/**
 * Stage 1 bucket 1.2 — production geometry edge cases and property oracles.
 *
 * The analytic predicates are checked against independent brute-force oracles
 * that enumerate small occupancy grids and unit edge segments, so the exact
 * interval arithmetic cannot silently drift from the documented half-open
 * rectangle, coverage, and facade semantics.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  CANONICAL_PROJECT,
  GRID_MM,
  area,
  assertExactGridRect,
  boundaryDistance,
  boundaryGapDistanceSquared,
  centre,
  centreAsRational,
  centreDistance,
  containsPoint,
  containsRect,
  coveredAreaWithin,
  edgeSegment,
  exteriorContactBySide,
  exteriorWallContact,
  intersection,
  intersectionArea,
  intervalContainsSpan,
  intervalIntersection,
  intervalLength,
  isGridRect,
  meaningfulAdjacency,
  mm2ToGridAreaCeil,
  mmToGridCeil,
  mmToGridFloor,
  normalizeSite,
  overlapArea,
  overlaps,
  right,
  sharedWallLength,
  sharedWallSegments,
  totalExteriorWallContact,
  unallocatedInteriorArea,
  unallocatedInteriorRatio,
  unionArea,
  type CardinalSide,
  type GridRect,
  type SiteBrief,
} from "../src/domain/index.ts";

const SIDES: readonly CardinalSide[] = ["north", "east", "south", "west"];

/** Deterministic test-only LCG so oracle inputs never depend on ambient randomness. */
function createTestRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const ORACLE_LIMIT = 64;

function cellKeys(rect: GridRect): string[] {
  const cells: string[] = [];
  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    for (let y = rect.y; y < rect.y + rect.depth; y += 1) {
      if (Math.abs(x) > ORACLE_LIMIT || Math.abs(y) > ORACLE_LIMIT) {
        throw new RangeError("oracle received a rectangle outside its enumeration window");
      }
      cells.push(`${x}:${y}`);
    }
  }
  return cells;
}

function oracleIntersectionArea(a: GridRect, b: GridRect): number {
  const other = new Set(cellKeys(b));
  return cellKeys(a).filter((cell) => other.has(cell)).length;
}

function oracleUnionArea(rectangles: readonly GridRect[]): number {
  const covered = new Set<string>();
  for (const rect of rectangles) {
    for (const cell of cellKeys(rect)) covered.add(cell);
  }
  return covered.size;
}

function oracleCoveredAreaWithin(bounds: GridRect, rectangles: readonly GridRect[]): number {
  const boundsCells = new Set(cellKeys(bounds));
  const covered = new Set<string>();
  for (const rect of rectangles) {
    for (const cell of cellKeys(rect)) {
      if (boundsCells.has(cell)) covered.add(cell);
    }
  }
  return covered.size;
}

function oracleContains(parent: GridRect, child: GridRect): boolean {
  const parentCells = new Set(cellKeys(parent));
  return cellKeys(child).every((cell) => parentCells.has(cell));
}

function cellGaps(a: GridRect, b: GridRect): { horizontal: number; vertical: number } {
  let horizontal = Number.POSITIVE_INFINITY;
  let vertical = Number.POSITIVE_INFINITY;
  for (let firstX = a.x; firstX < a.x + a.width; firstX += 1) {
    for (let firstY = a.y; firstY < a.y + a.depth; firstY += 1) {
      for (let secondX = b.x; secondX < b.x + b.width; secondX += 1) {
        for (let secondY = b.y; secondY < b.y + b.depth; secondY += 1) {
          const gapX = Math.max(secondX - (firstX + 1), firstX - (secondX + 1), 0);
          const gapY = Math.max(secondY - (firstY + 1), firstY - (secondY + 1), 0);
          horizontal = Math.min(horizontal, gapX);
          vertical = Math.min(vertical, gapY);
        }
      }
    }
  }
  return { horizontal, vertical };
}

