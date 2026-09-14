# Stage 3 gate — amendment record (D1–D4)

**Decision owner:** architect/user. **Recorded:** 2026-09-14.

The gate brief asked five questions. The user answered D1 by directing a change, and asked for the
same treatment on the decisions that were really engineering questions with a product tail: do the
work where it is contained, and keep every value settable later rather than hard-coded. D5
(push) remains unanswered.

## D1 — Mathematical usefulness: **redirect, implemented**

The finding that forced this: the approved canonical brief declared a minimum **area** for the
bathroom, kitchen, living room and laundry, and no minimum **short side**. The engine enforced
whatever the brief declared — including the record that `DimensionConstraintsMm` already carries
`minShortSideMm`, `preferredAreaMm2` and `maxAspectRatio`, and that the bedroom already used
`minShortSideMm: 3_000` — so seed 01 passed hard validity with a **7.00 × 0.75 m bathroom** that
satisfies a 5 m² minimum exactly.

The gate brief's framing ("adding preferred areas is a scoring-language decision") understated the
problem in one direction and overstated it in another: no new engine capability was needed, but two
separate defects were present.

| Defect | Cause | Fix |
|---|---|---|
| 0.75 m-wide bathroom; 1.50 × 8.50 m kitchen | No minimum short side on four room types | `ROOM_SHAPE_POLICY` in `src/domain/constants.ts`, expanded into ordinary brief data by `src/domain/fixtures.ts` |
| 31.5 / 28.8 / 13.5 m² interchangeable bedrooms | The generator divided free area **equally** and ignored `preferredAreaUnits2` entirely, so early rooms absorbed the surplus later rooms never saw | `src/domain/generator.ts` now divides in proportion to declared preference, and never past what the later rooms' minimums require |

The `maxAspectRatio` guard is what makes the change general rather than a list of numbers: a room may
not be corridor-shaped even if its area and short side are satisfied. No room type needs to be
enumerated for the guard to bite.

### Approved policy

| Room | Min area | Min short side | Preferred area | Max aspect |
|---|---|---|---|---|
| Bedroom | 10 m² | 3.00 m | 16 m² | 2.0 |
| Bathroom | 5 m² | 1.50 m | 10 m² | 2.0 |
| Kitchen | 12 m² | 3.00 m | 24 m² | 2.0 |
| Living Room | 20 m² | 3.00 m | 34 m² | 2.0 |
| Laundry | 5 m² | 1.50 m | 8 m² | 2.0 |
| Garage | 36 m² | — | — | unchanged (6.00 × 6.00 preset) |

Every value is authored brief data on a `RoomRequirement`, so the future brief editor changes them
without touching the generator, the validator, or the calibration surface. That is the "set it
later" requirement.

### Effect on seed 01

| | Before | After |
|---|---|---|
| Bathroom | 1.75 × 3.75 / **0.75 × 7.00** / 1.50 × 3.50 | 3.00 × 3.75 / 3.00 × 5.00 / 3.00 × 3.75 |
| Bedrooms | 35.0 / 27.0 / 10.6 m² | 18.0 / 18.0 / 18.0 m² (compact, balanced) |
| Living room | 3.00 × 9.00 (3.00 × 12.00) | 6.00 × 6.00 |
| Kitchen | 3.25 × 3.75 / **1.50 × 8.50** | 6.00 × 3.00 |
| Scores | 82 / 77 / 81 | 81 / 79 / 83 |
| Selection | 3/3 complete | 3/3 complete |

Eight of ten seeds selected only two options when the generator was first switched to target the
preferred area exactly; proportional allocation restored 10/10 complete while keeping the balanced
room sizes.

### Cost, stated honestly

