import {
  area,
  containsRect,
  right,
  bottom,
  sharedWallLength,
  sharedWallSegments,
  unionArea,
  type GridRect,
} from "./geometry.ts";
import {
  GRID_MM2,
  GARAGE_MIN_DEPTH_UNITS,
  GARAGE_MIN_WIDTH_UNITS,
  MAX_GFA_M2,
  MIN_PORTAL_WIDTH_UNITS,
} from "./constants.ts";
import {
  normalizeProject,
  NormalizationError,
} from "./normalization.ts";
import type { NormalizedProject, RoomInstance } from "./model.ts";
import {
  EXTERIOR_SPACE_ID,
  type AccessPortal,
  type CirculationSkeleton,
  type CirculationSkeletonKind,
  type FootprintVariant,
  type Layout,
  type PlacedSpace,
} from "./layout.ts";
import { createSeededPrng, hashSeed, type SeededPrng } from "./prng.ts";
import { validateLayout, type ValidationResult } from "./validation.ts";
import {
  scoreCandidates,
  type ScoredLayoutCandidate,
} from "./scoring.ts";
import {
  DEFAULT_DIVERSITY_THRESHOLD,
  selectDiverseTriplet,
  type SelectedLayout,
  type TripletSelection,
} from "./diversity.ts";

export const GENERATOR_ENGINE_VERSION = "planlab-generator-0.2";
export const GENERATOR_RULE_VERSION = "planlab-core-1";

export interface GenerationBudget {
  beamWidth: number;
  maxExpansionsPerTopology: number;
  maxCandidatesPerTopology: number;
  maxTotalCandidates: number;
}

export const DEFAULT_GENERATION_BUDGET: Readonly<GenerationBudget> = Object.freeze({
  beamWidth: 64,
  maxExpansionsPerTopology: 15_000,
  maxCandidatesPerTopology: 100,
  maxTotalCandidates: 300,
});

export interface GenerationOptions {
  seed?: string;
  budget?: Partial<GenerationBudget>;
}

export interface GenerationDiagnostic {
  code:
    | "NORMALIZATION_FAILED"
    | "NO_FOOTPRINT_VARIANT"
    | "SEARCH_BUDGET_EXCEEDED"
    | "NO_VALID_LAYOUT"
    | "VALIDATION_REJECTED"
    | "INSUFFICIENT_CANDIDATES"
    | "INSUFFICIENT_DIVERSITY";
  message: string;
  topology?: CirculationSkeletonKind;
  footprintVariant?: string;
  expandedStates?: number;
  violations?: string[];
}

export interface GenerationResult {
  ok: boolean;
  layouts: Layout[];
  /** Alias retained for callers that call the pool “candidates”. */
  candidates: Layout[];
  diagnostics: GenerationDiagnostic[];
  /** One shared facts/metrics pass plus all three strategy scorecards. */
  analyses: ScoredLayoutCandidate[];
  /** Compatibility alias for callers that use “scorecards” for analyses. */
  scorecards: ScoredLayoutCandidate[];
  /** Joint strategy selection; it may honestly contain fewer than three options. */
  selection: TripletSelection;
  selected: SelectedLayout[];
  selectedLayouts: Layout[];
  options: SelectedLayout[];
  metadata: {
    engineVersion: string;
    ruleVersion: string;
    seed: string;
    budget: GenerationBudget;
    expandedStates: number;
    topologyExpansions: Record<CirculationSkeletonKind, number>;
    topologyCounts: Record<CirculationSkeletonKind, number>;
  };
}

interface InternalSkeleton extends CirculationSkeleton {
  garageSpaces: PlacedSpace[];
}

interface SearchState {
  spaces: PlacedSpace[];
  score: number;
  key: string;
}

interface SearchCandidate {
  layout: Layout;
  validation: ValidationResult;
  score: number;
  key: string;
}

const TOPOLOGY_ORDER: CirculationSkeletonKind[] = ["straight", "L", "T"];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isNormalized(value: unknown): value is NormalizedProject {
  return (
    value !== null &&
    typeof value === "object" &&
    "rooms" in value &&
    Array.isArray((value as { rooms?: unknown }).rooms) &&
    "site" in value
  );
}

function canonicalBudget(budget: Partial<GenerationBudget> | undefined): GenerationBudget {
  const result = {
    ...DEFAULT_GENERATION_BUDGET,
    ...(budget ?? {}),
  };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return result;
}

function projectSeed(project: NormalizedProject, options: string | GenerationOptions | undefined): string {
  if (typeof options === "string") return options;
  if (options?.seed !== undefined) return options.seed;
  return project.generation.seed;
}

function minimumRoomSpan(project: NormalizedProject): number {
  let span = project.planning.minimumCirculationWidthUnits;
  for (const room of project.rooms) {
    if (room.inclusion !== "required") continue;
    const dimensions = room.dimensions;
    span = Math.max(
      span,
      dimensions.minShortSideUnits ?? 1,
      dimensions.minWidthUnits ?? 1,
      dimensions.minDepthUnits ?? 1,
    );
  }
  return span;
}

function requiredRoomArea(project: NormalizedProject): number {
  return project.rooms
    .filter((room) => room.inclusion === "required")
    .reduce((total, room) => total + room.dimensions.minAreaUnits2, 0);
}

function footprintPlacement(
  envelope: GridRect,
  width: number,
  depth: number,
): GridRect {
  return {
    x: envelope.x + Math.floor((envelope.width - width) / 2),
    y: envelope.y + Math.floor((envelope.depth - depth) / 2),
    width,
    depth,
  };
}

function addDimensionCandidate(
  values: Set<string>,
  width: number,
  depth: number,
  envelope: GridRect,
  desiredArea: number,
  maxArea: number,
): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(depth)) return;
  if (width <= 0 || depth <= 0 || width > envelope.width || depth > envelope.depth) return;
  const candidateArea = width * depth;
  if (candidateArea < desiredArea || candidateArea > maxArea) return;
  values.add(`${width}x${depth}`);
}

/**
 * Derive a small stable set of rectangular footprints.  The target is treated
 * as a planning target, while the maximum GFA remains a hard upper bound.
 */
