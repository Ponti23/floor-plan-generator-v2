# Stage 3 hard gate — decision brief

**State:** `main` @ `cf31d93` — clean tree. `npm test` 122 passing, `npm run typecheck` 0 errors,
`npm run diagnostics:canonical -- --check` clean, Stage 0 regression gate **PASS**.

**Decision owner:** architect/user. This brief prepares the decision; it does not claim it. The
3.5 review deliberately left it untouched (`validation-review.md`).

**What it unblocks:** Milestone 4 (worker vertical slice) and every polished UI task after it.
Nothing in `knowledge/planlab/IMPLEMENTATION_PLAN.md` past Milestone 3 is staged until this closes.

## The two approvals requested

1. **Mathematical usefulness.** Is the constrained layout class — one rectangular ~180 m²
   footprint, integer 250 mm grid, abstract portals, two-car garage on the south frontage, transit
   only through entry/circulation and policy-approved rooms — producing plans an architect would
   accept as a starting point? Judge this from the crude renderings for seed 01 in
   [`diagnostics/`](diagnostics/README.md) (`*.svg`, `*.txt`).
2. **Scoring language.** Are the five categories, their breakpoints, the three profile weightings,
   the diversity threshold, and the explanation/false-precision policy the language the product
   should speak? All of it is frozen, validated, inspectable domain data in
   `src/domain/calibration.ts` (`planlab-calibration-0.1`) and `src/domain/metrics.ts`
   (`planlab-scoring-0.6`).

## Evidence at this commit

| Claim | Evidence |
|---|---|
| Three valid, diverse layouts per seed | 10/10 seeds, 3/3 selected, minimum selected-pair distance 0.32 against the 0.20 threshold |
| Runtime inside the approved targets | median **903.7 ms** / p95 **1153.1 ms** (record run); **817.4 / 1038.6 ms** on immediate `--check`; targets < 2000 / < 4000 ms |
| Reproducible output | byte-equivalent replay per seed, equal hashes across two processes, budgets respected |
| Impossible briefs fail honestly | typed normalization diagnostics, zero candidates, no budget exhaustion presented as proof of impossibility |
| Validity is independent of strategy | 300/300 candidates valid; calibration changes desirability only, never a hard verdict |

Full numbers: [`benchmark.md`](benchmark.md), [`benchmark.json`](benchmark.json),
[`determinism-regression.md`](determinism-regression.md), [`pruning-oracle.json`](pruning-oracle.json).

## What is being approved

Category weights (fractions, each profile sums to 1 — `planlab-calibration-0.1`):

| Strategy | Program & Space | Flow | Relationships | Liveability | Services & Site |
|---|---:|---:|---:|---:|---:|
| Compact Efficiency | 0.40 | 0.20 | 0.15 | 0.10 | 0.15 |
| Best Flow | 0.15 | 0.40 | 0.25 | 0.15 | 0.05 |
| Balanced | 0.25 | 0.25 | 0.20 | 0.20 | 0.10 |

Diversity and explanation constants: threshold **0.20**, component weights adjacency 0.45 /
centroid 0.35 / footprint 0.10 / circulation 0.10, selection diversity bonus 0.50, shortlist size
**24** of a 300-candidate pool, explanation limit 10.

Metric breakpoints (`METRIC_CONFIG`): preferred area plateaus at 1.0 and declines to 0 at **2.0×**
preferred (oversize tolerance 1.15); aspect utility 1.0 at ≤ 1.5 and 0 at **3.0**; circulation
ratio target 0.15, unacceptable 0.35; near target 12 units (3 m); exterior target 12 units;
route-distance target 48 units (12 m); strong-observation cutoff 0.75, weak 0.45.

Policy: hard rules stay hard, invalid geometry is never rescued by a score, scores display as whole
numbers with raw evidence beside them, no compliance percentage, no "optimal"/"accessible" claims
that the metric does not support.

## What seed 01 actually produced

Selected triplet: `layout-L-footprint-48x60-171` (Compact Efficiency, 82), `layout-L-footprint-48x60-117`
(Best Flow, 77), `layout-straight-footprint-40x72-26` (Balanced, 80). Selected-pair distances
0.320 / 0.537 / 0.547. Both an L and a straight topology survive, so the triplet is not one
box-packing solution relabelled.

Rects that bear on the usefulness judgement (metres, 250 mm grid):

