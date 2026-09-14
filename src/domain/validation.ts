import {
  area,
  containsRect,
  edgeSegment,
  intervalContainsSpan,
  isGridRect,
  sharedWallSegments,
  sharedWallLength,
  type GridRect,
} from "./geometry.ts";
import { buildLayoutIndexes } from "./facts.ts";
import {
  GRID_MM,
  GRID_UNIT_METRES,
  GARAGE_MIN_DEPTH_UNITS,
  GARAGE_MIN_WIDTH_UNITS,
  MAX_UNALLOCATED_INTERIOR_RATIO,
  MAX_GFA_M2,
  MIN_PORTAL_WIDTH_UNITS,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
} from "./constants.ts";
import {
  roomSelectorKey,
  type NormalizedProject,
  type RelationshipRequirement,
  type RoomInstance,
  type RoomSelector,
} from "./model.ts";
import {
  EXTERIOR_SPACE_ID,
  type AccessPortal,
  type Layout,
  type PlacedSpace,
} from "./layout.ts";

export type ValidationSeverity = "hard";

export interface ValidationEvidence {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ValidationViolation {
  code: string;
  ruleId: string;
  ruleVersion: number;
  severity: ValidationSeverity;
  subjects: string[];
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  evidence?: ValidationEvidence;
  message: { key: string; values: Record<string, string | number> };
}

export interface PortalGraphEdge {
  a: string;
  b: string;
  portalId: string;
  kind: "pedestrian" | "vehicle";
}

export interface PortalGraph {
  nodes: string[];
  edges: PortalGraphEdge[];
  adjacency: Record<string, string[]>;
}

export interface PortalGraphOptions {
  /** Restrict the graph to portal kinds that support the operation at hand. */
  kinds?: readonly AccessPortal["kind"][];
}

export type AccessGraph = PortalGraph;

export interface ValidationResult {
  valid: boolean;
  violations: ValidationViolation[];
  counts: { errors: number; warnings: number };
  /** Pedestrian-only access graph used to establish human reachability. */
  graph: PortalGraph;
  reachableSpaceIds: string[];
}

const RULE_VERSION = 2;
const RULE_PREFIX = "planlab-core";
const DEFAULT_MAX_UNALLOCATED_RATIO = 0.05;

function issue(
  violations: ValidationViolation[],
  code: string,
  subjects: string[] = [],
  evidence?: ValidationEvidence,
  expected?: string | number | boolean,
  actual?: string | number | boolean,
): void {
  violations.push({
    code,
    ruleId: `${RULE_PREFIX}.${code.toLowerCase()}`,
    ruleVersion: RULE_VERSION,
    severity: "hard",
    subjects,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    message: { key: `validation.${code.toLowerCase()}`, values: {} },
  });
}

function isNormalizedProject(value: unknown): value is NormalizedProject {
  return (
    value !== null &&
    typeof value === "object" &&
    "site" in value &&
    typeof (value as { site?: unknown }).site === "object" &&
    Array.isArray((value as { rooms?: unknown }).rooms)
  );
}

function resolveArguments(
  first: Layout | NormalizedProject,
  second: Layout | NormalizedProject,
): { layout: Layout; project: NormalizedProject } {
  if (isNormalizedProject(first)) {
    return { project: first, layout: second as Layout };
  }
  return { layout: first as Layout, project: second as NormalizedProject };
}

function spaceRole(space: PlacedSpace): PlacedSpace["role"] {
  return space.role ?? "room";
}

function addAdjacency(adjacency: Record<string, string[]>, a: string, b: string): void {
  if (!adjacency[a]) adjacency[a] = [];
  if (!adjacency[b]) adjacency[b] = [];
  if (!adjacency[a].includes(b)) adjacency[a].push(b);
  if (!adjacency[b].includes(a)) adjacency[b].push(a);
}

/** Build the graph represented by portals, preserving stable insertion order. */
export function buildPortalGraph(
  layout: Layout,
  options: PortalGraphOptions = {},
): PortalGraph {
  const permittedKinds = options.kinds === undefined ? undefined : new Set(options.kinds);
  const nodes = [
    EXTERIOR_SPACE_ID,
    ...layout.spaces.map((space) => space.instanceId),
  ];
  const adjacency: Record<string, string[]> = {};
  for (const node of nodes) adjacency[node] = [];
  const edges: PortalGraphEdge[] = [];
  for (const portal of layout.portals) {
    if (permittedKinds !== undefined && !permittedKinds.has(portal.kind)) continue;
    if (!(portal.a in adjacency) || !(portal.b in adjacency)) continue;
    addAdjacency(adjacency, portal.a, portal.b);
    edges.push({
      a: portal.a,
      b: portal.b,
      portalId: portal.id,
      kind: portal.kind,
    });
  }
  return { nodes, edges, adjacency };
}

/** Vehicle frontage is not a pedestrian route through the plan. */
export function buildPedestrianPortalGraph(layout: Layout): PortalGraph {
  return buildPortalGraph(layout, { kinds: ["pedestrian"] });
}

export const buildAccessGraph = buildPortalGraph;
export const createPortalGraph = buildPortalGraph;

function bfs(graph: PortalGraph, start = EXTERIOR_SPACE_ID): Set<string> {
  const visited = new Set<string>();
  if (!(start in graph.adjacency)) return visited;
  const queue = [start];
  visited.add(start);
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const next of graph.adjacency[node] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

export function reachableSpaceIds(
  graphOrLayout: PortalGraph | Layout,
  start = EXTERIOR_SPACE_ID,
): string[] {
  const graph = "adjacency" in graphOrLayout
    ? graphOrLayout
    : buildPortalGraph(graphOrLayout);
  return [...bfs(graph, start)];
}

export const computeReachability = reachableSpaceIds;

function exteriorPortalValid(
  portal: AccessPortal,
  space: PlacedSpace,
  footprint: GridRect,
): boolean {
  if (portal.wall === "north" && space.rect.y !== footprint.y) return false;
  if (portal.wall === "east" && space.rect.x + space.rect.width !== footprint.x + footprint.width) {
    return false;
  }
  if (portal.wall === "south" && space.rect.y + space.rect.depth !== footprint.y + footprint.depth) {
    return false;
  }
  if (portal.wall === "west" && space.rect.x !== footprint.x) return false;
  const edge = edgeSegment(space.rect, portal.wall);
  const footprintEdge = edgeSegment(footprint, portal.wall);
  return (
    edge.fixed === footprintEdge.fixed &&
    intervalContainsSpan(edge.interval, portal.start, portal.length) &&
    intervalContainsSpan(footprintEdge.interval, portal.start, portal.length)
  );
}

function interiorPortalValid(
  portal: AccessPortal,
  a: PlacedSpace,
  b: PlacedSpace,
): boolean {
  const segments = sharedWallSegments(a.rect, b.rect);
  for (const segment of segments) {
    const aSide = portal.a === a.instanceId ? segment.aSide : segment.bSide;
    if (
      aSide === portal.wall &&
      intervalContainsSpan(segment.interval, portal.start, portal.length)
    ) {
      return true;
    }
  }
  return false;
}

function roomSelectorMatches(room: RoomInstance, selector: RoomSelector): boolean {
  const key = roomSelectorKey(selector);
  return room.id === key || room.requirementId === key || room.kind === key;
}

function selectedSpaces(
  selector: RoomSelector,
  project: NormalizedProject,
  roomSpaces: Map<string, PlacedSpace>,
): PlacedSpace[] {
  return project.rooms
    .filter((room) => roomSelectorMatches(room, selector))
    .map((room) => roomSpaces.get(room.id))
    .filter((space): space is PlacedSpace => space !== undefined);
}

function validateRelationship(
  relationship: RelationshipRequirement,
  project: NormalizedProject,
  roomSpaces: Map<string, PlacedSpace>,
  violations: ValidationViolation[],
): void {
  if (relationship.kind !== "mustShareWall") return;
  const from = selectedSpaces(relationship.from, project, roomSpaces);
  const to = selectedSpaces(relationship.to, project, roomSpaces);
  if (from.length === 0 || to.length === 0) {
    issue(violations, "RELATIONSHIP_SELECTOR_UNRESOLVED", [relationship.id], {
      from: roomSelectorKey(relationship.from),
      to: roomSelectorKey(relationship.to),
    });
    return;
  }
  const threshold = Math.max(
    MIN_MEANINGFUL_SHARED_WALL_UNITS,
    relationship.minSharedWallM === undefined
      ? 0
      : Math.ceil(relationship.minSharedWallM / GRID_UNIT_METRES),
  );
  let satisfied = false;
  for (const a of from) {
    for (const b of to) {
      if (a.instanceId === b.instanceId) continue;
      if (sharedWallLength(a.rect, b.rect) >= threshold) satisfied = true;
    }
  }
  if (!satisfied) {
    issue(violations, "MUST_SHARE_WALL_UNSATISFIED", [relationship.id], {
      thresholdUnits: threshold,
    });
  }
}

function isTransitNode(space: PlacedSpace, room: RoomInstance | undefined): boolean {
  if (spaceRole(space) === "entry" || spaceRole(space) === "circulation") return true;
  if (!room) return false;
  return (
    room.traits.mayBePassThrough ||
    room.kind === "hallway"
  );
}

/**
 * Reach rooms from the exterior while refusing to traverse private/service
 * rooms.  Merely having an undirected path is insufficient: a bedroom may be
 * a destination but must not be the hallway to another room.
 */
function transitReachability(
  graph: PortalGraph,
  spaces: readonly PlacedSpace[],
  rooms: Map<string, RoomInstance>,
): Set<string> {
  const transit = new Set<string>([EXTERIOR_SPACE_ID]);
  for (const space of spaces) {
    if (isTransitNode(space, rooms.get(space.instanceId))) transit.add(space.instanceId);
  }
  const visited = new Set<string>([EXTERIOR_SPACE_ID]);
  const queue = [EXTERIOR_SPACE_ID];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const next of graph.adjacency[node] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      // The destination itself is reachable, but only transit nodes may be
      // expanded to reach another destination.
      if (transit.has(next)) queue.push(next);
    }
  }
  return visited;
}