export function deriveFootprintVariants(
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
  seed = "",
): FootprintVariant[] {
  const project = isNormalized(projectOrBrief)
    ? projectOrBrief
    : normalizeProject(projectOrBrief);
  const envelope = project.site.envelope;
  const maxArea = Math.min(
    area(envelope),
    Math.floor((project.planning.maxGfaMm2 ?? MAX_GFA_M2 * 1_000_000) / GRID_MM2),
  );
  const required = requiredRoomArea(project);
  const circulationReserve = project.planning.minimumCirculationWidthUnits *
    Math.max(project.planning.minimumCirculationWidthUnits * 2, 8);
  const target = project.planning.targetGfaMm2 === undefined
    ? required + circulationReserve
    : Math.ceil(project.planning.targetGfaMm2 / GRID_MM2);
  const largestRoomArea = project.rooms.reduce(
    (largest, room) => room.inclusion === "required"
      ? Math.max(largest, room.dimensions.minAreaUnits2)
      : largest,
    0,
  );
  // The footprint target is gross area: circulation/entry (and an anchor
  // garage when present) still need room inside it.  Reserve two corridor
  // widths plus the entry so a target that merely equals room minima does not
  // produce a structurally impossible footprint.
  const minimumArea = Math.max(required + circulationReserve + largestRoomArea, target);
  const span = minimumRoomSpan(project);
  if (minimumArea > maxArea || span > envelope.width || span > envelope.depth) return [];

  const dimensions = new Set<string>();
  const root = Math.sqrt(minimumArea);
  const minimumDepth = Math.max(span, Math.ceil(minimumArea / envelope.width));
  for (let width = span; width <= envelope.width; width += 1) {
    const nearTarget = Math.ceil(minimumArea / width);
    const nearTargetFloor = Math.floor(minimumArea / width);
    // A corridor consumes a vertical slice and the entry consumes the south
    // end.  Keep at least one aspect variant with enough depth for the largest
    // room on a side of a straight skeleton; gross-area arithmetic alone does
    // not capture that shape constraint.
    const sideWidth = Math.max(1, Math.floor((width - span) / 2));
    const roomDepth = Math.ceil(largestRoomArea / sideWidth) + span;
    const values = [
      nearTarget,
      nearTargetFloor,
      nearTarget + 1,
      Math.max(minimumDepth, Math.ceil(root)),
      roomDepth,
    ];
    for (const depth of values) {
      if (depth < span || depth > envelope.depth) continue;
      addDimensionCandidate(dimensions, width, depth, envelope, minimumArea, maxArea);
    }
  }
  // Always try both envelope orientations when the target permits them.  This
  // provides meaningfully different frontages for the topology search without
  // introducing a combinatorial list.
  addDimensionCandidate(
    dimensions,
    Math.min(envelope.width, Math.max(span, Math.floor(root))),
    Math.min(envelope.depth, Math.max(span, Math.ceil(minimumArea / Math.max(span, Math.floor(root))))),
    envelope,
    minimumArea,
    maxArea,
  );

  const random = createSeededPrng(`${seed}:footprints`);
  const candidates = [...dimensions].map((value) => {
    const [widthText, depthText] = value.split("x");
    const width = Number(widthText);
    const depth = Number(depthText);
    const candidateArea = width * depth;
    const aspect = Math.max(width / depth, depth / width);
    return {
      id: `footprint-${width}x${depth}`,
      width,
      depth,
      area: candidateArea,
      targetDistance: Math.abs(candidateArea - minimumArea),
      aspect,
      jitter: random.nextUint32(),
    };
  });
  candidates.sort(
    (a, b) =>
      a.targetDistance - b.targetDistance ||
      a.aspect - b.aspect ||
      a.jitter - b.jitter ||
      a.width - b.width ||
      a.depth - b.depth,
  );
  return candidates.slice(0, 64).map(({ id, width, depth, area: footprintArea }) => ({
    id,
    width,
    depth,
    area: footprintArea,
  }));
}

export const enumerateFootprintVariants = deriveFootprintVariants;

function largestGarageDimensions(room: RoomInstance, footprint: GridRect, circulationWidth: number): {
  width: number;
  depth: number;
} | null {
  const dimensions = room.dimensions;
  const minimumWidth = Math.max(
    dimensions.minWidthUnits ?? 1,
    GARAGE_MIN_WIDTH_UNITS,
  );
  const minimumDepth = Math.max(
    dimensions.minDepthUnits ?? 1,
    GARAGE_MIN_DEPTH_UNITS,
  );
  const variants = [
    [minimumWidth, minimumDepth],
    [minimumDepth, minimumWidth],
    [Math.max(minimumWidth, Math.ceil(Math.sqrt(dimensions.minAreaUnits2))), minimumDepth],
    [minimumWidth, Math.max(minimumDepth, Math.ceil(dimensions.minAreaUnits2 / minimumWidth))],
  ];
  for (const [width, depth] of variants) {
    if (width <= footprint.width - circulationWidth && depth <= footprint.depth - circulationWidth) {
      return { width, depth };
    }
  }
  return null;
}

function makeSpace(instanceId: string, role: PlacedSpace["role"], rect: GridRect): PlacedSpace {
  return { instanceId, role, rect };
}

function rectsOverlapAny(rect: GridRect, rectangles: readonly GridRect[]): boolean {
  return rectangles.some((candidate) => {
    const left = Math.max(rect.x, candidate.x);
    const top = Math.max(rect.y, candidate.y);
    const rightEdge = Math.min(right(rect), right(candidate));
    const bottomEdge = Math.min(bottom(rect), bottom(candidate));
    return rightEdge > left && bottomEdge > top;
  });
}

