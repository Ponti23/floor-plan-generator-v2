import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_SURFACE,
  CALIBRATED_STRATEGY_PROFILE_IDS,
  CANONICAL_NORMALIZED_PROJECT,
  METRIC_CATEGORIES,
  SCORING_CALIBRATION,
  STRATEGY_PROFILE_IDS,
  calibrationIssues,
  generateLayouts,
  compareLayoutDiversity,
  selectDiverseTriplet,
  scoreLayoutProfiles,
  scoreCandidates,
  strategyWeightTotal,
  strategyWeightTotals,
  type ScoringCalibrationSurface,
} from "../src/domain/index.ts";

const generated = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
  seed: "strategy-calibration-tests",
  budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 3 },
});
const layout = generated.layouts[0];
if (!layout) throw new Error("calibration test fixture did not generate a layout");

test("the calibration surface is frozen, complete, and normalizes every weight", () => {
  assert.equal(SCORING_CALIBRATION, CALIBRATION_SURFACE);
  assert.equal(Object.isFrozen(CALIBRATION_SURFACE), true);
  assert.equal(Object.isFrozen(CALIBRATION_SURFACE.profiles), true);
  assert.equal(Object.isFrozen(CALIBRATION_SURFACE.diversity), true);
  assert.equal(Object.isFrozen(CALIBRATION_SURFACE.tradeoffs.balanced.message.values), true);
  assert.equal(Object.isFrozen(CALIBRATION_SURFACE.tradeoffs.balanced.focusCategories), true);
  assert.deepEqual(calibrationIssues(), []);
  assert.deepEqual(CALIBRATED_STRATEGY_PROFILE_IDS, STRATEGY_PROFILE_IDS);
  for (const total of Object.values(strategyWeightTotals())) assert.ok(Math.abs(total - 1) < 1e-9);
  for (const id of STRATEGY_PROFILE_IDS) {
    const profile = CALIBRATION_SURFACE.profiles[id];
    assert.deepEqual(Object.keys(profile.weights).sort(), [...METRIC_CATEGORIES].sort());
    assert.ok(Math.abs(strategyWeightTotal(profile) - 1) < 1e-9);
    assert.equal(Object.isFrozen(profile.weights), true);
  }
});

test("strategy scorecards share facts and hard validation and differ through weights", () => {
  const set = scoreLayoutProfiles(layout, CANONICAL_NORMALIZED_PROJECT);
  assert.equal(set.valid, true);
  assert.equal(set.calibrationVersion, CALIBRATION_SURFACE.version);
  const first = set.profiles[0];
  assert.ok(first);
  for (const scorecard of set.profiles) {
    assert.equal(scorecard.valid, set.valid);
    assert.equal(scorecard.validation, set.validation);
    assert.equal(scorecard.ruleReport, set.ruleReport);
    assert.equal(scorecard.facts, set.facts);
    assert.equal(scorecard.metrics, set.metrics);
    assert.deepEqual(scorecard.categoryScores, first.categoryScores);
    assert.equal(scorecard.tradeoffs.length, 1);
    assert.equal(scorecard.tradeoffs[0]?.profileId, scorecard.profileId);
    assert.match(scorecard.tradeoffs[0]?.message.key ?? "", /^strategy\./);
    const expected = METRIC_CATEGORIES.reduce(
      (total, category) => total + set.metrics.categories[category].utility * scorecard.profile.weights[category],
      0,
    );
    assert.equal(scorecard.overallUtility, expected);
  }
  assert.notEqual(
    set.scorecards.compactEfficiency.overallUtility,
    set.scorecards.bestFlow.overallUtility,
  );
});

test("changing calibrated thresholds changes desirability only, never hard validity", () => {
  const custom = {
    ...CALIBRATION_SURFACE,
    metricConfig: {
      ...CALIBRATION_SURFACE.metricConfig,
      routeDistanceTargetUnits: 1,
      targetCirculationRatio: 0,
      unacceptableCirculationRatio: 1,
    },
  } as ScoringCalibrationSurface;
  const baseline = scoreLayoutProfiles(layout, CANONICAL_NORMALIZED_PROJECT);
  const calibrated = scoreLayoutProfiles(
    layout,
    CANONICAL_NORMALIZED_PROJECT,
    undefined,
    undefined,
    custom,
  );
  assert.equal(calibrated.valid, baseline.valid);
  assert.deepEqual(calibrated.validation, baseline.validation);
  assert.equal(calibrated.profiles.every((scorecard) => scorecard.valid), true);
  assert.notDeepEqual(
    calibrated.metrics.categories.flow.metrics.map((metric) => metric.utility),
    baseline.metrics.categories.flow.metrics.map((metric) => metric.utility),
  );
  assert.notEqual(
    calibrated.metrics.categories.flow.metrics.find((metric) => metric.id === "circulationRatio")?.utility,
    baseline.metrics.categories.flow.metrics.find((metric) => metric.id === "circulationRatio")?.utility,
  );
});

test("invalid geometry stays invalid under every calibrated profile", () => {
  const invalid = structuredClone(layout);
  const rooms = invalid.spaces.filter((space) => space.role === "room");
  assert.ok(rooms.length >= 2);
  rooms[1]!.rect = rooms[0]!.rect;
  const scored = scoreCandidates([invalid], CANONICAL_NORMALIZED_PROJECT, { includeInvalid: true });
  assert.equal(scored.length, 1);
  assert.equal(scored[0]?.valid, false);
  assert.ok(scored[0]);
  for (const profile of scored[0]!.profiles) {
    assert.equal(profile.valid, false);
    assert.equal(profile.designScore, null);
    assert.equal(profile.overallUtility, 0);
    assert.equal(profile.overallScore, 0);
    assert.deepEqual(profile.validation, scored[0]!.validation);
  }
});

test("selection reads its diversity threshold from the supplied calibration", () => {
  const custom = {
    ...CALIBRATION_SURFACE,
    diversity: {
      ...CALIBRATION_SURFACE.diversity,
      threshold: 0,
    },
  } as ScoringCalibrationSurface;
  const comparison = compareLayoutDiversity(layout, layout, CANONICAL_NORMALIZED_PROJECT, undefined, custom);
  assert.equal(comparison.threshold, 0);
  assert.equal(comparison.diverse, true);
  const selection = selectDiverseTriplet([layout], CANONICAL_NORMALIZED_PROJECT, { calibration: custom });
  assert.equal(selection.threshold, 0);
  assert.equal(selection.selected.length, 1);
});
