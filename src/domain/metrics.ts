import {
  area,
  boundaryDistance,
  centre,
  exteriorContactBySide,
  isGridRect,
  overlapArea,
  sharedWallLength,
  unallocatedInteriorArea,
  unionArea,
  type CardinalSide,
  type GridRect,
} from "./geometry.ts";
import {
  GRID_M2,
  MAX_GFA_M2,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
} from "./constants.ts";
import {
  roomSelectorKey,
  type NormalizedProject,
  type RoomInstance,
  type RoomSelector,
} from "./model.ts";
import {
  EXTERIOR_SPACE_ID,
  type Layout,
  type PlacedSpace,
} from "./layout.ts";
import {
  buildPortalGraph,
  type PortalGraph,
  type ValidationResult,
  validateLayout,
} from "./validation.ts";

/** The five scoreable categories approved by the PlanLab scoring note. */
export type MetricCategory =
  | "programSpace"
  | "flow"
  | "relationships"
  | "liveability"
  | "servicesSite";

export const METRIC_CATEGORIES: readonly MetricCategory[] = [
  "programSpace",
  "flow",
  "relationships",
  "liveability",
  "servicesSite",
] as const;

export interface MessageDescriptor {
  key: string;
  values: Record<string, string | number>;
}

/** A metric observation deliberately stores evidence, not presentation copy. */
export interface MetricObservation {
  key: string;
  values: Record<string, string | number>;
  impact: number;
  evidenceRefs: string[];
  message: MessageDescriptor;
  category?: MetricCategory;
}

export interface SpaceFact {
  instanceId: string;
  role: PlacedSpace["role"];
  rect: GridRect;
  areaUnits2: number;
  centre: { x: number; y: number };
  boundaryContact: Record<CardinalSide, number>;
}

export interface RoomFact extends SpaceFact {
  role: "room";
  requirementId: string;
  ordinal: number;
  displayName: string;
  kind: RoomInstance["kind"];
  zone: RoomInstance["traits"]["zone"];
  wet: boolean;
  exteriorPreference: RoomInstance["traits"]["exteriorPreference"];
  aspectRatio: number;
  exteriorContactUnits: number;
  exteriorContactBySide: Record<CardinalSide, number>;
}

export interface SharedWallFact {
  a: string;
  b: string;
  lengthUnits: number;
  meaningful: boolean;
}

export interface RoomDistanceFact {
  a: string;
  b: string;
  distanceUnits: number;
}

export interface LayoutFacts {
  /** Version the single fact pass so consumers can detect stale derived data. */
  factsVersion: string;
  layoutId: string;
  siteAreaUnits2: number;
  siteAreaM2: number;
  buildableAreaUnits2: number;
  buildableAreaM2: number;
  footprintAreaUnits2: number;
  footprintAreaM2: number;
  programmedUsableAreaUnits2: number;
  programmedUsableAreaM2: number;
  garageAreaUnits2: number;
  garageAreaM2: number;
  circulationAreaUnits2: number;
  circulationAreaM2: number;
  entryAreaUnits2: number;
  unallocatedInteriorAreaUnits2: number;
  unallocatedInteriorAreaM2: number;
  unallocatedInteriorRatio: number;
  overlapAreaUnits2: number;
  allocationRatio: number;
  planningEfficiency: number;
  targetGfaUnits2: number;
  maxGfaUnits2: number;
  gfaDeltaFromTargetUnits2: number;
  gfaDeltaFromTargetM2: number;
  gfaDeltaFromMaxUnits2: number;
  gfaDeltaFromMaxM2: number;
  circulationRatio: number;
  circulationLengthUnits: number;
  circulationComponentCount: number;
  deadEndCount: number;
  requiredRoomCount: number;
  reachableRequiredRoomCount: number;
  reachabilityQuality: number;
  routeDistancesUnits: Record<string, number | null>;
  roomFacts: RoomFact[];
  spaceFacts: SpaceFact[];
  sharedWalls: SharedWallFact[];
  roomDistances: RoomDistanceFact[];
  portalGraph: PortalGraph;
  reachableSpaceIds: string[];
  /** A stable, serialisable list of hard validation codes used by scoring. */
  hardViolationCodes: string[];
}

export interface MetricValue {
  id: string;
  utility: number;
  raw: number;
  target?: number;
  evidenceRefs: string[];
  observations: MetricObservation[];
}

export interface CategoryMetrics {
  category: MetricCategory;
  utility: number;
  score: number;
  metrics: MetricValue[];
  observations: MetricObservation[];
}

export interface LayoutMetrics {
  facts: LayoutFacts;
  categories: Record<MetricCategory, CategoryMetrics>;
  observations: MetricObservation[];
}

export const METRICS_VERSION = "planlab-metrics-0.4";