The constrained packing problem is genuinely harder to search: expansions per seed rose from
**6,779 → 15,456**, and the full gate's median went from **904 ms → 1,750 ms**. The approved targets
(median < 2,000 ms, p95 < 4,000 ms, 20,000 expansions) are still met, but the median margin dropped
from ~55% to ~13%. Two behaviour-preserving search optimisations landed with it (`frontierLength`
now takes a transit predicate; the skeleton/placed space list is built once per expansion instead of
once per candidate rectangle) and were verified to leave every layout id, score and expansion count
byte-identical.

The 15,456 expansions sit close to the 20,000 cap. Any further increase in room-shape strictness
should be measured against both the timing and expansion gates before it is adopted.

## D2 and D3 — scoring language and tuning: **approved as default, now settable**

The approved `planlab-calibration-0.1` stays the default and an unconfigured run is bit-identical to
the reviewed surface. `resolveCalibrationSurface(overrides)` in `src/domain/calibration.ts` is the
edit seam: category weights, metric breakpoints, `shortlistSize`, the diversity threshold and the
explanation limit are all reachable without a source change, a derived surface is labelled
`${base.version}+custom` so it never claims the approved version, unsafe edits are rejected with a
`RangeError`, and `StrategyTradeoffDescriptor` copies are re-derived so an edited profile is never
explained by stale numbers.

Hard validity is out of reach by construction: `test/calibration-overrides.test.ts` pins that a
hostile calibration (weights of 0/1, a 0.95 diversity threshold, a 100× selection bonus) moves
ranking and selection while every candidate keeps its verdict and its violation set.

`shortlistSize` stays **24** and the breakpoints stay as recorded. Both are now a data change rather
than a code change, but every such change moves selected triplets.

## D4 — Stage 0 evidence shape: **resolved by projection, not by deletion**

Measured on the canonical run:

| Payload | Size |
|---|---|
| Full `GenerationResult` | **324.6 MB** |
| `analyses` with derived facts | 233 MB |
| Derived facts alone (47 keys) | 90.4 MB |
| Layouts | **0.9 MB** |
| Selection | 0.3 MB |

The plans are 0.9 MB and the recomputable derived indexes are 99.6% of the bytes. Rather than delete
evidence from the domain, `src/domain/resultPayload.ts` defines an explicit projection:
`serializeGenerationResult` keeps layouts, selection, diagnostics, metadata, per-candidate scorecards
and explanations, and drops the derived geometry indexes. The in-memory result is unchanged, so a
review that needs the full indexes still has them through `serializeCanonical(result)`.

**Reduced resolution, stated plainly.** `evidenceHash` in the benchmark now hashes facts/metric/
scorecard **keys** and `factsVersion` rather than every value, so it still detects a derived-schema
change but no longer detects a silent change to an individual derived value that leaves the layouts
byte-identical. The previous full-result byte-identity check remains available and the `deterministic`
gate still compares the full serialization, so replay equivalence is still proven; a future review
that needs value-level derived drift detection must use `serializeCanonical(result)` explicitly.

The Stage 0 `outputHash` baselines were re-recorded. They are now hashes of the semantic payload,
which is the shape Milestone 4 should actually send across a worker boundary.

## D5 — push: **still open**

`main` is 56 commits ahead of `origin/main` and nothing has been pushed since Stage 1. No decision was
given, so nothing was pushed.

## Verification at this record

- `npm test` **136 passing** (122 before this amendment; +4 room-shape policy, +7 calibration
  overrides, +3 result payload).
- `npm run typecheck` 0 errors.
- `npm run diagnostics:canonical -- --check` clean; canonical project fingerprint
  `sha256:8efe5b5e…`.
- `npm run benchmark:stage0:check` **`baselineMatch: true`**, every gate line PASS, median
  **1,749.5 ms**, p95 **1,831.1 ms** on a quiet machine.
- `node scripts/benchmark-stage0.mjs --record-baseline` (full) median **1,786.9 ms**; the bounded
  record wrote **1,774.8 ms**.
- The room-shape tests were mutation-checked: relaxing the bedroom aspect cap to 10 and off broke
  three of the four.
