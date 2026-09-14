# PlanLab Milestone 0 feasibility benchmark

**Report version:** planlab-milestone-0-benchmark-0.5<br>
**Recorded:** 2026-09-14T00:28:48.932Z<br>
**Git HEAD at run:** 0dcbde29d3b5c5237e22579c59848e132b95e578<br>
**Benchmark input fingerprint:** `5914900b9515d7825baf0e0f6b4f9a1c4187c91924121aeaefb0efc7eeaf55f4`<br>
**Overall technical gate:** **PASS**<br>

This report covers the Stage 0 technical benchmark only. The architect usefulness review remains the separate Stage 0 hard gate.

## Method

- Fixed suite: exactly 10 seeds (planlab-canonical-01, planlab-canonical-02, planlab-canonical-03, planlab-canonical-04, planlab-canonical-05, planlab-canonical-06, planlab-canonical-07, planlab-canonical-08, planlab-canonical-09, planlab-canonical-10).
- Input: the canonical brief generated for each seed; the public generator performs normalization internally.
- Budget: beam width 64; 15,000 expansions/topology; 100 candidates/topology; 300 total candidates.
- Warm-up: 1 unmeasured run before the timed suite.
- Timing: 3 timed generations per seed using Node `performance.now()`; the table reports each seed median and the gate uses all 30 samples. Replay calls verify determinism and are reported separately.
- Percentiles: linear interpolation at p50 and p95 over all 30 measured timings.
- Diversity: selected-triplet pair distances from planlab-diversity-0.4, with threshold 0.2.
- Provenance: the input fingerprint hashes 18 local benchmark inputs (the runner, package manifest, and every domain module), so it remains authoritative even when Git HEAD is a pre-artifact commit.

## Reference environment

- OS: win32 10.0.26200 (Windows 11 Home) (x64)
- CPU: AMD Ryzen 5 9500F 6-Core Processor              (12 logical cores)
- Runtime: Node v24.21.0 / V8 13.6.233.17-node.53
- Engine: planlab-generator-0.4; rules: planlab-core-2
- Worktree status at start: dirty; full porcelain status is retained in benchmark.json

## Canonical 10-seed evidence

| Seed | Median time (ms) | Candidates / valid | Selected | Min pairwise | Expansions | Replay | Diagnostics |
|---|---:|---:|---:|---:|---:|---|---|
| planlab-canonical-01 | 1905.153 | 300 / 300 | 3 / 3 | 0.395163 | 8,970 | PASS | none |
| planlab-canonical-02 | 1699.111 | 300 / 300 | 3 / 3 | 0.320363 | 6,779 | PASS | none |
| planlab-canonical-03 | 1834.609 | 300 / 300 | 3 / 3 | 0.320363 | 8,921 | PASS | none |
| planlab-canonical-04 | 1814.751 | 300 / 300 | 3 / 3 | 0.395163 | 7,132 | PASS | none |
| planlab-canonical-05 | 1813.412 | 300 / 300 | 3 / 3 | 0.320363 | 8,921 | PASS | none |
| planlab-canonical-06 | 1697.561 | 300 / 300 | 3 / 3 | 0.320363 | 6,779 | PASS | none |
| planlab-canonical-07 | 1792.854 | 300 / 300 | 3 / 3 | 0.321032 | 6,803 | PASS | none |
| planlab-canonical-08 | 1701.750 | 300 / 300 | 3 / 3 | 0.320363 | 6,779 | PASS | none |
| planlab-canonical-09 | 1825.402 | 300 / 300 | 3 / 3 | 0.395163 | 7,132 | PASS | none |
| planlab-canonical-10 | 1890.009 | 300 / 300 | 3 / 3 | 0.321032 | 8,641 | PASS | none |

Timing summary across 30 measured generations: median **1810.531 ms**; p95 **1939.007 ms**; min 1679.031 ms; max 1976.939 ms.

Selected-triplet distances are recorded in full in `benchmark.json`; all three selected layouts are independently revalidated per seed.

### Expansion counts by topology

| Seed | Straight | L | T | Total |
|---|---:|---:|---:|---:|
| planlab-canonical-01 | 4,504 | 2,205 | 2,261 | 8,970 |
| planlab-canonical-02 | 4,175 | 1,285 | 1,319 | 6,779 |
| planlab-canonical-03 | 4,175 | 2,485 | 2,261 | 8,921 |
| planlab-canonical-04 | 4,504 | 1,309 | 1,319 | 7,132 |
| planlab-canonical-05 | 4,175 | 2,485 | 2,261 | 8,921 |
| planlab-canonical-06 | 4,175 | 1,285 | 1,319 | 6,779 |
| planlab-canonical-07 | 4,175 | 1,309 | 1,319 | 6,803 |
| planlab-canonical-08 | 4,175 | 1,285 | 1,319 | 6,779 |
| planlab-canonical-09 | 4,504 | 1,309 | 1,319 | 7,132 |
| planlab-canonical-10 | 4,175 | 2,205 | 2,261 | 8,641 |

## Impossible fixtures

| Fixture | Time (ms) | Outcome | Candidates | Expansions | Diagnostics |
|---|---:|---|---:|---:|---|
| envelopeConsumesSite | 0.180 | no layout | 0 | 0 | NORMALIZATION_FAILED: NON_POSITIVE_EXACT_ENVELOPE: opposing offsets leave no positive exact envelope |
| roomCannotFitEnvelope | 0.047 | no layout | 0 | 0 | NORMALIZATION_FAILED: ROOM_CANNOT_FIT_ENVELOPE: Impossible Room minimum dimensions/area cannot fit the envelope |
| programExceedsInstanceLimit | 0.027 | no layout | 0 | 0 | NORMALIZATION_FAILED: PROGRAM_TOO_LARGE: the prototype supports at most 24 generated space instances |

Each impossible fixture terminated with a typed normalization diagnostic and zero candidates; no search-budget exhaustion was presented as a proof of impossibility.

## Gate evidence

- Three selected, independently valid layouts for every seed: **PASS**
- Minimum selected-triplet diversity ≥ 0.2: **PASS**
- Byte-equivalent replay for every seed: **PASS**
- Expansion budgets respected: **PASS**
- Median < 2 s: **PASS**
- p95 < 4 s: **PASS**
- All impossible fixtures diagnosed: **PASS**

## Review artifacts

Crude SVG and text outputs for the first seed are in [`diagnostics/README.md`](diagnostics/README.md). Machine-readable evidence is [`benchmark.json`](benchmark.json).

No prototype constants were tuned for this run; the approved default generation budget was used unchanged.