/** Named breakpoints for the intentionally small prototype utility model. */
export const METRIC_CONFIG = Object.freeze({
  preferredAreaOversizeTolerance: 1.15,
  preferredAreaZeroUtilityRatio: 2,
  defaultPreferredAspectRatio: 1.5,
  defaultHardAspectRatio: 3,
  defaultAdjacencyTargetUnits: MIN_MEANINGFUL_SHARED_WALL_UNITS,
  defaultNearTargetUnits: 12,
  defaultExteriorTargetUnits: 12,
  targetCirculationRatio: 0.15,
  unacceptableCirculationRatio: 0.35,
  privateDepthTargetUnits: 16,
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Preferred-area utility: linear benefit up to the preferred area, a named
 * plateau, then a mild linear decline.  It is intentionally bounded so a
 * room cannot improve a score forever by growing into circulation space.
 */
export function preferredAreaUtility(
  actualArea: number,
  preferredArea: number,
  oversizeTolerance = METRIC_CONFIG.preferredAreaOversizeTolerance,
  zeroUtilityRatio = METRIC_CONFIG.preferredAreaZeroUtilityRatio,
): number {
  if (!Number.isFinite(actualArea) || actualArea <= 0) return 0;
  if (!Number.isFinite(preferredArea) || preferredArea <= 0) return 1;
  if (!Number.isFinite(oversizeTolerance) || oversizeTolerance < 1) {
    throw new RangeError("oversizeTolerance must be at least 1");
  }
  if (!Number.isFinite(zeroUtilityRatio) || zeroUtilityRatio <= oversizeTolerance) {
    throw new RangeError("zeroUtilityRatio must be greater than oversizeTolerance");
  }
  const ratio = actualArea / preferredArea;
  if (ratio <= 1) return clamp01(ratio);
  if (ratio <= oversizeTolerance) return 1;
  return clamp01(
    1 - (ratio - oversizeTolerance) / (zeroUtilityRatio - oversizeTolerance),
  );
}

/**
 * Aspect utility overloads accept either a ratio or width/depth plus explicit
 * breakpoints.  The latter form is useful to callers working directly with a
 * GridRect: `aspectUtility(width, depth, preferred, hardMaximum)`.
 */
export function aspectUtility(
  actualRatio: number,
  preferredRatio?: number,
  hardMaximum?: number,
): number;
export function aspectUtility(
  width: number,
  depth: number,
  preferredRatio: number,
  hardMaximum: number,
): number;
export function aspectUtility(
  first: number,
  second = METRIC_CONFIG.defaultPreferredAspectRatio,
  third = METRIC_CONFIG.defaultHardAspectRatio,
  fourth?: number,
): number {
  const ratio = fourth === undefined
    ? first
    : Math.max(first, second) / Math.max(1e-9, Math.min(first, second));
  const preferred = fourth === undefined ? second : third;
  const hard = fourth === undefined ? third : fourth;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (!Number.isFinite(preferred) || !Number.isFinite(hard) || preferred <= 0 || hard <= 0 || hard < preferred) {
    throw new RangeError("hard aspect ratio must be at least the preferred ratio");
  }
  if (ratio <= preferred) return 1;
  // A square-only constraint has no decline interval.  A square remains fully
  // useful, while any non-square rectangle fails the hard aspect breakpoint.
  if (hard === preferred) return 0;
  return clamp01(1 - (ratio - preferred) / (hard - preferred));
}

export function adjacencyUtility(
  sharedLengthUnits: number,
  targetLengthUnits = METRIC_CONFIG.defaultAdjacencyTargetUnits,
): number {
  if (!Number.isFinite(sharedLengthUnits) || sharedLengthUnits <= 0) return 0;
  return clamp01(sharedLengthUnits / finitePositive(targetLengthUnits, 1));
}

export function nearnessUtility(
  edgeDistanceUnits: number,
  targetDistanceUnits = METRIC_CONFIG.defaultNearTargetUnits,
): number {
  if (!Number.isFinite(edgeDistanceUnits) || edgeDistanceUnits < 0) return 0;
  const target = finitePositive(targetDistanceUnits, 1);
  return clamp01(1 - edgeDistanceUnits / target);
}

export function exteriorUtility(
  contactUnits: number,
  targetContactUnits = METRIC_CONFIG.defaultExteriorTargetUnits,
): number {
  if (!Number.isFinite(contactUnits) || contactUnits <= 0) return 0;
  return clamp01(contactUnits / finitePositive(targetContactUnits, 1));
}

export function circulationRatioUtility(
  ratio: number,
  targetRatio = METRIC_CONFIG.targetCirculationRatio,
  unacceptableRatio = METRIC_CONFIG.unacceptableCirculationRatio,
): number {
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  if (unacceptableRatio <= targetRatio) {
    throw new RangeError("unacceptable circulation ratio must exceed target ratio");
  }
  if (ratio <= targetRatio) return 1;
  return clamp01(1 - (ratio - targetRatio) / (unacceptableRatio - targetRatio));
}

export function unallocatedUtility(unallocatedRatio: number): number {
  if (!Number.isFinite(unallocatedRatio) || unallocatedRatio < 0) return 0;
  return clamp01(1 - unallocatedRatio);
}

export function separationUtility(
  edgeDistanceUnits: number,
  targetDistanceUnits = METRIC_CONFIG.defaultNearTargetUnits,
): number {
  if (!Number.isFinite(edgeDistanceUnits) || edgeDistanceUnits < 0) return 0;
  return clamp01(edgeDistanceUnits / finitePositive(targetDistanceUnits, 1));
}

function average(values: readonly number[], empty = 1): number {
  return values.length === 0 ? empty : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rectsFor(layout: Layout): PlacedSpace[] {
  return (Array.isArray(layout.spaces) ? layout.spaces : []).filter(
    (space): space is PlacedSpace & { rect: GridRect } => isGridRect(space.rect),
  );
}

function roomForSpace(project: NormalizedProject, space: PlacedSpace): RoomInstance | undefined {
  return project.rooms.find((room) => room.id === space.instanceId);
}

function emptyGraph(layout: Layout): PortalGraph {
  const nodes = [EXTERIOR_SPACE_ID, ...rectsFor(layout).map((space) => space.instanceId)];
  const adjacency: Record<string, string[]> = {};
  for (const node of nodes) adjacency[node] = [];
  return { nodes, edges: [], adjacency };
}

interface PortalRouteNode {
  id: string;
  point: { x: number; y: number };
  spaces: string[];
}

function portalMidpoint(
  portal: Layout["portals"][number],
  rectById: ReadonlyMap<string, GridRect>,
): { x: number; y: number } | null {
  const hostId = portal.a === EXTERIOR_SPACE_ID ? portal.b : portal.a;
  const host = rectById.get(hostId);
  if (!host) return null;
  const midpoint = portal.start + portal.length / 2;
  switch (portal.wall) {
    case "north": return { x: midpoint, y: host.y };
    case "east": return { x: host.x + host.width, y: midpoint };
    case "south": return { x: midpoint, y: host.y + host.depth };
    case "west": return { x: host.x, y: midpoint };
  }
}

function manhattan(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function graphRouteDistances(
  layout: Layout,
  graph: PortalGraph,
): { distances: Record<string, number | null>; reachable: string[] } {
  const rectById = new Map(rectsFor(layout).map((space) => [space.instanceId, space.rect]));
  const portalById = new Map(
    (Array.isArray(layout.portals) ? layout.portals : []).map((portal) => [portal.id, portal]),
  );
  const portalNodes: PortalRouteNode[] = graph.edges.flatMap((edge) => {
    const portal = portalById.get(edge.portalId);
    if (!portal) return [];
    const point = portalMidpoint(portal, rectById);
    if (!point) return [];
    return [{
      id: edge.portalId,
      point,
      spaces: [edge.a, edge.b].filter((spaceId) => spaceId !== EXTERIOR_SPACE_ID),
    }];
  });
  const nodeById = new Map(portalNodes.map((node) => [node.id, node]));
  const portalsBySpace = new Map<string, string[]>();
  for (const node of portalNodes) {
    for (const spaceId of node.spaces) {
      const ids = portalsBySpace.get(spaceId) ?? [];
      ids.push(node.id);
      portalsBySpace.set(spaceId, ids);
    }
  }
  const neighbours = new Map(portalNodes.map((node) => [node.id, [] as Array<{ id: string; cost: number }>]));
  for (const ids of portalsBySpace.values()) {
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        const a = nodeById.get(ids[first]!);
        const b = nodeById.get(ids[second]!);
        if (!a || !b) continue;
        const cost = manhattan(a.point, b.point);
        neighbours.get(a.id)?.push({ id: b.id, cost });
        neighbours.get(b.id)?.push({ id: a.id, cost });
      }
    }
  }
  const entranceNode = graph.edges.find((edge) =>
    edge.portalId === layout.entrancePortalId &&
      (edge.a === EXTERIOR_SPACE_ID || edge.b === EXTERIOR_SPACE_ID),
  ) ?? graph.edges.find((edge) => edge.a === EXTERIOR_SPACE_ID || edge.b === EXTERIOR_SPACE_ID);
  const portalDistances = new Map(portalNodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  if (entranceNode && portalDistances.has(entranceNode.portalId)) {
    portalDistances.set(entranceNode.portalId, 0);
  }
  const pending = new Set(portalNodes.map((node) => node.id));
  while (pending.size > 0) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const node of portalNodes) {
      if (!pending.has(node.id)) continue;
      const distance = portalDistances.get(node.id) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = node.id;
        currentDistance = distance;
      }
    }
    if (!current || !Number.isFinite(currentDistance)) break;
    pending.delete(current);
    for (const next of neighbours.get(current) ?? []) {
      if (!pending.has(next.id)) continue;
      const proposed = currentDistance + next.cost;
      if (proposed < (portalDistances.get(next.id) ?? Number.POSITIVE_INFINITY)) {
        portalDistances.set(next.id, proposed);
      }
    }
  }
  const serialised: Record<string, number | null> = {};
  const reachable: string[] = [];
  for (const spaceId of graph.nodes) {
    if (spaceId === EXTERIOR_SPACE_ID) {
      serialised[spaceId] = 0;
      reachable.push(spaceId);
      continue;
    }
    const rect = rectById.get(spaceId);
    const centrePoint = rect ? centre(rect) : undefined;
    const distance = Math.min(...(portalsBySpace.get(spaceId) ?? []).map((portalId) => {
      const node = nodeById.get(portalId);
      const portalDistance = portalDistances.get(portalId) ?? Number.POSITIVE_INFINITY;
      return node && centrePoint && Number.isFinite(portalDistance)
        ? portalDistance + manhattan(node.point, centrePoint)
        : Number.POSITIVE_INFINITY;
    }));
    serialised[spaceId] = Number.isFinite(distance) ? distance : null;
    if (Number.isFinite(distance)) reachable.push(spaceId);
  }
  return { distances: serialised, reachable };
}