function oracleBoundaryDistance(a: GridRect, b: GridRect): number {
  const { horizontal, vertical } = cellGaps(a, b);
  return horizontal + vertical;
}

function oracleBoundaryGapDistanceSquared(a: GridRect, b: GridRect): number {
  const { horizontal, vertical } = cellGaps(a, b);
  return horizontal * horizontal + vertical * vertical;
}

function verticalUnitEdges(rect: GridRect): Set<string> {
  const edges = new Set<string>();
  for (let y = rect.y; y < rect.y + rect.depth; y += 1) {
    edges.add(`${rect.x}:${y}`);
    edges.add(`${rect.x + rect.width}:${y}`);
  }
  return edges;
}

function horizontalUnitEdges(rect: GridRect): Set<string> {
  const edges = new Set<string>();
  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    edges.add(`${rect.y}:${x}`);
    edges.add(`${rect.y + rect.depth}:${x}`);
  }
  return edges;
}

function oracleSharedWallLength(a: GridRect, b: GridRect): number {
  let shared = 0;
  if (a.x + a.width === b.x || b.x + b.width === a.x) {
    const other = verticalUnitEdges(b);
    for (const edge of verticalUnitEdges(a)) {
      if (other.has(edge)) shared += 1;
    }
  }
  if (a.y + a.depth === b.y || b.y + b.depth === a.y) {
    const other = horizontalUnitEdges(b);
    for (const edge of horizontalUnitEdges(a)) {
      if (other.has(edge)) shared += 1;
    }
  }
  return shared;
}

function sideLine(rect: GridRect, side: CardinalSide): { line: number; start: number; end: number } {
  switch (side) {
    case "north":
      return { line: rect.y, start: rect.x, end: rect.x + rect.width };
    case "south":
      return { line: rect.y + rect.depth, start: rect.x, end: rect.x + rect.width };
    case "west":
      return { line: rect.x, start: rect.y, end: rect.y + rect.depth };
    case "east":
      return { line: rect.x + rect.width, start: rect.y, end: rect.y + rect.depth };
  }
}

function oracleExteriorContact(
  rect: GridRect,
  footprint: GridRect,
  side: CardinalSide,
  occluders: readonly GridRect[],
): number {
  const room = sideLine(rect, side);
  const edge = sideLine(footprint, side);
  if (room.line !== edge.line) return 0;
  const start = Math.max(room.start, edge.start);
  const end = Math.min(room.end, edge.end);
  let contact = 0;
  for (let unit = start; unit < end; unit += 1) {
    const obscured = occluders.some((other) => {
      if (other === rect) return false;
      const candidate = sideLine(other, side);
      return candidate.line === edge.line &&
        candidate.start <= unit &&
        unit + 1 <= candidate.end;
    });
    if (!obscured) contact += 1;
  }
  return contact;
}

function randomRect(rng: () => number, extent = 10, maxSize = 6): GridRect {
  return {
    x: 1 + (rng() % extent),
    y: 1 + (rng() % extent),
    width: 1 + (rng() % maxSize),
    depth: 1 + (rng() % maxSize),
  };
}

function randomRectInside(rng: () => number, bounds: GridRect): GridRect {
  const x = bounds.x + (rng() % bounds.width);
  const y = bounds.y + (rng() % bounds.depth);
  return {
    x,
    y,
    width: 1 + (rng() % (bounds.x + bounds.width - x)),
    depth: 1 + (rng() % (bounds.y + bounds.depth - y)),
  };
}

