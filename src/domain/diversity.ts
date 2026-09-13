import {
  area,
  centre,
  intersection,
  intersectionArea,
  isGridRect,
  sharedWallLength,
  unionArea,
  type GridRect,
} from "./geometry.ts";
import { MIN_MEANINGFUL_SHARED_WALL_UNITS, MIRRORED_LAYOUTS_COUNT_AS_DISTINCT } from "./constants.ts";
import type { NormalizedProject, RoomInstance } from "./model.ts";
import type { Layout, PlacedSpace } from "./layout.ts";
import {
  scoreCandidates,
  STRATEGY_PROFILE_IDS,
  type LayoutScorecard,
  type ScoredLayoutCandidate,
  type StrategyProfileId,
} from "./scoring.ts";

export const DIVERSITY_VERSION = "planlab-diversity-0.3";
export const DEFAULT_DIVERSITY_THRESHOLD = 0.20;

export interface DiversityComponents {
  adjacency: number;
  centroid: number;
  footprint: number;
  circulation: number;
}

export interface RoomMatch {
  a: string;
  b: string;
  group: string;
  distance: number;
}

export interface DiversityComparison {
  version: string;
  distance: number;
  components: DiversityComponents;
  threshold: number;
  diverse: boolean;
  mirroredComparison: boolean;
  matchedRooms: RoomMatch[];
}

interface RoomPlacement {
  room: RoomInstance;
  space: PlacedSpace;
}

type RectTransform = (rect: GridRect) => GridRect;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function average(values: readonly number[], empty = 1): number {
  return values.length === 0 ? empty : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validSpaces(layout: Layout): (PlacedSpace & { rect: GridRect })[] {
  return (Array.isArray(layout.spaces) ? layout.spaces : []).filter(
    (space): space is PlacedSpace & { rect: GridRect } => isGridRect(space.rect),
  );
}

function placements(layout: Layout, project: NormalizedProject): RoomPlacement[] {
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  return validSpaces(layout)
    .filter((space) => space.role === "room" && roomById.has(space.instanceId))
    .map((space) => ({ room: roomById.get(space.instanceId)!, space }));
}

function mirrorTransform(layout: Layout, project: NormalizedProject): RectTransform {
  const envelope = project.site.envelope;
  return (rect) => ({
    x: envelope.x + envelope.width - (rect.x - envelope.x) - rect.width,
    y: rect.y,
    width: rect.width,
    depth: rect.depth,
  });
}

function identityTransform(rect: GridRect): GridRect {
  return { ...rect };
}

function transformCentre(rect: GridRect, transform: RectTransform): { x: number; y: number } {
  return centre(transform(rect));
}

function groupKey(room: RoomInstance): string {
  // requirementId is the authoring group. This keeps bedroom-1 and
  // bedroom-2 interchangeable while preserving different requirements of the
  // same kind as distinct entities.
  return `${room.requirementId}|${room.kind}`;
}

/**
 * Exact minimum-cost assignment for a rectangular cost matrix.  The Hungarian
 * algorithm handles the 24-instance prototype limit without the factorial
 * blow-up of enumerating interchangeable-room permutations.  Rows must not
 * outnumber columns; callers swap the two groups when necessary.
 */
function minimumCostAssignment(costs: readonly (readonly number[])[]): number[] {
  const rowCount = costs.length;
  if (rowCount === 0) return [];
  const columnCount = costs[0]?.length ?? 0;
  if (columnCount < rowCount || costs.some((row) => row.length !== columnCount)) {
    throw new RangeError("assignment matrix must have at least as many columns as rows");
  }
  const u = new Array<number>(rowCount + 1).fill(0);
  const v = new Array<number>(columnCount + 1).fill(0);
  const p = new Array<number>(columnCount + 1).fill(0);
  const way = new Array<number>(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minimum = new Array<number>(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const reduced = costs[row0 - 1]![column - 1]! - u[row0]! - v[column]!;
        if (reduced < minimum[column]! || reduced === minimum[column]! && column < column1) {
          minimum[column] = reduced;
          way[column] = column0;
        }
        if (minimum[column]! < delta || minimum[column] === delta && column < column1) {
          delta = minimum[column]!;
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]!] += delta;
          v[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0]!;
      p[column0] = p[column1]!;
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = new Array<number>(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] > 0) assignment[p[column]! - 1] = column - 1;
  }
  return assignment;
}

