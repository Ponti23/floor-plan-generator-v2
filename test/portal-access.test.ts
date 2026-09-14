import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PORTAL_WIDTH_UNITS,
  buildLayoutIndexes,
  buildPedestrianPortalGraph,
  buildPortalGraph,
  normalizeProject,
  portalSpanValid,
  reachableSpaceIds,
  validateLayout,
  type AccessPortal,
  type GridRect,
  type Layout,
  type ProjectBrief,
  type RoomRequirement,
  type SiteBrief,
} from "../src/domain/index.ts";

function rect(x: number, y: number, width: number, depth: number): GridRect {
  return { x, y, width, depth };
}

function portal(
  id: string,
  a: string,
  b: string,
  wall: AccessPortal["wall"],
  start: number,
  length: number,
  kind: AccessPortal["kind"] = "pedestrian",
): AccessPortal {
  return { id, a, b, wall, start, length, kind };
}

type FixtureSpace = { id: string; role: Layout["spaces"][number]["role"]; rect: GridRect };

function fixture(
  footprint: GridRect,
  spaces: readonly FixtureSpace[],
  portals: readonly AccessPortal[],
): Layout {
  return {
    id: "portal-fixture",
    footprint,
    spaces: spaces.map((space) => ({
      instanceId: space.id,
      role: space.role,
      rect: space.rect,
    })),
    portals: portals.slice(),
    entrancePortalId: portals[0]?.id ?? "entrance",
    metadata: {
      engineVersion: "test",
      ruleVersion: "test",
      seed: "test",
      topology: "straight",
      footprintVariant: "test",
      expandedStates: 0,
      candidateOrdinal: 0,
    },
  };
}

function spaceMap(layout: Layout): Map<string, Layout["spaces"][number]> {
  return new Map(buildLayoutIndexes(layout).spaces.map((space) => [space.instanceId, space]));
}

/**
 * A fully tiled 16 × 12 footprint (4 m × 3 m at the approved 250 mm grid).  The
 * north band is an entrance plus living room; the south band is split into a
 * middle space and a far room, so the far room is reachable *only* by walking
 * through the middle one.
 */
const ACCESS_FOOTPRINT = rect(0, 0, 16, 12);

function accessSpaces(middleId: string, farId: string): FixtureSpace[] {
  return [
    { id: "entry-1", role: "entry", rect: rect(0, 8, 4, 4) },
    { id: "living-1", role: "room", rect: rect(4, 8, 12, 4) },
    {
      id: middleId,
      role: middleId === "hall-1" ? "circulation" : "room",
      rect: rect(0, 0, 8, 8),
    },
    { id: farId, role: "room", rect: rect(8, 0, 8, 8) },
  ];
}

function accessPortals(middleId: string, farId: string): AccessPortal[] {
  return [
    portal("p-entrance", "exterior", "entry-1", "south", 0, 4),
    portal("p-entry-living", "entry-1", "living-1", "east", 8, 4),
    // The living room sits on the north band (y 8..12), so its *north* side is
    // the wall it shares with the middle space below it.
    portal("p-living-middle", "living-1", middleId, "north", 4, 4),
    portal("p-middle-far", middleId, farId, "east", 0, 8),
  ];
}

function requirement(
  id: string,
  kind: RoomRequirement["kind"],
  zone: RoomRequirement["traits"]["zone"],
  mayBePassThrough: boolean,
  quantity = 1,
): RoomRequirement {
  return {
    id,
    label: id,
    kind,
    quantity,
    inclusion: "required",
    dimensions: { minAreaMm2: 1_000_000 },
    traits: {
      zone,
      wet: kind === "bathroom",
      exteriorPreference: "none",
      mayBePassThrough,
    },
  };
}

