# PlanLab Milestone 0 feasibility benchmark

**Report version:** planlab-milestone-0-benchmark-0.4<br>
**Recorded:** 2026-09-13T15:47:23.902Z<br>
**Source revision at run:** d89814f56a85ee70c7810c5c492eac8707023d8d<br>
**Overall technical gate:** **PASS**<br>

This report covers bucket 0.4 only. The architect usefulness review remains the separate Stage 0 hard gate.

## Method

- Fixed suite: exactly 10 seeds (planlab-canonical-01, planlab-canonical-02, planlab-canonical-03, planlab-canonical-04, planlab-canonical-05, planlab-canonical-06, planlab-canonical-07, planlab-canonical-08, planlab-canonical-09, planlab-canonical-10).
- Input: the canonical brief generated for each seed; the public generator performs normalization internally.
- Budget: beam width 64; 15,000 expansions/topology; 100 candidates/topology; 300 total candidates.
- Warm-up: 1 unmeasured run before the timed suite.
- Timing: one timed generation per seed using Node `performance.now()`; replay calls verify determinism and are reported separately, not included in the latency summary.
- Percentiles: linear interpolation at p50 and p95 over the ten measured seed timings.
- Diversity: selected-triplet pair distances from planlab-diversity-0.3, with threshold 0.2.

## Reference environment

- OS: win32 10.0.26200 (Windows 11 Home) (x64)
- CPU: AMD Ryzen 5 9500F 6-Core Processor              (12 logical cores)
- Runtime: Node v24.21.0 / V8 13.6.233.17-node.53
- Engine: planlab-generator-0.2; rules: planlab-core-1

## Canonical 10-seed evidence

| Seed | Time (ms) | Candidates / valid | Selected | Min pairwise | Expansions | Replay | Diagnostics |
|---|---:|---:|---:|---:|---:|---|---|
| planlab-canonical-01 | 1945.245 | 300 / 300 | 3 / 3 | 0.395163 | 8,970 | PASS | none |
| planlab-canonical-02 | 1701.558 | 300 / 300 | 3 / 3 | 0.227451 | 6,779 | PASS | none |
| planlab-canonical-03 | 1829.608 | 300 / 300 | 3 / 3 | 0.227451 | 8,921 | PASS | none |
| planlab-canonical-04 | 1796.773 | 300 / 300 | 3 / 3 | 0.395163 | 7,132 | PASS | none |
| planlab-canonical-05 | 1790.429 | 300 / 300 | 3 / 3 | 0.227451 | 8,921 | PASS | none |
| planlab-canonical-06 | 1693.287 | 300 / 300 | 3 / 3 | 0.227451 | 6,779 | PASS | none |
| planlab-canonical-07 | 1723.857 | 300 / 300 | 3 / 3 | 0.323788 | 6,803 | PASS | none |
| planlab-canonical-08 | 1708.145 | 300 / 300 | 3 / 3 | 0.227451 | 6,779 | PASS | none |
| planlab-canonical-09 | 1764.242 | 300 / 300 | 3 / 3 | 0.395163 | 7,132 | PASS | none |
| planlab-canonical-10 | 1890.835 | 300 / 300 | 3 / 3 | 0.323788 | 8,641 | PASS | none |

Timing summary: median **1777.336 ms**; p95 **1920.760 ms**; min 1693.287 ms; max 1945.245 ms.

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
| envelopeConsumesSite | 0.188 | no layout | 0 | 0 | NORMALIZATION_FAILED: NON_POSITIVE_EXACT_ENVELOPE: opposing offsets leave no positive exact envelope |
| roomCannotFitEnvelope | 0.046 | no layout | 0 | 0 | NORMALIZATION_FAILED: ROOM_CANNOT_FIT_ENVELOPE: Impossible Room minimum dimensions/area cannot fit the envelope |
| programExceedsInstanceLimit | 0.031 | no layout | 0 | 0 | NORMALIZATION_FAILED: PROGRAM_TOO_LARGE: the prototype supports at most 24 generated space instances |

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
