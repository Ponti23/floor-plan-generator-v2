import { GRID_M2, GRID_UNIT_METRES } from "../domain/constants.ts";
import type { GridRect } from "../domain/geometry.ts";
import type { Layout, AccessPortal, PlacedSpace } from "../domain/layout.ts";
import type { NormalizedProject } from "../domain/model.ts";
import type { PlanLabPresentationCopy } from "./presentation-copy.ts";
import { DEFAULT_VIEWPORT_TRANSFORM, viewportTransformAttribute, type ViewportTransform } from "./viewport.ts";

export interface ProjectedPortalLine {
  portal: AccessPortal;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProjectedEvidence {
  /** Authoritative rectangles resolved from evidence references. */
  rects: GridRect[];
  /** Authoritative portal spans resolved from evidence references. */
  portals: ProjectedPortalLine[];
}

export interface SvgProjectionOptions {
  layout?: Layout;
  project: NormalizedProject;
  stale?: boolean;
  focusedEvidenceRefs?: readonly string[];
  transform?: ViewportTransform;
  copy: PlanLabPresentationCopy["ui"];
}

/**
 * Root margin in grid units.  The scale bar and the site-dimension label are
 * drawn below the site rectangle, so the margin must be large enough to keep
 * them inside the viewBox instead of clipping at the canvas edge.
 */
const ROOT_MARGIN_UNITS = 6;
/**
 * Extra room below the site rectangle.  The site-dimension row and the scale
 * bar are drawn under the site, and the canvas reserves a further band under
 * the plan for the entrance label, so the drawing must not run to the viewBox
 * edge.
 */
const ROOT_BOTTOM_MARGIN_UNITS = 16;
const LAYER_ORDER = [
  "grid",
  "site",
  "envelope",
  "footprint",
  "spaces-portals",
  "labels",
  "evidence",
  "north-scale",
] as const;

export type SvgLayerName = typeof LAYER_ORDER[number];

export function svgLayerOrder(): readonly SvgLayerName[] {
  return LAYER_ORDER;
}

/**
 * The plan viewBox in grid units: one source of truth shared by the projection
 * that renders the SVG and by the viewport maths that maps pointer positions
 * back into it.  A second, hand-written copy of these margins is how zoom
 * anchors and pan deltas silently drift from what the user sees.
 */
export function planViewBox(project: NormalizedProject): GridRect {
  const site = project.site.site;
  return {
    x: -ROOT_MARGIN_UNITS,
    y: -ROOT_MARGIN_UNITS,
    width: site.width + ROOT_MARGIN_UNITS * 2,
    depth: site.depth + ROOT_MARGIN_UNITS + ROOT_BOTTOM_MARGIN_UNITS,
  };
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function escapeAttribute(value: string | number): string {
  return escapeText(String(value));
}

function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function formatArea(areaUnits2: number, copy: PlanLabPresentationCopy["ui"]): string {
  return `${(areaUnits2 * GRID_M2).toFixed(1)} ${copy.units.squareMetre}`;
}

function formatLength(lengthUnits: number, copy: PlanLabPresentationCopy["ui"]): string {
  return `${(lengthUnits * GRID_UNIT_METRES).toFixed(2)} ${copy.units.metre}`;
}

function roomKindClass(kind: string): string {
  return `room-kind-${kind}`;
}

function rectKey(rect: GridRect): string {
  return `${rect.x},${rect.y},${rect.width},${rect.depth}`;
}

function portalKey(portal: AccessPortal): string {
  return `${portal.id}:${portal.wall}:${portal.start}:${portal.length}`;
}

function spaceForPortal(layout: Layout, portal: AccessPortal): PlacedSpace | undefined {
  return layout.spaces.find((space) => space.instanceId === portal.a) ??
    layout.spaces.find((space) => space.instanceId === portal.b);
}

/** Project a portal's grid-unit wall span into an SVG line. */
export function projectPortalLine(layout: Layout, portal: AccessPortal): ProjectedPortalLine | null {
  const owner = spaceForPortal(layout, portal);
  const rect = owner?.rect ?? layout.footprint;
  if (portal.length <= 0) return null;
  switch (portal.wall) {
    case "north":
      return { portal, x1: portal.start, y1: rect.y, x2: portal.start + portal.length, y2: rect.y };
    case "south":
      return { portal, x1: portal.start, y1: rect.y + rect.depth, x2: portal.start + portal.length, y2: rect.y + rect.depth };
    case "west":
      return { portal, x1: rect.x, y1: portal.start, x2: rect.x, y2: portal.start + portal.length };
    case "east":
      return { portal, x1: rect.x + rect.width, y1: portal.start, x2: rect.x + rect.width, y2: portal.start + portal.length };
  }
}

/**
 * Resolve semantic evidence references against the authoritative layout.
 *
 * Payloads intentionally omit the large derived facts index.  These small
 * projections therefore resolve only references whose geometry is present in
 * the layout itself; non-geometric refs are left out instead of guessed.
 */
export function projectEvidenceGeometry(
  layout: Layout | undefined,
  evidenceRefs: readonly string[] = [],
): ProjectedEvidence {
  if (!layout || evidenceRefs.length === 0) return { rects: [], portals: [] };
  const rects: GridRect[] = [];
  const portals: ProjectedPortalLine[] = [];
  const rectKeys = new Set<string>();
  const portalKeys = new Set<string>();
  const addRect = (rect: GridRect | undefined): void => {
    if (!rect || rect.width <= 0 || rect.depth <= 0) return;
    const key = rectKey(rect);
    if (rectKeys.has(key)) return;
    rectKeys.add(key);
    rects.push(rect);
  };
  const addPortal = (portal: AccessPortal | undefined): void => {
    if (!portal) return;
    const line = projectPortalLine(layout, portal);
    if (!line) return;
    const key = portalKey(portal);
    if (portalKeys.has(key)) return;
    portalKeys.add(key);
    portals.push(line);
  };
  const addSpace = (id: string): void => {
    addRect(layout.spaces.find((space) => space.instanceId === id)?.rect);
  };
  const addSpacesByRole = (roles: readonly PlacedSpace["role"][]): void => {
    for (const space of layout.spaces) {
      if (roles.includes(space.role)) addRect(space.rect);
    }
  };

  for (const reference of evidenceRefs) {
    const parts = reference.split(":");
    const kind = parts[0];
    const id = parts[1];
    if (kind === "room" || kind === "route" || kind === "space") {
      if (id) addSpace(id);
    } else if (kind === "portal") {
      addPortal(layout.portals.find((portal) => portal.id === id));
    } else if (kind === "subject") {
      const space = layout.spaces.find((candidate) => candidate.instanceId === id);
      if (space) addRect(space.rect);
      else addPortal(layout.portals.find((portal) => portal.id === id));
    } else if (kind === "layout" && id === layout.id) {
      addRect(layout.footprint);
    } else if (kind === "footprint") {
      addRect(layout.footprint);
    } else if (kind === "circulation") {
      addSpacesByRole(["circulation", "entry"]);
    } else if (kind === "access") {
      addSpacesByRole(["circulation", "entry"]);
      for (const portal of layout.portals) {
        if (portal.kind === "pedestrian") addPortal(portal);
      }
    }
  }
  return { rects, portals };
}

function portalMarkup(layout: Layout | undefined): string {
  if (!layout) return "";
  return layout.portals.map((portal) => {
    const line = projectPortalLine(layout, portal);
    if (!line) return "";
    const kind = portal.kind === "vehicle" ? "vehicle" : "pedestrian";
    return `<line class="portal portal-${kind}" data-portal-id="${escapeAttribute(portal.id)}" x1="${formatNumber(line.x1)}" y1="${formatNumber(line.y1)}" x2="${formatNumber(line.x2)}" y2="${formatNumber(line.y2)}"/>`;
  }).join("");
}

function dimensionsMarkup(
  project: NormalizedProject,
  copy: PlanLabPresentationCopy["ui"],
): string {
  const site = project.site.site;
  const envelope = project.site.envelope;
  const top = Math.max(-1, envelope.y - 2.6);
  const left = Math.max(-1, envelope.x - 2.6);
  return `<g class="dimensions" aria-hidden="true">
    <line class="dimension-line" x1="${formatNumber(envelope.x)}" y1="${formatNumber(top)}" x2="${formatNumber(envelope.x + envelope.width)}" y2="${formatNumber(top)}"/>
    <text class="dimension-label" x="${formatNumber(envelope.x + envelope.width / 2)}" y="${formatNumber(top - .8)}">${escapeText(formatLength(envelope.width, copy))}</text>
    <line class="dimension-line" x1="${formatNumber(left)}" y1="${formatNumber(envelope.y)}" x2="${formatNumber(left)}" y2="${formatNumber(envelope.y + envelope.depth)}"/>
    <text class="dimension-label dimension-label-vertical" x="${formatNumber(left - .8)}" y="${formatNumber(envelope.y + envelope.depth / 2)}">${escapeText(formatLength(envelope.depth, copy))}</text>
    <text class="site-dimension" x="${formatNumber(site.width / 2)}" y="${formatNumber(site.depth + 2.2)}">${escapeText(formatLength(site.width, copy))} × ${escapeText(formatLength(site.depth, copy))}</text>
  </g>`;
}

function scaleBarMarkup(project: NormalizedProject, copy: PlanLabPresentationCopy["ui"]): string {
  const site = project.site.site;
  // A bar scale, not a bare line: alternating filled segments with numbered
  // ticks, ending in the total length.  The number of segments stays fixed so
  // the bar reads as a scale at any site size.
  const segments = 3;
  const barUnits = Math.min(24, Math.max(12, Math.floor(site.width / 3)));
  const segment = barUnits / segments;
  const x0 = Math.max(1, site.width - barUnits - 3);
  const y = site.depth + 2.4;
  const height = 1.1;
  const metresPerSegment = segment * GRID_UNIT_METRES;
  const blocks = Array.from({ length: segments }, (_, index) => {
    const x = x0 + index * segment;
    const shade = index % 2 === 0 ? "scale-bar-dark" : "scale-bar-light";
    return `<rect class="${shade}" x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(segment)}" height="${formatNumber(height)}"/>`;
  }).join("");
  const ticks = Array.from({ length: segments }, (_, index) => {
    const x = x0 + index * segment;
    const value = Number((index * metresPerSegment).toFixed(2));
    return `<line class="scale-tick" x1="${formatNumber(x)}" y1="${formatNumber(y - .55)}" x2="${formatNumber(x)}" y2="${formatNumber(y + height + .55)}"/><text class="scale-tick-label" x="${formatNumber(x)}" y="${formatNumber(y + height + 2.1)}">${escapeText(String(value))}</text>`;
  }).join("");
  const endX = x0 + barUnits;
  const endLabel = `${formatLength(barUnits, copy).replace(/\.00/, "")}`;
  return `${blocks}${ticks}<text class="scale-label" x="${formatNumber(endX + .8)}" y="${formatNumber(y + height + 2.1)}">${escapeText(endLabel)}</text>`;
}

function northScaleMarkup(project: NormalizedProject, copy: PlanLabPresentationCopy["ui"]): string {
  const site = project.site.site;
  return `<g class="north-scale" aria-hidden="true">
    <text class="north" x="${formatNumber(site.width - 2)}" y="2">${escapeText(copy.northSymbol)}</text>
    <path class="north-arrow" d="M ${formatNumber(site.width - 2)} 2.8 L ${formatNumber(site.width - 2)} 5.5"/>
    ${scaleBarMarkup(project, copy)}
  </g>`;
}

function evidenceMarkup(evidence: ProjectedEvidence): string {
  const rects = evidence.rects.map((rect) => `<rect class="evidence-highlight" x="${formatNumber(rect.x)}" y="${formatNumber(rect.y)}" width="${formatNumber(rect.width)}" height="${formatNumber(rect.depth)}"/>`).join("");
  const portals = evidence.portals.map((line) => `<line class="evidence-portal-highlight" data-portal-id="${escapeAttribute(line.portal.id)}" x1="${formatNumber(line.x1)}" y1="${formatNumber(line.y1)}" x2="${formatNumber(line.x2)}" y2="${formatNumber(line.y2)}"/>`).join("");
  return `${rects}${portals}`;
}

export function projectPlanSvg(options: SvgProjectionOptions): string {
  const {
    project,
    layout,
    stale = false,
    focusedEvidenceRefs = [],
    transform = DEFAULT_VIEWPORT_TRANSFORM,
    copy,
  } = options;
  const site = project.site.site;
  const envelope = project.site.envelope;
  const root = planViewBox(project);
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const spaces = layout?.spaces ?? [];
  const evidence = projectEvidenceGeometry(layout, focusedEvidenceRefs);
  const staleClass = stale ? " stale-plan" : "";
  const spaceMarkup = spaces.map((space) => {
    const room = roomById.get(space.instanceId);
    const className = room ? roomKindClass(room.kind) : space.role;
    return `<rect class="space ${className}" data-space-id="${escapeAttribute(space.instanceId)}" x="${formatNumber(space.rect.x)}" y="${formatNumber(space.rect.y)}" width="${formatNumber(space.rect.width)}" height="${formatNumber(space.rect.depth)}"/>`;
  }).join("");
  const labelMarkup = spaces.map((space) => {
    const room = roomById.get(space.instanceId);
    const label = room?.displayName ?? (space.role === "circulation" ? copy.circulationLegend : space.role === "entry" ? copy.entrySpaceLabel : space.instanceId);
    const centreX = space.rect.x + space.rect.width / 2;
    const centreY = space.rect.y + space.rect.depth / 2;
    // Rooms carry their area on a second line.  Circulation and entry runs are
    // often a single grid unit wide, where a second line would collide with the
    // neighbouring room labels, so they keep the name only.
    const area = room ? `<tspan x="${formatNumber(centreX)}" dy="2.2">${escapeText(formatArea(space.rect.width * space.rect.depth, copy))}</tspan>` : "";
    const baseline = room ? centreY - 1 : centreY;
    return `<text class="space-label" data-space-label="${escapeAttribute(space.instanceId)}" x="${formatNumber(centreX)}" y="${formatNumber(baseline)}">${escapeText(label)}${area}</text>`;
  }).join("");
  const footprint = layout
    ? `<rect class="footprint" data-footprint="true" x="${formatNumber(layout.footprint.x)}" y="${formatNumber(layout.footprint.y)}" width="${formatNumber(layout.footprint.width)}" height="${formatNumber(layout.footprint.depth)}"/>`
    : "";
  const gridId = `plan-grid-${layout?.id ?? "empty"}`.replace(/[^A-Za-z0-9_-]/g, "-");
  const layers: Record<SvgLayerName, string> = {
    grid: `<g class="svg-layer grid-layer" data-layer="grid"><rect class="grid" style="fill:url(#${escapeAttribute(gridId)})" x="${formatNumber(root.x)}" y="${formatNumber(root.y)}" width="${formatNumber(root.width)}" height="${formatNumber(root.depth)}"/></g>`,
    site: `<g class="svg-layer site-layer" data-layer="site"><rect class="site" x="${formatNumber(site.x)}" y="${formatNumber(site.y)}" width="${formatNumber(site.width)}" height="${formatNumber(site.depth)}"/></g>`,
    envelope: `<g class="svg-layer envelope-layer" data-layer="envelope"><rect class="envelope" x="${formatNumber(envelope.x)}" y="${formatNumber(envelope.y)}" width="${formatNumber(envelope.width)}" height="${formatNumber(envelope.depth)}"/></g>`,
    footprint: `<g class="svg-layer footprint-layer" data-layer="footprint">${footprint}</g>`,
    "spaces-portals": `<g class="svg-layer spaces-portals-layer" data-layer="spaces-portals">${spaceMarkup}${portalMarkup(layout)}</g>`,
    labels: `<g class="svg-layer labels-layer" data-layer="labels">${dimensionsMarkup(project, copy)}${labelMarkup}</g>`,
    evidence: `<g class="svg-layer evidence-layer" data-layer="evidence">${evidenceMarkup(evidence)}</g>`,
    "north-scale": `<g class="svg-layer north-scale-layer" data-layer="north-scale">${northScaleMarkup(project, copy)}</g>`,
  };
  return `<svg class="plan-svg${staleClass}" role="img" aria-label="${escapeAttribute(stale ? copy.stalePlanAria : copy.generatedPlanAria)}" viewBox="${formatNumber(root.x)} ${formatNumber(root.y)} ${formatNumber(root.width)} ${formatNumber(root.depth)}" preserveAspectRatio="xMidYMid meet" data-root-width="${formatNumber(root.width)}" data-root-depth="${formatNumber(root.depth)}">
    <defs><pattern id="${escapeAttribute(gridId)}" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M 2 0 L 0 0 0 2"/></pattern><marker id="dimension-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 6 3 L 0 6 z"/></marker></defs>
    <g class="viewport-transform" data-viewport-transform="true" transform="${escapeAttribute(viewportTransformAttribute(transform))}">${LAYER_ORDER.map((layer) => layers[layer]).join("")}</g>
  </svg>`;
}