function matchRooms(
  a: Layout,
  b: Layout,
  project: NormalizedProject,
  transformB: RectTransform,
): RoomMatch[] {
  const aPlacements = placements(a, project);
  const bPlacements = placements(b, project);
  const bByGroup = new Map<string, RoomPlacement[]>();
  for (const placement of bPlacements) {
    const key = groupKey(placement.room);
    const group = bByGroup.get(key) ?? [];
    group.push(placement);
    bByGroup.set(key, group);
  }
  const aByGroup = new Map<string, RoomPlacement[]>();
  for (const placement of aPlacements) {
    const key = groupKey(placement.room);
    const group = aByGroup.get(key) ?? [];
    group.push(placement);
    aByGroup.set(key, group);
  }
  const matches: RoomMatch[] = [];
  for (const key of [...aByGroup.keys()].sort(compareText)) {
    const first = [...(aByGroup.get(key) ?? [])].sort((x, y) => compareText(x.room.id, y.room.id));
    const second = [...(bByGroup.get(key) ?? [])].sort((x, y) => compareText(x.room.id, y.room.id));
    if (first.length === 0 || second.length === 0) continue;
    const diagonal = Math.max(1, Math.hypot(project.site.envelope.width, project.site.envelope.depth));
    const directOrder = first.length <= second.length;
    const rows = directOrder ? first : second;
    const columns = directOrder ? second : first;
    const costs = rows.map((row) => columns.map((column) => {
      const from = centre(directOrder ? row.space.rect : column.space.rect);
      const to = transformCentre(directOrder ? column.space.rect : row.space.rect, transformB);
      return Math.hypot(from.x - to.x, from.y - to.y) / diagonal;
    }));
    const assignment = minimumCostAssignment(costs);
    for (let index = 0; index < assignment.length; index += 1) {
      const assigned = assignment[index];
      if (assigned === undefined || assigned < 0) continue;
      const aPlacement = directOrder ? rows[index] : columns[assigned];
      const bPlacement = directOrder ? columns[assigned] : rows[index];
      if (!aPlacement || !bPlacement) continue;
      const from = centre(aPlacement.space.rect);
      const to = transformCentre(bPlacement.space.rect, transformB);
      matches.push({
        a: aPlacement.room.id,
        b: bPlacement.room.id,
        group: key,
        distance: clamp01(Math.hypot(from.x - to.x, from.y - to.y) / diagonal),
      });
    }
  }
  return matches.sort((x, y) => compareText(x.a, y.a) || compareText(x.b, y.b));
}

function mappedRoomId(id: string, matches: readonly RoomMatch[], fromA: boolean): string {
  const match = fromA ? matches.find((candidate) => candidate.a === id) : matches.find((candidate) => candidate.b === id);
  return fromA ? id : match?.a ?? id;
}

function adjacencyEdges(
  layout: Layout,
  project: NormalizedProject,
  matches: readonly RoomMatch[],
  fromA: boolean,
  transform: RectTransform,
): Map<string, number> {
  const roomPlacements = placements(layout, project);
  const edges = new Map<string, number>();
  for (let first = 0; first < roomPlacements.length; first += 1) {
    for (let second = first + 1; second < roomPlacements.length; second += 1) {
      const a = roomPlacements[first];
      const b = roomPlacements[second];
      const length = sharedWallLength(transform(a.space.rect), transform(b.space.rect));
      if (length < MIN_MEANINGFUL_SHARED_WALL_UNITS) continue;
      const firstId = mappedRoomId(a.room.id, matches, fromA);
      const secondId = mappedRoomId(b.room.id, matches, fromA);
      if (firstId === secondId) continue;
      const key = firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
      // Keep the actual meaningful wall length as the edge weight.  Scaling
      // only by the one-metre threshold and then clamping would make a 1 m
      // and a 5 m shared wall indistinguishable to weighted Jaccard.
      edges.set(key, length / MIN_MEANINGFUL_SHARED_WALL_UNITS);
    }
  }
  return edges;
}

function weightedJaccardDistance(first: Map<string, number>, second: Map<string, number>): number {
  const keys = new Set([...first.keys(), ...second.keys()]);
  let minimum = 0;
  let maximum = 0;
  for (const key of keys) {
    const a = first.get(key) ?? 0;
    const b = second.get(key) ?? 0;
    minimum += Math.min(a, b);
    maximum += Math.max(a, b);
  }
  return maximum === 0 ? 0 : clamp01(1 - minimum / maximum);
}