test("rectangle predicates reject non-integer, non-positive, and overflowing geometry", () => {
  assert.equal(isGridRect({ x: -3, y: 5, width: 7, depth: 2 }), true);
  assert.equal(isGridRect({ x: 0, y: 0, width: 0, depth: 1 }), false);
  assert.equal(isGridRect({ x: 0, y: 0, width: 1, depth: -1 }), false);
  assert.equal(isGridRect({ x: 0.5, y: 0, width: 1, depth: 1 }), false);
  assert.equal(isGridRect({ x: 0, y: 0, width: Number.NaN, depth: 1 }), false);
  assert.equal(isGridRect({ x: 0, y: 0, width: 1, depth: Number.POSITIVE_INFINITY }), false);
  assert.equal(isGridRect({ x: "0", y: 0, width: 1, depth: 1 }), false);
  assert.equal(isGridRect(null), false);
  assert.equal(isGridRect([1, 2, 3, 4]), false);
  assert.equal(isGridRect({}), false);

  const overflowingEdge = { x: Number.MAX_SAFE_INTEGER - 1, y: 0, width: 4, depth: 1 };
  const overflowingArea = { x: 0, y: 0, width: 2 ** 27, depth: 2 ** 27 };
  assert.equal(isGridRect(overflowingEdge), false);
  assert.equal(isGridRect(overflowingArea), false);
  // Composite operations refuse to compute with geometry they cannot measure.
  assert.throws(() => assertExactGridRect(overflowingEdge), TypeError);
  assert.throws(() => assertExactGridRect(overflowingArea), TypeError);
  assert.throws(() => unionArea([overflowingArea as GridRect]), TypeError);
  assert.throws(() => overlapArea([overflowingEdge as GridRect]), TypeError);
  assert.throws(() => coveredAreaWithin(overflowingArea as GridRect, []), TypeError);
  // The hot per-edge helpers still reject malformed structure.
  assert.throws(() => right({} as GridRect), TypeError);
  assert.throws(() => area({ x: 0, y: 0, width: 0, depth: 1 } as GridRect), TypeError);
});

test("half-open rectangles separate containment from edge and corner contact", () => {
  const a: GridRect = { x: 0, y: 0, width: 4, depth: 4 };
  assert.equal(containsPoint(a, { x: 0, y: 0 }), true);
  assert.equal(containsPoint(a, { x: 3, y: 3 }), true);
  assert.equal(containsPoint(a, { x: 4, y: 3 }), false);
  assert.equal(containsPoint(a, { x: 3, y: 4 }), false);
  assert.throws(() => containsPoint(a, { x: 0.5, y: 1 }), TypeError);

  assert.equal(containsRect(a, { ...a }), true);
  assert.equal(containsRect(a, { x: 0, y: 0, width: 4, depth: 5 }), false);
  assert.equal(containsRect(a, { x: 4, y: 0, width: 1, depth: 1 }), false);

  const edge: GridRect = { x: 4, y: 1, width: 3, depth: 2 };
  const corner: GridRect = { x: 4, y: 4, width: 2, depth: 2 };
  assert.equal(intersection(a, edge), null);
  assert.equal(intersection(a, corner), null);
  assert.equal(intersectionArea(a, edge), 0);
  assert.equal(overlaps(a, edge), false);
  assert.deepEqual(intersection(a, { ...a }), a);
  assert.deepEqual(intersection(a, { x: 2, y: 1, width: 4, depth: 4 }), {
    x: 2,
    y: 1,
    width: 2,
    depth: 3,
  });
  assert.equal(area(a), 16);
});

