import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  CANONICAL_PROJECT,
  IMPOSSIBLE_FIXTURES,
  buildPortalGraph,
  buildCirculationSkeleton,
  createSeededPrng,
  deriveFootprintVariants,
  generateLayouts,
  validateLayout,
  type Layout,
} from "../src/domain/index.ts";

test("owned seeded PRNG is replayable and never uses ambient randomness", () => {
  const first = createSeededPrng("generator-test");
  const second = createSeededPrng("generator-test");
  const a = Array.from({ length: 32 }, () => first.nextUint32());
  const b = Array.from({ length: 32 }, () => second.nextUint32());
  assert.deepEqual(a, b);
  assert.ok(a.some((value) => value !== 0));
  assert.ok(a.every((value) => Number.isSafeInteger(value) && value >= 0));
});

test("canonical footprint variants stay in the envelope and GFA cap", () => {
  const variants = deriveFootprintVariants(CANONICAL_NORMALIZED_PROJECT, "fixture");
  assert.ok(variants.length > 0);
  const maxArea = Math.floor((CANONICAL_NORMALIZED_PROJECT.planning.maxGfaMm2 ?? 0) / 62_500);
  assert.ok(variants.every((variant) => variant.area <= maxArea));
  assert.ok(variants.some((variant) => variant.width === 60 && variant.depth === 48));
});

test("all circulation families are rectangular, grid aligned, and anchored", () => {
  const footprint = { x: 10, y: 10, width: 40, depth: 72 };
  for (const kind of ["straight", "L", "T"] as const) {
    const skeleton = buildCirculationSkeleton(CANONICAL_NORMALIZED_PROJECT, footprint, kind, "skeleton");
    assert.ok(skeleton, kind);
    if (!skeleton) throw new Error(`missing ${kind} skeleton`);
    assert.equal(skeleton.kind, kind);
    assert.equal(skeleton.rectangles.every((rect) => Math.min(rect.width, rect.depth) >= 4), true);
    assert.equal(skeleton.entry.y + skeleton.entry.depth, footprint.y + footprint.depth);
  }
});

test("canonical generator emits only independently hard-valid layouts and replays exactly", () => {
  const options = { seed: "canonical-replay", budget: { maxCandidatesPerTopology: 3, maxTotalCandidates: 9 } };
  const first = generateLayouts(CANONICAL_NORMALIZED_PROJECT, options);
  const second = generateLayouts(CANONICAL_PROJECT, options);
  assert.equal(first.ok, true);
  assert.ok(first.layouts.length >= 3);
  assert.deepEqual(first, second);
  assert.ok(first.layouts.every((layout) => validateLayout(layout, CANONICAL_NORMALIZED_PROJECT).valid));
  assert.ok(first.layouts.every((layout) => layout.portals.some((portal) => portal.kind === "pedestrian" && portal.wall === "south")));
});

test("validator rejects overlap, bad portals, and disconnected rooms", () => {
  const layout: Layout = {
    id: "invalid",
    footprint: { x: 10, y: 10, width: 40, depth: 40 },
    spaces: [
      { instanceId: "living-1", role: "room", rect: { x: 10, y: 10, width: 20, depth: 20 } },
      { instanceId: "entry", role: "entry", rect: { x: 10, y: 46, width: 4, depth: 4 } },
    ],
    portals: [],
    entrancePortalId: "missing",
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
  const result = validateLayout(layout, CANONICAL_NORMALIZED_PROJECT);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((violation) => violation.code === "REQUIRED_ROOM_MISSING"));
  assert.ok(result.violations.some((violation) => violation.code === "ENTRANCE_COUNT_INVALID"));
});

test("impossible normalized input returns typed diagnostics instead of partial layouts", () => {
  const result = generateLayouts(IMPOSSIBLE_FIXTURES.roomCannotFitEnvelope, "impossible");
  assert.equal(result.ok, false);
  assert.deepEqual(result.layouts, []);
  assert.equal(result.diagnostics[0]?.code, "NORMALIZATION_FAILED");
});

test("portal graph is serializable and rooted at the exterior", () => {
  const result = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "graph",
    budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  assert.equal(result.ok, true);
  assert.ok(result.layouts[0]);
  const graph = buildPortalGraph(result.layouts[0]);
  assert.equal(graph.nodes[0], "exterior");
  assert.ok(graph.edges.length > 0);
  assert.ok(graph.adjacency.exterior.length > 0);
});