function roomDimensionsValid(room: RoomInstance, rect: GridRect): boolean {
  const dimensions = room.dimensions;
  if (area(rect) < dimensions.minAreaUnits2) return false;
  if (
    dimensions.minShortSideUnits !== undefined &&
    Math.min(rect.width, rect.depth) < dimensions.minShortSideUnits
  ) {
    return false;
  }
  const directOrientation =
    (dimensions.minWidthUnits === undefined || rect.width >= dimensions.minWidthUnits) &&
    (dimensions.minDepthUnits === undefined || rect.depth >= dimensions.minDepthUnits);
  const rotatedOrientation =
    dimensions.minWidthUnits !== undefined &&
    dimensions.minDepthUnits !== undefined &&
    rect.width >= dimensions.minDepthUnits &&
    rect.depth >= dimensions.minWidthUnits;
  if (!directOrientation && !rotatedOrientation) return false;
  if (
    dimensions.maxAspectRatio !== undefined &&
    Math.max(rect.width / rect.depth, rect.depth / rect.width) > dimensions.maxAspectRatio
  ) {
    return false;
  }
  return true;
}

function isGarageRoom(room: RoomInstance): boolean {
  return room.kind === "garage" || room.traits.frontage?.kind === "vehicle";
}

function maxGfaUnits(project: NormalizedProject): number {
  const approvedMaxGfaMm2 = MAX_GFA_M2 * 1_000_000;
  const maxGfaMm2 = Math.min(
    project.planning.maxGfaMm2 ?? approvedMaxGfaMm2,
    approvedMaxGfaMm2,
  );
  return Math.floor(maxGfaMm2 / (GRID_MM * GRID_MM));
}