test("shared walls require a positive facing coincident edge", () => {
  const a: GridRect = { x: 0, y: 0, width: 4, depth: 8 };
  const beside: GridRect = { x: 4, y: 2, width: 5, depth: 4 };
  const corner: GridRect = { x: 4, y: 8, width: 2, depth: 2 };
  const overlapping: GridRect = { x: 1, y: 1, width: 4, depth: 4 };
  const above: GridRect = { x: 0, y: -2, width: 4, depth: 2 };
  const shortWall: GridRect = { x: 4, y: 6, width: 3, depth: 4 };

  assert.equal(sharedWallLength(a, beside), 4);
  assert.deepEqual(sharedWallSegments(a, beside), [
    { aSide: "east", bSide: "west", fixed: 4, interval: { start: 2, end: 6 } },
  ]);
  assert.deepEqual(sharedWallSegments(beside, a), [
    { aSide: "west", bSide: "east", fixed: 4, interval: { start: 2, end: 6 } },
  ]);
  assert.deepEqual(sharedWallSegments(a, above), [
    { aSide: "north", bSide: "south", fixed: 0, interval: { start: 0, end: 4 } },
  ]);
  assert.equal(sharedWallLength(a, corner), 0);
  assert.equal(sharedWallLength(a, overlapping), 0);
  assert.equal(sharedWallLength(a, { ...a }), 0);
  assert.equal(sharedWallLength(a, shortWall), 2);
  assert.equal(sharedWallLength(a, beside), sharedWallLength(beside, a));

  assert.equal(meaningfulAdjacency(a, beside), true);
  assert.equal(meaningfulAdjacency(a, shortWall), false);
  assert.equal(meaningfulAdjacency(a, beside, 4), true);
  assert.equal(meaningfulAdjacency(a, beside, 5), false);
  assert.throws(() => meaningfulAdjacency(a, beside, 0), RangeError);
  assert.throws(() => meaningfulAdjacency(a, beside, 1.5), TypeError);
});

test("edge segments describe all four sides in half-open coordinates", () => {
  const rect: GridRect = { x: 3, y: 5, width: 6, depth: 4 };
  assert.deepEqual(edgeSegment(rect, "north"), {
    side: "north",
    fixed: 5,
    interval: { start: 3, end: 9 },
  });
  assert.deepEqual(edgeSegment(rect, "east"), {
    side: "east",
    fixed: 9,
    interval: { start: 5, end: 9 },
  });
  assert.deepEqual(edgeSegment(rect, "south"), {
    side: "south",
    fixed: 9,
    interval: { start: 3, end: 9 },
  });
  assert.deepEqual(edgeSegment(rect, "west"), {
    side: "west",
    fixed: 3,
    interval: { start: 5, end: 9 },
  });
  assert.throws(() => edgeSegment({ ...rect, width: 0 }, "north"), TypeError);
});

test("interval primitives keep half-open, empty, and span semantics", () => {
  assert.equal(intervalLength({ start: 2, end: 6 }), 4);
  assert.equal(intervalLength({ start: 6, end: 2 }), 0);
  assert.deepEqual(intervalIntersection({ start: 0, end: 4 }, { start: 4, end: 8 }), null);
  assert.deepEqual(intervalIntersection({ start: 0, end: 4 }, { start: 2, end: 8 }), {
    start: 2,
    end: 4,
  });
  assert.throws(() => intervalIntersection({ start: 0.5, end: 4 }, { start: 2, end: 8 }), TypeError);
  assert.throws(() => intervalLength({ start: 0, end: Number.NaN }), TypeError);

  const container = { start: 2, end: 8 };
  assert.equal(intervalContainsSpan(container, 2, 6), true);
  assert.equal(intervalContainsSpan(container, 3, 5), true);
  assert.equal(intervalContainsSpan(container, 2, 7), false);
  assert.equal(intervalContainsSpan(container, 1, 1), false);
  assert.throws(() => intervalContainsSpan(container, 2, 0), RangeError);
  assert.throws(() => intervalContainsSpan(container, 2, -3), RangeError);
  assert.throws(() => intervalContainsSpan(container, 2.5, 1), TypeError);
});

