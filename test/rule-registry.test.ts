import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  GARAGE_MIN_DEPTH_UNITS,
  GARAGE_MIN_WIDTH_UNITS,
  MAX_GFA_M2,
  MIN_PORTAL_WIDTH_UNITS,
  PLANLAB_CORE_DEFINITIONS,
  PLANLAB_CORE_PIPELINE,
  PLANLAB_CORE_RULE_PACK,
  PLANLAB_CORE_RULE_VERSION,
  createCanonicalProject,
  createPlanlabCoreRuleInstances,
  evaluatePlanlabCoreRules,
  evaluateRuleInstance,
  generateLayouts,
  normalizeProject,
  prepareRuleContext,
  validateLayout,
  type AccessPortal,
  type GridRect,
  type Layout,
  type NormalizedProject,
  type ProjectBrief,
  type RuleInstance,
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

function fixtureLayout(
  spaces: Layout["spaces"],
  portals: AccessPortal[],
): Layout {
  return {
    id: "registry-fixture",
    footprint: rect(0, 0, 8, 8),
    spaces,
    portals,
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

function invalidProject(): ProjectBrief {
  return {
    schemaVersion: 1,
    projectId: "registry-invalid",
    name: "Registry invalid",
    site: {
      widthMm: 2_000,
      depthMm: 2_000,
      offsets: {
        north: { distanceMm: 0, source: "architect" },
        east: { distanceMm: 0, source: "architect" },
        south: { distanceMm: 0, source: "architect" },
        west: { distanceMm: 0, source: "architect" },
      },
      frontSide: "south",
    },
    program: [
      {
        id: "living",
        label: "Living",
        kind: "living",
        quantity: 1,
        inclusion: "required",
        dimensions: { minAreaMm2: 1_000_000 },
        traits: {
          zone: "public",
          wet: false,
          exteriorPreference: "none",
          mayBePassThrough: true,
        },
      },
      {
        id: "garage",
        label: "Garage",
        kind: "garage",
        quantity: 1,
        inclusion: "optional",
        dimensions: { minAreaMm2: 1_000_000 },
        traits: {
          zone: "service",
          wet: false,
          exteriorPreference: "none",
          mayBePassThrough: false,
          frontage: { side: "south", kind: "vehicle" },
        },
      },
      {
        id: "bedroom",
        label: "Bedroom",
        kind: "bedroom",
        quantity: 1,
        inclusion: "required",
        dimensions: { minAreaMm2: 1_000_000 },
        traits: {
          zone: "private",
          wet: false,
          exteriorPreference: "none",
          mayBePassThrough: false,
        },
      },
    ],
    relationships: [{
      id: "rel-1",
      from: { type: "instance", id: "living-1" },
      to: { type: "instance", id: "bedroom-1" },
      kind: "mustShareWall",
      source: "architect",
    }],
    planning: { minimumCirculationWidthMm: 1_000, maxUnallocatedInteriorRatio: 0.05 },
    generation: { seed: "registry-invalid" },
  };
}

function validFixture(): { layout: Layout; project: NormalizedProject } {
  const project = normalizeProject(createCanonicalProject("registry-valid"));
  const generated = generateLayouts(createCanonicalProject("registry-valid"), {
    seed: "registry-valid",
    budget: {
      beamWidth: 8,
      // The room-shape policy makes a valid tiling take more search before the
      // first candidate appears (400 expansions now finds none, 800 finds two).
      // This fixture only needs one valid layout to exercise the rule registry.
      maxExpansionsPerTopology: 1_200,
      maxCandidatesPerTopology: 2,
      maxTotalCandidates: 6,
    },
  });
  const layout = generated.layouts[0];
  assert.ok(layout, "the canonical generator must produce a candidate");
  return { layout, project };
}

test("every pipeline definition is registered with a stable id and version", () => {
  assert.equal(PLANLAB_CORE_PIPELINE.length, 33);
  assert.equal(new Set(PLANLAB_CORE_PIPELINE).size, PLANLAB_CORE_PIPELINE.length);
  for (const id of PLANLAB_CORE_PIPELINE) {
    const definition = PLANLAB_CORE_DEFINITIONS.get(id);
    assert.ok(definition, `missing definition ${id}`);
    assert.equal(definition.version, PLANLAB_CORE_RULE_VERSION);
    assert.ok(definition.category.length > 0);
    assert.equal(typeof definition.validateParameters, "function");
    assert.equal(typeof definition.evaluate, "function");
  }
});

test("the pipeline order follows the eight RULE_ENGINE stages", () => {
  const stages: readonly (readonly string[])[] = [
    ["unsupported-schema-version"],
    ["invalid-footprint-geometry", "footprint-outside-envelope", "footprint-exceeds-max-gfa"],
    [
      "invalid-space-role",
      "invalid-space-geometry",
      "duplicate-space-id",
      "space-outside-footprint",
      "unknown-room-instance",
    ],
    ["space-overlap", "unallocated-interior-exceeds-cap"],
    ["required-room-missing", "room-dimensions-invalid", "circulation-width-invalid"],
    [
      "duplicate-portal-id",
      "portal-wall-invalid",
      "portal-kind-invalid",
      "portal-width-invalid",
      "portal-unknown-space",
      "portal-not-on-shared-edge",
      "entrance-count-invalid",
      "entrance-portal-invalid",
      "entrance-target-invalid",
    ],
    ["forbidden-pass-through", "room-unreachable", "circulation-unreachable"],
    [
      "garage-vehicle-portal-missing",
      "garage-frontage-policy-invalid",
      "garage-preset-dimensions-invalid",
      "garage-missing-south-frontage",
      "relationship-selector-unresolved",
      "must-share-wall-unsatisfied",
      "relationship-aggregation-unsupported",
    ],
  ];
  assert.deepEqual(PLANLAB_CORE_PIPELINE, stages.flat());
});

test("built-in instances carry enforcement, source, parameters, and scope", () => {
  const instances = createPlanlabCoreRuleInstances(CANONICAL_NORMALIZED_PROJECT);
  assert.equal(instances.length, PLANLAB_CORE_PIPELINE.length);

  const allowedScopes = new Set(["layout", "space", "room", "portal", "relationship"]);
  for (const instance of instances) {
    assert.equal(instance.definitionVersion, PLANLAB_CORE_RULE_VERSION);
    assert.equal(instance.enabled, true);
    assert.equal(instance.enforcement, "hard");
    assert.equal(instance.source.kind, "planlab");
    assert.ok(instance.source.reference?.includes("RULE_ENGINE.md"));
    assert.ok(allowedScopes.has(instance.scope.kind));
    assert.ok(instance.id.startsWith(`${PLANLAB_CORE_RULE_PACK}.`));
    assert.equal(typeof instance.parameters, "object");
  }

  const byId = new Map(instances.map((instance) => [instance.definitionId, instance]));
  assert.equal(
    byId.get("footprint-exceeds-max-gfa")?.parameters.maximumGfaUnits2,
    Math.floor((MAX_GFA_M2 * 1_000_000) / (250 * 250)),
  );
  assert.equal(
    byId.get("circulation-width-invalid")?.parameters.minimumWidthUnits,
    CANONICAL_NORMALIZED_PROJECT.planning.minimumCirculationWidthUnits,
  );
  assert.equal(
    byId.get("portal-width-invalid")?.parameters.minimumWidthUnits,
    MIN_PORTAL_WIDTH_UNITS,
  );
  assert.equal(
    byId.get("garage-preset-dimensions-invalid")?.parameters.minimumWidthUnits,
    GARAGE_MIN_WIDTH_UNITS,
  );
  assert.equal(
    byId.get("garage-preset-dimensions-invalid")?.parameters.minimumDepthUnits,
    GARAGE_MIN_DEPTH_UNITS,
  );
});

test("a valid candidate passes every built-in rule with full provenance", () => {
  const { layout, project } = validFixture();
  const result = validateLayout(layout, project);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.counts, { errors: 0, warnings: 0 });

  const evaluations = evaluatePlanlabCoreRules(prepareRuleContext(layout, project));
  assert.equal(evaluations.length, PLANLAB_CORE_PIPELINE.length);
  for (const evaluation of evaluations) {
    assert.equal(evaluation.status, "pass");
    assert.equal(evaluation.ruleDefinitionVersion, PLANLAB_CORE_RULE_VERSION);
    assert.equal(evaluation.enforcement, "hard");
    assert.ok(evaluation.ruleInstanceId.startsWith(`${PLANLAB_CORE_RULE_PACK}.`));
    assert.equal(
      evaluation.code,
      evaluation.ruleDefinitionId.replaceAll("-", "_").toUpperCase(),
    );
    assert.ok(evaluation.message.key.startsWith("validation."));
  }
});

test("unknown definitions and version mismatches report unsupported, never pass", () => {
  const { layout, project } = validFixture();
  const context = prepareRuleContext(layout, project);
  const base: Omit<RuleInstance, "definitionId" | "definitionVersion" | "enabled"> = {
    id: "pack.custom.unknown",
    enforcement: "hard",
    source: { kind: "custom" },
    parameters: {},
    scope: { kind: "layout" },
  };

  const unknown = evaluateRuleInstance({ ...base, definitionId: "mystery-rule", definitionVersion: 1, enabled: true }, context);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]?.status, "fail");
  assert.equal(unknown[0]?.code, "RULE_DEFINITION_UNSUPPORTED");
  assert.deepEqual(unknown[0]?.subjects, [{ kind: "rule", id: "mystery-rule" }]);
  assert.equal(unknown[0]?.message.key, "validation.rule-definition-unsupported");

  const stale = evaluateRuleInstance({
    ...base,
    id: "pack.core.stale",
    definitionId: "space-overlap",
    definitionVersion: PLANLAB_CORE_RULE_VERSION + 1,
    enabled: true,
  }, context);
  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.status, "fail");
  assert.equal(stale[0]?.code, "RULE_DEFINITION_UNSUPPORTED");

  const disabled = evaluateRuleInstance({
    ...base,
    id: "pack.core.disabled",
    definitionId: "space-overlap",
    definitionVersion: PLANLAB_CORE_RULE_VERSION,
    enabled: false,
  }, context);
  assert.equal(disabled.length, 1);
  assert.equal(disabled[0]?.status, "notApplicable");
});

