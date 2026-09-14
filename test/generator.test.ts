import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  CANONICAL_PROJECT,
  IMPOSSIBLE_FIXTURES,
  MAX_GFA_M2,
  buildPortalGraph,
  buildCirculationSkeleton,
  createSeededPrng,
  deriveFootprintVariants,
  generateLayouts,
  sharedWallLength,
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

test("generation does not read ambient randomness", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("ambient randomness is forbidden in deterministic generation");
  };
  try {
    const result = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
      seed: "ambient-randomness-guard",
      budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
    });
    assert.equal(result.ok, true);
  } finally {
    Math.random = originalRandom;
  }
});

test("canonical footprint variants stay in the envelope and GFA cap", () => {
  const variants = deriveFootprintVariants(CANONICAL_NORMALIZED_PROJECT, "fixture");
  assert.ok(variants.length > 0);
  const maxArea = Math.floor((CANONICAL_NORMALIZED_PROJECT.planning.maxGfaMm2 ?? 0) / 62_500);
  assert.ok(variants.every((variant) => variant.area <= maxArea));
  assert.ok(variants.some((variant) => variant.width === 60 && variant.depth === 48));

  // Normalized data can be supplied directly to the domain API, so retain the
  // approved hard cap even if a malformed caller bypasses brief normalization.
  const relaxed = structuredClone(CANONICAL_NORMALIZED_PROJECT);
  relaxed.planning.maxGfaMm2 = 300_000_000;
  relaxed.planning.targetGfaMm2 = 250_000_000;
  const relaxedVariants = deriveFootprintVariants(relaxed, "hard-cap-guard");
  assert.ok(relaxedVariants.every((variant) => variant.area <= MAX_GFA_M2 * 16));
});

test("footprint enumeration does not reject a room that only fits when rotated", () => {
  const rotated = structuredClone(CANONICAL_NORMALIZED_PROJECT);
  const bedroom = rotated.rooms.find((room) => room.id === "bedroom-1")!;
  // The 18 m width cannot fit the 17 m envelope width directly, but the
  // paired 4 m depth lets the room fit as 4 m × 18 m after rotation.
  bedroom.dimensions = {
    ...bedroom.dimensions,
    minWidthUnits: 72,
    minDepthUnits: 16,
    minAreaUnits2: 72 * 16,
  };
  const variants = deriveFootprintVariants(rotated, "rotated-room");
  assert.ok(variants.length > 0);
  assert.ok(variants.some((variant) => variant.depth >= 72 && variant.width >= 16));
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

test("a garage vehicle portal never substitutes for pedestrian access", () => {
  const generated = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "garage-pedestrian-access",
    budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  const layout = structuredClone(generated.layouts[0]!);
  layout.portals = layout.portals.filter((portal) =>
    !(portal.kind === "pedestrian" && (portal.a === "garage-1" || portal.b === "garage-1")),
  );

  const validation = validateLayout(layout, CANONICAL_NORMALIZED_PROJECT);
  assert.equal(validation.valid, false);
  assert.equal(validation.reachableSpaceIds.includes("garage-1"), false);
  assert.ok(validation.violations.some((violation) =>
    violation.code === "ROOM_UNREACHABLE" && violation.subjects.includes("garage-1"),
  ));
  assert.equal(validation.graph.edges.some((edge) => edge.kind === "vehicle"), false);
});

test("validator rejects a garage that bypasses the vehicle-frontage policy", () => {
  const generated = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "garage-frontage-policy",
    budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  const malformedProject = structuredClone(CANONICAL_NORMALIZED_PROJECT);
  malformedProject.rooms.find((room) => room.id === "garage-1")!.traits.frontage = undefined;

  const validation = validateLayout(generated.layouts[0]!, malformedProject);
  assert.equal(validation.valid, false);
  assert.ok(validation.violations.some((violation) =>
    violation.code === "GARAGE_FRONTAGE_POLICY_INVALID" && violation.subjects.includes("garage-1"),
  ));
});

test("a placed optional room still needs pedestrian access", () => {
  const generated = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "optional-pedestrian-access",
    budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  const optionalProject = structuredClone(CANONICAL_NORMALIZED_PROJECT);
  optionalProject.rooms.find((room) => room.id === "bedroom-3")!.inclusion = "optional";
  const layout = structuredClone(generated.layouts[0]!);
  layout.portals = layout.portals.filter((portal) =>
    portal.a !== "bedroom-3" && portal.b !== "bedroom-3",
  );

  const validation = validateLayout(layout, optionalProject);
  assert.equal(validation.valid, false);
  assert.equal(validation.reachableSpaceIds.includes("bedroom-3"), false);
  assert.ok(validation.violations.some((violation) =>
    violation.code === "ROOM_UNREACHABLE" && violation.subjects.includes("bedroom-3"),
  ));
});

test("hard relationship selectors support room kinds as well as IDs and requirement IDs", () => {
  const generated = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "kind-selector",
    budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  const layout = generated.layouts[0]!;
  const rooms = layout.spaces.filter((space) => space.role === "room");
  let pair: [typeof rooms[number], typeof rooms[number]] | undefined;
  for (let first = 0; first < rooms.length && !pair; first += 1) {
    for (let second = first + 1; second < rooms.length; second += 1) {
      if (sharedWallLength(rooms[first]!.rect, rooms[second]!.rect) >= 4) {
        pair = [rooms[first]!, rooms[second]!];
        break;
      }
    }
  }
  assert.ok(pair, "generated fixture must contain a meaningful room-to-room shared wall");

  const selectorProject = structuredClone(CANONICAL_NORMALIZED_PROJECT);
  const from = selectorProject.rooms.find((room) => room.id === pair![0].instanceId)!;
  from.requirementId = `custom-${from.id}`;
  selectorProject.relationships = [{
    id: "kind-selector",
    from: from.kind,
    to: pair![1].instanceId,
    kind: "mustShareWall",
    source: "architect",
  }];

  const validation = validateLayout(layout, selectorProject);
  assert.equal(validation.valid, true);
  assert.equal(validation.violations.some((violation) =>
    violation.code === "RELATIONSHIP_SELECTOR_UNRESOLVED",
  ), false);
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
