import { centre, formatMmAsMetres, isGridRect, type GridRect } from "./geometry.ts";
import { GRID_MM, GRID_UNIT_METRES } from "./constants.ts";
import type { NormalizedProject } from "./model.ts";
import type { Layout, PlacedSpace } from "./layout.ts";
import {
  computeLayoutFacts,
  type LayoutFacts,
} from "./metrics.ts";
import {
  scoreLayoutProfiles,
  type LayoutScorecardSet,
} from "./scoring.ts";
import {
  validateLayout,
  type ValidationResult,
} from "./validation.ts";

export const DIAGNOSTIC_VERSION = "planlab-diagnostic-0.4";

export interface DiagnosticRenderOptions {
  includeGrid?: boolean;
  includeLabels?: boolean;
  scorecards?: LayoutScorecardSet;
}

export interface CrudeLayoutDiagnostic {
  version: string;
  layoutId: string;
  validation: ValidationResult;
  facts: LayoutFacts;
  scorecards: LayoutScorecardSet;
  svg: string;
  text: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatArea(units2: number): string {
  return `${(units2 * GRID_UNIT_METRES ** 2).toFixed(2)} m²`;
}

function validSpaces(layout: Layout): (PlacedSpace & { rect: GridRect })[] {
  return (Array.isArray(layout.spaces) ? layout.spaces : []).filter(
    (space): space is PlacedSpace & { rect: GridRect } => isGridRect(space.rect),
  );
}

function roleFill(space: PlacedSpace): string {
  switch (space.role) {
    case "circulation": return "#d8dee9";
    case "entry": return "#bfc9d8";
    default: return "#f4ead5";
  }
}

function gridMarkup(footprint: GridRect): string {
  const lines: string[] = [];
  for (let x = footprint.x; x <= footprint.x + footprint.width; x += 4) {
    lines.push(`<path d="M ${x} ${footprint.y} V ${footprint.y + footprint.depth}"/>`);
  }
  for (let y = footprint.y; y <= footprint.y + footprint.depth; y += 4) {
    lines.push(`<path d="M ${footprint.x} ${y} H ${footprint.x + footprint.width}"/>`);
  }
  return lines.join("");
}

function portalMarkup(
  layout: Layout,
  footprint: GridRect,
): string {
  const spaces = new Map(validSpaces(layout).map((space) => [space.instanceId, space]));
  const lines: string[] = [];
  for (const portal of Array.isArray(layout.portals) ? layout.portals : []) {
    const hostId = portal.a === "exterior" ? portal.b : portal.a;
    const host = spaces.get(hostId);
    if (!host || !Number.isSafeInteger(portal.start) || !Number.isSafeInteger(portal.length) || portal.length <= 0) continue;
    const edge = portal.wall === "north"
      ? { x1: portal.start, y1: host.rect.y, x2: portal.start + portal.length, y2: host.rect.y }
      : portal.wall === "south"
      ? { x1: portal.start, y1: host.rect.y + host.rect.depth, x2: portal.start + portal.length, y2: host.rect.y + host.rect.depth }
      : portal.wall === "east"
      ? { x1: host.rect.x + host.rect.width, y1: portal.start, x2: host.rect.x + host.rect.width, y2: portal.start + portal.length }
      : { x1: host.rect.x, y1: portal.start, x2: host.rect.x, y2: portal.start + portal.length };
    // Keep the footprint referenced so malformed interior portals cannot
    // accidentally produce an unbounded diagnostic line.
    const inFootprint = [edge.x1, edge.x2].every((x) => x >= footprint.x && x <= footprint.x + footprint.width) &&
      [edge.y1, edge.y2].every((y) => y >= footprint.y && y <= footprint.y + footprint.depth);
    if (!inFootprint) continue;
    lines.push(`<line data-portal-id="${escapeXml(portal.id)}" data-kind="${escapeXml(portal.kind)}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" stroke="${portal.kind === "vehicle" ? "#b45309" : "#2563eb"}" stroke-width="0.6"/>`);
  }
  return lines.join("");
}

/**
 * Render the intentionally ugly, inspectable SVG used during the feasibility
 * spike. It is a projection of authoritative rectangles; it has no UI state
 * and cannot change the candidate or its score.
 */
export function renderDiagnosticSvg(
  layout: Layout,
  project: NormalizedProject,
  options: DiagnosticRenderOptions = {},
): string {
  const footprint = isGridRect(layout.footprint) ? layout.footprint : { x: 0, y: 0, width: 1, depth: 1 };
  const spaces = validSpaces(layout);
  const labels = options.includeLabels !== false;
  const grid = options.includeGrid
    ? `<g aria-label="grid" fill="none" stroke="#e5e7eb" stroke-width="0.08">${gridMarkup(footprint)}</g>`
    : "";
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const spaceMarkup = spaces.map((space) => {
    const id = escapeXml(space.instanceId);
    const label = escapeXml(roomById.get(space.instanceId)?.displayName ?? space.instanceId);
    const title = `${label} ${formatMmAsMetres(space.rect.width * GRID_MM, 2)} × ${formatMmAsMetres(space.rect.depth * GRID_MM, 2)}`;
    const centrePoint = centre(space.rect);
    return `<g data-space-id="${id}" data-role="${space.role}"><title>${escapeXml(title)}</title><rect x="${space.rect.x}" y="${space.rect.y}" width="${space.rect.width}" height="${space.rect.depth}" fill="${roleFill(space)}" stroke="#111827" stroke-width="0.18"/>${labels ? `<text x="${centrePoint.x}" y="${centrePoint.y}" text-anchor="middle" dominant-baseline="middle" font-size="1.6">${label}</text>` : ""}</g>`;
  }).join("");
  const portals = portalMarkup(layout, footprint);
  const scoreSummary = options.scorecards
    ? options.scorecards.profiles.map((scorecard) => `${scorecard.profile.label}: ${scorecard.overallScore}`).join(" | ")
    : "";
  const title = escapeXml(`PlanLab diagnostic ${layout.id}${scoreSummary ? ` — ${scoreSummary}` : ""}`);
  const northX = footprint.x + footprint.width - 3;
  const northY = footprint.y + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="diagnostic-title" viewBox="${footprint.x} ${footprint.y} ${footprint.width} ${footprint.depth}"><title id="diagnostic-title">${title}</title><rect data-layer="footprint" x="${footprint.x}" y="${footprint.y}" width="${footprint.width}" height="${footprint.depth}" fill="#ffffff" stroke="#111827" stroke-width="0.35"/>${grid}${spaceMarkup}<g data-layer="portals" fill="none">${portals}</g><g data-layer="orientation" aria-label="north"><path d="M ${northX} ${northY + 4} V ${northY}" stroke="#111827" stroke-width="0.25"/><path d="M ${northX} ${northY} l -1 1 M ${northX} ${northY} l 1 1" stroke="#111827" stroke-width="0.25"/><text x="${northX}" y="${northY - 0.8}" text-anchor="middle" font-size="1.4">N</text></g></svg>`;
}

/** Plain text diagnostic with raw evidence beside each derived score. */
export function renderDiagnosticText(
  layout: Layout,
  project: NormalizedProject,
  facts = computeLayoutFacts(layout, project),
  validation = validateLayout(layout, project),
  scorecards?: LayoutScorecardSet,
): string {
  const footprint = isGridRect(layout.footprint) ? layout.footprint : undefined;
  const lines = [
    `PlanLab diagnostic ${layout.id}`,
    `Validity: ${validation.valid ? "PASS" : "FAIL"} (${validation.violations.length} hard finding${validation.violations.length === 1 ? "" : "s"})`,
    footprint
      ? `Footprint: ${formatMmAsMetres(footprint.width * GRID_MM, 2)} × ${formatMmAsMetres(footprint.depth * GRID_MM, 2)} (${formatArea(facts.footprintAreaUnits2)})`
      : "Footprint: invalid",
    `Site: ${formatArea(facts.siteAreaUnits2)} | Buildable: ${formatArea(facts.buildableAreaUnits2)}`,
    `Programmed usable: ${formatArea(facts.programmedUsableAreaUnits2)} | Garage: ${formatArea(facts.garageAreaUnits2)} | Circulation: ${formatArea(facts.circulationAreaUnits2)}`,
    `GFA: ${formatArea(facts.footprintAreaUnits2)} | target Δ ${formatArea(facts.gfaDeltaFromTargetUnits2)} | max Δ ${formatArea(facts.gfaDeltaFromMaxUnits2)}`,
    `Unallocated interior: ${formatArea(facts.unallocatedInteriorAreaUnits2)} (${(facts.unallocatedInteriorRatio * 100).toFixed(1)}%) | Planning efficiency: ${(facts.planningEfficiency * 100).toFixed(1)}% | Allocation ratio (diagnostic): ${(facts.allocationRatio * 100).toFixed(1)}%`,
    `Circulation ratio: ${(facts.circulationRatio * 100).toFixed(1)}%`,
    `Reachability: ${facts.reachableRequiredRoomCount}/${facts.requiredRoomCount} required rooms | Dead ends: ${facts.deadEndCount}`,
    `Portals: ${Array.isArray(layout.portals) ? layout.portals.length : 0}`,
    "Spaces:",
  ];
  for (const space of validSpaces(layout)) {
    const room = project.rooms.find((candidate) => candidate.id === space.instanceId);
    lines.push(`- ${room?.displayName ?? space.instanceId} [${space.role}] @ ${space.rect.x},${space.rect.y} ${formatMmAsMetres(space.rect.width * GRID_MM, 2)} × ${formatMmAsMetres(space.rect.depth * GRID_MM, 2)} (${formatArea(space.rect.width * space.rect.depth)})`);
  }
  if (validation.violations.length > 0) {
    lines.push("Hard findings:");
    for (const violation of validation.violations) lines.push(`- ${violation.code}: ${violation.subjects.join(", ") || "layout"}`);
  }
  const scores = scorecards?.profiles ?? [];
  if (scores.length > 0) {
    lines.push(`Score model: ${scores[0]!.scoreModelVersion}`);
    lines.push("Scores:");
    for (const scorecard of scores) {
      lines.push(`- ${scorecard.profile.label}: ${scorecard.overallScore}/100 | ${Object.entries(scorecard.categoryScores).map(([key, value]) => `${key} ${value}`).join(", ")}`);
      for (const explanation of scorecard.explanations.slice(0, 4)) lines.push(`  ${explanation.impact >= 0 ? "+" : "−"} ${explanation.key} [${explanation.evidenceRefs.join(", ")}]`);
    }
  }
  return lines.join("\n");
}

export const renderLayoutSvg = renderDiagnosticSvg;
export const renderSvgDiagnostic = renderDiagnosticSvg;
export const renderLayoutText = renderDiagnosticText;
export const renderTextDiagnostic = renderDiagnosticText;

export function createCrudeDiagnostic(
  layout: Layout,
  project: NormalizedProject,
  options: DiagnosticRenderOptions = {},
): CrudeLayoutDiagnostic {
  const validation = validateLayout(layout, project);
  const facts = computeLayoutFacts(layout, project, validation);
  const scorecards = options.scorecards ?? scoreLayoutProfiles(layout, project, facts, validation);
  return {
    version: DIAGNOSTIC_VERSION,
    layoutId: layout.id,
    validation,
    facts,
    scorecards,
    svg: renderDiagnosticSvg(layout, project, { ...options, scorecards }),
    text: renderDiagnosticText(layout, project, facts, validation, scorecards),
  };
}

export const makeCrudeDiagnostic = createCrudeDiagnostic;
export const diagnosticForLayout = createCrudeDiagnostic;
