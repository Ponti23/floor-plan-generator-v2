import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  DEFAULT_GENERATION_BUDGET,
  GENERATOR_BUDGET_VERSION,
  GENERATOR_DETERMINISM_VERSION,
  GENERATOR_SEARCH_POLICY,
  auditTinyGridPruning,
  generateLayouts,
  serializeCanonical,
} from "../src/domain/index.ts";

test("generation exposes a pinned deterministic policy and budget", () => {
  const budget = {
    beamWidth: 4,
    maxExpansionsPerTopology: 64,
    maxCandidatesPerTopology: 2,
    maxTotalCandidates: 4,
  };
  const first = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: "pinned-policy", budget });
  const second = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: "pinned-policy", budget: { ...budget } });
  assert.equal(serializeCanonical(first), serializeCanonical(second));
  assert.equal(first.metadata.determinismVersion, GENERATOR_DETERMINISM_VERSION);
  assert.equal(first.metadata.budgetVersion, GENERATOR_BUDGET_VERSION);
  assert.deepEqual(first.metadata.budget, budget);
  assert.deepEqual(DEFAULT_GENERATION_BUDGET, {
    beamWidth: 64,
    maxExpansionsPerTopology: 15_000,
    maxCandidatesPerTopology: 100,
    maxTotalCandidates: 300,
  });
  assert.deepEqual(GENERATOR_SEARCH_POLICY, {
    candidateBranchFactor: 8,
    retainedStateFactor: 4,
    dedupeStateFactor: 8,
    footprintVariantLimit: 64,
  });
  assert.ok(first.metadata.expandedStates <= first.metadata.budget.maxExpansionsPerTopology * 3);
  assert.ok(first.metadata.pruning.minimumAreaChecks >= first.metadata.pruning.minimumAreaPruned);
  assert.ok(first.metadata.pruning.frontierChecks >= first.metadata.pruning.frontierPruned);
});
test("the independent tiny-grid oracle proves area-pruned branches cannot contain the selected optimum", () => {
  const audit = auditTinyGridPruning({
    footprint: { x: 0, y: 0, width: 4, depth: 3 },
    rooms: [
      {
        id: "first",
        minimumArea: 4,
        variants: [
          // This attractive branch fills the footprint and is pruned before
          // the second room is placed.
          { id: "fills-grid", width: 4, depth: 3, score: 100 },
          { id: "compact", width: 2, depth: 2, score: 1 },
        ],
      },
      {
        id: "second",
        minimumArea: 4,
        variants: [{ id: "required", width: 2, depth: 2, score: 1 }],
      },
    ],
  });
  assert.ok(audit.selectedOptimum);
  assert.ok(audit.prunedOptimum);
  assert.equal(audit.equivalent, true);
  assert.equal(audit.selectedOptimum?.score, 2);
  assert.equal(audit.prunedOptimum?.score, audit.selectedOptimum?.score);
  assert.ok(audit.prunedBranches.length > 0);
  assert.ok(audit.prunedBranches.every((branch) => {
    assert.equal(branch.reason, "minimum-remaining-area");
    assert.equal(branch.cannotContainSelectedOptimum, true);
    return branch.availableArea < branch.minimumRemainingArea;
  }));
});
