import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
  area,
  buildLayoutIndexes,
  computeLayoutFacts,
  createSeededPrng,
  sharedWallLength,
  spacePairKey,
  unallocatedInteriorArea,
  validateLayout,
  type CardinalSide,
  type GridRect,
  type Layout,
} from "../src/domain/index.ts";

function rect(x: number, y: number, width: number, depth: number): GridRect {
  return { x, y, width, depth };
}

type FixtureSpace = { id: string; role: Layout["spaces"][number]["role"]; rect: GridRect };

/** A hand-checked layout fixture: no portals, so the facts pass sees geometry only. */
function fixture(footprint: GridRect, spaces: readonly FixtureSpace[]): Layout {
  return {
    id: "facts-fixture",
    footprint,
    spaces: spaces.map((space) => ({
      instanceId: space.id,
      role: space.role,
      rect: space.rect,
    })),
    portals: [],
    entrancePortalId: "entrance",
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

test("shared-wall intervals are exact for full, partial, and corner contact", () => {
  const layout = fixture(rect(0, 0, 40, 40), [
    { id: "A", role: "room", rect: rect(0, 0, 10, 10) },
    { id: "B", role: "room", rect: rect(10, 0, 10, 10) },
    { id: "C", role: "room", rect: rect(20, 6, 6, 3) },
    { id: "D", role: "room", rect: rect(20, 10, 5, 5) },
  ]);
  const indexes = buildLayoutIndexes(layout);

  const ab = indexes.sharedWallIndex[spacePairKey("A", "B")];
  assert.equal(ab.length, 1);
  assert.deepEqual(ab[0].interval, { start: 0, end: 10 });
  assert.equal(ab[0].fixed, 10);
  assert.equal(ab[0].aSide, "east");
  assert.equal(ab[0].bSide, "west");
  assert.equal(ab[0].lengthUnits, 10);
  assert.equal(ab[0].meaningful, true);

  // B and C touch along x = 20 over y in [6, 9]: three units, below the
  // meaningful-adjacency threshold.
  const bc = indexes.sharedWallIndex[spacePairKey("B", "C")];
  assert.equal(bc.length, 1);
  assert.deepEqual(bc[0].interval, { start: 6, end: 9 });
  assert.equal(bc[0].lengthUnits, 3);
  assert.equal(bc[0].meaningful, 3 >= MIN_MEANINGFUL_SHARED_WALL_UNITS);

  // B and D meet at the single point (20, 10): corner contact is never a wall.
  assert.equal(indexes.sharedWallIndex[spacePairKey("B", "D")], undefined);
  assert.equal(indexes.sharedWallIntervals.length, 2);
  assert.equal(indexes.sharedWallIntervals[0].a, "A");
  assert.equal(indexes.sharedWallIntervals[1].a, "B");

  // The interval table cannot disagree with the primitive it replaces.
  for (const pair of [["A", "B"], ["B", "C"], ["B", "D"]] as const) {
    const [a, b] = pair;
    const fromIntervals = (indexes.sharedWallIndex[spacePairKey(a, b)] ?? [])
      .reduce((sum, fact) => sum + fact.lengthUnits, 0);
    const spaceA = layout.spaces.find((space) => space.instanceId === a)!;
    const spaceB = layout.spaces.find((space) => space.instanceId === b)!;
    assert.equal(fromIntervals, sharedWallLength(spaceA.rect, spaceB.rect));
  }
});

test("pairwise overlaps are clipped, ordered by declaration, and never counted twice", () => {
  const layout = fixture(rect(0, 0, 40, 40), [
    { id: "D", role: "room", rect: rect(0, 0, 5, 5) },
    { id: "A", role: "room", rect: rect(0, 0, 10, 10) },
    { id: "B", role: "room", rect: rect(10, 0, 10, 10) },
  ]);
  const indexes = buildLayoutIndexes(layout);

  assert.equal(indexes.overlaps.length, 1);
  const [overlap] = indexes.overlaps;
  assert.equal(overlap.a, "D");
  assert.equal(overlap.b, "A");
  assert.deepEqual(overlap.rect, rect(0, 0, 5, 5));
  assert.equal(overlap.areaUnits2, 25);
  assert.equal(indexes.overlapAreaUnits2, 25);

  // A and B share an edge only; edge contact is not an overlap.
  assert.equal(indexes.overlaps.some((fact) => fact.a === "A" && fact.b === "B"), false);
});

test("exterior contact reports both raw footprint contact and exposed contact", () => {
  const footprint = rect(0, 0, 20, 30);
  const layout = fixture(footprint, [
    { id: "west", role: "room", rect: rect(0, 0, 8, 10) },
    { id: "east", role: "circulation", rect: rect(8, 0, 12, 10) },
  ]);
  const indexes = buildLayoutIndexes(layout);

  const west = indexes.exteriorContactIndex["west"];
  // y grows south, so a space flush with y = 0 touches the footprint's north edge.
  assert.deepEqual(west.footprintBySide, { north: 8, east: 0, south: 0, west: 10 });
  assert.deepEqual(west.exposedBySide, west.footprintBySide);
  assert.equal(west.exposedTotalUnits, 18);

  const east = indexes.exteriorContactIndex["east"];
  assert.deepEqual(east.footprintBySide, { north: 12, east: 10, south: 0, west: 0 });
  assert.equal(indexes.exteriorContacts.length, indexes.spaces.length);
  assert.equal(indexes.exteriorContacts[0].instanceId, "west");

  // A space lying along the same boundary line blocks the stretch behind it.
  // Overlapping spaces are a separate hard failure; the index still separates
  // "touches the footprint" from "is exposed to the outside".
  const stacked = buildLayoutIndexes(fixture(footprint, [
    { id: "band", role: "room", rect: rect(0, 0, 20, 10) },
    { id: "inner", role: "room", rect: rect(0, 0, 10, 10) },
  ]));
  const band = stacked.exteriorContactIndex["band"];
  assert.equal(band.footprintBySide.north, 20);
  assert.equal(band.exposedBySide.north, 10);
  // `inner` sits behind `band` on both boundary lines it touches, so every
  // stretch of its footprint contact is obscured.
  assert.deepEqual(stacked.exteriorContactIndex["inner"].exposedBySide, {
    north: 0,
    east: 0,
    south: 0,
    west: 0,
  });
});

test("area totals and coverage come from one hand-checked pass", () => {
  const layout = fixture(rect(0, 0, 20, 30), [
    { id: "living-1", role: "room", rect: rect(0, 0, 10, 10) },
    { id: "bedroom-1", role: "room", rect: rect(10, 0, 10, 10) },
    { id: "entry-1", role: "entry", rect: rect(0, 10, 4, 10) },
  ]);
  const facts = computeLayoutFacts(layout, CANONICAL_NORMALIZED_PROJECT);

  assert.equal(facts.footprintAreaUnits2, 600);
  assert.equal(facts.programmedUsableAreaUnits2, 200);
  assert.equal(facts.circulationAreaUnits2, 40);
  assert.equal(facts.entryAreaUnits2, 40);
  assert.equal(facts.garageAreaUnits2, 0);
  assert.equal(facts.overlapAreaUnits2, 0);
  assert.equal(facts.unallocatedInteriorAreaUnits2, 600 - 200 - 40);
  assert.equal(facts.planningEfficiency, 200 / 600);
  assert.equal(facts.allocationRatio, 240 / 600);

  // The index agrees with the primitives it now feeds.
  const indexes = buildLayoutIndexes(layout);
  assert.equal(
    indexes.unallocatedInteriorAreaUnits2,
    unallocatedInteriorArea(layout.footprint, layout.spaces.map((space) => space.rect)),
  );
  assert.equal(indexes.footprintAreaUnits2, area(layout.footprint));
});

test("the facts pass is immutable and carries its indexes", () => {
  const layout = fixture(rect(0, 0, 20, 30), [
    { id: "living-1", role: "room", rect: rect(0, 0, 10, 10) },
    { id: "bedroom-1", role: "room", rect: rect(10, 0, 10, 10) },
  ]);
  const facts = computeLayoutFacts(layout, CANONICAL_NORMALIZED_PROJECT);

  assert.equal(Object.isFrozen(facts), true);
  assert.equal(Object.isFrozen(facts.overlaps), true);
  assert.equal(Object.isFrozen(facts.sharedWallIntervals), true);
  assert.equal(Object.isFrozen(facts.exteriorContacts), true);
  assert.equal(Object.isFrozen(facts.sharedWallIndex), true);
  assert.equal(facts.exteriorContacts.length, facts.spaceFacts.length);
  assert.equal(facts.overlaps.length, 0);
  assert.equal(facts.sharedWalls.length, 1);
  assert.equal(facts.sharedWalls[0].a, "bedroom-1");
  assert.equal(facts.sharedWalls[0].b, "living-1");
  assert.equal(facts.sharedWalls[0].lengthUnits, 10);
  assert.equal(facts.sharedWalls[0].meaningful, true);
});

test("the validator reads overlap and coverage evidence from the shared index", () => {
  const layout = fixture(rect(0, 0, 20, 30), [
    { id: "living", role: "room", rect: rect(0, 0, 10, 10) },
    { id: "bedroom", role: "room", rect: rect(5, 0, 10, 10) },
  ]);
  const result = validateLayout(layout, CANONICAL_NORMALIZED_PROJECT);
  const indexes = buildLayoutIndexes(layout);
  const overlaps = result.violations.filter((violation) => violation.code === "SPACE_OVERLAP");

  assert.equal(overlaps.length, indexes.overlaps.length);
  assert.equal(overlaps[0].subjects[0], indexes.overlaps[0].a);
  assert.equal(overlaps[0].subjects[1], indexes.overlaps[0].b);
  assert.equal(overlaps[0].evidence?.overlapUnits2, indexes.overlaps[0].areaUnits2);
  assert.equal(indexes.overlaps[0].areaUnits2, 50);
});

type GridOracle = {
  coveredCells: number;
  multiplyAllocatedCells: number;
  /** Shared-wall length per sorted pair key, counted cell-by-cell. */
  sharedWalls: Map<string, number>;
  /** Footprint-boundary cells per space per side. */
  exteriorBySide: Map<string, Record<CardinalSide, number>>;
};

/**
 * An occupancy-grid oracle: rasterise the layout to one cell per grid unit and
 * count adjacency, multiply-allocated cells, and boundary cells by brute force.
 *
 * This deliberately shares no code with `geometry.ts`. The interval index and
 * the oracle are independent computations of the same quantities, so agreeing
 * over many layouts is evidence the index is right rather than evidence it is
 * self-consistent.
 */
function occupancyOracle(footprint: GridRect, spaces: readonly FixtureSpace[]): GridOracle {
  const owners = new Map<string, string[]>();
  for (const space of spaces) {
    for (let x = space.rect.x; x < space.rect.x + space.rect.width; x += 1) {
      for (let y = space.rect.y; y < space.rect.y + space.rect.depth; y += 1) {
        const key = `${x},${y}`;
        const existing = owners.get(key);
        if (existing) existing.push(space.id);
        else owners.set(key, [space.id]);
      }
    }
  }

  const sharedWalls = new Map<string, number>();
  let multiplyAllocatedCells = 0;
  for (const [key, ids] of owners) {
    if (ids.length > 1) multiplyAllocatedCells += 1;
    const [x, y] = key.split(",").map(Number);
    // Orthogonal neighbours only: diagonal contact is a corner and a corner is
    // never a shared wall.
    for (const [nx, ny] of [
      [x + 1, y],
      [x, y + 1],
    ] as const) {
      const neighbour = owners.get(`${nx},${ny}`);
      if (!neighbour) continue;
      for (const a of ids) {
        for (const b of neighbour) {
          if (a === b) continue;
          const pairKey = spacePairKey(a, b);
          sharedWalls.set(pairKey, (sharedWalls.get(pairKey) ?? 0) + 1);
        }
      }
    }
  }

  const exteriorBySide = new Map<string, Record<CardinalSide, number>>();
  for (const space of spaces) {
    exteriorBySide.set(space.id, { north: 0, east: 0, south: 0, west: 0 });
  }
  for (const [key, ids] of owners) {
    const [x, y] = key.split(",").map(Number);
    for (const id of ids) {
      const sides = exteriorBySide.get(id)!;
      if (y === footprint.y) sides.north += 1;
      if (y === footprint.y + footprint.depth - 1) sides.south += 1;
      if (x === footprint.x) sides.west += 1;
      if (x === footprint.x + footprint.width - 1) sides.east += 1;
    }
  }

  return { coveredCells: owners.size, multiplyAllocatedCells, sharedWalls, exteriorBySide };
}

/** A deterministic layout of non-overlapping rectangles inside a 12 × 12 footprint. */
function randomLayout(seed: string): Layout {
  const prng = createSeededPrng(`facts-oracle:${seed}`);
  const footprint = rect(0, 0, 12, 12);
  const spaces: FixtureSpace[] = [];
  const target = 3 + prng.nextInt(4);
  for (let attempt = 0; attempt < 200 && spaces.length < target; attempt += 1) {
    const width = 1 + prng.nextInt(6);
    const depth = 1 + prng.nextInt(6);
    const candidate = rect(
      prng.nextInt(footprint.width - width + 1),
      prng.nextInt(footprint.depth - depth + 1),
      width,
      depth,
    );
    const intrudes = spaces.some(
      (space) =>
        candidate.x < space.rect.x + space.rect.width &&
        space.rect.x < candidate.x + candidate.width &&
        candidate.y < space.rect.y + space.rect.depth &&
        space.rect.y < candidate.y + candidate.depth,
    );
    if (intrudes) continue;
    spaces.push({ id: `s${spaces.length}`, role: "room", rect: candidate });
  }
  return fixture(footprint, spaces);
}

test("indexed facts agree with an occupancy-grid oracle across generated layouts", () => {
  let checkedSharedWallPairs = 0;
  let checkedExteriorSides = 0;

  for (let index = 0; index < 60; index += 1) {
    const layout = randomLayout(`layout-${index}`);
    const spaces = layout.spaces.map((space) => ({
      id: space.instanceId,
      role: space.role,
      rect: space.rect,
    }));
    const oracle = occupancyOracle(layout.footprint, spaces);
    const indexes = buildLayoutIndexes(layout);

    // The generator never overlaps, so the oracle must agree that nothing is
    // multiply allocated and that no pair is reported as an overlap.
    assert.equal(oracle.multiplyAllocatedCells, 0, `layout ${index} generated an overlap`);
    assert.equal(indexes.overlapAreaUnits2, oracle.multiplyAllocatedCells);
    assert.equal(indexes.overlaps.length, 0);

    // Covered and unallocated area are counted cell-by-cell.
    assert.equal(indexes.unallocatedInteriorAreaUnits2, area(layout.footprint) - oracle.coveredCells);
    assert.equal(
      computeLayoutFacts(layout, CANONICAL_NORMALIZED_PROJECT).unallocatedInteriorAreaUnits2,
      area(layout.footprint) - oracle.coveredCells,
    );

    // Shared walls: every oracle pair matches the summed intervals, and the
    // index invents no pair the grid cannot see.
    for (const interval of indexes.sharedWallIntervals) {
      assert.equal(oracle.sharedWalls.has(spacePairKey(interval.a, interval.b)), true);
    }
    for (const [pairKey, expected] of oracle.sharedWalls) {
      const actual = (indexes.sharedWallIndex[pairKey] ?? []).reduce(
        (sum, fact) => sum + fact.lengthUnits,
        0,
      );
      assert.equal(actual, expected, `layout ${index} pair ${pairKey}`);
      checkedSharedWallPairs += 1;
    }
    assert.equal(Object.keys(indexes.sharedWallIndex).length, oracle.sharedWalls.size);

    // Footprint-boundary contact per space per side. Without overlaps no facade
    // stretch is occluded, so exposed contact equals raw footprint contact.
    for (const contact of indexes.exteriorContacts) {
      const expected = oracle.exteriorBySide.get(contact.instanceId)!;
      assert.deepEqual(contact.footprintBySide, expected, `layout ${index} ${contact.instanceId}`);
      assert.deepEqual(contact.exposedBySide, expected);
      assert.equal(
        contact.exposedTotalUnits,
        expected.north + expected.east + expected.south + expected.west,
      );
      checkedExteriorSides += 4;
    }
  }

  // Guard against a generator that silently stops producing interesting cases.
  assert.ok(checkedSharedWallPairs > 100, `only ${checkedSharedWallPairs} shared-wall pairs checked`);
  assert.ok(checkedExteriorSides > 400, `only ${checkedExteriorSides} exterior sides checked`);
});
