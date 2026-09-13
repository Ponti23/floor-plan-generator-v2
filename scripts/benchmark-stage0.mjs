#!/usr/bin/env node

/**
 * Reproducible Milestone 0 feasibility benchmark.
 *
 * This is intentionally a non-interactive Node script. It runs the one
 * approved canonical brief for exactly ten fixed seeds, replays every seed,
 * exercises every impossible fixture, and writes both machine-readable
 * evidence and crude diagnostic artifacts for review.
 */

import { createHash } from "node:crypto";
import { cpus, EOL, platform, release, version as osVersion } from "node:os";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  DEFAULT_DIVERSITY_THRESHOLD,
  DEFAULT_GENERATION_BUDGET,
  GENERATOR_ENGINE_VERSION,
  GENERATOR_RULE_VERSION,
  IMPOSSIBLE_FIXTURES,
  createCanonicalProject,
  createCrudeDiagnostic,
  generateLayouts,
  normalizeProject,
  validateLayout,
} from "../src/domain/index.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = resolve(REPO_ROOT, "artifacts", "planlab", "milestone-0");
const DIAGNOSTIC_ROOT = resolve(OUTPUT_ROOT, "diagnostics");

// Keep this list literal and versioned. The benchmark gate is intentionally
// not allowed to drift by deriving seeds from the clock or from randomness.
export const CANONICAL_BENCHMARK_SEEDS = Object.freeze([
  "planlab-canonical-01",
  "planlab-canonical-02",
  "planlab-canonical-03",
  "planlab-canonical-04",
  "planlab-canonical-05",
  "planlab-canonical-06",
  "planlab-canonical-07",
  "planlab-canonical-08",
  "planlab-canonical-09",
  "planlab-canonical-10",
]);

const SUITE_VERSION = "planlab-stage0-seed-suite-0.4";
const REPORT_VERSION = "planlab-milestone-0-benchmark-0.4";
const TIMING_TARGETS_MS = Object.freeze({ median: 2_000, p95: 4_000 });

function round(value, places = 3) {
  const rounded = Number(value.toFixed(places));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  const weight = position - lower;
  return ordered[lower] + (ordered[upper] - ordered[lower]) * weight;
}