test("boundary and centre distances stay exact and directional", () => {
  const a: GridRect = { x: 0, y: 0, width: 4, depth: 4 };
  assert.equal(boundaryDistance(a, { x: 4, y: 1, width: 3, depth: 2 }), 0);
  assert.equal(boundaryDistance(a, { x: 6, y: 1, width: 2, depth: 2 }), 2);
  assert.equal(boundaryDistance(a, { x: 1, y: 6, width: 2, depth: 2 }), 2);
  assert.equal(boundaryDistance(a, { x: 6, y: 6, width: 2, depth: 2 }), 4);
  assert.equal(boundaryDistance(a, a), 0);

  assert.equal(boundaryGapDistanceSquared(a, { x: 6, y: 6, width: 2, depth: 2 }), 8);
  assert.equal(boundaryGapDistanceSquared(a, { x: 7, y: 8, width: 3, depth: 4 }), 25);
  assert.equal(boundaryGapDistanceSquared(a, { x: 4, y: 4, width: 1, depth: 1 }), 0);
  assert.equal(boundaryGapDistanceSquared(a, a), 0);

  assert.deepEqual(centre(a), { x: 2, y: 2 });
  assert.deepEqual(centreAsRational({ x: 1, y: 2, width: 3, depth: 4 }), {
    xNumerator: 5,
    yNumerator: 8,
    denominator: 2,
  });
  assert.equal(centreDistance(a, { x: 8, y: 0, width: 4, depth: 4 }), 8);
  assert.equal(centreDistance(a, { x: 0, y: 6, width: 4, depth: 4 }), 6);
  assert.equal(centreDistance(a, a), 0);
});

test("coverage identities clip, deduplicate, and never inflate", () => {
  const footprint: GridRect = { x: 0, y: 0, width: 6, depth: 4 };
  assert.equal(unionArea([]), 0);
  assert.equal(unionArea([{ x: 0, y: 0, width: 4, depth: 4 }, { x: 0, y: 0, width: 4, depth: 4 }]), 16);
  assert.equal(unionArea([{ x: 0, y: 0, width: 4, depth: 4 }, { x: 1, y: 1, width: 2, depth: 2 }]), 16);
  assert.equal(coveredAreaWithin(footprint, []), 0);
  assert.equal(unallocatedInteriorArea(footprint, []), 24);
  assert.equal(unallocatedInteriorRatio(footprint, []), 1);

  const tiled: GridRect[] = [
    { x: 0, y: 0, width: 3, depth: 4 },
    { x: 3, y: 0, width: 3, depth: 4 },
  ];
  assert.equal(coveredAreaWithin(footprint, tiled), 24);
  assert.equal(unallocatedInteriorArea(footprint, tiled), 0);
  assert.equal(unallocatedInteriorRatio(footprint, tiled), 0);

  const leaking: GridRect[] = [
    { x: 0, y: 0, width: 5, depth: 4 },
    { x: 6, y: 0, width: 3, depth: 4 },
    { x: 0, y: 0, width: 5, depth: 4 },
  ];
  assert.equal(coveredAreaWithin(footprint, leaking), 20);
  assert.equal(unallocatedInteriorArea(footprint, leaking), 4);
  assert.equal(unallocatedInteriorRatio(footprint, leaking), 4 / 24);
  assert.throws(
    () => coveredAreaWithin(footprint, [{ x: 0, y: 0, width: 0, depth: 1 }]),
    TypeError,
  );

  assert.equal(overlapArea([]), 0);
  assert.equal(overlapArea([{ x: 0, y: 0, width: 4, depth: 4 }]), 0);
  assert.equal(
    overlapArea([{ x: 0, y: 0, width: 4, depth: 4 }, { x: 6, y: 0, width: 2, depth: 2 }]),
    0,
  );
  assert.equal(
    overlapArea([{ x: 0, y: 0, width: 4, depth: 4 }, { x: 2, y: 0, width: 4, depth: 4 }]),
    8,
  );
  // Three rectangles sharing one cell: 12 - 8 = 4, not the 5 a pairwise sum would give.
  assert.equal(
    overlapArea([
      { x: 0, y: 0, width: 2, depth: 2 },
      { x: 1, y: 0, width: 2, depth: 2 },
      { x: 0, y: 1, width: 2, depth: 2 },
    ]),
    4,
  );
});