function centroidDistance(
  a: Layout,
  b: Layout,
  project: NormalizedProject,
  matches: readonly RoomMatch[],
  transformB: RectTransform,
): number {
  const aPlacements = placements(a, project);
  const bPlacements = placements(b, project);
  if (matches.length === 0) return aPlacements.length === 0 && bPlacements.length === 0 ? 0 : 1;
  const aById = new Map(aPlacements.map((placement) => [placement.room.id, placement]));
  const bById = new Map(bPlacements.map((placement) => [placement.room.id, placement]));
  const diagonal = Math.max(1, Math.hypot(project.site.envelope.width, project.site.envelope.depth));
  const values = matches.flatMap((match) => {
    const first = aById.get(match.a);
    const second = bById.get(match.b);
    if (!first || !second) return [];
    const from = centre(first.space.rect);
    const to = transformCentre(second.space.rect, transformB);
    return [clamp01(Math.hypot(from.x - to.x, from.y - to.y) / diagonal)];
  });
  return average(values, 1);
}

function iou(first: GridRect, second: GridRect): number {
  const union = area(first) + area(second) - intersectionArea(first, second);
  return union <= 0 ? 0 : clamp01(intersectionArea(first, second) / union);
}

function circulationRects(layout: Layout): GridRect[] {
  return validSpaces(layout)
    .filter((space) => space.role === "circulation" || space.role === "entry")
    .map((space) => space.rect);
}

function unionIntersectionArea(first: readonly GridRect[], second: readonly GridRect[]): number {
  const intersections = first.flatMap((a) => second.flatMap((b) => {
    const value = intersection(a, b);
    return value ? [value] : [];
  }));
  return unionArea(intersections);
}

function unionIoU(first: readonly GridRect[], second: readonly GridRect[]): number {
  const union = unionArea(first) + unionArea(second) - unionIntersectionArea(first, second);
  return union <= 0 ? 1 : clamp01(unionIntersectionArea(first, second) / union);
}

interface OneWayComparison {
  distance: number;
  components: DiversityComponents;
  matches: RoomMatch[];
}

function oneWayComparison(
  a: Layout,
  b: Layout,
  project: NormalizedProject,
  transformB: RectTransform,
): OneWayComparison {
  const matches = matchRooms(a, b, project, transformB);
  const firstEdges = adjacencyEdges(a, project, matches, true, identityTransform);
  const secondEdges = adjacencyEdges(b, project, matches, false, transformB);
  const adjacency = weightedJaccardDistance(firstEdges, secondEdges);
  const centroid = centroidDistance(a, b, project, matches, transformB);
  const footprint = 1 - iou(a.footprint, transformB(b.footprint));
  const firstCirculation = circulationRects(a);
  const secondCirculation = circulationRects(b).map(transformB);
  const circulation = 1 - unionIoU(firstCirculation, secondCirculation);
  const components = {
    adjacency: clamp01(adjacency),
    centroid: clamp01(centroid),
    footprint: clamp01(footprint),
    circulation: clamp01(circulation),
  };
  return {
    components,
    distance: clamp01(
      0.45 * components.adjacency +
      0.35 * components.centroid +
      0.10 * components.footprint +
      0.10 * components.circulation,
    ),
    matches,
  };
}

/** Compare two layouts using the approved weighted graph/geometry formula. */
export function compareLayoutDiversity(
  a: Layout,
  b: Layout,
  project: NormalizedProject,
  threshold = DEFAULT_DIVERSITY_THRESHOLD,
): DiversityComparison {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("diversity threshold must be between 0 and 1");
  }
  const direct = oneWayComparison(a, b, project, identityTransform);
  let best = direct;
  let mirroredComparison = false;
  if (!MIRRORED_LAYOUTS_COUNT_AS_DISTINCT) {
    const mirrored = oneWayComparison(a, b, project, mirrorTransform(b, project));
    if (mirrored.distance < best.distance || mirrored.distance === best.distance && JSON.stringify(mirrored.components) < JSON.stringify(best.components)) {
      best = mirrored;
      mirroredComparison = true;
    }
  }
  return {
    version: DIVERSITY_VERSION,
    distance: best.distance,
    components: best.components,
    threshold,
    diverse: best.distance >= threshold,
    mirroredComparison,
    matchedRooms: best.matches,
  };
}

/** Number-only convenience API used by ranking code. */
export function diversityDistance(a: Layout, b: Layout, project: NormalizedProject): number {
  return compareLayoutDiversity(a, b, project).distance;
}

