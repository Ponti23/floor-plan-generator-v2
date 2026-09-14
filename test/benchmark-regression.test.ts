import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

interface Baseline {
  schemaVersion: string;
  mode: string;
  budget: Record<string, number>;
  searchPolicy: Record<string, number>;
  seeds: string[];
  benchmarkInputFingerprint: string;
  historicalStage0Baseline: {
    commit: string;
    artifact: string;
    outputHashes: Record<string, string>;
  };
  canonical: Array<{
    seed: string;
    outputHash: string;
    layoutHash: string;
    selectionHash: string;
    evidenceHash: string;
    expansions: { total: number; pruning: Record<string, number> };
  }>;
}

function readBaseline(name: string): Baseline {
  return JSON.parse(readFileSync(
    resolve(process.cwd(), "artifacts", "planlab", "milestone-3", "benchmark-baselines", name),
    "utf8",
  )) as Baseline;
}

test("regression baselines pin source provenance, policy, and historical drift", () => {
  const full = readBaseline("full.json");
  assert.equal(full.schemaVersion, "planlab-stage0-regression-baseline-1");
  assert.equal(full.mode, "full");
  assert.equal(full.seeds.length, 10);
  assert.match(full.benchmarkInputFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(full.historicalStage0Baseline.commit, "e1c6f38");
  assert.equal(full.historicalStage0Baseline.artifact, "artifacts/planlab/milestone-0/benchmark.json");
  assert.equal(Object.keys(full.historicalStage0Baseline.outputHashes).length, 10);
  assert.deepEqual(full.budget, {
    beamWidth: 64,
    maxExpansionsPerTopology: 15000,
    maxCandidatesPerTopology: 100,
    maxTotalCandidates: 300,
  });
  assert.deepEqual(full.searchPolicy, {
    candidateBranchFactor: 8,
    retainedStateFactor: 4,
    dedupeStateFactor: 8,
    footprintVariantLimit: 64,
  });
  assert.equal(full.canonical.length, full.seeds.length);
  for (const record of full.canonical) {
    for (const key of ["outputHash", "layoutHash", "selectionHash", "evidenceHash"] as const) {
      assert.match(record[key], /^[0-9a-f]{64}$/);
    }
    assert.ok(record.expansions.total > 0);
    assert.ok(record.expansions.pruning.minimumAreaPruned >= 0);
  }
});

test("bounded baseline is a reproducible subset with the same semantic budget", () => {
  const bounded = readBaseline("bounded.json");
  assert.equal(bounded.schemaVersion, "planlab-stage0-regression-baseline-1");
  assert.equal(bounded.mode, "bounded");
  assert.deepEqual(bounded.budget, readBaseline("full.json").budget);
  assert.deepEqual(bounded.seeds, ["planlab-canonical-01", "planlab-canonical-02"]);
  assert.equal(bounded.canonical.length, 2);
});
