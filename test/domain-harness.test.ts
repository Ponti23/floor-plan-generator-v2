import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_CONSTANTS,
  CANONICAL_NORMALIZED_PROJECT,
  CANONICAL_PROJECT,
  GRID_MM,
  IMPOSSIBLE_FIXTURES,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
  area,
  boundaryDistance,
  containsRect,
  exteriorContactBySide,
  intersection,
  intersectionArea,
  meaningfulAdjacency,
  metresToMm,
  normalizeProject,
  normalizeRoomRequirements,
  overlaps,
  parseMetresToMm,
  sharedWallLength,
  sharedWallSegments,
  tryNormalizeProject,
  unionArea,
  type GridRect,
  type RoomRequirement,
} from "../src/domain/index.ts";

test("approved prototype constants are centralized", () => {
  assert.equal(GRID_MM, 250);
  assert.equal(APPROVED_CONSTANTS.GRID_MM, 250);
  assert.equal(APPROVED_CONSTANTS.TARGET_GFA_M2, 180);
  assert.equal(APPROVED_CONSTANTS.MAX_GFA_M2, 200);
  assert.equal(APPROVED_CONSTANTS.MAX_UNALLOCATED_INTERIOR_RATIO, 0.05);
  assert.equal(APPROVED_CONSTANTS.MIN_MEANINGFUL_SHARED_WALL_UNITS, 4);
  assert.equal(APPROVED_CONSTANTS.GARAGE_MIN_WIDTH_UNITS, 24);
  assert.equal(APPROVED_CONSTANTS.GARAGE_MIN_DEPTH_UNITS, 24);
  assert.equal(APPROVED_CONSTANTS.GARAGE_FRONT_SIDE, "south");
  assert.equal(APPROVED_CONSTANTS.MIRRORED_LAYOUTS_COUNT_AS_DISTINCT, false);
  assert.equal(APPROVED_CONSTANTS.FRONT_SIDE, "south");
});

test("metre text converts to integer millimetres without floating-point geometry", () => {
  assert.equal(parseMetresToMm("20"), 20_000);
  assert.equal(parseMetresToMm("1.5"), 1_500);
  assert.equal(metresToMm(0.25), 250);
  assert.throws(() => parseMetresToMm("1.2345"), /at most 3 places/);
  assert.throws(() => parseMetresToMm("-1"), /non-negative/);
});

test("canonical fixture normalizes to the exact approved site and envelope", () => {
  const normalized = CANONICAL_NORMALIZED_PROJECT;
  assert.deepEqual(normalized.site.site, { x: 0, y: 0, width: 80, depth: 120 });
  assert.deepEqual(normalized.site.envelope, { x: 6, y: 8, width: 68, depth: 88 });
  assert.deepEqual(normalized.site.exactEnvelopeMm, {
    x: 1_500,
    y: 2_000,
    width: 17_000,
    depth: 22_000,
  });
  assert.equal(normalized.site.discretizationLossMm2, 0);
  assert.equal(normalized.rooms.length, 8);
  assert.deepEqual(
    normalized.rooms.map((room) => room.id),
    [
      "bedroom-1",
      "bedroom-2",
      "bedroom-3",
      "bathroom-1",
      "kitchen-1",
      "living-1",
      "laundry-1",
      "garage-1",
    ],
  );
  assert.equal(normalized.rooms[0].dimensions.minShortSideUnits, 12);
  assert.equal(normalized.rooms.at(-1)?.dimensions.minWidthUnits, 24);
  assert.equal(normalized.rooms.at(-1)?.dimensions.minDepthUnits, 24);
  assert.equal(CANONICAL_PROJECT.site.frontSide, "south");
});

test("conservative snapping insets both minimum and maximum edges", () => {
  const project = structuredClone(CANONICAL_PROJECT);
  project.site.widthMm = 20_123;
  project.site.depthMm = 30_234;
  project.site.offsets.west.distanceMm = 1_501;
  project.site.offsets.north.distanceMm = 2_001;
  project.site.offsets.east.distanceMm = 1_501;
  project.site.offsets.south.distanceMm = 6_001;
  const normalized = normalizeProject(project);
  assert.deepEqual(normalized.site.site, { x: 0, y: 0, width: 80, depth: 120 });
  assert.deepEqual(normalized.site.envelope, { x: 7, y: 9, width: 67, depth: 87 });
  for (const loss of Object.values(normalized.site.gridInsetLossMm)) {
    assert.ok(loss >= 0 && loss < GRID_MM);
  }
  assert.ok(normalized.site.discretizationLossMm2 > 0);
  assert.ok(containsRect(normalized.site.site, normalized.site.envelope));
});

test("half-open rectangle intersection distinguishes overlap from edge/corner contact", () => {
  const a: GridRect = { x: 0, y: 0, width: 4, depth: 4 };
  const edge: GridRect = { x: 4, y: 1, width: 3, depth: 2 };
  const corner: GridRect = { x: 4, y: 4, width: 2, depth: 2 };
  const overlap: GridRect = { x: 2, y: 1, width: 4, depth: 4 };
  assert.equal(intersection(a, edge), null);
  assert.equal(intersectionArea(a, edge), 0);
  assert.equal(overlaps(a, edge), false);
  assert.equal(intersection(a, corner), null);
  assert.equal(intersectionArea(a, overlap), 6);
  assert.equal(area(intersection(a, overlap)!), 6);
  assert.equal(overlaps(a, overlap), true);
  assert.equal(containsRect(a, { x: 0, y: 0, width: 4, depth: 4 }), true);
  assert.equal(containsRect(a, { x: 4, y: 0, width: 1, depth: 1 }), false);
});