export const layoutDistance = diversityDistance;
export const calculateDiversity = compareLayoutDiversity;
export const compareLayouts = compareLayoutDiversity;

/**
 * Produce a stable structural key. Interchangeable instances are ordered by
 * geometry, and the east/west mirror is canonicalised when the approved
 * prototype policy treats mirrors as the same design.
 */
export function canonicalLayoutKey(layout: Layout, project: NormalizedProject): string {
  const encode = (transform: RectTransform): string => {
    const roomRecords = placements(layout, project).map((placement) => ({
      group: groupKey(placement.room),
      rect: transform(placement.space.rect),
    })).sort((a, b) =>
      compareText(a.group, b.group) ||
      a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.rect.width - b.rect.width || a.rect.depth - b.rect.depth,
    );
    const transit = circulationRects(layout).map(transform).sort((a, b) =>
      a.x - b.x || a.y - b.y || a.width - b.width || a.depth - b.depth,
    );
    const footprint = transform(layout.footprint);
    return JSON.stringify({
      footprint: [footprint.x, footprint.y, footprint.width, footprint.depth],
      rooms: roomRecords.map((record) => [record.group, record.rect.x, record.rect.y, record.rect.width, record.rect.depth]),
      transit: transit.map((rect) => [rect.x, rect.y, rect.width, rect.depth]),
    });
  };
  const direct = encode(identityTransform);
  if (MIRRORED_LAYOUTS_COUNT_AS_DISTINCT) return direct;
  const mirrored = encode(mirrorTransform(layout, project));
  return direct < mirrored ? direct : mirrored;
}

export const canonicalizeLayout = canonicalLayoutKey;

export interface SelectedLayout {
  strategy: StrategyProfileId;
  label: string;
  layout: Layout;
  scorecard: LayoutScorecard;
}

export interface SelectionPairDistance {
  a: string;
  b: string;
  distance: number;
  diverse: boolean;
}

export interface SelectionDiagnostic {
  code: "NO_VALID_CANDIDATES" | "INSUFFICIENT_CANDIDATES" | "INSUFFICIENT_DIVERSITY";
  message: string;
  candidateCount: number;
  threshold: number;
}

export interface TripletSelection {
  version: string;
  status: "complete" | "partial";
  complete: boolean;
  partial: boolean;
  threshold: number;
  selected: SelectedLayout[];
  layouts: Layout[];
  pairwiseDistances: SelectionPairDistance[];
  diagnostics: SelectionDiagnostic[];
  reason?: SelectionDiagnostic["code"];
}

type CandidateInput = Layout | ScoredLayoutCandidate;

function isScoredCandidate(value: CandidateInput): value is ScoredLayoutCandidate {
  return value !== null && typeof value === "object" && "layout" in value && "scorecards" in value;
}

function resolveScoredCandidates(
  candidates: readonly CandidateInput[],
  project: NormalizedProject,
): ScoredLayoutCandidate[] {
  // Accept raw layouts, scorecard sets, or a mixture.  The latter is useful to
  // callers that have cached analysis for some candidates but not others; a
  // cast of the mixed array to Layout[] would otherwise feed scorecard objects
  // to the validator and fail in an opaque way.
  const resolved: ScoredLayoutCandidate[] = [];
  for (const candidate of candidates) {
    const scored = isScoredCandidate(candidate)
      ? candidate
      : scoreCandidates([candidate], project)[0];
    if (scored?.valid) resolved.push(scored);
  }

  // A candidate id is not enough for diversity identity: independently
  // generated layouts can carry different ids while representing the same
  // geometry, including interchangeable-room relabellings and mirrors.  Keep
  // one deterministic representative for each canonical design key.
  const ordered = resolved.slice().sort((a, b) =>
    compareText(a.layout.id, b.layout.id) ||
    compareText(canonicalLayoutKey(a.layout, project), canonicalLayoutKey(b.layout, project)),
  );
  const unique = new Map<string, ScoredLayoutCandidate>();
  const keysById = new Map<string, string>();
  for (const candidate of ordered) {
    const key = canonicalLayoutKey(candidate.layout, project);
    const existingKey = keysById.get(candidate.layout.id);
    if (existingKey !== undefined) {
      // Same id is expected to identify one layout.  If malformed input
      // repeats it, retain the lexicographically first canonical geometry.
      if (key < existingKey) {
        unique.delete(existingKey);
        unique.set(key, candidate);
        keysById.set(candidate.layout.id, key);
      }
      continue;
    }
    if (unique.has(key)) continue;
    unique.set(key, candidate);
    keysById.set(candidate.layout.id, key);
  }
  return [...unique.values()];
}

