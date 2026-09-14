/**
 * Stage 1 bucket 1.3 — inspectable project and discretization diagnostics.
 *
 * The Stage 0 feasibility gate was reviewed by hand through crude artifacts.
 * This module is the production equivalent for the normalized brief itself: a
 * deterministic, human-readable report of what the solver will actually see
 * (grid rectangles, expanded room instances, unit conversions) plus the
 * conservative-snapping evidence that explains where authored millimetres were
 * lost on the 250 mm grid.
 *
 * Both renderers are pure functions of the normalized project: no wall clock,
 * no locale formatting, no ambient state. `scripts/inspect-canonical.mjs`
 * writes these texts to `artifacts/planlab/milestone-1/diagnostics/`, and the
 * suite fails if the committed artifacts drift.
 */
import { GRID_MM } from "./constants.ts";
import { formatMmAsMetres } from "./geometry.ts";
import type {
  NormalizedProject,
  NormalizedSite,
  RoomInstance,
  RoomSelector,
} from "./model.ts";
import { fingerprintNormalizedProject } from "./serialization.ts";

export const PROJECT_INSPECTION_VERSION = "planlab-project-inspection-1";

export type DiscretizationFindingCode =
  | "EXACT_GRID_FIT"
  | "SITE_TRUNCATED_TO_GRID"
  | "ENVELOPE_INSET_LOSS";

/** One hand-inspectable statement about authored millimetres versus solver units. */
export interface DiscretizationFinding {
  code: DiscretizationFindingCode;
  severity: "info" | "warning";
  message: string;
}

export interface DiscretizationDiagnostic {
  version: string;
  projectId: string;
  gridMm: number;
  /** The normalized site, quoted verbatim so the report cannot drift from the solver input. */
  site: NormalizedSite;
  snappedSiteMm: { width: number; depth: number };
  /** Authored site millimetres the grid cannot represent (floor of width/depth). */
  siteTruncationMm: { width: number; depth: number };
  exact: boolean;
  findings: DiscretizationFinding[];
}

export interface ProjectInspectionDiagnostic {
  version: string;
  projectId: string;
  fingerprint: string;
  discretization: DiscretizationDiagnostic;
  text: string;
}

function formatAreaMm2(mm2: number): string {
  return `${(mm2 / 1_000_000).toFixed(2)} m²`;
}

function formatRectMm(rect: { x: number; y: number; width: number; depth: number }): string {
  return `${rect.width} × ${rect.depth} mm at x ${rect.x} mm, y ${rect.y} mm`;
}

/** Discretization evidence for a normalized project, with findings, no re-normalization. */
export function createDiscretizationDiagnostic(project: NormalizedProject): DiscretizationDiagnostic {
  const site = project.site;
  const snappedSiteMm = {
    width: site.site.width * GRID_MM,
    depth: site.site.depth * GRID_MM,
  };
  const siteTruncationMm = {
    width: site.exactSiteMm.width - snappedSiteMm.width,
    depth: site.exactSiteMm.depth - snappedSiteMm.depth,
  };
  const insetLossMm = site.gridInsetLossMm;
  const insetTotal = insetLossMm.north + insetLossMm.east + insetLossMm.south + insetLossMm.west;
  const truncated = siteTruncationMm.width > 0 || siteTruncationMm.depth > 0;
  const exact = !truncated && insetTotal === 0 && site.discretizationLossMm2 === 0;

  const findings: DiscretizationFinding[] = [];
  if (exact) {
    findings.push({
      code: "EXACT_GRID_FIT",
      severity: "info",
      message: `authored site and envelope land exactly on the ${GRID_MM} mm grid; no authored millimetres are lost`,
    });
  }
  if (truncated) {
    findings.push({
      code: "SITE_TRUNCATED_TO_GRID",
      severity: "warning",
      message:
        `site edges are floored to whole ${GRID_MM} mm units, dropping ${siteTruncationMm.width} mm of width and ${siteTruncationMm.depth} mm of depth`,
    });
  }
  if (insetTotal > 0 || site.discretizationLossMm2 > 0) {
    findings.push({
      code: "ENVELOPE_INSET_LOSS",
      severity: "warning",
      message:
        `conservative offset snapping insets the buildable envelope by ${insetTotal} mm in total (${formatAreaMm2(site.discretizationLossMm2)} of envelope area)`,
    });
  }

  return {
    version: PROJECT_INSPECTION_VERSION,
    projectId: project.projectId,
    gridMm: GRID_MM,
    site,
    snappedSiteMm,
    siteTruncationMm,
    exact,
    findings,
  };
}

/** Text block for one discretization diagnostic; the manual inspection path for grid loss. */
export function renderDiscretizationText(diagnostic: DiscretizationDiagnostic): string {
  const site = diagnostic.site;
  const loss = site.gridInsetLossMm;
  const lines = [
    `Discretization (grid ${diagnostic.gridMm} mm)`,
    `Project: ${diagnostic.projectId}`,
    `Authored site: ${site.exactSiteMm.width} × ${site.exactSiteMm.depth} mm`,
    `Snapped site: ${site.site.width} × ${site.site.depth} units = ${diagnostic.snappedSiteMm.width} × ${diagnostic.snappedSiteMm.depth} mm (truncated width ${diagnostic.siteTruncationMm.width} mm, depth ${diagnostic.siteTruncationMm.depth} mm)`,
    `Authored envelope: ${formatRectMm(site.exactEnvelopeMm)}`,
    `Snapped envelope: ${site.envelope.width} × ${site.envelope.depth} units at x ${site.envelope.x}, y ${site.envelope.y} = ${formatRectMm(site.snappedEnvelopeMm)}`,
    `Inset loss: north ${loss.north} mm, east ${loss.east} mm, south ${loss.south} mm, west ${loss.west} mm`,
    `Discretization loss: ${site.discretizationLossMm2} mm² (${formatAreaMm2(site.discretizationLossMm2)})`,
    `Findings: ${diagnostic.findings.map((finding) => finding.code).join(", ") || "none"}`,
  ];
  for (const finding of diagnostic.findings) {
    lines.push(`- ${finding.code} (${finding.severity}): ${finding.message}`);
  }
  return lines.join("\n");
}