function brief(program: RoomRequirement[]): ProjectBrief {
  const site: SiteBrief = {
    widthMm: 4_000,
    depthMm: 3_000,
    offsets: {
      north: { distanceMm: 0, source: "architect" },
      east: { distanceMm: 0, source: "architect" },
      south: { distanceMm: 0, source: "architect" },
      west: { distanceMm: 0, source: "architect" },
    },
    frontSide: "south",
  };
  return {
    schemaVersion: 1,
    projectId: "portal-access",
    name: "Portal access",
    site,
    program,
    relationships: [],
    planning: { minimumCirculationWidthMm: 1_000, maxUnallocatedInteriorRatio: 0.05 },
    generation: { seed: "portal-access" },
  };
}

function codesOf(layout: Layout, project: ProjectBrief): string[] {
  return validateLayout(layout, normalizeProject(project)).violations.map(
    (violation) => violation.code,
  );
}

test("a portal counts only when it lies on a real shared interval of sufficient width", () => {
  const layout = fixture(
    ACCESS_FOOTPRINT,
    [
      { id: "entry-1", role: "entry", rect: rect(0, 8, 4, 4) },
      { id: "living-1", role: "room", rect: rect(4, 8, 12, 4) },
    ],
    [],
  );
  const spaces = spaceMap(layout);

  // The genuine shared wall: entry's east side against living's west side.
  assert.equal(
    portalSpanValid(portal("ok", "entry-1", "living-1", "east", 8, 4), spaces, ACCESS_FOOTPRINT),
    true,
  );

  // Narrower than the approved abstract door width.
  assert.equal(MIN_PORTAL_WIDTH_UNITS, 4);
  assert.equal(
    portalSpanValid(portal("narrow", "entry-1", "living-1", "east", 8, 3), spaces, ACCESS_FOOTPRINT),
    false,
  );

  // The spaces are adjacent, but not along the wall the portal declares.
  assert.equal(
    portalSpanValid(
      portal("wrong-side", "entry-1", "living-1", "north", 8, 4),
      spaces,
      ACCESS_FOOTPRINT,
    ),
    false,
  );

  // The portal runs past the end of the shared interval.
  assert.equal(
    portalSpanValid(
      portal("overhang", "entry-1", "living-1", "east", 10, 4),
      spaces,
      ACCESS_FOOTPRINT,
    ),
    false,
  );

  // Unknown endpoint, and exterior on both sides, are never portals.
  assert.equal(
    portalSpanValid(portal("unknown", "entry-1", "ghost", "east", 8, 4), spaces, ACCESS_FOOTPRINT),
    false,
  );
  assert.equal(
    portalSpanValid(
      portal("nowhere", "exterior", "exterior", "south", 0, 4),
      spaces,
      ACCESS_FOOTPRINT,
    ),
    false,
  );
});

test("corner contact never creates a portal", () => {
  // `a` occupies x 0..4, y 0..4; `b` occupies x 4..8, y 4..8.  They meet at the
  // single point (4, 4): diagonal contact, not a shared wall.
  const spaces: FixtureSpace[] = [
    { id: "a", role: "room", rect: rect(0, 0, 4, 4) },
    { id: "b", role: "room", rect: rect(4, 4, 4, 4) },
  ];
  const diagonal = portal("corner", "a", "b", "east", 4, 4);
  const layout = fixture(rect(0, 0, 12, 12), spaces, [diagonal]);

  assert.deepEqual(buildLayoutIndexes(layout).sharedWallIntervals, []);
  assert.equal(portalSpanValid(diagonal, spaceMap(layout), layout.footprint), false);
  assert.deepEqual(buildPortalGraph(layout).edges, []);
  assert.deepEqual(buildPortalGraph(layout).adjacency.a, []);
  assert.deepEqual(reachableSpaceIds(layout), ["exterior"]);
});