test("violations keep stable codes, provenance, evidence, and pipeline order", () => {
  const project = normalizeProject(invalidProject());
  const layout = fixtureLayout(
    [
      { instanceId: "living-1", role: "room", rect: rect(0, 0, 8, 8) },
      { instanceId: "garage-1", role: "room", rect: rect(0, 0, 4, 4) },
    ],
    [portal("p1", "living-1", "ghost", "south", 0, 4)],
  );
  const result = validateLayout(layout, project);
  const codes = result.violations.map((violation) => violation.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("SPACE_OVERLAP"));
  assert.ok(codes.includes("PORTAL_UNKNOWN_SPACE"));
  assert.ok(codes.includes("ROOM_UNREACHABLE"));
  assert.ok(codes.includes("GARAGE_PRESET_DIMENSIONS_INVALID"));
  assert.ok(codes.includes("RELATIONSHIP_SELECTOR_UNRESOLVED"));

  assert.ok(codes.indexOf("SPACE_OVERLAP") < codes.indexOf("PORTAL_UNKNOWN_SPACE"));
  assert.ok(codes.indexOf("PORTAL_UNKNOWN_SPACE") < codes.indexOf("ROOM_UNREACHABLE"));
  assert.ok(codes.indexOf("ROOM_UNREACHABLE") < codes.indexOf("GARAGE_PRESET_DIMENSIONS_INVALID"));
  assert.ok(
    codes.indexOf("GARAGE_PRESET_DIMENSIONS_INVALID") <
    codes.indexOf("RELATIONSHIP_SELECTOR_UNRESOLVED"),
  );

  const overlap = result.violations.find((violation) => violation.code === "SPACE_OVERLAP");
  assert.ok(overlap);
  assert.equal(overlap.ruleId, "planlab-core.space-overlap");
  assert.equal(overlap.ruleVersion, PLANLAB_CORE_RULE_VERSION);
  assert.equal(overlap.severity, "hard");
  assert.deepEqual(overlap.subjects, ["living-1", "garage-1"]);
  assert.equal(overlap.evidence?.overlapUnits2, 16);
  assert.equal(overlap.message.key, "validation.space_overlap");
  assert.deepEqual(overlap.geometryEvidence?.[0]?.rect, rect(0, 0, 4, 4));
});

test("registry evaluation for the broken fixture agrees with the legacy validator", () => {
  const project = normalizeProject(invalidProject());
  const layout = fixtureLayout(
    [
      { instanceId: "living-1", role: "room", rect: rect(0, 0, 8, 8) },
      { instanceId: "garage-1", role: "room", rect: rect(0, 0, 4, 4) },
    ],
    [portal("p1", "living-1", "ghost", "south", 0, 4)],
  );
  const evaluations = evaluatePlanlabCoreRules(prepareRuleContext(layout, project));
  const failingCodes = evaluations
    .filter((evaluation) => evaluation.status === "fail")
    .map((evaluation) => evaluation.code);
  const legacyCodes = validateLayout(layout, project).violations.map(
    (violation) => violation.code,
  );
  assert.deepEqual(failingCodes, legacyCodes);
});