function renderDimensionConstraints(room: RoomInstance): string {
  const dimensions = room.dimensions;
  const parts = [
    `min area ${formatAreaMm2(dimensions.minAreaMm2)} (${dimensions.minAreaUnits2} units²)`,
  ];
  if (dimensions.preferredAreaMm2 !== undefined) {
    parts.push(
      `preferred area ${formatAreaMm2(dimensions.preferredAreaMm2)} (${dimensions.preferredAreaUnits2} units²)`,
    );
  }
  if (dimensions.minShortSideMm !== undefined) {
    parts.push(`min short side ${formatMmAsMetres(dimensions.minShortSideMm, 2)} m`);
  }
  if (dimensions.minWidthMm !== undefined) {
    parts.push(`min width ${formatMmAsMetres(dimensions.minWidthMm, 2)} m`);
  }
  if (dimensions.minDepthMm !== undefined) {
    parts.push(`min depth ${formatMmAsMetres(dimensions.minDepthMm, 2)} m`);
  }
  if (dimensions.maxAspectRatio !== undefined) {
    parts.push(`max aspect ratio ${dimensions.maxAspectRatio}`);
  }
  return parts.join(" | ");
}

function renderRoomInstance(room: RoomInstance): string {
  const traits = [
    `zone ${room.traits.zone}`,
    `wet ${room.traits.wet ? "yes" : "no"}`,
    `exterior ${room.traits.exteriorPreference}`,
    room.traits.mayBePassThrough ? "pass-through allowed" : "pass-through not allowed",
  ];
  if (room.traits.frontage) {
    traits.push(`frontage ${room.traits.frontage.side} ${room.traits.frontage.kind}`);
  }
  if (room.traits.vehicleSpaces !== undefined) {
    traits.push(`${room.traits.vehicleSpaces} vehicle spaces`);
  }
  return `- ${room.id}: ${room.kind} "${room.displayName}" [${room.inclusion}] | ${renderDimensionConstraints(room)} | ${traits.join(", ")}`;
}

/**
 * Full inspection text for a normalized project: identity, fingerprint,
 * discretization, the expanded program, relationships, and planning settings.
 */
export function renderProjectInspectionText(
  project: NormalizedProject,
  diagnostic: DiscretizationDiagnostic = createDiscretizationDiagnostic(project),
  fingerprint: string = fingerprintNormalizedProject(project),
): string {
  const lines = [
    `PlanLab project inspection ${PROJECT_INSPECTION_VERSION}`,
    `Project: ${project.projectId} (${project.name})`,
    `Schema: v${project.schemaVersion} | Seed: ${project.generation.seed}`,
    `Fingerprint: ${fingerprint}`,
    "",
    renderDiscretizationText(diagnostic),
    "",
    `Program: ${project.rooms.length} room instances`,
  ];
  for (const room of project.rooms) lines.push(renderRoomInstance(room));

  lines.push("", `Relationships: ${project.relationships.length}`);
  for (const relationship of project.relationships) {
    const details = [
      relationship.kind,
      relationship.source,
      `aggregation ${relationship.aggregation ?? "any"}`,
    ];
    if (relationship.strength !== undefined) details.push(`strength ${relationship.strength}`);
    if (relationship.minSharedWallM !== undefined) {
      details.push(`min shared wall ${relationship.minSharedWallM} m`);
    }
    if (relationship.targetDistanceM !== undefined) {
      details.push(`target distance ${relationship.targetDistanceM} m`);
    }
    lines.push(
      `- ${relationship.id}: ${describeSelector(relationship.from)} → ${describeSelector(relationship.to)} (${details.join(", ")})`,
    );
  }

  const planning = project.planning;
  const planningParts = [
    `min circulation ${planning.minimumCirculationWidthMm} mm (${planning.minimumCirculationWidthUnits} units)`,
    `target GFA ${planning.targetGfaMm2 === undefined ? "none" : formatAreaMm2(planning.targetGfaMm2)}`,
    `max GFA ${planning.maxGfaMm2 === undefined ? "none" : formatAreaMm2(planning.maxGfaMm2)}`,
    `max unallocated interior ${(planning.maxUnallocatedInteriorRatio * 100).toFixed(1)}%`,
  ];
  lines.push("", `Planning: ${planningParts.join(" | ")}`);
  return lines.join("\n");
}

function describeSelector(selector: RoomSelector): string {
  if (typeof selector === "string") return selector;
  if (selector.type === "kind") return `kind ${selector.kind}`;
  return `${selector.type} ${selector.id}`;
}

/** Structured + textual inspection of one normalized project. */
export function createProjectInspection(project: NormalizedProject): ProjectInspectionDiagnostic {
  const discretization = createDiscretizationDiagnostic(project);
  const fingerprint = fingerprintNormalizedProject(project);
  return {
    version: PROJECT_INSPECTION_VERSION,
    projectId: project.projectId,
    fingerprint,
    discretization,
    text: renderProjectInspectionText(project, discretization, fingerprint),
  };
}