function componentCount(
  spaces: readonly PlacedSpace[],
  graph: PortalGraph,
): number {
  const transit = spaces
    .filter((space) => space.role === "circulation" || space.role === "entry")
    .map((space) => space.instanceId);
  const transitSet = new Set(transit);
  const visited = new Set<string>();
  let count = 0;
  for (const start of transit) {
    if (visited.has(start)) continue;
    count += 1;
    const queue = [start];
    visited.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      for (const next of graph.adjacency[queue[index]] ?? []) {
        if (!transitSet.has(next) || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return count;
}

function countDeadEnds(spaces: readonly PlacedSpace[], graph: PortalGraph): number {
  return spaces.filter(
    (space) => space.role === "circulation" && (graph.adjacency[space.instanceId]?.length ?? 0) <= 1,
  ).length;
}

function sharedWallsForRooms(roomFacts: readonly RoomFact[]): SharedWallFact[] {
  const facts: SharedWallFact[] = [];
  for (let first = 0; first < roomFacts.length; first += 1) {
    for (let second = first + 1; second < roomFacts.length; second += 1) {
      const a = roomFacts[first];
      const b = roomFacts[second];
      const lengthUnits = sharedWallLength(a.rect, b.rect);
      if (lengthUnits <= 0) continue;
      facts.push({
        a: a.instanceId < b.instanceId ? a.instanceId : b.instanceId,
        b: a.instanceId < b.instanceId ? b.instanceId : a.instanceId,
        lengthUnits,
        meaningful: lengthUnits >= MIN_MEANINGFUL_SHARED_WALL_UNITS,
      });
    }
  }
  return facts.sort((a, b) => compareText(a.a, b.a) || compareText(a.b, b.b));
}

function distancesForRooms(roomFacts: readonly RoomFact[]): RoomDistanceFact[] {
  const facts: RoomDistanceFact[] = [];
  for (let first = 0; first < roomFacts.length; first += 1) {
    for (let second = first + 1; second < roomFacts.length; second += 1) {
      const a = roomFacts[first];
      const b = roomFacts[second];
      facts.push({
        a: a.instanceId < b.instanceId ? a.instanceId : b.instanceId,
        b: a.instanceId < b.instanceId ? b.instanceId : a.instanceId,
        distanceUnits: boundaryDistance(a.rect, b.rect),
      });
    }
  }
  return facts.sort((a, b) => compareText(a.a, b.a) || compareText(a.b, b.b));
}

function isGarage(room: RoomInstance): boolean {
  return room.kind === "garage" || room.traits.frontage?.kind === "vehicle";
}

function roomSelection(
  project: NormalizedProject,
  facts: readonly RoomFact[],
  selector: RoomSelector,
): RoomFact[] {
  const key = roomSelectorKey(selector);
  const ids = new Set(
    project.rooms
      .filter((room) => room.id === key || room.requirementId === key || room.kind === key)
      .map((room) => room.id),
  );
  return facts.filter((fact) => ids.has(fact.instanceId));
}

function distanceFor(
  distances: readonly RoomDistanceFact[],
  a: string,
  b: string,
): number {
  const fact = distances.find(
    (candidate) => candidate.a === (a < b ? a : b) && candidate.b === (a < b ? b : a),
  );
  return fact?.distanceUnits ?? Number.POSITIVE_INFINITY;
}

function metricObservation(
  category: MetricCategory,
  id: string,
  utility: number,
  values: Record<string, string | number>,
  evidenceRefs: string[],
): MetricObservation[] {
  const bounded = clamp01(utility);
  const impact = bounded - 0.5;
  if (bounded >= 0.75) {
    return [{
      key: `${category}.${id}.strong`,
      values,
      impact,
      evidenceRefs,
      category,
      message: { key: `${category}.${id}.strong`, values },
    }];
  }
  if (bounded <= 0.45) {
    return [{
      key: `${category}.${id}.weak`,
      values,
      impact,
      evidenceRefs,
      category,
      message: { key: `${category}.${id}.weak`, values },
    }];
  }
  return [];
}

function makeMetric(
  category: MetricCategory,
  id: string,
  utility: number,
  raw: number,
  values: Record<string, string | number>,
  evidenceRefs: string[],
  target?: number,
): MetricValue {
  const bounded = clamp01(utility);
  const notApplicable = evidenceRefs.some((reference) => reference.includes(":notApplicable"));
  return {
    id,
    utility: bounded,
    raw,
    ...(target === undefined ? {} : { target }),
    evidenceRefs,
    // A neutral score for an absent optional feature is useful for category
    // aggregation, but must not be presented as a positive design finding.
    observations: notApplicable ? [] : metricObservation(category, id, bounded, values, evidenceRefs),
  };
}

function category(
  categoryId: MetricCategory,
  metrics: MetricValue[],
): CategoryMetrics {
  const utility = average(metrics.map((metric) => metric.utility));
  return {
    category: categoryId,
    utility: clamp01(utility),
    score: Math.round(clamp01(utility) * 100),
    metrics,
    observations: metrics.flatMap((metric) => metric.observations),
  };
}

function averageRelationshipUtility(
  project: NormalizedProject,
  facts: LayoutFacts,
): { utility: number; observations: MetricObservation[]; rawCount: number } {
  const utilities: number[] = [];
  const observations: MetricObservation[] = [];
  for (const relationship of project.relationships) {
    if (relationship.kind === "mustShareWall") continue;
    const from = roomSelection(project, facts.roomFacts, relationship.from);
    const to = roomSelection(project, facts.roomFacts, relationship.to);
    for (const first of from) {
      for (const second of to) {
        if (first.instanceId === second.instanceId) continue;
        const shared = facts.sharedWalls.find(
          (candidate) => candidate.a === (first.instanceId < second.instanceId ? first.instanceId : second.instanceId) &&
            candidate.b === (first.instanceId < second.instanceId ? second.instanceId : first.instanceId),
        )?.lengthUnits ?? 0;
        const distance = distanceFor(facts.roomDistances, first.instanceId, second.instanceId);
        let utility = 0;
        let measure = "distanceUnits";
        let raw = distance;
        let target = relationship.targetDistanceM === undefined
          ? METRIC_CONFIG.defaultNearTargetUnits
          : relationship.targetDistanceM / 0.25;
        if (relationship.kind === "preferShareWall") {
          utility = adjacencyUtility(
            shared,
            relationship.minSharedWallM === undefined
              ? METRIC_CONFIG.defaultAdjacencyTargetUnits
              : relationship.minSharedWallM / 0.25,
          );
          measure = "sharedWallUnits";
          raw = shared;
          target = relationship.minSharedWallM === undefined
            ? METRIC_CONFIG.defaultAdjacencyTargetUnits
            : relationship.minSharedWallM / 0.25;
        } else if (relationship.kind === "preferNear") {
          utility = nearnessUtility(distance, target);
        } else if (relationship.kind === "avoidShareWall") {
          utility = shared >= MIN_MEANINGFUL_SHARED_WALL_UNITS ? 0 : 1;
          measure = "sharedWallUnits";
          raw = shared;
          target = MIN_MEANINGFUL_SHARED_WALL_UNITS;
        } else if (relationship.kind === "keepSeparate") {
          utility = separationUtility(distance, target);
        }
        utilities.push(utility);
        observations.push(...metricObservation(
          "relationships",
          `relationship.${relationship.id}`,
          utility,
          { from: first.displayName, to: second.displayName, [measure]: raw, targetUnits: target },
          [`relationship:${relationship.id}`, `room:${first.instanceId}`, `room:${second.instanceId}`],
        ));
      }
    }
  }
  return { utility: average(utilities), observations, rawCount: utilities.length };
}

function bedroomGroupingUtility(facts: LayoutFacts, project: NormalizedProject): number {
  const bedrooms = facts.roomFacts.filter((fact) => {
    const room = project.rooms.find((candidate) => candidate.id === fact.instanceId);
    return room?.kind === "bedroom";
  });
  if (bedrooms.length < 2) return 1;
  const diagonal = Math.max(
    1,
    Math.hypot(project.site.envelope.width, project.site.envelope.depth),
  );
  const dispersion = average(
    bedrooms.flatMap((first, index) => bedrooms.slice(index + 1).map((second) =>
      Math.hypot(first.centre.x - second.centre.x, first.centre.y - second.centre.y) / diagonal,
    )),
  );
  return clamp01(1 - dispersion);
}

function wetClusteringUtility(facts: LayoutFacts): number {
  const wet = facts.roomFacts.filter((fact) => fact.wet);
  if (wet.length < 2) return 1;
  const diagonal = Math.max(1, Math.hypot(
    facts.footprintAreaUnits2 > 0 ? Math.sqrt(facts.footprintAreaUnits2) : 1,
    facts.footprintAreaUnits2 > 0 ? Math.sqrt(facts.footprintAreaUnits2) : 1,
  ));
  const values: number[] = [];
  for (let first = 0; first < wet.length; first += 1) {
    for (let second = first + 1; second < wet.length; second += 1) {
      const shared = facts.sharedWalls.find(
        (candidate) => candidate.a === (wet[first].instanceId < wet[second].instanceId ? wet[first].instanceId : wet[second].instanceId) &&
          candidate.b === (wet[first].instanceId < wet[second].instanceId ? wet[second].instanceId : wet[first].instanceId),
      )?.lengthUnits ?? 0;
      const distance = distanceFor(facts.roomDistances, wet[first].instanceId, wet[second].instanceId);
      const distanceUtility = Number.isFinite(distance) ? 1 - clamp01(distance / diagonal) : 0;
      values.push(Math.max(adjacencyUtility(shared), distanceUtility));
    }
  }
  return average(values);
}

function roomTargetExterior(room: RoomInstance): number {
  switch (room.traits.exteriorPreference) {
    case "high": return 16;
    case "medium": return 12;
    case "low": return 8;
    default: return 0;
  }
}

/**
 * Compute immutable facts once.  This function is deliberately useful on
 * invalid layouts too: callers can inspect evidence, while scoreLayout will
 * refuse to award design points until hard validation passes.
 */
export function computeLayoutFacts(
  layout: Layout,
  project: NormalizedProject,
  validation?: ValidationResult,
): LayoutFacts {
  const spaces = rectsFor(layout);
  const footprint = isGridRect(layout.footprint) ? layout.footprint : {
    x: 0,
    y: 0,
    width: 1,
    depth: 1,
  };
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const spaceFacts: SpaceFact[] = spaces.map((space) => ({
    instanceId: space.instanceId,
    role: space.role,
    rect: space.rect,
    areaUnits2: area(space.rect),
    centre: centre(space.rect),
    boundaryContact: exteriorContactBySide(space.rect, footprint),
  }));
  const roomFacts: RoomFact[] = spaces
    .filter((space) => space.role === "room" && roomById.has(space.instanceId))
    .map((space) => {
      const room = roomById.get(space.instanceId)!;
      const sides = exteriorContactBySide(space.rect, footprint, spaces.map((candidate) => candidate.rect));
      return {
        instanceId: space.instanceId,
        role: "room" as const,
        rect: space.rect,
        areaUnits2: area(space.rect),
        centre: centre(space.rect),
        boundaryContact: sides,
        requirementId: room.requirementId,
        ordinal: room.ordinal,
        displayName: room.displayName,
        kind: room.kind,
        zone: room.traits.zone,
        wet: room.traits.wet,
        exteriorPreference: room.traits.exteriorPreference,
        aspectRatio: Math.max(space.rect.width / space.rect.depth, space.rect.depth / space.rect.width),
        exteriorContactUnits: Object.values(sides).reduce((sum, value) => sum + value, 0),
        exteriorContactBySide: sides,
      };
    });
  let graph: PortalGraph;
  let hardValidation = validation;
  if (!hardValidation) {
    try {
      hardValidation = validateLayout(layout, project);
    } catch {
      hardValidation = undefined;
    }
  }
  try {
    graph = hardValidation?.graph ?? buildPortalGraph(layout);
  } catch {
    graph = emptyGraph(layout);
  }
  const route = graphRouteDistances(layout, graph);
  const required = project.rooms.filter((room) => room.inclusion === "required");
  const reachableRequired = required.filter((room) => route.reachable.includes(room.id));
  const entrySpaces = spaces.filter((space) => space.role === "entry");
  const circulationSpaces = spaces.filter((space) => space.role === "circulation");
  // Entry is a transit space in the approved area model: circulation area is
  // the union of entry and hallway/circulation rectangles.  Keep entryArea as
  // a separate diagnostic while using the combined union for identities.
  const transitSpaces = [...circulationSpaces, ...entrySpaces];
  const garageFacts = roomFacts.filter((fact) => {
    const room = roomById.get(fact.instanceId);
    return room ? isGarage(room) : false;
  });
  const programmedFacts = roomFacts.filter((fact) => !garageFacts.includes(fact));
  // Coverage is an interior measure: spaces are clipped to the footprint
  // before the union, so a malformed space that spills outside cannot make an
  // interior void disappear from facts.
  const spaceRects = spaces.map((space) => space.rect);
  const footprintArea = area(footprint);
  const garageAreaUnits2 = unionArea(garageFacts.map((fact) => fact.rect));
  const circulationAreaUnits2 = unionArea(transitSpaces.map((space) => space.rect));
  const entryAreaUnits2 = unionArea(entrySpaces.map((space) => space.rect));
  const programmedUsableAreaUnits2 = unionArea(programmedFacts.map((fact) => fact.rect));
  const unallocatedInteriorAreaUnits2 = unallocatedInteriorArea(footprint, spaceRects);
  const denominator = footprintArea - garageAreaUnits2;
  // Keep the category totals additive for the allocation diagnostic.  Unlike
  // unallocated area (which is based on geometric union), this intentionally
  // does not subtract cross-category overlaps; an invalid layout must not look
  // well allocated merely because union coverage hid the double allocation.
  const allocatedAreaUnits2 = programmedUsableAreaUnits2 + garageAreaUnits2 + circulationAreaUnits2;
  const targetGfaUnits2 = Math.floor(
    (project.planning.targetGfaMm2 ?? 180 * 1_000_000) / (GRID_M2 * 1_000_000),
  );
  const maxGfaUnits2 = Math.floor(
    Math.min(
      project.planning.maxGfaMm2 ?? MAX_GFA_M2 * 1_000_000,
      MAX_GFA_M2 * 1_000_000,
    ) / (GRID_M2 * 1_000_000),
  );
  return {
    factsVersion: METRICS_VERSION,
    layoutId: layout.id,
    siteAreaUnits2: area(project.site.site),
    siteAreaM2: area(project.site.site) * GRID_M2,
    buildableAreaUnits2: area(project.site.envelope),
    buildableAreaM2: area(project.site.envelope) * GRID_M2,
    footprintAreaUnits2: footprintArea,
    footprintAreaM2: footprintArea * GRID_M2,
    programmedUsableAreaUnits2,
    programmedUsableAreaM2: programmedUsableAreaUnits2 * GRID_M2,
    garageAreaUnits2,
    garageAreaM2: garageAreaUnits2 * GRID_M2,
    circulationAreaUnits2,
    circulationAreaM2: circulationAreaUnits2 * GRID_M2,
    entryAreaUnits2,
    unallocatedInteriorAreaUnits2,
    unallocatedInteriorAreaM2: unallocatedInteriorAreaUnits2 * GRID_M2,
    unallocatedInteriorRatio: footprintArea === 0 ? 1 : unallocatedInteriorAreaUnits2 / footprintArea,
    overlapAreaUnits2: overlapArea(spaceRects),
    allocationRatio: footprintArea === 0 ? 0 : allocatedAreaUnits2 / footprintArea,
    planningEfficiency: denominator <= 0 ? 0 : programmedUsableAreaUnits2 / denominator,
    targetGfaUnits2,
    maxGfaUnits2,
    gfaDeltaFromTargetUnits2: footprintArea - targetGfaUnits2,
    gfaDeltaFromTargetM2: (footprintArea - targetGfaUnits2) * GRID_M2,
    gfaDeltaFromMaxUnits2: footprintArea - maxGfaUnits2,
    gfaDeltaFromMaxM2: (footprintArea - maxGfaUnits2) * GRID_M2,
    circulationRatio: footprintArea === 0 ? 1 : circulationAreaUnits2 / footprintArea,
    circulationLengthUnits: transitSpaces.reduce(
      (sum, space) => sum + Math.max(space.rect.width, space.rect.depth),
      0,
    ),
    circulationComponentCount: componentCount(spaces, graph),
    deadEndCount: countDeadEnds(spaces, graph),
    requiredRoomCount: required.length,
    reachableRequiredRoomCount: reachableRequired.length,
    reachabilityQuality: required.length === 0 ? 1 : reachableRequired.length / required.length,
    routeDistancesUnits: Object.fromEntries(
      project.rooms.map((room) => [room.id, route.distances[room.id] ?? null]),
    ),
    roomFacts,
    spaceFacts,
    sharedWalls: sharedWallsForRooms(roomFacts),
    roomDistances: distancesForRooms(roomFacts),
    portalGraph: graph,
    reachableSpaceIds: route.reachable,
    hardViolationCodes: [...new Set((hardValidation?.violations ?? []).map((violation) => violation.code))],
  };
}

export const calculateLayoutFacts = computeLayoutFacts;
export const deriveLayoutFacts = computeLayoutFacts;

function targetFootprintUtility(facts: LayoutFacts): number {
  if (facts.targetGfaUnits2 <= 0) return 0;
  return clamp01(1 - Math.abs(facts.gfaDeltaFromTargetUnits2) / facts.targetGfaUnits2);
}

/** Compute all five category utilities from one shared facts object. */
export function evaluateLayoutMetrics(
  layout: Layout,
  project: NormalizedProject,
  facts = computeLayoutFacts(layout, project),
): LayoutMetrics {
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const placedRooms = facts.roomFacts.filter((fact) => roomById.has(fact.instanceId));
  const preferredRooms = placedRooms.filter((fact) => {
    const preferred = roomById.get(fact.instanceId)?.dimensions.preferredAreaUnits2;
    return preferred !== undefined;
  });
  const preferredUtilities = preferredRooms.map((fact) => {
    const room = roomById.get(fact.instanceId)!;
    return preferredAreaUtility(fact.areaUnits2, room.dimensions.preferredAreaUnits2!);
  });
  const aspectUtilities = placedRooms.map((fact) => {
    const room = roomById.get(fact.instanceId)!;
    return aspectUtility(
      fact.aspectRatio,
      room.dimensions.maxAspectRatio === undefined
        ? METRIC_CONFIG.defaultPreferredAspectRatio
        : Math.min(METRIC_CONFIG.defaultPreferredAspectRatio, room.dimensions.maxAspectRatio),
      room.dimensions.maxAspectRatio ?? METRIC_CONFIG.defaultHardAspectRatio,
    );
  });
  const program = category("programSpace", [
    makeMetric(
      "programSpace",
      "preferredArea",
      average(preferredUtilities),
      average(preferredUtilities),
      { roomsWithPreferredArea: preferredRooms.length },
      preferredRooms.length > 0
        ? preferredRooms.map((fact) => `room:${fact.instanceId}:area`)
        : ["program:preferredArea:notApplicable"],
    ),
    makeMetric(
      "programSpace",
      "proportion",
      average(aspectUtilities),
      average(aspectUtilities),
      { rooms: placedRooms.length },
      placedRooms.length > 0
        ? placedRooms.map((fact) => `room:${fact.instanceId}:aspect`)
        : ["program:proportion:notApplicable"],
    ),
    makeMetric(
      "programSpace",
      "unallocatedInterior",
      unallocatedUtility(facts.unallocatedInteriorRatio),
      facts.unallocatedInteriorRatio,
      { unallocatedRatio: facts.unallocatedInteriorRatio, unallocatedAreaUnits2: facts.unallocatedInteriorAreaUnits2 },
      ["footprint:unallocated"],
      project.planning.maxUnallocatedInteriorRatio,
    ),
    makeMetric(
      "programSpace",
      "targetFootprint",
      targetFootprintUtility(facts),
      facts.footprintAreaUnits2,
      {
        footprintAreaUnits2: facts.footprintAreaUnits2,
        targetGfaUnits2: facts.targetGfaUnits2,
        maxGfaUnits2: facts.maxGfaUnits2,
        deltaFromTargetUnits2: facts.gfaDeltaFromTargetUnits2,
        deltaFromMaxUnits2: facts.gfaDeltaFromMaxUnits2,
      },
      ["footprint:targetGfa"],
      facts.targetGfaUnits2,
    ),
  ]);

  const routeValues = project.rooms
    .map((room) => facts.routeDistancesUnits[room.id])
    .filter((distance): distance is number => distance !== null && Number.isFinite(distance));
  const routeUtilities = routeValues.map((distance) => nearnessUtility(distance, 48));
  const circulation = category("flow", [
    makeMetric(
      "flow",
      "reachability",
      facts.reachabilityQuality,
      facts.reachabilityQuality,
      { reachableRequiredRooms: facts.reachableRequiredRoomCount, requiredRooms: facts.requiredRoomCount },
      ["access:reachability"],
    ),
    makeMetric(
      "flow",
      "circulationRatio",
      circulationRatioUtility(facts.circulationRatio),
      facts.circulationRatio,
      { circulationAreaUnits2: facts.circulationAreaUnits2, footprintAreaUnits2: facts.footprintAreaUnits2, ratio: facts.circulationRatio },
      ["circulation:area"],
      METRIC_CONFIG.targetCirculationRatio,
    ),
    makeMetric(
      "flow",
      "routeDistances",
      average(routeUtilities),
      average(routeValues, 0),
      { roomsWithRoutes: routeValues.length },
      project.rooms.length > 0
        ? project.rooms.map((room) => `route:${room.id}`)
        : ["route:notApplicable"],
    ),
    makeMetric(
      "flow",
      "deadEnds",
      1 - clamp01(facts.deadEndCount / Math.max(1, facts.circulationComponentCount + 1)),
      facts.deadEndCount,
      { deadEndCount: facts.deadEndCount, circulationComponents: facts.circulationComponentCount },
      ["circulation:deadEnds"],
    ),
  ]);

  const relationship = averageRelationshipUtility(project, facts);
  const relationships = category("relationships", [
    makeMetric(
      "relationships",
      "declaredPreferences",
      relationship.utility,
      relationship.rawCount,
      { evaluatedPairs: relationship.rawCount },
      relationship.rawCount > 0 ? ["relationships:declared"] : ["relationships:declared:notApplicable"],
    ),
    makeMetric(
      "relationships",
      "bedroomGrouping",
      bedroomGroupingUtility(facts, project),
      bedroomGroupingUtility(facts, project),
      { bedroomCount: facts.roomFacts.filter((fact) => fact.kind === "bedroom").length },
      facts.roomFacts.filter((fact) => fact.kind === "bedroom").length > 1
        ? facts.roomFacts.filter((fact) => fact.kind === "bedroom").map((fact) => `room:${fact.instanceId}:centre`)
        : ["relationships:bedroomGrouping:notApplicable"],
    ),
  ]);
  relationships.observations.push(...relationship.observations);

  const exteriorUtilities = placedRooms.map((fact) => {
    const room = roomById.get(fact.instanceId)!;
    const target = roomTargetExterior(room);
    return target === 0 ? 1 : exteriorUtility(fact.exteriorContactUnits, target);
  });
  const orientationRooms = placedRooms.filter((fact) => fact.kind === "living" || fact.kind === "dining");
  const northUtilities = orientationRooms.map((fact) => exteriorUtility(
    fact.exteriorContactBySide.north,
    Math.max(1, Math.min(fact.rect.width, 12)),
  ));
  const privateRooms = placedRooms.filter((fact) => fact.zone === "private");
  const privateDepthUtilities = privateRooms.map((fact) => {
    const distance = facts.routeDistancesUnits[fact.instanceId];
    return distance === null || distance === undefined
      ? 0
      : clamp01(distance / METRIC_CONFIG.privateDepthTargetUnits);
  });
  const liveability = category("liveability", [
    makeMetric(
      "liveability",
      "exteriorContact",
      average(exteriorUtilities),
      average(exteriorUtilities),
      { rooms: placedRooms.length },
      placedRooms.length > 0
        ? placedRooms.map((fact) => `room:${fact.instanceId}:exterior`)
        : ["room:exterior:notApplicable"],
    ),
    makeMetric(
      "liveability",
      "northOpportunity",
      average(northUtilities),
      average(northUtilities),
      { northOpportunityRooms: orientationRooms.length },
      orientationRooms.length > 0
        ? orientationRooms.map((fact) => `room:${fact.instanceId}:north`)
        : ["room:north:notApplicable"],
    ),
    makeMetric(
      "liveability",
      "privacyDepth",
      average(privateDepthUtilities),
      average(privateDepthUtilities, 0),
      { privateRooms: privateRooms.length },
      privateRooms.length > 0
        ? privateRooms.map((fact) => `route:${fact.instanceId}`)
        : ["privacy:notApplicable"],
    ),
  ]);

  const garages = placedRooms.filter((fact) => {
    const room = roomById.get(fact.instanceId);
    return room !== undefined && isGarage(room);
  });
  const entryFacts = facts.spaceFacts.filter((fact) => fact.role === "entry" || fact.role === "circulation");
  const serviceRooms = placedRooms.filter((fact) => fact.wet || fact.zone === "service");
  const garageUtilities = garages.flatMap((garage) => {
    const related = placedRooms.filter((fact) => ["kitchen", "laundry"].includes(fact.kind));
    const near = related.map((fact) => nearnessUtility(distanceFor(facts.roomDistances, garage.instanceId, fact.instanceId), 24));
    const entryNear = entryFacts.length === 0
      ? 1
      : Math.max(...entryFacts.map((fact) => nearnessUtility(boundaryDistance(garage.rect, fact.rect), 24)));
    return [average(near), entryNear];
  });
  const footprint = isGridRect(layout.footprint) ? layout.footprint : undefined;
  const compactness = !footprint || facts.footprintAreaUnits2 <= 0
    ? 0
    : clamp01(2 * Math.min(footprint.width, footprint.depth) / (footprint.width + footprint.depth));
  const servicesSite = category("servicesSite", [
    makeMetric(
      "servicesSite",
      "wetClustering",
      wetClusteringUtility(facts),
      wetClusteringUtility(facts),
      { wetRoomCount: serviceRooms.filter((fact) => fact.wet).length },
      serviceRooms.filter((fact) => fact.wet).length > 0
        ? serviceRooms.filter((fact) => fact.wet).map((fact) => `room:${fact.instanceId}:wet`)
        : ["services:wetClustering:notApplicable"],
    ),
    makeMetric(
      "servicesSite",
      "garageRelationships",
      average(garageUtilities),
      average(garageUtilities, garages.length === 0 ? 1 : 0),
      { garageCount: garages.length },
      garages.length > 0
        ? garages.map((fact) => `room:${fact.instanceId}:garage`)
        : ["garage:notApplicable"],
    ),
    makeMetric(
      "servicesSite",
      "footprintCompactness",
      compactness,
      compactness,
      { widthUnits: footprint?.width ?? 0, depthUnits: footprint?.depth ?? 0 },
      ["footprint:compactness"],
    ),
    makeMetric(
      "servicesSite",
      "planningEfficiency",
      clamp01(facts.planningEfficiency),
      facts.planningEfficiency,
      { programmedUsableAreaUnits2: facts.programmedUsableAreaUnits2, footprintMinusGarageUnits2: facts.footprintAreaUnits2 - facts.garageAreaUnits2 },
      ["area:planningEfficiency"],
    ),
  ]);

  const categories = {
    programSpace: program,
    flow: circulation,
    relationships,
    liveability,
    servicesSite,
  } satisfies Record<MetricCategory, CategoryMetrics>;
  return {
    facts,
    categories,
    observations: METRIC_CATEGORIES.flatMap((key) => categories[key].observations),
  };
}

export const calculateMetrics = evaluateLayoutMetrics;
export const scoreableMetrics = evaluateLayoutMetrics;