test("shared walls use positive projected intervals and a one-metre threshold", () => {
  const a: GridRect = { x: 0, y: 0, width: 4, depth: 8 };
  const b: GridRect = { x: 4, y: 2, width: 5, depth: 4 };
  const corner: GridRect = { x: 4, y: 8, width: 2, depth: 2 };
  assert.equal(sharedWallLength(a, b), 4);
  assert.deepEqual(sharedWallSegments(a, b), [
    { aSide: "east", bSide: "west", fixed: 4, interval: { start: 2, end: 6 } },
  ]);
  assert.equal(meaningfulAdjacency(a, b), true);
  assert.equal(meaningfulAdjacency(a, b, 5), false);
  assert.equal(sharedWallLength(a, corner), 0);
  assert.equal(MIN_MEANINGFUL_SHARED_WALL_UNITS, 4);
});

test("boundary distance, facade contact, and exact multi-rectangle coverage are analytical", () => {
  const footprint: GridRect = { x: 0, y: 0, width: 20, depth: 20 };
  const room: GridRect = { x: 0, y: 3, width: 6, depth: 5 };
  const blocker: GridRect = { x: 0, y: 0, width: 2, depth: 3 };
  assert.equal(boundaryDistance(room, { x: 8, y: 3, width: 2, depth: 4 }), 2);
  assert.deepEqual(exteriorContactBySide(room, footprint, [blocker]), {
    north: 0,
    east: 0,
    south: 0,
    west: 5,
  });
  const circulation = [
    { x: 0, y: 0, width: 4, depth: 10 },
    { x: 0, y: 6, width: 10, depth: 4 },
  ];
  assert.equal(unionArea(circulation), 64);
});

test("quantity expansion produces stable room instances and preserves traits", () => {
  const rooms: RoomRequirement[] = [
    {
      id: "bedroom",
      label: "Bedroom",
      kind: "bedroom",
      quantity: 3,
      inclusion: "required",
      dimensions: { minAreaMm2: 10_000_000, minShortSideMm: 3_000 },
      traits: {
        zone: "private",
        wet: false,
        exteriorPreference: "high",
        mayBePassThrough: false,
      },
    },
  ];
  const instances = normalizeRoomRequirements(rooms);
  assert.deepEqual(instances.map((room) => [room.id, room.displayName]), [
    ["bedroom-1", "Bedroom 1"],
    ["bedroom-2", "Bedroom 2"],
    ["bedroom-3", "Bedroom 3"],
  ]);
  assert.equal(instances.every((room) => room.requirementId === "bedroom"), true);
  assert.equal(instances.every((room) => room.dimensions.minShortSideUnits === 12), true);
});

test("impossible fixtures return structured normalization diagnostics", () => {
  const envelopeResult = tryNormalizeProject(IMPOSSIBLE_FIXTURES.envelopeConsumesSite);
  assert.equal(envelopeResult.ok, false);
  if (!envelopeResult.ok) {
    assert.equal(envelopeResult.issues[0].code, "NON_POSITIVE_EXACT_ENVELOPE");
  }

  const roomResult = tryNormalizeProject(IMPOSSIBLE_FIXTURES.roomCannotFitEnvelope);
  assert.equal(roomResult.ok, false);
  if (!roomResult.ok) {
    assert.equal(roomResult.issues[0].code, "ROOM_CANNOT_FIT_ENVELOPE");
    assert.equal(roomResult.issues[0].subjectId, "impossible-room-1");
  }

  const sizeResult = tryNormalizeProject(IMPOSSIBLE_FIXTURES.programExceedsInstanceLimit);
  assert.equal(sizeResult.ok, false);
  if (!sizeResult.ok) {
    assert.equal(sizeResult.issues[0].code, "PROGRAM_TOO_LARGE");
  }
});

test("bounded rectangle invariants hold for representative integer cases", () => {
  const rectangles: GridRect[] = [
    { x: 0, y: 0, width: 1, depth: 1 },
    { x: 2, y: 1, width: 3, depth: 4 },
    { x: -3, y: 5, width: 7, depth: 2 },
    { x: 4, y: -2, width: 6, depth: 8 },
  ];
  for (const a of rectangles) {
    assert.ok(area(a) > 0);
    assert.equal(intersectionArea(a, a), area(a));
    assert.equal(boundaryDistance(a, a), 0);
    for (const b of rectangles) {
      assert.equal(intersectionArea(a, b), intersectionArea(b, a));
      assert.equal(intersectionArea(a, b) > 0, overlaps(a, b));
      assert.ok(intersectionArea(a, b) >= 0);
      assert.equal(sharedWallLength(a, b), sharedWallLength(b, a));
    }
  }
});