test("exterior wall contact subtracts facade intervals without double counting", () => {
  const footprint: GridRect = { x: 0, y: 0, width: 20, depth: 20 };
  const cornerRoom: GridRect = { x: 0, y: 0, width: 4, depth: 4 };
  assert.deepEqual(exteriorContactBySide(cornerRoom, footprint), {
    north: 4,
    east: 0,
    south: 0,
    west: 4,
  });
  assert.equal(totalExteriorWallContact(cornerRoom, footprint), 8);
  assert.equal(totalExteriorWallContact(cornerRoom, footprint), SIDES
    .map((side) => exteriorWallContact(cornerRoom, footprint, side))
    .reduce((sum, length) => sum + length, 0));

  const facadeRoom: GridRect = { x: 0, y: 3, width: 6, depth: 5 };
  assert.equal(exteriorWallContact(facadeRoom, footprint, "west", []), 5);
  assert.equal(
    exteriorWallContact(facadeRoom, footprint, "west", [{ x: 0, y: 0, width: 1, depth: 4 }]),
    4,
  );
  // Overlapping occluders subtract the union interval once, not twice.
  assert.equal(
    exteriorWallContact(facadeRoom, footprint, "west", [
      { x: 0, y: 0, width: 1, depth: 5 },
      { x: 0, y: 0, width: 1, depth: 4 },
    ]),
    3,
  );
  // An obstacle that never reaches this facade cannot reduce the contact.
  assert.equal(
    exteriorWallContact(facadeRoom, footprint, "west", [{ x: 3, y: 0, width: 2, depth: 2 }]),
    5,
  );
  // The room itself is not an occluder.
  assert.equal(exteriorWallContact(facadeRoom, footprint, "west", [facadeRoom]), 5);
  // A room that shares no line with the requested footprint edge has no contact.
  assert.equal(
    exteriorWallContact({ x: 0, y: 4, width: 6, depth: 5 }, footprint, "north"),
    0,
  );
  assert.equal(exteriorWallContact(cornerRoom, { x: 1, y: 1, width: 20, depth: 20 }, "west"), 0);
});

test("grid conversion helpers keep the conservative half-open boundary", () => {
  assert.equal(GRID_MM, 250);
  assert.equal(mmToGridFloor(1000), 4);
  assert.equal(mmToGridCeil(1000), 4);
  assert.equal(mmToGridFloor(999), 3);
  assert.equal(mmToGridCeil(1001), 5);
  assert.equal(mmToGridFloor(0), 0);
  assert.equal(mm2ToGridAreaCeil(GRID_MM * GRID_MM), 1);
  assert.equal(mm2ToGridAreaCeil(GRID_MM * GRID_MM + 1), 2);
  assert.throws(() => mmToGridFloor(-1), RangeError);
  assert.throws(() => mmToGridCeil(1.5), TypeError);
  assert.throws(() => mm2ToGridAreaCeil(Number.NaN), TypeError);
});

test("the canonical envelope is preserved exactly at the geometry boundary", () => {
  const normalized = CANONICAL_NORMALIZED_PROJECT.site;
  assert.deepEqual(normalized, normalizeSite(CANONICAL_PROJECT.site));
  assert.deepEqual(normalized.site, { x: 0, y: 0, width: 80, depth: 120 });
  assert.deepEqual(normalized.envelope, { x: 6, y: 8, width: 68, depth: 88 });
  assert.deepEqual(normalized.exactEnvelopeMm, {
    x: 1_500,
    y: 2_000,
    width: 17_000,
    depth: 22_000,
  });
  assert.deepEqual(normalized.snappedEnvelopeMm, normalized.exactEnvelopeMm);
  assert.equal(normalized.discretizationLossMm2, 0);
  assert.equal(normalized.envelope.width * GRID_MM, normalized.exactEnvelopeMm.width);
  assert.equal(normalized.envelope.depth * GRID_MM, normalized.exactEnvelopeMm.depth);
  assert.equal(containsRect(normalized.site, normalized.envelope), true);
});