/** Stable JSON used for replay hashes and byte-equivalence checks. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

function diagnosticSummary(result) {
  return result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.topology === undefined ? {} : { topology: diagnostic.topology }),
    ...(diagnostic.footprintVariant === undefined ? {} : { footprintVariant: diagnostic.footprintVariant }),
    ...(diagnostic.expandedStates === undefined ? {} : { expandedStates: diagnostic.expandedStates }),
    ...(diagnostic.violations === undefined ? {} : { violations: diagnostic.violations }),
  }));
}

function expansionSummary(result) {
  return {
    total: result.metadata.expandedStates,
    perTopology: { ...result.metadata.topologyExpansions },
    validCandidatesPerTopology: { ...result.metadata.topologyCounts },
  };
}

function selectedSummary(result, project) {
  return result.selection.selected.map((item) => ({
    strategy: item.strategy,
    label: item.label,
    layoutId: item.layout.id,
    valid: validateLayout(item.layout, project).valid,
    overallScore: item.scorecard.overallScore,
    overallUtility: item.scorecard.overallUtility,
    topology: item.layout.metadata.topology,
    footprintVariant: item.layout.metadata.footprintVariant,
  }));
}

function makeCanonicalRecord(seed, budget) {
  const project = createCanonicalProject(seed);
  const start = performance.now();
  const result = generateLayouts(project, { seed, budget });
  const elapsedMs = performance.now() - start;

  const replayStart = performance.now();
  const replay = generateLayouts(createCanonicalProject(seed), { seed, budget });
  const replayElapsedMs = performance.now() - replayStart;
  const firstBytes = stableJson(result);
  const replayBytes = stableJson(replay);

  // The result contains normalized geometry but intentionally does not carry a
  // project reference. Recreate the normalized brief once, outside timing.
  const normalizedProject = normalizeProject(project);
  const validLayouts = result.layouts.filter((layout) => validateLayout(layout, normalizedProject).valid);
  const validSelected = result.selection.layouts.filter((layout) => validateLayout(layout, normalizedProject).valid);
  const pairwiseDistances = result.selection.pairwiseDistances.map((pair) => ({
    a: pair.a,
    b: pair.b,
    distance: round(pair.distance, 6),
    diverse: pair.diverse,
  }));
  const minimumPairwiseDistance = pairwiseDistances.length > 0
    ? Math.min(...pairwiseDistances.map((pair) => pair.distance))
    : null;

  return {
    seed,
    elapsedMs: round(elapsedMs),
    replayElapsedMs: round(replayElapsedMs),
    deterministic: firstBytes === replayBytes,
    outputHash: sha256(firstBytes),
    replayHash: sha256(replayBytes),
    ok: result.ok,
    candidateCount: result.layouts.length,
    independentlyValidCandidateCount: validLayouts.length,
    selectedCount: result.selection.layouts.length,
    independentlyValidSelectedCount: validSelected.length,
    selectionStatus: result.selection.status,
    selectionComplete: result.selection.complete,
    selectionReason: result.selection.reason ?? null,
    diversityThreshold: result.selection.threshold,
    minimumSelectedPairwiseDistance: minimumPairwiseDistance,
    selectedPairwiseDistances: pairwiseDistances,
    expansions: expansionSummary(result),
    diagnostics: diagnosticSummary(result),
    selected: selectedSummary(result, normalizedProject),
    rawResult: result,
    normalizedProject,
  };
}

function makeImpossibleRecord(name, fixture) {
  const seed = fixture.generation.seed;
  const start = performance.now();
  const result = generateLayouts(fixture, { seed });
  const elapsedMs = performance.now() - start;
  return {
    fixture: name,
    seed,
    elapsedMs: round(elapsedMs),
    ok: result.ok,
    candidateCount: result.layouts.length,
    selectedCount: result.selection.layouts.length,
    expansions: expansionSummary(result),
    diagnostics: diagnosticSummary(result),
  };
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function writeDiagnosticArtifacts(record) {
  const directory = DIAGNOSTIC_ROOT;
  mkdirSync(directory, { recursive: true });
  const artifactRows = [];
  for (const item of record.rawResult.selection.selected) {
    const stem = `canonical-${safeName(record.seed)}-${safeName(item.strategy)}`;
    const diagnostic = createCrudeDiagnostic(item.layout, record.normalizedProject);
    writeFileSync(resolve(directory, `${stem}.svg`), `${diagnostic.svg}${EOL}`, "utf8");
    writeFileSync(resolve(directory, `${stem}.txt`), `${diagnostic.text}${EOL}`, "utf8");
    artifactRows.push({
      strategy: item.strategy,
      layoutId: item.layout.id,
      // The index itself lives inside diagnostics/, so links are relative to
      // that directory rather than repeating the directory component.
      svg: `${stem}.svg`,
      text: `${stem}.txt`,
    });
  }
  writeFileSync(resolve(directory, "README.md"), [
    "# Milestone 0 crude diagnostic artifacts",
    "",
    `These artifacts are the three selected layouts for the first measured seed, **${record.seed}**.`,
    "They are a direct projection of authoritative grid rectangles and portals; they are not a polished UI or construction drawing.",
    "",
    "| Strategy | Layout | SVG | Text evidence |",
    "|---|---|---|---|",
    ...artifactRows.map((row) => `| ${row.strategy} | ${row.layoutId} | [SVG](${row.svg}) | [text](${row.text}) |`),
    "",
  ].join(EOL), "utf8");
}

function pass(value) {
  return value ? "PASS" : "FAIL";
}

function formatNumber(value, digits = 3) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
}

function makeMarkdownReport(benchmark) {
  const canonical = benchmark.canonical;
  const summary = benchmark.summary;
  const lines = [
    "# PlanLab Milestone 0 feasibility benchmark",
    "",
    `**Report version:** ${benchmark.reportVersion}<br>`,
    `**Recorded:** ${benchmark.recordedAt}<br>`,
    `**Source revision at run:** ${benchmark.environment.sourceRevision}<br>`,
    `**Overall technical gate:** **${benchmark.gate.pass ? "PASS" : "FAIL"}**<br>`,
    "",
    "This report covers bucket 0.4 only. The architect usefulness review remains the separate Stage 0 hard gate.",
    "",
    "## Method",
    "",
    `- Fixed suite: exactly ${benchmark.methodology.seedCount} seeds (${benchmark.methodology.seeds.join(", ")}).`,
    `- Input: the canonical brief generated for each seed; the public generator performs normalization internally.`,
    `- Budget: beam width ${benchmark.methodology.budget.beamWidth}; ${benchmark.methodology.budget.maxExpansionsPerTopology.toLocaleString()} expansions/topology; ${benchmark.methodology.budget.maxCandidatesPerTopology} candidates/topology; ${benchmark.methodology.budget.maxTotalCandidates} total candidates.`,
    `- Warm-up: ${benchmark.methodology.warmupRuns} unmeasured run before the timed suite.`,
    `- Timing: one timed generation per seed using Node \`performance.now()\`; replay calls verify determinism and are reported separately, not included in the latency summary.`,
    `- Percentiles: linear interpolation at p50 and p95 over the ten measured seed timings.`,
    `- Diversity: selected-triplet pair distances from ${benchmark.methodology.diversityVersion}, with threshold ${benchmark.methodology.diversityThreshold}.`,
    "",
    "## Reference environment",
    "",
    `- OS: ${benchmark.environment.os} (${benchmark.environment.arch})` ,
    `- CPU: ${benchmark.environment.cpuModel} (${benchmark.environment.logicalCores} logical cores)`,
    `- Runtime: Node ${benchmark.environment.node} / V8 ${benchmark.environment.v8}`,
    `- Engine: ${benchmark.engineVersion}; rules: ${benchmark.ruleVersion}`,
    "",
    "## Canonical 10-seed evidence",
    "",
    "| Seed | Time (ms) | Candidates / valid | Selected | Min pairwise | Expansions | Replay | Diagnostics |",
    "|---|---:|---:|---:|---:|---:|---|---|",
    ...canonical.map((record) => `| ${record.seed} | ${formatNumber(record.elapsedMs)} | ${record.candidateCount} / ${record.independentlyValidCandidateCount} | ${record.selectedCount} / ${record.independentlyValidSelectedCount} | ${formatNumber(record.minimumSelectedPairwiseDistance, 6)} | ${record.expansions.total.toLocaleString()} | ${pass(record.deterministic)} | ${record.diagnostics.length === 0 ? "none" : record.diagnostics.map((item) => item.code).join(", ")} |`),
    "",
    `Timing summary: median **${formatNumber(summary.medianMs)} ms**; p95 **${formatNumber(summary.p95Ms)} ms**; min ${formatNumber(summary.minimumMs)} ms; max ${formatNumber(summary.maximumMs)} ms.`,
    "",
    "Selected-triplet distances are recorded in full in `benchmark.json`; all three selected layouts are independently revalidated per seed.",
    "",
    "### Expansion counts by topology",
    "",
    "| Seed | Straight | L | T | Total |",
    "|---|---:|---:|---:|---:|",
    ...canonical.map((record) => `| ${record.seed} | ${record.expansions.perTopology.straight.toLocaleString()} | ${record.expansions.perTopology.L.toLocaleString()} | ${record.expansions.perTopology.T.toLocaleString()} | ${record.expansions.total.toLocaleString()} |`),
    "",
    "## Impossible fixtures",
    "",
    "| Fixture | Time (ms) | Outcome | Candidates | Expansions | Diagnostics |",
    "|---|---:|---|---:|---:|---|",
    ...benchmark.impossibleFixtures.map((record) => `| ${record.fixture} | ${formatNumber(record.elapsedMs)} | ${record.ok ? "unexpected valid result" : "no layout"} | ${record.candidateCount} | ${record.expansions.total.toLocaleString()} | ${record.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ")} |`),
    "",
    "Each impossible fixture terminated with a typed normalization diagnostic and zero candidates; no search-budget exhaustion was presented as a proof of impossibility.",
    "",
    "## Gate evidence",
    "",
    `- Three selected, independently valid layouts for every seed: **${pass(benchmark.gate.threeValidLayoutsPerSeed)}**`,
    `- Minimum selected-triplet diversity ≥ ${benchmark.methodology.diversityThreshold}: **${pass(benchmark.gate.diversityThreshold)}**`,
    `- Byte-equivalent replay for every seed: **${pass(benchmark.gate.determinism)}**`,
    `- Expansion budgets respected: **${pass(benchmark.gate.expansionBudget)}**`,
    `- Median < ${TIMING_TARGETS_MS.median / 1000} s: **${pass(benchmark.gate.medianRuntime)}**`,
    `- p95 < ${TIMING_TARGETS_MS.p95 / 1000} s: **${pass(benchmark.gate.p95Runtime)}**`,
    `- All impossible fixtures diagnosed: **${pass(benchmark.gate.impossibleFixtures)}**`,
    "",
    "## Review artifacts",
    "",
    "Crude SVG and text outputs for the first seed are in [`diagnostics/README.md`](diagnostics/README.md). Machine-readable evidence is [`benchmark.json`](benchmark.json).",
    "",
    "No prototype constants were tuned for this run; the approved default generation budget was used unchanged.",
  ];
  return lines.join(EOL);
}

function main() {
  if (CANONICAL_BENCHMARK_SEEDS.length !== 10) {
    throw new Error("canonical benchmark suite must contain exactly 10 fixed seeds");
  }
  mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });

  const budget = { ...DEFAULT_GENERATION_BUDGET };
  // Warm the module/JIT path with an existing suite seed without adding an
  // unlisted seed to the benchmark's canonical input set.
  const warmupSeed = CANONICAL_BENCHMARK_SEEDS[0];
  generateLayouts(createCanonicalProject(warmupSeed), { seed: warmupSeed, budget });

  const canonicalRecords = CANONICAL_BENCHMARK_SEEDS.map((seed) => makeCanonicalRecord(seed, budget));
  const firstRecord = canonicalRecords[0];
  if (firstRecord) writeDiagnosticArtifacts(firstRecord);

  const impossibleRecords = Object.entries(IMPOSSIBLE_FIXTURES)
    .map(([name, fixture]) => makeImpossibleRecord(name, fixture));
  const timings = canonicalRecords.map((record) => record.elapsedMs);
  const medianMs = percentile(timings, 0.5);
  const p95Ms = percentile(timings, 0.95);
  const threshold = DEFAULT_DIVERSITY_THRESHOLD;
  const threeValidLayoutsPerSeed = canonicalRecords.every((record) =>
    record.ok && record.selectionComplete && record.selectedCount === 3 &&
    record.independentlyValidSelectedCount === 3 && record.independentlyValidCandidateCount === record.candidateCount,
  );
  const diversityThreshold = canonicalRecords.every((record) =>
    record.minimumSelectedPairwiseDistance !== null &&
    record.minimumSelectedPairwiseDistance >= threshold &&
    record.selectedPairwiseDistances.length === 3 &&
    record.selectedPairwiseDistances.every((pair) => pair.diverse),
  );
  const determinism = canonicalRecords.every((record) => record.deterministic);
  const expansionBudget = canonicalRecords.every((record) =>
    Object.values(record.expansions.perTopology).every((count) => count <= budget.maxExpansionsPerTopology) &&
    record.expansions.total <= budget.maxExpansionsPerTopology * 3,
  );
  const impossibleFixtures = impossibleRecords.length === Object.keys(IMPOSSIBLE_FIXTURES).length &&
    impossibleRecords.every((record) => !record.ok && record.candidateCount === 0 &&
      record.diagnostics.length > 0 && record.diagnostics.every((item) => item.code === "NORMALIZATION_FAILED"));

  const benchmark = {
    reportVersion: REPORT_VERSION,
    suiteVersion: SUITE_VERSION,
    recordedAt: new Date().toISOString(),
    engineVersion: GENERATOR_ENGINE_VERSION,
    ruleVersion: GENERATOR_RULE_VERSION,
    environment: {
      sourceRevision: gitValue(["rev-parse", "HEAD"]),
      workingTreeStatus: gitValue(["status", "--short"]),
      os: `${platform()} ${release()}${osVersion() ? ` (${osVersion()})` : ""}`,
      arch: process.arch,
      cpuModel: cpus()[0]?.model ?? "unavailable",
      logicalCores: cpus().length,
      node: process.version,
      v8: process.versions.v8,
      cwd: process.cwd(),
    },
    methodology: {
      seedSuiteVersion: SUITE_VERSION,
      seedCount: CANONICAL_BENCHMARK_SEEDS.length,
      seeds: [...CANONICAL_BENCHMARK_SEEDS],
      warmupRuns: 1,
      timedRuns: canonicalRecords.length,
      replayRuns: canonicalRecords.length,
      input: "createCanonicalProject(seed), passed to generateLayouts with the explicit seed",
      timingClock: "node:perf_hooks performance.now",
      replayComparison: "stable-key JSON of the complete GenerationResult",
      budget,
      diversityVersion: "planlab-diversity-0.3",
      diversityThreshold: threshold,
      percentileMethod: "linear interpolation over sorted ten-sample timings",
      timingTargetsMs: { ...TIMING_TARGETS_MS },
    },
    summary: {
      medianMs: round(medianMs),
      p95Ms: round(p95Ms),
      minimumMs: round(Math.min(...timings)),
      maximumMs: round(Math.max(...timings)),
    },
    gate: {
      threeValidLayoutsPerSeed,
      diversityThreshold,
      determinism,
      expansionBudget,
      medianRuntime: medianMs < TIMING_TARGETS_MS.median,
      p95Runtime: p95Ms < TIMING_TARGETS_MS.p95,
      impossibleFixtures,
      pass: threeValidLayoutsPerSeed && diversityThreshold && determinism && expansionBudget &&
        medianMs < TIMING_TARGETS_MS.median && p95Ms < TIMING_TARGETS_MS.p95 && impossibleFixtures,
    },
    canonical: canonicalRecords.map(({ rawResult, normalizedProject, ...record }) => record),
    impossibleFixtures: impossibleRecords,
    artifacts: {
      diagnosticIndex: "diagnostics/README.md",
      firstSeed: firstRecord?.seed ?? null,
      benchmarkJson: "benchmark.json",
    },
  };

  writeFileSync(resolve(OUTPUT_ROOT, "benchmark.json"), `${JSON.stringify(benchmark, null, 2)}${EOL}`, "utf8");
  writeFileSync(resolve(OUTPUT_ROOT, "benchmark.md"), `${makeMarkdownReport(benchmark)}${EOL}`, "utf8");
  process.stdout.write(`${JSON.stringify({
    report: relative(REPO_ROOT, resolve(OUTPUT_ROOT, "benchmark.md")),
    json: relative(REPO_ROOT, resolve(OUTPUT_ROOT, "benchmark.json")),
    gate: benchmark.gate,
    medianMs: benchmark.summary.medianMs,
    p95Ms: benchmark.summary.p95Ms,
  }, null, 2)}${EOL}`);
  if (!benchmark.gate.pass) process.exitCode = 1;
}

main();
