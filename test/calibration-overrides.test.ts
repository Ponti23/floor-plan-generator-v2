import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_SURFACE,
  CANONICAL_NORMALIZED_PROJECT,
  METRIC_CATEGORIES,
  SCORING_VERSION,
  calibrationIssues,
  evaluateLayoutMetrics,
  generateLayouts,
  resolveCalibrationSurface,
  scoreCandidates,
  selectDiverseTriplet,
  serializeCanonical,
  validateLayout,
} from "../src/domain/index.ts";

/**
 * The Stage 3 gate asked for the approved scoring language to stay the default
 * while remaining settable later.  These tests pin both halves: an unconfigured
 * run is bit-identical to the reviewed baseline, and an override can move soft
 * scoring without ever touching hard validity.
 */

const BUDGET = { maxCandidatesPerTopology: 1, maxTotalCandidates: 3 } as const;
const SEED = "calibration-override-tests";

const baseline = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: SEED, budget: BUDGET });
if (baseline.layouts.length === 0) throw new Error("override test fixture produced no layout");

test("an unconfigured run keeps the approved surface and its exact version", () => {
  assert.equal(resolveCalibrationSurface(), CALIBRATION_SURFACE);
  assert.equal(resolveCalibrationSurface({}).version, CALIBRATION_SURFACE.version);

  const explicit = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: SEED,
    budget: BUDGET,
    calibration: CALIBRATION_SURFACE,
  });
  // Passing the approved surface explicitly must not perturb any output.
  assert.equal(serializeCanonical(explicit.layouts), serializeCanonical(baseline.layouts));
  assert.equal(explicit.metadata.calibrationVersion, CALIBRATION_SURFACE.version);
  assert.deepEqual(explicit.diagnostics.map((d) => d.code), baseline.diagnostics.map((d) => d.code));
});

test("a derived surface is frozen, validated, and never claims the approved version", () => {
  const custom = resolveCalibrationSurface({ diversity: { threshold: 0.35 } });
  assert.equal(Object.isFrozen(custom), true);
  assert.equal(Object.isFrozen(custom.diversity), true);
  assert.equal(Object.isFrozen(custom.profiles.balanced.weights), true);
  assert.deepEqual(calibrationIssues(custom), []);
  assert.equal(custom.version, `${CALIBRATION_SURFACE.version}+custom`);
  assert.notEqual(custom.version, CALIBRATION_SURFACE.version);
  assert.equal(custom.diversity.threshold, 0.35);
  // Untouched values stay on the approved baseline.
  assert.equal(custom.diversity.selectionDiversityBonus, CALIBRATION_SURFACE.diversity.selectionDiversityBonus);
  assert.deepEqual(custom.profiles.balanced.weights, CALIBRATION_SURFACE.profiles.balanced.weights);
});

test("overriding weights re-derives the trade-off explanation instead of leaving it stale", () => {
  const custom = resolveCalibrationSurface({
    profiles: {
      compactEfficiency: {
        weights: {
          programSpace: 0.60,
          flow: 0.10,
          relationships: 0.10,
          liveability: 0.10,
          servicesSite: 0.10,
        },
      },
    },
  });
  const values = custom.tradeoffs.compactEfficiency.message.values;
  // The descriptor prints these numbers to explain a profile, so they must follow the merge.
  assert.equal(values.focusWeight, 0.60);
  assert.equal(values.tradeoffWeight, 0.10);
  assert.equal(CALIBRATION_SURFACE.tradeoffs.compactEfficiency.message.values.focusWeight, 0.40);
  // The multi-category "balanced" descriptor keys its weight off the first category listed.
  const balanced = resolveCalibrationSurface({
    profiles: { balanced: { weights: { programSpace: 0.41, flow: 0.41, relationships: 0.06, liveability: 0.06, servicesSite: 0.06 } } },
  });
  assert.equal(balanced.tradeoffs.balanced.message.values.focusWeight, 0.41);
  assert.equal(balanced.tradeoffs.balanced.message.values.tradeoffWeight, 0.06);
});

test("unsafe overrides are rejected before they can reach scoring", () => {
  const cases: Array<[string, () => unknown]> = [
    ["weights that do not sum to one", () =>
      resolveCalibrationSurface({ profiles: { balanced: { weights: { programSpace: 0.9 } } } })],
    ["a weight above one", () =>
      resolveCalibrationSurface({ profiles: { balanced: { weights: { programSpace: 1.4, flow: 0 } } } })],
    ["a negative weight", () =>
      resolveCalibrationSurface({ profiles: { balanced: { weights: { programSpace: -0.2 } } } })],
    ["a diversity threshold above one", () =>
      resolveCalibrationSurface({ diversity: { threshold: 1.5 } })],
    ["a diversity threshold below zero", () =>
      resolveCalibrationSurface({ diversity: { threshold: -0.1 } })],
    ["a zero shortlist size", () =>
      resolveCalibrationSurface({ diversity: { shortlistSize: 0 } })],
    ["a non-integer shortlist size", () =>
      resolveCalibrationSurface({ diversity: { shortlistSize: 2.5 } })],
    ["distance component weights that do not sum to one", () =>
      resolveCalibrationSurface({ diversity: { adjacencyWeight: 0.9 } })],
    ["an oversize tolerance that meets the zero-utility ratio", () =>
      resolveCalibrationSurface({ metricConfig: { preferredAreaOversizeTolerance: 2 } })],
    ["a zero explanation limit", () =>
      resolveCalibrationSurface({ explanations: { defaultLimit: 0 } })],
    ["an empty version tag", () =>
      resolveCalibrationSurface({ version: "" })],
  ];
  for (const [label, run] of cases) {
    assert.throws(run, /invalid scoring calibration/, `${label} must be rejected`);
  }
  // The baseline is untouched by a rejected edit.
  assert.deepEqual(calibrationIssues(), []);
  assert.equal(CALIBRATION_SURFACE.diversity.shortlistSize, 24);
});

