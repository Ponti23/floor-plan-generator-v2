# PlanLab Stage 0 regression benchmark

**Report version:** planlab-stage0-regression-0.1<br>
**Recorded:** 2026-09-14T12:29:53.204Z<br>
**Git HEAD at run:** d6fcc9c329b9701b385a59a1ba30e45c32dcdbc4<br>
**Benchmark input fingerprint:** `f85df394b8572f58e306965e221ae5997fecc52467919329367a78862da4cc2f`<br>
**Overall technical gate:** **PASS**<br>

This report re-runs the historical Stage 0 suite in **bounded** mode. Timing and host data are run evidence; the checked-in regression baseline compares stable result signatures only. The architect usefulness review remains the separate Stage 0 hard gate.

## Method

- Fixed suite: 2 seeds (planlab-canonical-01, planlab-canonical-02).
- Input: the canonical brief generated for each seed; the public generator performs normalization internally.
- Budget (planlab-generator-budget-1): beam width 64; 15,000 expansions/topology; 100 candidates/topology; 300 total candidates.
- Warm-up: 1 unmeasured run before the timed suite.
- Timing: 1 timed generations per seed using Node `performance.now()`; the table reports each seed median and the gate uses all 2 samples. Replay calls verify determinism and are reported separately.
- Percentiles: linear interpolation at p50 and p95 over all 2 measured timings.
- Determinism policy: planlab-generator-determinism-1; diversity: selected-triplet pair distances from planlab-diversity-0.5, with threshold 0.2.
- Provenance: the input fingerprint hashes 26 local benchmark inputs (the runner, package manifest, and every domain module), so it remains authoritative even when Git HEAD is a pre-artifact commit.

## Reference environment

- OS: win32 10.0.26200 (Windows 11 Home) (x64)
- CPU: AMD Ryzen 5 9500F 6-Core Processor              (12 logical cores)
- Runtime: Node v24.21.0 / V8 13.6.233.17-node.53
- Engine: planlab-generator-0.4; rules: planlab-core-2; facts: planlab-metrics-0.6
- Worktree status at start: dirty; full porcelain status is retained in benchmark.json

## Canonical 2-seed evidence

| Seed | Median time (ms) | Candidates / valid | Selected | Min pairwise | Expansions | Replay | Diagnostics |
|---|---:|---:|---:|---:|---:|---|---|
| planlab-canonical-01 | 1767.253 | 300 / 300 | 3 / 3 | 0.255810 | 15,456 | PASS | none |
| planlab-canonical-02 | 1782.292 | 300 / 300 | 3 / 3 | 0.311924 | 15,481 | PASS | none |

Timing summary across 2 measured generations: median **1774.772 ms**; p95 **1781.540 ms**; min 1767.253 ms; max 1782.292 ms.

Selected-triplet distances are recorded in full in `benchmark.json`; all three selected layouts are independently revalidated per seed.

### Expansion counts by topology

| Seed | Straight | L | T | Total |
|---|---:|---:|---:|---:|
| planlab-canonical-01 | 4,746 | 5,193 | 5,517 | 15,456 |
| planlab-canonical-02 | 4,755 | 5,193 | 5,533 | 15,481 |

## Impossible fixtures

| Fixture | Time (ms) | Outcome | Candidates | Expansions | Diagnostics |
|---|---:|---|---:|---:|---|
| envelopeConsumesSite | 0.313 | no layout | 0 | 0 | NORMALIZATION_FAILED: NON_POSITIVE_EXACT_ENVELOPE: opposing offsets leave no positive exact envelope; INFEASIBLE: the brief is infeasible before candidate search |
| roomCannotFitEnvelope | 0.090 | no layout | 0 | 0 | NORMALIZATION_FAILED: ROOM_CANNOT_FIT_ENVELOPE: Impossible Room minimum dimensions/area cannot fit the envelope; INFEASIBLE: the brief is infeasible before candidate search |
| programExceedsInstanceLimit | 0.071 | no layout | 0 | 0 | NORMALIZATION_FAILED: PROGRAM_TOO_LARGE: the V1 solver supports at most 24 generated space instances; INFEASIBLE: the brief is infeasible before candidate search |

Each impossible fixture terminated with a typed normalization diagnostic and zero candidates; no search-budget exhaustion was presented as a proof of impossibility.

## Gate evidence

- Three selected, independently valid layouts for every seed: **PASS**
- Minimum selected-triplet diversity ≥ 0.2: **PASS**
- Byte-equivalent replay for every seed: **PASS**
- Expansion budgets respected: **PASS**
- Same seeded budget reproduces byte-equivalent output: **PASS**
- Median < 2 s: **not applied in bounded mode**
- p95 < 4 s: **not applied in bounded mode**
- All impossible fixtures diagnosed: **PASS**
- Stable regression baseline (artifacts/planlab/milestone-3/benchmark-baselines/bounded.json): **not checked (run with --check)**

## Review artifacts

Crude SVG and text outputs for the first seed are in [`diagnostics/README.md`](diagnostics/README.md). Machine-readable evidence is [`benchmark.json`](benchmark.json).

Historical evidence remains anchored to commit `e1c6f38`; current derived-facts evidence is recorded separately and does not silently rewrite that baseline.

No prototype constants were tuned for this run; the approved generation budget was used unchanged for the selected mode.