function makeSkeleton(
  project: NormalizedProject,
  footprint: GridRect,
  kind: CirculationSkeletonKind,
  seed: string,
): InternalSkeleton | null {
  const circulationWidth = project.planning.minimumCirculationWidthUnits;
  const rooms = project.rooms;
  const garageRooms = rooms.filter(
    (room) => room.inclusion === "required" && room.traits.frontage?.kind === "vehicle",
  );
  const garageSpaces: PlacedSpace[] = [];
  const occupiedGarageRects: GridRect[] = [];
  let garageSide: "left" | "right" = createSeededPrng(`${seed}:${kind}:garage`).nextBoolean()
    ? "left"
    : "right";
  for (const room of garageRooms) {
    const dimensions = largestGarageDimensions(room, footprint, circulationWidth);
    if (!dimensions) return null;
    const slots = garageSide === "left"
      ? [footprint.x, right(footprint) - dimensions.width]
      : [right(footprint) - dimensions.width, footprint.x];
    const x = slots.find((candidateX) => {
      const candidate = {
        x: candidateX,
        y: bottom(footprint) - dimensions.depth,
        width: dimensions.width,
        depth: dimensions.depth,
      };
      return !rectsOverlapAny(candidate, occupiedGarageRects);
    });
    if (x === undefined) return null;
    const rect = {
      x,
      y: bottom(footprint) - dimensions.depth,
      width: dimensions.width,
      depth: dimensions.depth,
    };
    occupiedGarageRects.push(rect);
    garageSpaces.push(makeSpace(room.id, "room", rect));
    // Put subsequent garages on the other side if the program asks for more
    // than one; this keeps the south edge anchor explicit.
    garageSide = garageSide === "left" ? "right" : "left";
  }

  const entryDepth = circulationWidth;
  const entryWidth = circulationWidth;
  const bottomOfEntry = bottom(footprint);
  let stemX: number;
  if (occupiedGarageRects.length > 0) {
    const garage = occupiedGarageRects[0];
    if (garage.x === footprint.x) stemX = right(garage);
    else stemX = garage.x - circulationWidth;
  } else {
    stemX = footprint.x + Math.floor((footprint.width - circulationWidth) / 2);
  }
  if (stemX < footprint.x || stemX + circulationWidth > right(footprint)) return null;
  let entryX = stemX;
  let entry = {
    x: entryX,
    y: bottomOfEntry - entryDepth,
    width: entryWidth,
    depth: entryDepth,
  };
  if (rectsOverlapAny(entry, occupiedGarageRects)) {
    // A garage can consume the preferred side of the frontage.  Search stable
    // corridor-width slots for another south entry before rejecting the family.
    const slots = [
      footprint.x,
      footprint.x + circulationWidth,
      right(footprint) - circulationWidth,
      footprint.x + Math.floor((footprint.width - circulationWidth) / 2),
    ];
    const replacement = slots.find((x) => {
      const candidate = { x, y: bottomOfEntry - entryDepth, width: entryWidth, depth: entryDepth };
      return x >= footprint.x && x + entryWidth <= right(footprint) &&
        !rectsOverlapAny(candidate, occupiedGarageRects);
    });
    if (replacement === undefined) return null;
    stemX = replacement;
    entryX = replacement;
    entry = { x: entryX, y: bottomOfEntry - entryDepth, width: entryWidth, depth: entryDepth };
  }

  const top = footprint.y;
  const stemBottom = entry.y;
  const skeleton: GridRect[] = [];
  if (kind === "straight") {
    if (stemBottom - top < circulationWidth) return null;
    skeleton.push({ x: stemX, y: top, width: circulationWidth, depth: stemBottom - top });
  } else if (kind === "L") {
    let barY = top + Math.max(circulationWidth, Math.floor((stemBottom - top) * 0.5));
    const garageTop = occupiedGarageRects.length > 0
      ? Math.min(...occupiedGarageRects.map((rect) => rect.y))
      : bottomOfEntry;
    barY = Math.min(barY, garageTop - circulationWidth);
    barY = Math.max(top + circulationWidth, barY);
    if (barY + circulationWidth > stemBottom) return null;
    if (barY > top) skeleton.push({ x: stemX, y: top, width: circulationWidth, depth: barY - top });
    if (stemBottom > barY + circulationWidth) {
      skeleton.push({
        x: stemX,
        y: barY + circulationWidth,
        width: circulationWidth,
        depth: stemBottom - barY - circulationWidth,
      });
    }
    const extendLeft = occupiedGarageRects.length > 0 && occupiedGarageRects[0].x > footprint.x;
    if (extendLeft) {
      skeleton.push({
        x: footprint.x,
        y: barY,
        width: stemX - footprint.x + circulationWidth,
        depth: circulationWidth,
      });
    } else {
      skeleton.push({
        x: stemX,
        y: barY,
        width: right(footprint) - stemX,
        depth: circulationWidth,
      });
    }
  } else {
    // Keep the T bar above the garage while leaving a useful lower side bay.
    // A lower bar would strand the narrow garage-side bay and make all rooms
    // depend on private-room pass-through.
    let barY = top + Math.floor((stemBottom - top) * 0.34);
    const garageTop = occupiedGarageRects.length > 0
      ? Math.min(...occupiedGarageRects.map((rect) => rect.y))
      : bottomOfEntry;
    barY = Math.min(barY, garageTop - circulationWidth);
    barY = Math.max(top + circulationWidth, barY);
    if (barY + circulationWidth > stemBottom) return null;
    skeleton.push({
      x: footprint.x,
      y: barY,
      width: footprint.width,
      depth: circulationWidth,
    });
    if (stemBottom > barY + circulationWidth) {
      skeleton.push({
        x: stemX,
        y: barY + circulationWidth,
        width: circulationWidth,
        depth: stemBottom - barY - circulationWidth,
      });
    }
  }
  if (skeleton.some((rect) => !containsRect(footprint, rect) || rectsOverlapAny(rect, occupiedGarageRects))) {
    return null;
  }
  if (skeleton.some((rect, index) => skeleton.slice(index + 1).some((other) => rectsOverlapAny(rect, [other])))) {
    return null;
  }
  const rectangles = skeleton.filter((rect) => rect.width > 0 && rect.depth > 0);
  if (rectangles.length === 0) return null;
  return {
    kind,
    rectangles,
    entry,
    rectangleIds: rectangles.map((_, index) => `circulation-${kind}-${index + 1}`),
    entryId: `entry-${kind}`,
    garageSpaces,
  };
}

/** Construct one circulation family without placing ordinary rooms. */
export function buildCirculationSkeleton(
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
  footprint: GridRect,
  kind: CirculationSkeletonKind,
  seed = "",
): CirculationSkeleton | null {
  const project = isNormalized(projectOrBrief)
    ? projectOrBrief
    : normalizeProject(projectOrBrief);
  const internal = makeSkeleton(project, footprint, kind, seed);
  if (!internal) return null;
  return {
    kind: internal.kind,
    rectangles: internal.rectangles,
    entry: internal.entry,
    rectangleIds: internal.rectangleIds,
    entryId: internal.entryId,
  };
}