test("metric breakpoints and shortlist size are settable without touching source", () => {
  const raised = resolveCalibrationSurface({
    metricConfig: { targetCirculationRatio: 0.30 },
  });
  assert.equal(raised.metricConfig.targetCirculationRatio, 0.30);

  // The meaningful-shared-wall cutoff follows an overridden metric breakpoint
  // unless the cutoff itself was set explicitly.
  const derived = resolveCalibrationSurface({ metricConfig: { defaultAdjacencyTargetUnits: 20 } });
  assert.equal(derived.diversity.adjacencyThresholdUnits, 20);
  const explicit = resolveCalibrationSurface({
    metricConfig: { defaultAdjacencyTargetUnits: 20 },
    diversity: { adjacencyThresholdUnits: 7 },
  });
  assert.equal(explicit.diversity.adjacencyThresholdUnits, 7);

  // shortlistSize is the recorded untaken tuning headroom (D3); it must be
  // genuinely reachable through the edit surface, not just a documented field.
  const shortlist = resolveCalibrationSurface({ diversity: { shortlistSize: 3 } });
  const candidates = scoreCandidates(baseline.layouts, CANONICAL_NORMALIZED_PROJECT, { calibration: shortlist });
  const selection = selectDiverseTriplet(candidates, CANONICAL_NORMALIZED_PROJECT, { calibration: shortlist });
  assert.equal(selection.threshold, CALIBRATION_SURFACE.diversity.threshold);
  assert.equal(shortlist.diversity.shortlistSize, 3);
  for (const layout of selection.layouts) {
    assert.equal(validateLayout(layout, CANONICAL_NORMALIZED_PROJECT).valid, true);
  }
});

test("a hostile calibration moves soft scoring but can never move hard validity", () => {
  const hostile = resolveCalibrationSurface({
    profiles: {
      compactEfficiency: { weights: { programSpace: 0, flow: 0, relationships: 0, liveability: 0, servicesSite: 1 } },
    },
    metricConfig: { targetCirculationRatio: 0.34, unacceptableCirculationRatio: 0.35 },
    diversity: { threshold: 0.95, selectionDiversityBonus: 100 },
  });
  const scored = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: SEED,
    budget: BUDGET,
    calibration: hostile,
  });

  assert.equal(scored.metadata.calibrationVersion, hostile.version);
  // Same candidate pool, same verdicts, same violation sets — only scoring moved.
  assert.deepEqual(scored.layouts.map((l) => l.id), baseline.layouts.map((l) => l.id));
  for (const [index, layout] of scored.layouts.entries()) {
    const before = validateLayout(baseline.layouts[index]!, CANONICAL_NORMALIZED_PROJECT);
    const after = validateLayout(layout, CANONICAL_NORMALIZED_PROJECT);
    assert.equal(after.valid, before.valid);
    assert.deepEqual(after.violations.map((v) => v.code), before.violations.map((v) => v.code));
  }
  for (const analysis of scored.analyses) {
    assert.equal(analysis.validation.valid, true);
    assert.equal(analysis.calibrationVersion, hostile.version);
  }
  // The score model itself is untouched by a calibration edit.
  assert.equal(scored.analyses[0]?.profiles[0]?.scoreModelVersion, SCORING_VERSION);
});

test("metrics honour a breakpoint override, so the edit surface is not cosmetic", () => {
  const layout = baseline.layouts[0]!;
  const approved = evaluateLayoutMetrics(layout, CANONICAL_NORMALIZED_PROJECT);
  const strict = evaluateLayoutMetrics(layout, CANONICAL_NORMALIZED_PROJECT, undefined, {
    ...CALIBRATION_SURFACE.metricConfig,
    targetCirculationRatio: 0.005,
    unacceptableCirculationRatio: 0.01,
  });
  const flowMetricUtilities = (metrics: typeof approved) =>
    metrics.categories.flow.metrics.map((metric) => `${metric.id}:${metric.utility}`).join(",");

  assert.notEqual(
    flowMetricUtilities(strict),
    flowMetricUtilities(approved),
    "a stricter circulation target must change the reported flow evidence",
  );
  // Hard validity is not part of the metric config, so it cannot move with it.
  assert.equal(validateLayout(layout, CANONICAL_NORMALIZED_PROJECT).valid, true);
  // Every category stays bounded and no score can rescue an invalid layout.
  for (const category of METRIC_CATEGORIES) {
    const value = strict.categories[category].utility;
    assert.ok(value >= 0 && value <= 1, `${category} utility stays bounded`);
  }
});