| Space | L-171 (Compact) | L-117 (Best Flow) | Straight-26 (Balanced) |
|---|---|---|---|
| Footprint | 12.00 × 15.00 | 12.00 × 15.00 | 10.00 × 18.00 |
| Living | 3.00 × 9.00 | 3.00 × 9.00 | 3.00 × 12.00 |
| Bedroom 1 | 5.00 × 7.00 (35 m²) | 5.00 × 7.00 (35 m²) | 3.00 × 5.00 (15 m²) |
| Bedroom 2 | 3.00 × 9.00 (27 m²) | 3.00 × 9.00 (27 m²) | 3.00 × 13.00 (39 m²) |
| Bedroom 3 | 3.25 × 3.25 | 3.25 × 3.25 | 3.00 × 3.50 |
| Kitchen | 3.25 × 3.75 | 3.25 × 3.75 | 1.50 × 8.50 |
| Bathroom | 1.75 × 3.75 | **0.75 × 7.00** | 1.50 × 3.50 |
| Laundry | 1.75 × 3.25 | 1.00 × 7.00 | 1.50 × 5.00 |
| Circulation | 1.00 m wide (3 segments) | 1.00 m wide (3 segments) | 1.00 m wide |

GFA 180.00 m² (target Δ 0.00), unallocated interior 0.0%, no hard findings, 8/8 required rooms
reachable, 0 dead ends, 11–13 portals.

## Observations that bear on the decision (not defects)

1. **The preferred-area metric is inert on the canonical brief.** No room in `src/domain/fixtures.ts`
   declares `preferredAreaMm2`, and `evaluateLayoutMetrics` only scores rooms that do. Oversize room
   area is therefore penalised only through aspect ratio — which is why a 39 m² bedroom and a
   0.75 m × 7.00 m bathroom pass while `programSpace` still reports 85–92/100. Adding preferred
   areas to the brief (or defaulting them) is a scoring-language decision, not a bug fix.
2. **Hard validity has no per-room minimum short side.** Only the garage (6.00 × 6.00), the
   circulation width (1.00 m), and portal widths carry hard minimum dimensions; the bathroom and
   laundry carry area minimums only. A 750 mm-wide bathroom is geometrically valid today. Tightening
   that is a product/brief decision and moves selected triplets.
3. **Leftover area concentrates in the largest rooms.** Rooms are pushed to their minimum
   dimension while one or two rooms absorb the remainder (35/27/10.6 m² for three interchangeable
   bedrooms in L-171). This is the box-packing pathology the Milestone 0 gate asked an architect to
   judge.
4. **Rounded scores barely separate the triplet.** 82/77/81, 82/77/80, 81/77/80 — a one-point
   spread over raw utilities 0.8228 / 0.7750 / 0.8013. The spec's rule (compare qualitatively when
   two displayed scores round to the same value) is exercised by the canonical seed rather than
   being hypothetical.
5. **The profiles differ only by weights, by proof.** Ranking differences between strategies are
   therefore small by construction; the triplet comes from three separate strategy pools, not from
   three different search policies. If the product needs more separation, that is a strategy-model
   change, not a calibration tweak.
6. **Untaken tuning headroom.** Selection now costs ~56 ms, so `shortlistSize` (24 of 300) and the
   metric breakpoints are cheap to revisit — but every change moves selected triplets, which is why
   it belongs to this gate.
7. **The search is a heuristic, not a completeness proof.** The minimum-area cut is admissible and
   oracle-certified; the frontier cut is not. Disabling it (a temporary mutation run in the 3.5
   review) changed the found design set on all ten seeds while every candidate stayed hard-valid —
   for example seed 01: 6,779 → 9,038 expansions, 124 → 123 distinct designs. Nothing invalid is
   ever emitted; some valid layouts are simply never seen.

## Decisions requested

| # | Decision | Notes |
|---|---|---|
| D1 | Architectural usefulness: approve / redirect | If redirect, name what is missing (room-shape policy, circulation, garage placement, topology families) |
| D2 | Scoring language: approve / change | Point at the specific calibration values in `planlab-calibration-0.1` |
| D3 | Tune breakpoints and `shortlistSize` now, or accept as-is | Moves selected triplets; cheap while selection is fast |
| D4 | Stage 0 evidence shape: accept the new `outputHash` baselines or stop serializing derived indexes | Carried from the 2.5 review; ~256 → ~342 MB canonical payload; matters for the Milestone 4 worker protocol |
| D5 | Push `main` to `origin/main` (55 commits ahead) | Nothing is pushed since Stage 1 |

Until D1 and D2 are answered, Milestone 4 stays unstarted.