test("property: rectangle predicates match a small occupancy-grid oracle", () => {
  const rng = createTestRng(0x5eed_1a2b);
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const a = randomRect(rng);
    const b = randomRect(rng);
    const oracleOverlap = oracleIntersectionArea(a, b);
    assert.equal(intersectionArea(a, b), oracleOverlap);
    assert.equal(overlaps(a, b), oracleOverlap > 0);
    assert.equal(containsRect(a, b), oracleContains(a, b));
    assert.equal(unionArea([a, b]), oracleUnionArea([a, b]));
    assert.equal(sharedWallLength(a, b), oracleSharedWallLength(a, b));
    assert.equal(sharedWallLength(a, b), sharedWallLength(b, a));
    assert.equal(boundaryDistance(a, b), oracleBoundaryDistance(a, b));
    assert.equal(boundaryGapDistanceSquared(a, b), oracleBoundaryGapDistanceSquared(a, b));
    assert.equal(boundaryDistance(a, b), boundaryDistance(b, a));
  }
});

test("property: footprint coverage identities match the occupancy-grid oracle", () => {
  const rng = createTestRng(0xc0ffee);
  for (let iteration = 0; iteration < 150; iteration += 1) {
    const footprint = randomRect(rng, 10, 8);
    const rectangles = Array.from({ length: 1 + (rng() % 4) }, () => randomRect(rng, 12, 5));
    const oracleCovered = oracleCoveredAreaWithin(footprint, rectangles);
    const oracleUnion = oracleUnionArea(rectangles);
    const allocated = rectangles.reduce((sum, rect) => sum + area(rect), 0);
    assert.equal(coveredAreaWithin(footprint, rectangles), oracleCovered);
    assert.equal(unallocatedInteriorArea(footprint, rectangles), area(footprint) - oracleCovered);
    assert.equal(
      unallocatedInteriorRatio(footprint, rectangles),
      (area(footprint) - oracleCovered) / area(footprint),
    );
    assert.equal(overlapArea(rectangles), allocated - oracleUnion);
    assert.ok(coveredAreaWithin(footprint, rectangles) <= area(footprint));
  }
});

test("property: facade contact matches a unit-segment facade oracle", () => {
  const rng = createTestRng(0xfacade);
  const footprint: GridRect = { x: 2, y: 3, width: 14, depth: 12 };
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const rect = randomRectInside(rng, footprint);
    const occluders = Array.from({ length: rng() % 3 }, () => randomRectInside(rng, footprint));
    let total = 0;
    for (const side of SIDES) {
      const contact = exteriorWallContact(rect, footprint, side, occluders);
      assert.equal(contact, oracleExteriorContact(rect, footprint, side, occluders));
      total += contact;
    }
    assert.equal(totalExteriorWallContact(rect, footprint, occluders), total);
  }
});

test("property: conservative snapping never grows the authored envelope", () => {
  const rng = createTestRng(0x5100);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const site: SiteBrief = {
      widthMm: 8_000 + (rng() % 12_000),
      depthMm: 8_000 + (rng() % 12_000),
      offsets: {
        north: { distanceMm: rng() % 2_000, source: "architect" },
        east: { distanceMm: rng() % 2_000, source: "architect" },
        south: { distanceMm: rng() % 2_000, source: "architect" },
        west: { distanceMm: rng() % 2_000, source: "architect" },
      },
      frontSide: "south",
    };
    const normalized = normalizeSite(site);
    assert.ok(containsRect(normalized.site, normalized.envelope));
    assert.ok(normalized.envelope.width > 0 && normalized.envelope.depth > 0);

    const exact = normalized.exactEnvelopeMm;
    const snapped = normalized.snappedEnvelopeMm;
    assert.ok(snapped.x >= exact.x);
    assert.ok(snapped.y >= exact.y);
    assert.ok(snapped.x + snapped.width <= exact.x + exact.width);
    assert.ok(snapped.y + snapped.depth <= exact.y + exact.depth);
    for (const loss of Object.values(normalized.gridInsetLossMm)) {
      assert.ok(loss >= 0 && loss < GRID_MM);
    }
    assert.equal(
      normalized.discretizationLossMm2,
      exact.width * exact.depth - snapped.width * snapped.depth,
    );
  }
});