function assignmentObjective(
  selected: readonly { candidate: ScoredLayoutCandidate; strategy: StrategyProfileId }[],
  project: NormalizedProject,
  threshold: number,
): { valid: boolean; objective: number; distances: SelectionPairDistance[] } {
  const distances: SelectionPairDistance[] = [];
  for (let first = 0; first < selected.length; first += 1) {
    for (let second = first + 1; second < selected.length; second += 1) {
      const a = selected[first].candidate.layout;
      const b = selected[second].candidate.layout;
      const comparison = compareLayoutDiversity(a, b, project, threshold);
      distances.push({ a: a.id, b: b.id, distance: comparison.distance, diverse: comparison.diverse });
      if (!comparison.diverse) return { valid: false, objective: Number.NEGATIVE_INFINITY, distances };
    }
  }
  const score = selected.reduce(
    (total, item) => total + item.candidate.scorecards[item.strategy].overallUtility,
    0,
  );
  const averageDistance = distances.length === 0
    ? 0
    : distances.reduce((total, item) => total + item.distance, 0) / distances.length;
  return { valid: true, objective: score + 0.5 * averageDistance, distances };
}

function betterAssignment(
  current: { objective: number; ids: string[] } | undefined,
  objective: number,
  ids: string[],
): boolean {
  if (!current) return true;
  return objective > current.objective || objective === current.objective && ids.join("|") < current.ids.join("|");
}

/**
 * Jointly choose at most one candidate for each strategy. A bounded shortlist
 * keeps the O(n³) triplet search predictable for the generator's 300-candidate
 * pool while retaining every candidate in small test fixtures.
 */