/**
 * Independent hard validator.  It intentionally does not trust generator
 * metadata, constructor state, or a precomputed graph.
 *
 * Both `(layout, project)` and `(project, layout)` are accepted to make the
 * domain helper pleasant to use from small spike scripts.
 */
export function validateLayout(
  layoutOrProject: Layout | NormalizedProject,
  projectOrLayout: Layout | NormalizedProject,
): ValidationResult {
  const { layout, project } = resolveArguments(layoutOrProject, projectOrLayout);
  const violations: ValidationViolation[] = [];
  const footprint = layout.footprint;
  const spaces = Array.isArray(layout.spaces) ? layout.spaces : [];
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const spaceById = new Map<string, PlacedSpace>();
  const roomSpaces = new Map<string, PlacedSpace>();
  // One geometry pass: overlaps, shared-wall intervals, exterior contact, and
  // coverage are read from the shared index rather than recomputed per rule.
  const indexes = buildLayoutIndexes(layout);

  // 1. Schema and site/footprint.
  if (project.schemaVersion !== 1) issue(violations, "UNSUPPORTED_SCHEMA_VERSION");
  if (!isGridRect(footprint)) {
    issue(violations, "INVALID_FOOTPRINT_GEOMETRY", [layout.id]);
  } else {
    if (!containsRect(project.site.envelope, footprint)) {
      issue(violations, "FOOTPRINT_OUTSIDE_ENVELOPE", [layout.id]);
    }
    if (area(footprint) > maxGfaUnits(project)) {
      issue(violations, "FOOTPRINT_EXCEEDS_MAX_GFA", [layout.id], {
        maxGfaUnits: maxGfaUnits(project),
      }, maxGfaUnits(project), area(footprint));
    }
  }

  // 2. Rectangle integrity, containment, duplicate IDs, and overlap.
  for (const space of spaces) {
    if (!["room", "circulation", "entry"].includes(space.role)) {
      issue(violations, "INVALID_SPACE_ROLE", [space.instanceId]);
    }
    if (!isGridRect(space.rect)) {
      issue(violations, "INVALID_SPACE_GEOMETRY", [space.instanceId]);
      continue;
    }
    if (spaceById.has(space.instanceId)) {
      issue(violations, "DUPLICATE_SPACE_ID", [space.instanceId]);
    } else {
      spaceById.set(space.instanceId, space);
    }
    if (isGridRect(footprint) && !containsRect(footprint, space.rect)) {
      issue(violations, "SPACE_OUTSIDE_FOOTPRINT", [space.instanceId]);
    }
    if (spaceRole(space) === "room") {
      if (!roomById.has(space.instanceId)) {
        issue(violations, "UNKNOWN_ROOM_INSTANCE", [space.instanceId]);
      } else {
        roomSpaces.set(space.instanceId, space);
      }
    }
  }
  for (const overlap of indexes.overlaps) {
    issue(violations, "SPACE_OVERLAP", [overlap.a, overlap.b], {
      overlapUnits2: overlap.areaUnits2,
    });
  }

  // 3. Room presence and dimensions.
  for (const room of project.rooms) {
    const space = roomSpaces.get(room.id);
    if (!space) {
      if (room.inclusion === "required") issue(violations, "REQUIRED_ROOM_MISSING", [room.id]);
      continue;
    }
    if (!roomDimensionsValid(room, space.rect)) {
      issue(violations, "ROOM_DIMENSIONS_INVALID", [room.id]);
    }
    if (isGarageRoom(room)) {
      if (
        room.traits.frontage?.kind !== "vehicle" ||
        room.traits.frontage.side !== "south"
      ) {
        issue(violations, "GARAGE_FRONTAGE_POLICY_INVALID", [room.id]);
      }
      if (space.rect.width < GARAGE_MIN_WIDTH_UNITS || space.rect.depth < GARAGE_MIN_DEPTH_UNITS) {
        issue(violations, "GARAGE_PRESET_DIMENSIONS_INVALID", [room.id], {
          minimumWidthUnits: GARAGE_MIN_WIDTH_UNITS,
          minimumDepthUnits: GARAGE_MIN_DEPTH_UNITS,
        });
      }
      if (
        isGridRect(footprint) &&
        space.rect.y + space.rect.depth !== footprint.y + footprint.depth
      ) {
        issue(violations, "GARAGE_MISSING_SOUTH_FRONTAGE", [room.id]);
      }
    }
  }
  const circulationMinimum = project.planning.minimumCirculationWidthUnits;
  for (const space of spaces) {
    if (spaceRole(space) !== "circulation" && spaceRole(space) !== "entry") continue;
    if (Math.min(space.rect.width, space.rect.depth) < circulationMinimum) {
      issue(violations, "CIRCULATION_WIDTH_INVALID", [space.instanceId], {
        minimumUnits: circulationMinimum,
      });
    }
  }

  // 4. Coverage/unallocated interior.  Overlap remains a separate failure and
  // is never allowed to inflate coverage.
  if (isGridRect(footprint)) {
    // Coverage is the analytical union of every well-formed space clipped to
    // the footprint, computed once in the shared geometry index; malformed
    // rectangles are skipped so they cannot shrink or inflate the interior
    // void.  Pairwise overlap checks above remain the authoritative failure;
    // subtracting pairwise overlaps here would over-subtract triple
    // intersections.
    const unallocated = indexes.unallocatedInteriorAreaUnits2;
    const ratio = unallocated / area(footprint);
    const maximum = Math.min(
      project.planning.maxUnallocatedInteriorRatio ?? DEFAULT_MAX_UNALLOCATED_RATIO,
      MAX_UNALLOCATED_INTERIOR_RATIO,
    );
    if (ratio > maximum) {
      issue(violations, "UNALLOCATED_INTERIOR_EXCEEDS_CAP", [layout.id], {
        unallocatedUnits2: unallocated,
        ratio,
      }, maximum, ratio);
    }
  }

  // 5. Portal geometry and entrance/frontage anchors.
  const validPortals: AccessPortal[] = [];
  const portalIds = new Set<string>();
  for (const portal of Array.isArray(layout.portals) ? layout.portals : []) {
    if (portalIds.has(portal.id)) {
      issue(violations, "DUPLICATE_PORTAL_ID", [portal.id]);
      continue;
    }
    portalIds.add(portal.id);
    if (!["north", "east", "south", "west"].includes(portal.wall)) {
      issue(violations, "PORTAL_WALL_INVALID", [portal.id]);
      continue;
    }
    if (portal.kind !== "pedestrian" && portal.kind !== "vehicle") {
      issue(violations, "PORTAL_KIND_INVALID", [portal.id]);
      continue;
    }
    if (
      !Number.isSafeInteger(portal.start) ||
      !Number.isSafeInteger(portal.length) ||
      portal.length < MIN_PORTAL_WIDTH_UNITS
    ) {
      issue(violations, "PORTAL_WIDTH_INVALID", [portal.id], {
        minimumUnits: MIN_PORTAL_WIDTH_UNITS,
      });
      continue;
    }
    const a = portal.a === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.a);
    const b = portal.b === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.b);
    if (portal.a !== EXTERIOR_SPACE_ID && !a) {
      issue(violations, "PORTAL_UNKNOWN_SPACE", [portal.id, portal.a]);
      continue;
    }
    if (portal.b !== EXTERIOR_SPACE_ID && !b) {
      issue(violations, "PORTAL_UNKNOWN_SPACE", [portal.id, portal.b]);
      continue;
    }
    let valid = false;
    if (a === undefined && b !== undefined && isGridRect(footprint)) {
      valid = exteriorPortalValid(portal, b, footprint);
    } else if (b === undefined && a !== undefined && isGridRect(footprint)) {
      valid = exteriorPortalValid(portal, a, footprint);
    } else if (a !== undefined && b !== undefined) {
      valid = interiorPortalValid(portal, a, b);
    }
    if (!valid) {
      issue(violations, "PORTAL_NOT_ON_SHARED_EDGE", [portal.id]);
      continue;
    }
    validPortals.push(portal);
  }
  const externalPedestrian = validPortals.filter(
    (portal) =>
      portal.kind === "pedestrian" &&
      (portal.a === EXTERIOR_SPACE_ID || portal.b === EXTERIOR_SPACE_ID),
  );
  if (externalPedestrian.length !== 1) {
    issue(violations, "ENTRANCE_COUNT_INVALID", externalPedestrian.map((portal) => portal.id), {
      expectedCount: 1,
      actualCount: externalPedestrian.length,
    });
  }
  const entrance = validPortals.find((portal) => portal.id === layout.entrancePortalId);
  if (
    !entrance ||
    entrance.kind !== "pedestrian" ||
    entrance.a !== EXTERIOR_SPACE_ID && entrance.b !== EXTERIOR_SPACE_ID ||
    entrance.wall !== "south"
  ) {
    issue(violations, "ENTRANCE_PORTAL_INVALID", [layout.entrancePortalId]);
  } else {
    const entranceTargetId = entrance.a === EXTERIOR_SPACE_ID ? entrance.b : entrance.a;
    const entranceTarget = spaceById.get(entranceTargetId);
    if (
      !entranceTarget ||
      (spaceRole(entranceTarget) !== "entry" && spaceRole(entranceTarget) !== "circulation")
    ) {
      issue(violations, "ENTRANCE_TARGET_INVALID", [layout.entrancePortalId, entranceTargetId]);
    }
  }
  const vehicleExternal = validPortals.filter(
    (portal) =>
      portal.kind === "vehicle" &&
      (portal.a === EXTERIOR_SPACE_ID || portal.b === EXTERIOR_SPACE_ID),
  );
  for (const room of project.rooms.filter(
    (candidate) => candidate.traits.frontage?.kind === "vehicle" &&
      (candidate.inclusion === "required" || roomSpaces.has(candidate.id)),
  )) {
    const garagePortal = vehicleExternal.find(
      (portal) =>
        (portal.a === room.id || portal.b === room.id) &&
        portal.wall === "south",
    );
    if (!garagePortal) issue(violations, "GARAGE_VEHICLE_PORTAL_MISSING", [room.id]);
  }

  // 6. Graph reachability and pass-through policy.
  // A vehicle portal proves vehicle frontage only.  It must never make a
  // garage (or any other occupiable room) appear human-reachable from the
  // pedestrian entrance.
  const graph = buildPedestrianPortalGraph({ ...layout, portals: validPortals });
  const reachable = bfs(graph);
  const transitReachable = transitReachability(graph, spaces, roomById);
  for (const room of project.rooms) {
    const roomSpace = roomSpaces.get(room.id);
    if (!roomSpace) {
      // Missing required rooms were recorded above. Optional rooms may be
      // omitted, but once placed they are occupiable and need the same safe
      // pedestrian access and pass-through checks as required rooms.
      continue;
    }
    if (!isTransitNode(roomSpace, room)) {
      // A private/service destination may have one pedestrian edge to the
      // circulation graph, but two or more pedestrian edges would make it a
      // possible through-route.  Vehicle frontage is deliberately excluded so
      // a garage may have one vehicle edge plus one internal pedestrian edge.
      const pedestrianIncidents = graph.edges.filter(
        (edge) => edge.kind === "pedestrian" &&
          (edge.a === room.id || edge.b === room.id),
      );
      if (pedestrianIncidents.length > 1) {
        issue(violations, "FORBIDDEN_PASS_THROUGH", [room.id]);
      }
    }
    if (!reachable.has(room.id)) {
      issue(violations, "ROOM_UNREACHABLE", [room.id]);
    } else if (!transitReachable.has(room.id)) {
      issue(violations, "FORBIDDEN_PASS_THROUGH", [room.id]);
    }
  }
  for (const space of spaces.filter((candidate) => spaceRole(candidate) === "circulation")) {
    if (!reachable.has(space.instanceId)) issue(violations, "CIRCULATION_UNREACHABLE", [space.instanceId]);
  }

  // 7. Hard relationships.
  for (const relationship of project.relationships) {
    validateRelationship(relationship, project, roomSpaces, violations);
  }

  return {
    valid: violations.length === 0,
    violations,
    counts: { errors: violations.length, warnings: 0 },
    graph,
    reachableSpaceIds: [...reachable],
  };
}

export const hardValidateLayout = validateLayout;
export const validateGeneratedLayout = validateLayout;
export const independentlyValidateLayout = validateLayout;
