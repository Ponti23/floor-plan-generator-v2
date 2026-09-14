/**
 * Portal graph and transit-policy helpers shared by validation and the rule
 * registry.
 *
 * These helpers lived inside `validation.ts` until Stage 2 bucket 2.3.  They
 * are the single source of truth for portal geometry and pedestrian
 * reachability, so both the ordered validator and the typed evaluator registry
 * consume them without creating a module cycle.
 */

import { MIN_PORTAL_WIDTH_UNITS } from "./constants.ts";
import { placedSpaces } from "./facts.ts";
import {
  edgeSegment,
  intervalContainsSpan,
  isGridRect,
  sharedWallSegments,
  type GridRect,
} from "./geometry.ts";
import {
  EXTERIOR_SPACE_ID,
  type AccessPortal,
  type Layout,
  type PlacedSpace,
} from "./layout.ts";
import type { RoomInstance, RoomKind } from "./model.ts";

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
  // A malformed candidate is reported by the validator; it must never crash an
  // access helper, or one bad candidate would take down generation instead of
  // being rejected.
  const layoutSpaces = Array.isArray(layout.spaces) ? layout.spaces : [];
  const layoutPortals = Array.isArray(layout.portals) ? layout.portals : [];
  const nodes = [
    EXTERIOR_SPACE_ID,
    ...layoutSpaces.map((space) => space.instanceId),
  ];
  const adjacency: Record<string, string[]> = {};
  for (const node of nodes) adjacency[node] = [];
  const edges: PortalGraphEdge[] = [];
  // Only geometrically real portals become edges.  A portal the validator
  // rejects — off the shared wall, on a corner, too narrow, pointing at an
  // unknown space — must not make a room look reachable.
  const spaceById = new Map(
    placedSpaces(layout).map((space) => [space.instanceId, space] as const),
  );
  const footprint = isGridRect(layout.footprint) ? layout.footprint : null;
  // Duplicate portal ids are a validation finding; the graph keeps the first
  // occurrence, matching the validator's first-wins loop.
  const seenPortalIds = new Set<string>();
  for (const portal of layoutPortals) {
    if (seenPortalIds.has(portal.id)) continue;
    seenPortalIds.add(portal.id);
    if (permittedKinds !== undefined && !permittedKinds.has(portal.kind)) continue;
    if (!(portal.a in adjacency) || !(portal.b in adjacency)) continue;
    if (!portalSpanValid(portal, spaceById, footprint)) continue;
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
    const node = queue[index]!;
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
  // Reachability in this domain means human reachability.  A vehicle portal
  // proves frontage, never a route, so a bare layout is resolved through the
  // pedestrian graph; callers that pass a graph get exactly that graph.
  const graph = "adjacency" in graphOrLayout
    ? graphOrLayout
    : buildPedestrianPortalGraph(graphOrLayout);
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

/**
 * Single source of truth for portal geometry.
 *
 * A portal only exists where the geometry allows one: its interval must lie
 * inside a real shared-wall segment of the declared side (or the footprint
 * boundary for an exterior portal), both endpoints must resolve, and it must be
 * at least `MIN_PORTAL_WIDTH_UNITS` wide.  Validation and the access graph both
 * call this, so reachability can never be established through a portal that
 * validation simultaneously rejects — and mere adjacency, corner contact
 * included, never becomes a route.
 *
 * `footprint` is `null` when the layout has no well-formed footprint; interior
 * portals are still decidable in that case, exterior ones are not.
 */
export function portalSpanValid(
  portal: AccessPortal,
  spaceById: ReadonlyMap<string, PlacedSpace>,
  footprint: GridRect | null,
): boolean {
  if (!portal || typeof portal !== "object") return false;
  if (!["north", "east", "south", "west"].includes(portal.wall)) return false;
  // Kind is part of the geometry contract, not just a graph filter: a portal
  // with an unsupported kind is a finding, so it is never a traversable edge.
  if (portal.kind !== "pedestrian" && portal.kind !== "vehicle") return false;
  if (!Number.isSafeInteger(portal.start) || !Number.isSafeInteger(portal.length)) return false;
  if (portal.length < MIN_PORTAL_WIDTH_UNITS) return false;

  const a = portal.a === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.a);
  const b = portal.b === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.b);
  if (portal.a !== EXTERIOR_SPACE_ID && !a) return false;
  if (portal.b !== EXTERIOR_SPACE_ID && !b) return false;

  if (a === undefined && b !== undefined) {
    return footprint !== null && exteriorPortalValid(portal, b, footprint);
  }
  if (b === undefined && a !== undefined) {
    return footprint !== null && exteriorPortalValid(portal, a, footprint);
  }
  if (a !== undefined && b !== undefined) {
    return interiorPortalValid(portal, a, b);
  }
  // Exterior on both sides is not a portal.
  return false;
}

/**
 * Rooms that may never be walked *through*, regardless of what their traits
 * claim.  A bathroom is still a valid destination; it just cannot be someone
 * else's corridor.  `RULE_ENGINE.md` names private, bathroom/WC, garage,
 * laundry and storage explicitly.
 */
const NEVER_TRANSIT_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>([
  "bedroom",
  "bathroom",
  "garage",
  "laundry",
  "storage",
]);

/**
 * Rooms that may become transit nodes only when the project policy permits
 * open-plan circulation.  The normalized form of that policy is the room's own
 * `mayBePassThrough` trait, so an authored brief still has to ask for it.
 */
const OPEN_PLAN_TRANSIT_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>([
  "living",
  "dining",
  "kitchen",
]);

/**
 * Transit policy, in one place.
 *
 * Entry and circulation spaces are the designed through-route.  Private and
 * service rooms are destinations only, even if a brief sets their
 * `mayBePassThrough` trait.  Open-plan rooms (living/dining/kitchen) join the
 * through-route only when the brief explicitly opts them in.
 */
export function isTransitNode(space: PlacedSpace, room: RoomInstance | undefined): boolean {
  if (spaceRole(space) === "entry" || spaceRole(space) === "circulation") return true;
  if (!room) return false;
  if (room.kind === "hallway") return true;
  if (NEVER_TRANSIT_KINDS.has(room.kind)) return false;
  if (room.traits.zone === "private" || room.traits.zone === "service") return false;
  return OPEN_PLAN_TRANSIT_KINDS.has(room.kind) && room.traits.mayBePassThrough === true;
}

/**
 * Reach rooms from the exterior while refusing to traverse private/service
 * rooms.  Merely having an undirected path is insufficient: a bedroom may be
 * a destination but must not be the hallway to another room.
 */
export function transitReachability(
  graph: PortalGraph,
  spaces: readonly PlacedSpace[],
  rooms: ReadonlyMap<string, RoomInstance>,
): Set<string> {
  const transit = new Set<string>([EXTERIOR_SPACE_ID]);
  for (const space of spaces) {
    if (isTransitNode(space, rooms.get(space.instanceId))) transit.add(space.instanceId);
  }
  const visited = new Set<string>([EXTERIOR_SPACE_ID]);
  const queue = [EXTERIOR_SPACE_ID];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]!;
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