test("the access graph refuses portals the validator rejects", () => {
  // entry-1 and bedroom-2 are nowhere near each other; a portal between them is
  // pure fiction and must not become a route.
  const bogus = portal("bogus", "entry-1", "bedroom-2", "south", 0, 4);
  const layout = fixture(ACCESS_FOOTPRINT, accessSpaces("bedroom-1", "bedroom-2"), [bogus]);
  const project = brief([
    requirement("living", "living", "public", true),
    requirement("bedroom", "bedroom", "private", false, 2),
  ]);

  assert.equal(portalSpanValid(bogus, spaceMap(layout), layout.footprint), false);
  assert.deepEqual(buildPortalGraph(layout).edges, []);
  assert.deepEqual(reachableSpaceIds(layout), ["exterior"]);
  assert.ok(codesOf(layout, project).includes("PORTAL_NOT_ON_SHARED_EDGE"));
});

test("vehicle frontage is not a pedestrian route", () => {
  const spaces: FixtureSpace[] = [
    { id: "entry-1", role: "entry", rect: rect(0, 8, 4, 4) },
    { id: "garage-1", role: "room", rect: rect(4, 8, 12, 4) },
  ];
  const layout = fixture(ACCESS_FOOTPRINT, spaces, [
    portal("p-entrance", "exterior", "entry-1", "south", 0, 4),
    portal("p-garage", "exterior", "garage-1", "south", 4, 4, "vehicle"),
  ]);

  assert.deepEqual(buildPedestrianPortalGraph(layout).adjacency["garage-1"], []);
  assert.equal(reachableSpaceIds(layout).includes("garage-1"), false);
  assert.equal(buildPortalGraph(layout).adjacency["garage-1"].length, 1);
});

test("a private room is never a transit node, even when its traits claim otherwise", () => {
  // The brief optimistically marks the bedroom as a pass-through.  It is still
  // a destination only, so bedroom-2 — reachable solely by walking through it —
  // must be reported as forbidden pass-through.
  const project = brief([
    requirement("living", "living", "public", true),
    requirement("bedroom", "bedroom", "private", true, 2),
  ]);
  const layout = fixture(
    ACCESS_FOOTPRINT,
    accessSpaces("bedroom-1", "bedroom-2"),
    accessPortals("bedroom-1", "bedroom-2"),
  );
  const codes = codesOf(layout, project);

  assert.ok(codes.includes("FORBIDDEN_PASS_THROUGH"));
  // bedroom-1 is a legitimate destination, not an unreachable room.
  assert.equal(codes.includes("ROOM_UNREACHABLE"), false);
});

test("the same route through circulation is allowed", () => {
  const project = brief([
    requirement("living", "living", "public", true),
    requirement("bedroom", "bedroom", "private", false),
  ]);
  const layout = fixture(
    ACCESS_FOOTPRINT,
    accessSpaces("hall-1", "bedroom-1"),
    accessPortals("hall-1", "bedroom-1"),
  );
  const codes = codesOf(layout, project);

  assert.equal(codes.includes("FORBIDDEN_PASS_THROUGH"), false);
  assert.equal(codes.includes("ROOM_UNREACHABLE"), false);
  assert.deepEqual(codes, []);
});

test("an open-plan room is a transit node only when the brief opts in", () => {
  const layout = fixture(
    ACCESS_FOOTPRINT,
    accessSpaces("living-2", "bedroom-1"),
    accessPortals("living-2", "bedroom-1"),
  );

  const optedIn = codesOf(
    layout,
    brief([
      requirement("living", "living", "public", true, 2),
      requirement("bedroom", "bedroom", "private", false),
    ]),
  );
  const optedOut = codesOf(
    layout,
    brief([
      requirement("living", "living", "public", false, 2),
      requirement("bedroom", "bedroom", "private", false),
    ]),
  );

  assert.deepEqual(optedIn, []);
  // Without the opt-in the open-plan room stops being a corridor, so the far
  // bedroom can only be reached by walking through it.
  assert.ok(optedOut.includes("FORBIDDEN_PASS_THROUGH"));
});