export function selectDiverseTriplet(
  candidates: readonly CandidateInput[],
  project: NormalizedProject,
  options: { threshold?: number; shortlistSize?: number } = {},
): TripletSelection {
  const threshold = options.threshold ?? DEFAULT_DIVERSITY_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("diversity threshold must be between 0 and 1");
  }
  const scored = resolveScoredCandidates(candidates, project);
  const diagnostics: SelectionDiagnostic[] = [];
  if (scored.length === 0) {
    diagnostics.push({ code: "NO_VALID_CANDIDATES", message: "no hard-valid candidates are available for strategy selection", candidateCount: 0, threshold });
    return {
      version: DIVERSITY_VERSION,
      status: "partial",
      complete: false,
      partial: true,
      threshold,
      selected: [],
      layouts: [],
      pairwiseDistances: [],
      diagnostics,
      reason: "NO_VALID_CANDIDATES",
    };
  }
  if (options.shortlistSize !== undefined &&
    (!Number.isSafeInteger(options.shortlistSize) || options.shortlistSize <= 0)) {
    throw new RangeError("shortlist size must be a positive safe integer");
  }
  const shortlistSize = Math.min(scored.length, options.shortlistSize ?? 24);
  const pools = Object.fromEntries(STRATEGY_PROFILE_IDS.map((strategy) => [strategy, [...scored]
    .sort((a, b) => b.scorecards[strategy].overallUtility - a.scorecards[strategy].overallUtility || compareText(a.layout.id, b.layout.id))
    .slice(0, shortlistSize)])) as Record<StrategyProfileId, ScoredLayoutCandidate[]>;
  let bestTriple: { objective: number; ids: string[]; assignment: { candidate: ScoredLayoutCandidate; strategy: StrategyProfileId }[]; distances: SelectionPairDistance[] } | undefined;
  for (const first of pools.compactEfficiency) {
    for (const second of pools.bestFlow) {
      if (first.layout.id === second.layout.id) continue;
      for (const third of pools.balanced) {
        if (third.layout.id === first.layout.id || third.layout.id === second.layout.id) continue;
        const assignment = [
          { candidate: first, strategy: "compactEfficiency" as const },
          { candidate: second, strategy: "bestFlow" as const },
          { candidate: third, strategy: "balanced" as const },
        ];
        const result = assignmentObjective(assignment, project, threshold);
        if (!result.valid) continue;
        const ids = assignment.map((item) => item.candidate.layout.id);
        if (betterAssignment(bestTriple, result.objective, ids)) {
          bestTriple = { objective: result.objective, ids, assignment, distances: result.distances };
        }
      }
    }
  }
  if (bestTriple) {
    const selected = bestTriple.assignment.map((item) => ({
      strategy: item.strategy,
      label: item.candidate.scorecards[item.strategy].profile.label,
      layout: item.candidate.layout,
      scorecard: item.candidate.scorecards[item.strategy],
    }));
    return {
      version: DIVERSITY_VERSION,
      status: "complete",
      complete: true,
      partial: false,
      threshold,
      selected,
      layouts: selected.map((item) => item.layout),
      pairwiseDistances: bestTriple.distances,
      diagnostics: [],
    };
  }

  // No diverse triple: retain the best distinct pair that clears the same
  // threshold, then a single best candidate if even that is impossible.
  let bestPair: { objective: number; ids: string[]; assignment: { candidate: ScoredLayoutCandidate; strategy: StrategyProfileId }[]; distances: SelectionPairDistance[] } | undefined;
  const pairProfiles: [StrategyProfileId, StrategyProfileId][] = [
    ["compactEfficiency", "bestFlow"],
    ["compactEfficiency", "balanced"],
    ["bestFlow", "balanced"],
  ];
  for (const [firstStrategy, secondStrategy] of pairProfiles) {
    for (const first of pools[firstStrategy]) {
      for (const second of pools[secondStrategy]) {
        if (first.layout.id === second.layout.id) continue;
        const assignment = [
          { candidate: first, strategy: firstStrategy },
          { candidate: second, strategy: secondStrategy },
        ];
        const result = assignmentObjective(assignment, project, threshold);
        if (!result.valid) continue;
        const ids = assignment.map((item) => item.candidate.layout.id);
        if (betterAssignment(bestPair, result.objective, ids)) {
          bestPair = { objective: result.objective, ids, assignment, distances: result.distances };
        }
      }
    }
  }
  if (bestPair) {
    const selected = bestPair.assignment.map((item) => ({
      strategy: item.strategy,
      label: item.candidate.scorecards[item.strategy].profile.label,
      layout: item.candidate.layout,
      scorecard: item.candidate.scorecards[item.strategy],
    }));
    const code = scored.length < 3 ? "INSUFFICIENT_CANDIDATES" : "INSUFFICIENT_DIVERSITY";
    diagnostics.push({
      code,
      message: code === "INSUFFICIENT_CANDIDATES"
        ? "fewer than three hard-valid candidates are available"
        : "fewer than three candidates meet the pairwise diversity threshold",
      candidateCount: scored.length,
      threshold,
    });
    return {
      version: DIVERSITY_VERSION,
      status: "partial",
      complete: false,
      partial: true,
      threshold,
      selected,
      layouts: selected.map((item) => item.layout),
      pairwiseDistances: bestPair.distances,
      diagnostics,
      reason: code,
    };
  }
  const bestSingle = [...scored].sort((a, b) => {
    const scoreA = Math.max(...STRATEGY_PROFILE_IDS.map((strategy) => a.scorecards[strategy].overallUtility));
    const scoreB = Math.max(...STRATEGY_PROFILE_IDS.map((strategy) => b.scorecards[strategy].overallUtility));
    return scoreB - scoreA || compareText(a.layout.id, b.layout.id);
  })[0];
  const bestStrategy = [...STRATEGY_PROFILE_IDS].sort((a, b) => bestSingle.scorecards[b].overallUtility - bestSingle.scorecards[a].overallUtility || STRATEGY_PROFILE_IDS.indexOf(a) - STRATEGY_PROFILE_IDS.indexOf(b))[0];
  const selected: SelectedLayout[] = [{
    strategy: bestStrategy,
    label: bestSingle.scorecards[bestStrategy].profile.label,
    layout: bestSingle.layout,
    scorecard: bestSingle.scorecards[bestStrategy],
  }];
  const code = scored.length < 3 ? "INSUFFICIENT_CANDIDATES" : "INSUFFICIENT_DIVERSITY";
  diagnostics.push({
    code,
    message: code === "INSUFFICIENT_CANDIDATES"
      ? "fewer than three hard-valid candidates are available"
      : "no pair of hard-valid candidates meets the pairwise diversity threshold",
    candidateCount: scored.length,
    threshold,
  });
  return {
    version: DIVERSITY_VERSION,
    status: "partial",
    complete: false,
    partial: true,
    threshold,
    selected,
    layouts: selected.map((item) => item.layout),
    pairwiseDistances: [],
    diagnostics,
    reason: code,
  };
}

export const jointlySelectTriplet = selectDiverseTriplet;
export const selectTriplet = selectDiverseTriplet;
export const selectDiverseLayouts = selectDiverseTriplet;