export const createCirculationSkeleton = buildCirculationSkeleton;
export const enumerateCirculationSkeletons = (
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
  footprint: GridRect,
  seed = "",
): CirculationSkeleton[] => TOPOLOGY_ORDER
  .map((kind) => buildCirculationSkeleton(projectOrBrief, footprint, kind, seed))
  .filter((skeleton): skeleton is CirculationSkeleton => skeleton !== null);

function subtractFreeRectangles(
  footprint: GridRect,
  occupied: readonly GridRect[],
): GridRect[] {
  const xEdges = [...new Set([
    footprint.x,
    right(footprint),
    ...occupied.flatMap((rect) => [rect.x, right(rect)]),
  ])]
    .filter((x) => x >= footprint.x && x <= right(footprint))
    .sort((a, b) => a - b);
  const result: GridRect[] = [];
  for (let index = 0; index < xEdges.length - 1; index += 1) {
    const x = xEdges[index];
    const nextX = xEdges[index + 1];
    if (nextX <= x) continue;
    const yEdges = [...new Set([
      footprint.y,
      bottom(footprint),
      ...occupied.flatMap((rect) => [rect.y, bottom(rect)]),
    ])]
      .filter((y) => y >= footprint.y && y <= bottom(footprint))
      .sort((a, b) => a - b);
    for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex += 1) {
      const y = yEdges[yIndex];
      const nextY = yEdges[yIndex + 1];
      if (nextY <= y) continue;
      const slab = { x, y, width: nextX - x, depth: nextY - y };
      if (!rectsOverlapAny(slab, occupied)) result.push(slab);
    }
  }
  // Coalesce only truly equal-height/adjacent slabs.  Keeping the decomposition
  // conservative makes every candidate rectangle independently easy to prove.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let first = 0; first < result.length; first += 1) {
      for (let second = first + 1; second < result.length; second += 1) {
        const a = result[first];
        const b = result[second];
        if (a.y === b.y && a.depth === b.depth && right(a) === b.x) {
          result.splice(first, 1, { x: a.x, y: a.y, width: a.width + b.width, depth: a.depth });
          result.splice(second, 1);
          changed = true;
          break outer;
        }
        if (a.x === b.x && a.width === b.width && bottom(a) === b.y) {
          result.splice(first, 1, { x: a.x, y: a.y, width: a.width, depth: a.depth + b.depth });
          result.splice(second, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return result.filter((rect) => rect.width > 0 && rect.depth > 0);
}

function roomRectValid(room: RoomInstance, width: number, depth: number): boolean {
  const dimensions = room.dimensions;
  if (width <= 0 || depth <= 0 || width * depth < dimensions.minAreaUnits2) return false;
  if (dimensions.minShortSideUnits !== undefined && Math.min(width, depth) < dimensions.minShortSideUnits) {
    return false;
  }
  const direct =
    (dimensions.minWidthUnits === undefined || width >= dimensions.minWidthUnits) &&
    (dimensions.minDepthUnits === undefined || depth >= dimensions.minDepthUnits);
  const rotated =
    dimensions.minWidthUnits !== undefined &&
    dimensions.minDepthUnits !== undefined &&
    width >= dimensions.minDepthUnits &&
    depth >= dimensions.minWidthUnits;
  if (!direct && !rotated) return false;
  if (
    dimensions.maxAspectRatio !== undefined &&
    Math.max(width / depth, depth / width) > dimensions.maxAspectRatio
  ) return false;
  return true;
}

function dimensionVariants(
  room: RoomInstance,
  maxWidth: number,
  maxDepth: number,
  desiredArea: number,
): Array<{ width: number; depth: number }> {
  const dimensions = room.dimensions;
  const minimumWidth = Math.max(dimensions.minWidthUnits ?? dimensions.minShortSideUnits ?? 1, 1);
  const minimumDepth = Math.max(dimensions.minDepthUnits ?? dimensions.minShortSideUnits ?? 1, 1);
  const target = Math.max(dimensions.minAreaUnits2, desiredArea);
  const values = new Set<string>();
  const widths = new Set<number>([
    minimumWidth,
    minimumDepth,
    Math.min(maxWidth, Math.max(minimumWidth, Math.floor(Math.sqrt(target)))),
    Math.min(maxWidth, Math.max(minimumWidth, Math.ceil(Math.sqrt(target)))),
    Math.max(minimumWidth, Math.floor(maxWidth / 2)),
    maxWidth,
  ]);
  for (const width of widths) {
    if (width > maxWidth) continue;
    const depths = [
      minimumDepth,
      Math.ceil(dimensions.minAreaUnits2 / width),
      Math.ceil(target / width),
      Math.max(minimumDepth, Math.floor(maxDepth / 2)),
      maxDepth,
    ];
    for (const depth of depths) {
      if (depth > maxDepth || !roomRectValid(room, width, depth)) continue;
      values.add(`${width}x${depth}`);
    }
  }
  const variants = [...values].map((value) => {
    const [width, depth] = value.split("x").map(Number);
    return { width, depth };
  });
  variants.sort(
    (a, b) =>
      Math.abs(a.width * a.depth - target) - Math.abs(b.width * b.depth - target) ||
      a.width * a.depth - b.width * b.depth ||
      a.width - b.width ||
      a.depth - b.depth,
  );
  return variants;
}

function transitSpace(space: PlacedSpace, project: NormalizedProject): boolean {
  if (space.role === "entry" || space.role === "circulation") return true;
  const room = project.rooms.find((candidate) => candidate.id === space.instanceId);
  return room?.traits.mayBePassThrough === true || room?.kind === "hallway";
}

function stateKey(spaces: readonly PlacedSpace[]): string {
  return spaces
    .map((space) => `${space.instanceId}@${space.rect.x},${space.rect.y},${space.rect.width},${space.rect.depth}`)
    .sort()
    .join("|");
}

function frontierLength(candidate: GridRect, spaces: readonly PlacedSpace[], project: NormalizedProject): number {
  return spaces.reduce((total, space) => {
    return total + (transitSpace(space, project) ? sharedWallLength(candidate, space.rect) : 0);
  }, 0);
}

function candidatePositions(
  free: GridRect,
  width: number,
  depth: number,
  spaces: readonly PlacedSpace[],
): GridRect[] {
  const xs = new Set<number>([free.x, right(free) - width]);
  const ys = new Set<number>([free.y, bottom(free) - depth]);
  for (const space of spaces) {
    const rect = space.rect;
    if (right(rect) === free.x || right(free) === rect.x) {
      xs.add(right(rect) === free.x ? free.x : right(free) - width);
      ys.add(Math.max(free.y, Math.min(bottom(free) - depth, rect.y)));
      ys.add(Math.max(free.y, Math.min(bottom(free) - depth, bottom(rect) - depth)));
    }
    if (bottom(rect) === free.y || bottom(free) === rect.y) {
      ys.add(bottom(rect) === free.y ? free.y : bottom(free) - depth);
      xs.add(Math.max(free.x, Math.min(right(free) - width, rect.x)));
      xs.add(Math.max(free.x, Math.min(right(free) - width, right(rect) - width)));
    }
  }
  const result: GridRect[] = [];
  for (const x of xs) {
    for (const y of ys) {
      const rect = { x, y, width, depth };
      if (containsRect(free, rect)) result.push(rect);
    }
  }
  return result;
}

function expandRoomIntoGaps(
  spaces: PlacedSpace[],
  project: NormalizedProject,
  footprint: GridRect,
): void {
  const roomMap = new Map(project.rooms.map((room) => [room.id, room]));
  const roomSpaces = spaces.filter((space) =>
    space.role === "room" &&
    roomMap.has(space.instanceId) &&
    roomMap.get(space.instanceId)?.traits.frontage?.kind !== "vehicle",
  );
  // A bounded number of one-cell growth rounds makes this a repair pass, not a
  // second unbounded solver.  It only grows into proven free rectangles.
  for (let round = 0; round < 4 * Math.max(1, footprint.width + footprint.depth); round += 1) {
    let changed = false;
    for (const space of roomSpaces) {
      const room = roomMap.get(space.instanceId);
      if (!room) continue;
      const directions: Array<"left" | "right" | "up" | "down"> = ["right", "left", "down", "up"];
      for (const direction of directions) {
        const rect = { ...space.rect };
        if (direction === "left") {
          if (rect.x <= footprint.x) continue;
          rect.x -= 1;
          rect.width += 1;
        } else if (direction === "right") {
          if (right(rect) >= right(footprint)) continue;
          rect.width += 1;
        } else if (direction === "up") {
          if (rect.y <= footprint.y) continue;
          rect.y -= 1;
          rect.depth += 1;
        } else {
          if (bottom(rect) >= bottom(footprint)) continue;
          rect.depth += 1;
        }
        if (!roomRectValid(room, rect.width, rect.depth)) continue;
        if (spaces.some((other) => other !== space && rectsOverlapAny(rect, [other.rect]))) continue;
        space.rect = rect;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function addCirculationInfill(
  spaces: PlacedSpace[],
  project: NormalizedProject,
  footprint: GridRect,
  kind: CirculationSkeletonKind,
): void {
  const minimum = project.planning.minimumCirculationWidthUnits;
  const maxRounds = 8;
  for (let round = 0; round < maxRounds; round += 1) {
    const free = subtractFreeRectangles(footprint, spaces.map((space) => space.rect));
    const candidate = free
      .filter((rect) => Math.min(rect.width, rect.depth) >= minimum)
      .filter((rect) => spaces.some((space) => transitSpace(space, project) && sharedWallLength(space.rect, rect) >= minimum))
      .sort((a, b) => b.width * b.depth - a.width * a.depth || a.y - b.y || a.x - b.x)[0];
    if (!candidate) break;
    const id = `circulation-${kind}-infill-${round + 1}`;
    spaces.push(makeSpace(id, "circulation", candidate));
  }
}

function makePortalBetween(
  a: PlacedSpace,
  b: PlacedSpace,
  kind: "pedestrian" | "vehicle",
  ordinal: number,
): AccessPortal | null {
  const segments = sharedWallSegments(a.rect, b.rect);
  if (segments.length === 0) return null;
  const segment = [...segments].sort(
    (first, second) =>
      (second.interval.end - second.interval.start) -
      (first.interval.end - first.interval.start) ||
      compareText(first.aSide, second.aSide),
  )[0];
  const length = segment.interval.end - segment.interval.start;
  if (length < MIN_PORTAL_WIDTH_UNITS) return null;
  return {
    id: `portal-${a.instanceId}-${b.instanceId}-${kind}-${ordinal}`,
    a: a.instanceId,
    b: b.instanceId,
    wall: segment.aSide,
    start: segment.interval.start,
    length,
    kind,
  };
}

function makeExteriorPortal(
  space: PlacedSpace,
  footprint: GridRect,
  wall: "south" | "north" | "east" | "west",
  kind: "pedestrian" | "vehicle",
  ordinal: number,
): AccessPortal | null {
  const edge = wall === "north" || wall === "south"
    ? { start: space.rect.x, end: right(space.rect), fixed: wall === "north" ? space.rect.y : bottom(space.rect) }
    : { start: space.rect.y, end: bottom(space.rect), fixed: wall === "west" ? space.rect.x : right(space.rect) };
  const footprintFixed = wall === "north" ? footprint.y
    : wall === "south" ? bottom(footprint)
      : wall === "west" ? footprint.x : right(footprint);
  if (edge.fixed !== footprintFixed || edge.end <= edge.start) return null;
  return {
    id: `portal-exterior-${space.instanceId}-${kind}-${ordinal}`,
    a: EXTERIOR_SPACE_ID,
    b: space.instanceId,
    wall,
    start: edge.start,
    length: edge.end - edge.start,
    kind,
  };
}

function buildPortals(
  spaces: readonly PlacedSpace[],
  footprint: GridRect,
  project: NormalizedProject,
): { portals: AccessPortal[]; entrancePortalId: string } {
  const portals: AccessPortal[] = [];
  const entry = spaces.find((space) => space.role === "entry");
  let portalOrdinal = 0;
  let entrancePortalId = "";
  if (entry) {
    const entrance = makeExteriorPortal(entry, footprint, "south", "pedestrian", portalOrdinal++);
    if (entrance) {
      portals.push(entrance);
      entrancePortalId = entrance.id;
    }
  }
  // Garage vehicle frontage is independently represented even when an internal
  // pedestrian portal is also available.
  for (const space of spaces) {
    const room = project.rooms.find((candidate) => candidate.id === space.instanceId);
    if (room?.traits.frontage?.kind !== "vehicle") continue;
    const garagePortal = makeExteriorPortal(space, footprint, "south", "vehicle", portalOrdinal++);
    if (garagePortal) portals.push(garagePortal);
  }
  const transit = spaces.filter((space) => space.role === "entry" || space.role === "circulation");
  // Connect every corridor component to the closest touching component.  The
  // skeleton rectangles are constructed to meet at full-width edges.
  for (const first of transit) {
    const neighbours = transit
      .filter((other) => other !== first)
      .map((other) => ({ other, length: sharedWallLength(first.rect, other.rect) }))
      .filter((candidate) => candidate.length >= MIN_PORTAL_WIDTH_UNITS)
      .sort((a, b) => b.length - a.length || compareText(a.other.instanceId, b.other.instanceId));
    const neighbour = neighbours[0]?.other;
    if (neighbour && !portals.some((portal) =>
      (portal.a === first.instanceId && portal.b === neighbour.instanceId) ||
      (portal.a === neighbour.instanceId && portal.b === first.instanceId))) {
      const portal = makePortalBetween(first, neighbour, "pedestrian", portalOrdinal++);
      if (portal) portals.push(portal);
    }
  }
  // Every room gets one portal to a circulation/pass-through frontier.  A room
  // may have additional geometric neighbours, but one explicit access edge is
  // enough for this conceptual graph.
  for (const space of spaces.filter((candidate) => candidate.role === "room")) {
    const room = project.rooms.find((candidate) => candidate.id === space.instanceId);
    if (!room) continue;
    const candidates = spaces
      .filter((other) => other !== space && transitSpace(other, project))
      .map((other) => ({ other, length: sharedWallLength(space.rect, other.rect) }))
      .filter((candidate) => candidate.length >= MIN_PORTAL_WIDTH_UNITS)
      .sort((a, b) => b.length - a.length || compareText(a.other.instanceId, b.other.instanceId));
    const neighbour = candidates[0]?.other;
    if (neighbour) {
      const kind = room.traits.frontage?.kind === "vehicle" ? "pedestrian" : "pedestrian";
      const portal = makePortalBetween(space, neighbour, kind, portalOrdinal++);
      if (portal && !portals.some((existing) => existing.id === portal.id)) portals.push(portal);
    }
  }
  // A garage can be reached from the stem when its side wall touches it.  The
  // external vehicle portal remains the authoritative frontage anchor.
  return { portals, entrancePortalId };
}

function layoutForState(
  project: NormalizedProject,
  footprint: GridRect,
  skeleton: InternalSkeleton,
  state: SearchState,
  seed: string,
  footprintVariant: FootprintVariant,
  expandedStates: number,
  candidateOrdinal: number,
): Layout {
  const baseSpaces = [
    ...skeleton.garageSpaces,
    ...skeleton.rectangles.map((rect, index) => makeSpace(skeleton.rectangleIds[index], "circulation", rect)),
    makeSpace(skeleton.entryId, "entry", skeleton.entry),
    ...state.spaces.filter((space) =>
      space.role === "room" &&
      !skeleton.garageSpaces.some((garage) => garage.instanceId === space.instanceId),
    ).map((space) => ({ ...space, rect: { ...space.rect } })),
  ];
  expandRoomIntoGaps(baseSpaces, project, footprint);
  addCirculationInfill(baseSpaces, project, footprint, skeleton.kind);
  const portals = buildPortals(baseSpaces, footprint, project);
  const id = `layout-${skeleton.kind}-${footprintVariant.id}-${candidateOrdinal}`;
  return {
    id,
    footprint,
    spaces: baseSpaces,
    portals: portals.portals,
    entrancePortalId: portals.entrancePortalId,
    metadata: {
      engineVersion: GENERATOR_ENGINE_VERSION,
      ruleVersion: GENERATOR_RULE_VERSION,
      seed,
      topology: skeleton.kind,
      footprintVariant: footprintVariant.id,
      expandedStates,
      candidateOrdinal,
    },
  };
}

function orderedRooms(project: NormalizedProject, skeleton: InternalSkeleton): RoomInstance[] {
  const garageIds = new Set(skeleton.garageSpaces.map((space) => space.instanceId));
  return project.rooms
    .filter((room) => room.inclusion === "required" && !garageIds.has(room.id))
    .map((room, index) => ({ room, index }))
    .sort((a, b) => {
      const aConstraints =
        a.room.dimensions.minAreaUnits2 +
        (a.room.dimensions.minShortSideUnits ?? 0) * 10 +
        (a.room.traits.exteriorPreference === "high" ? 25 : 0);
      const bConstraints =
        b.room.dimensions.minAreaUnits2 +
        (b.room.dimensions.minShortSideUnits ?? 0) * 10 +
        (b.room.traits.exteriorPreference === "high" ? 25 : 0);
      return bConstraints - aConstraints || a.index - b.index;
    })
    .map(({ room }) => room);
}

function searchTopology(
  project: NormalizedProject,
  footprintVariant: FootprintVariant,
  topology: CirculationSkeletonKind,
  seed: string,
  budget: GenerationBudget,
  candidateOffset: number,
): { candidates: SearchCandidate[]; expandedStates: number; budgetExceeded: boolean } {
  const footprint = footprintPlacement(project.site.envelope, footprintVariant.width, footprintVariant.depth);
  const skeleton = makeSkeleton(project, footprint, topology, seed);
  if (!skeleton) return { candidates: [], expandedStates: 0, budgetExceeded: false };
  const roomOrder = orderedRooms(project, skeleton);
  const initialSpaces = [...skeleton.garageSpaces];
  let beam: SearchState[] = [{ spaces: initialSpaces, score: 0, key: stateKey(initialSpaces) }];
  let expandedStates = 0;
  let budgetExceeded = false;
  for (let roomIndex = 0; roomIndex < roomOrder.length; roomIndex += 1) {
    const room = roomOrder[roomIndex];
    const next: SearchState[] = [];
    for (const state of beam) {
      if (expandedStates >= budget.maxExpansionsPerTopology) {
        budgetExceeded = true;
        break;
      }
      expandedStates += 1;
      const obstacles = [
        ...skeleton.garageSpaces.map((space) => space.rect),
        ...skeleton.rectangles,
        skeleton.entry,
        ...state.spaces.filter((space) => !skeleton.garageSpaces.some((garage) => garage.instanceId === space.instanceId)).map((space) => space.rect),
      ];
      const free = subtractFreeRectangles(footprint, obstacles);
      const remainingFreeArea = free.reduce((total, rect) => total + area(rect), 0);
      const minimumRemainingArea = roomOrder
        .slice(roomIndex)
        .reduce((total, candidate) => total + candidate.dimensions.minAreaUnits2, 0);
      // Cheap admissible area pruning: even the minimum rectangle area of the
      // current and remaining rooms must fit in the still-free footprint.
      if (remainingFreeArea < minimumRemainingArea) continue;
      const desiredArea = Math.max(
        room.dimensions.minAreaUnits2,
        Math.floor(remainingFreeArea / Math.max(1, roomOrder.length - roomIndex)),
      );
      const candidates: Array<{ rect: GridRect; frontier: number; score: number; key: string }> = [];
      for (const freeRect of free) {
        for (const dimensions of dimensionVariants(room, freeRect.width, freeRect.depth, desiredArea)) {
          for (const rect of candidatePositions(freeRect, dimensions.width, dimensions.depth, [
            ...skeleton.garageSpaces,
            ...skeleton.rectangles.map((candidate, index) => makeSpace(skeleton.rectangleIds[index], "circulation", candidate)),
            makeSpace(skeleton.entryId, "entry", skeleton.entry),
            ...state.spaces,
          ])) {
            const frontier = frontierLength(rect, [
              ...skeleton.garageSpaces,
              ...skeleton.rectangles.map((candidate, index) => makeSpace(skeleton.rectangleIds[index], "circulation", candidate)),
              makeSpace(skeleton.entryId, "entry", skeleton.entry),
              ...state.spaces,
            ], project);
            // Every occupiable room must be a destination off circulation (or a
            // pass-through public room).  Refusing a room with no transit
            // frontier here is the constructive counterpart to the independent
            // validator's forbidden-pass-through check.
            if (frontier < MIN_PORTAL_WIDTH_UNITS) continue;
            const occupied = unionArea([...obstacles, rect]);
            const candidateScore =
              frontier * 100 +
              (occupied / area(footprint)) * 25 -
              Math.abs(rect.width * rect.depth - desiredArea) / Math.max(1, area(footprint)) * 10;
            candidates.push({
              rect,
              frontier,
              score: candidateScore,
              key: `${rect.x},${rect.y},${rect.width},${rect.depth}`,
            });
          }
        }
      }
      const unique = new Map(candidates.map((candidate) => [candidate.key, candidate]));
      const sorted = [...unique.values()].sort(
        (a, b) =>
          b.frontier - a.frontier ||
          b.score - a.score ||
          compareText(a.key, b.key),
      );
      for (const candidate of sorted.slice(0, budget.beamWidth * 8)) {
        const spaces = [...state.spaces, makeSpace(room.id, "room", candidate.rect)];
        next.push({
          spaces,
          score: state.score + candidate.score,
          key: state.key + `|${room.id}@${candidate.key}`,
        });
      }
    }
    if (next.length === 0 || budgetExceeded) break;
    next.sort((a, b) => b.score - a.score || compareText(a.key, b.key));
    const unique = new Map<string, SearchState>();
    for (const state of next) {
      const canonical = stateKey(state.spaces);
      if (!unique.has(canonical)) unique.set(canonical, state);
      if (unique.size >= budget.beamWidth * 8) break;
    }
    beam = [...unique.values()].slice(0, budget.beamWidth * 4);
  }
  if (beam.length === 0 || beam[0].spaces.length < skeleton.garageSpaces.length + roomOrder.length) {
    return { candidates: [], expandedStates, budgetExceeded };
  }
  const candidates: SearchCandidate[] = [];
  for (const [index, state] of beam.entries()) {
    const layout = layoutForState(
      project,
      footprint,
      skeleton,
      state,
      seed,
      footprintVariant,
      expandedStates,
      candidateOffset + index,
    );
    const validation = validateLayout(layout, project);
    if (validation.valid) {
      candidates.push({ layout, validation, score: state.score, key: state.key });
    }
    if (candidates.length >= budget.maxCandidatesPerTopology) break;
  }
  return { candidates, expandedStates, budgetExceeded };
}

function normalizeInput(
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
): { project: NormalizedProject; normalizationDiagnostics: GenerationDiagnostic[] } {
  if (isNormalized(projectOrBrief)) return { project: projectOrBrief, normalizationDiagnostics: [] };
  try {
    return { project: normalizeProject(projectOrBrief), normalizationDiagnostics: [] };
  } catch (error) {
    if (error instanceof NormalizationError) {
      return {
        project: undefined as never,
        normalizationDiagnostics: [{
          code: "NORMALIZATION_FAILED",
          message: error.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
        }],
      };
    }
    throw error;
  }
}

function emptyTripletSelection(
  code: "NO_VALID_CANDIDATES" | "INSUFFICIENT_CANDIDATES" = "NO_VALID_CANDIDATES",
): TripletSelection {
  return {
    version: "planlab-diversity-0.3",
    status: "partial",
    complete: false,
    partial: true,
    threshold: DEFAULT_DIVERSITY_THRESHOLD,
    selected: [],
    layouts: [],
    pairwiseDistances: [],
    diagnostics: [{
      code,
      message: code === "NO_VALID_CANDIDATES"
        ? "no hard-valid candidates are available for strategy selection"
        : "fewer than three hard-valid candidates are available",
      candidateCount: 0,
      threshold: DEFAULT_DIVERSITY_THRESHOLD,
    }],
    reason: code,
  };
}

function appendSelectionDiagnostics(
  diagnostics: GenerationDiagnostic[],
  selection: TripletSelection,
): void {
  for (const diagnostic of selection.diagnostics) {
    if (diagnostics.some((existing) => existing.code === diagnostic.code)) continue;
    diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
  }
}

/**
 * Deterministic topology-first constructive beam search.  All candidates are
 * independently revalidated before they enter the returned pool.
 */
export function generateLayouts(
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
  options?: string | GenerationOptions,
): GenerationResult {
  const normalized = normalizeInput(projectOrBrief);
  const seed = normalized.project
    ? projectSeed(normalized.project, options)
    : typeof options === "string" ? options : options?.seed ?? "";
  const budget = canonicalBudget(typeof options === "object" ? options?.budget : undefined);
  const emptyMetadata = {
    engineVersion: GENERATOR_ENGINE_VERSION,
    ruleVersion: GENERATOR_RULE_VERSION,
    seed,
    budget,
    expandedStates: 0,
    topologyExpansions: { straight: 0, L: 0, T: 0 } as Record<CirculationSkeletonKind, number>,
    topologyCounts: { straight: 0, L: 0, T: 0 } as Record<CirculationSkeletonKind, number>,
  };
  if (!normalized.project) {
    const selection = emptyTripletSelection();
    return {
      ok: false,
      layouts: [],
      candidates: [],
      diagnostics: normalized.normalizationDiagnostics,
      analyses: [],
      scorecards: [],
      selection,
      selected: [],
      selectedLayouts: [],
      options: [],
      metadata: emptyMetadata,
    };
  }
  const project = normalized.project;
  const variants = deriveFootprintVariants(project, seed);
  if (variants.length === 0) {
    const selection = emptyTripletSelection();
    return {
      ok: false,
      layouts: [],
      candidates: [],
      diagnostics: [{ code: "NO_FOOTPRINT_VARIANT", message: "no footprint satisfies the envelope, room minimums, and GFA cap" }],
      analyses: [],
      scorecards: [],
      selection,
      selected: [],
      selectedLayouts: [],
      options: [],
      metadata: emptyMetadata,
    };
  }
  const diagnostics: GenerationDiagnostic[] = [];
  const layouts: Layout[] = [];
  let expandedStates = 0;
  let ordinal = 0;
  for (const topology of TOPOLOGY_ORDER) {
    if (layouts.length >= budget.maxTotalCandidates) break;
    let topologyCandidates: SearchCandidate[] = [];
    let topologyExpanded = 0;
    for (const variant of variants) {
      if (layouts.length + topologyCandidates.length >= budget.maxTotalCandidates) break;
      const remainingExpansions = budget.maxExpansionsPerTopology - topologyExpanded;
      if (remainingExpansions <= 0) break;
      const search = searchTopology(
        project,
        variant,
        topology,
        seed,
        { ...budget, maxExpansionsPerTopology: remainingExpansions },
        ordinal,
      );
      topologyExpanded += search.expandedStates;
      expandedStates += search.expandedStates;
      topologyCandidates.push(...search.candidates);
      if (search.budgetExceeded) {
        diagnostics.push({
          code: "SEARCH_BUDGET_EXCEEDED",
          message: `search budget exhausted while exploring ${topology} circulation`,
          topology,
          footprintVariant: variant.id,
          expandedStates: search.expandedStates,
        });
        break;
      }
      if (topologyCandidates.length >= budget.maxCandidatesPerTopology) break;
    }
    topologyCandidates.sort((a, b) => b.score - a.score || compareText(a.key, b.key));
    topologyCandidates = topologyCandidates.slice(0, budget.maxCandidatesPerTopology);
    for (const candidate of topologyCandidates) {
      // A second independent call is intentional: do not trust the validation
      // result carried by search if future construction code mutates a layout.
      const independent = validateLayout(candidate.layout, project);
      if (!independent.valid) {
        diagnostics.push({
          code: "VALIDATION_REJECTED",
          message: "constructor output failed independent hard validation",
          topology,
          footprintVariant: candidate.layout.metadata.footprintVariant,
          violations: independent.violations.map((violation) => violation.code),
        });
        continue;
      }
      candidate.layout.metadata.candidateOrdinal = ordinal;
      candidate.layout.id = `layout-${topology}-${candidate.layout.metadata.footprintVariant}-${ordinal}`;
      layouts.push(candidate.layout);
      ordinal += 1;
      if (layouts.length >= budget.maxTotalCandidates) break;
    }
    emptyMetadata.topologyCounts[topology] = topologyCandidates.length;
    emptyMetadata.topologyExpansions[topology] = topologyExpanded;
  }
  if (layouts.length === 0) {
    diagnostics.push({ code: "NO_VALID_LAYOUT", message: "bounded search found no hard-valid layout" });
  }
  emptyMetadata.expandedStates = expandedStates;
  const analyses = scoreCandidates(layouts, project);
  const selection = selectDiverseTriplet(analyses, project);
  appendSelectionDiagnostics(diagnostics, selection);
  return {
    ok: layouts.length > 0,
    layouts,
    candidates: layouts,
    diagnostics,
    analyses,
    scorecards: analyses,
    selection,
    selected: selection.selected,
    selectedLayouts: selection.layouts,
    options: selection.selected,
    metadata: emptyMetadata,
  };
}

export const generate = generateLayouts;
export const generateLayoutCandidates = generateLayouts;

/** Run the search for one already chosen family/footprint (useful in tests). */
export function constructiveBeamSearch(
  projectOrBrief: NormalizedProject | Parameters<typeof normalizeProject>[0],
  footprint: FootprintVariant | GridRect,
  topology: CirculationSkeletonKind,
  options?: string | GenerationOptions,
): Layout[] {
  const project = isNormalized(projectOrBrief) ? projectOrBrief : normalizeProject(projectOrBrief);
  const variant: FootprintVariant = "area" in footprint
    ? footprint
    : { id: `footprint-${footprint.width}x${footprint.depth}`, width: footprint.width, depth: footprint.depth, area: area(footprint) };
  const seed = projectSeed(project, options);
  const budget = canonicalBudget(typeof options === "object" ? options?.budget : undefined);
  return searchTopology(project, variant, topology, seed, budget, 0).candidates.map((candidate) => candidate.layout);
}

export const beamSearch = constructiveBeamSearch;

// Keep the hash imported in this module as an explicit, reusable seed hook for
// callers that need a stable ordering key.
export const generatorSeedHash = hashSeed;
