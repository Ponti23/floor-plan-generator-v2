# Stage 3 — independent generator/metrics/scoring review (bucket 3.5)

Reviewer: orchestrator (`/root`) · 2026-09-14 · review target: `main` `b2b87de`
(Stage 3 head at review start; fixes are recorded in this document and landed
on top of it)

## Scope

Independent review of the Stage 3 stack: misleading metrics, false precision,
determinism leaks, weak tests, pruning-oracle credibility, and benchmark
honesty.

| Bucket | Commit | Surface |
|---|---|---|
| 3.1 | `6089c48` | `src/domain/metrics.ts` named breakpoints, validity gates, ratio definitions |
| 3.2 | `c5bff25` | `src/domain/calibration.ts` frozen calibration surface, scoring/selection plumbing |
| 3.3 | `e301ed4`, `e8d4b45` | `src/domain/diversity.ts` canonical identity, distance, joint selection |
| 3.4 | `99e1904` | determinism policy, `src/domain/pruning.ts`, `scripts/benchmark-stage0.mjs`, baselines |

Against the Milestone 3 acceptance criteria in `knowledge/planlab/IMPLEMENTATION_PLAN.md`,
`knowledge/planlab/SCORING.md`, `RULE_ENGINE.md`, and `DELEGATION-PLAN.md`.

Independence note: the Stage 3 buckets were executed by dispatched executors and
by the orchestrator, and this review was performed by the orchestrator because no
separate agent was available in the session. It therefore leans on **differential
evidence** — frozen prior commits in a scratch worktree, injected defects, a
separate process, and independent oracles — rather than on reading alone. The
architect usefulness and scoring-language decision remains an untouched human
hard gate and is **not** claimed by this review.

## Method

1. Full suite, typecheck, and canonical diagnostics on the review target.
2. Benchmark reproduction: full and bounded runs, plus `--check` against the
   committed baselines.
3. Attribution of the recorded runtime failure by timing the search, scoring,
   and selection phases separately, in the pre-fix scratch worktree
   (`b2b87de`) and in the working tree.
4. Byte-level differential: `serializeCanonical(GenerationResult)` for all ten
   canonical seeds, before and after the fix, compared by SHA-256.
5. Injected-defect (mutation) checks: a deliberately wrong selection memo, and a
   temporarily disabled frontier cut, each measured against the unmodified code.
6. Cross-process determinism: the full result hash for a canonical seed computed
   in two separate `node` processes.
7. Evidence integrity: re-running the recorded pruning oracle against its
   checked-in artifact, and diffing re-recorded baselines against the previous
   baselines field by field.

## Findings

### F1 — median runtime gate failed (resolved)

**Severity: blocking for Stage 3.** The recorded Stage 0 suite reported median
**3,036.067 ms** against the approved **< 2,000 ms** target (`99e1904`,
`benchmark.md`), while p95 passed.

**Root cause.** Joint triplet selection (`selectDiverseTriplet`) searches the
product of three strategy shortlists (24 × 24 × 24 ordered assignments) and
recomputed `compareLayoutDiversity` — including Hungarian room matching — for
every assignment pair, although only `C(72, 2) ≈ 2,556` distinct pairs exist.
That is ~41,000 comparisons per seed for ~2,556 distinct pairs.

Attribution on the reference host (seed `planlab-canonical-01`, approved budget):

| Phase | Pre-fix `b2b87de` | Post-fix |
|---|---:|---:|
| Whole generation | 4,509 ms | 840 ms |
| Scoring (`scoreCandidates`) | 118 ms | 72 ms |
| Selection (`selectDiverseTriplet`) | 3,403 ms | 56 ms |

**Fix.** `src/domain/diversity.ts` memoises the symmetric distance verdict by
candidate object identity for the duration of one selection call. The memo stores
only `{ distance, diverse }`, which is everything the objective consumes.

**Correctness evidence.**

- `serializeCanonical(GenerationResult)` is byte-identical for all ten canonical
  seeds before and after the fix (per-seed full-result and selection SHA-256
  compared; e.g. seed 01 `1ea3931c2c0d1fedf18449347c968720002464b20b4d5949999fe944f058ac4f`).
- Expansion counts are unchanged (6,779 / 7,108 / 8,641 / … as recorded), so the
  search visited exactly the same states.
- Re-recorded baselines changed in exactly one field each — the benchmark input
  fingerprint, which hashes every domain module — with `outputHash`,
  `layoutHash`, `selectionHash`, `evidenceHash`, counts, and diagnostics
  identical.

**Post-fix gate.** Median **903.743 ms**, p95 **1,153.068 ms** (record run);
median **817.392 ms**, p95 **1,038.613 ms** (immediate `--check` re-run). All
other gate lines remain PASS.

### F2 — the selection memo had no test teeth (resolved)

**Severity: high (test-credibility).** Injecting a deliberately wrong memo read
(returning the first cached pair for the left-hand candidate regardless of the
pair) left `npm test` at **120/120 passing**. Only the separate, slower
`benchmark:stage0:bounded` check noticed, by diffing `selectionHash`.

**Fix.** Two oracle tests in `test/diversity-selection.test.ts`:

1. every reported `pairwiseDistances` entry must equal a direct
   `compareLayoutDiversity` call for that pair, and every selected pair must
   really clear the threshold;
2. with a shortlist covering the whole pool, the selected triplet must equal an
   independent brute-force enumeration of all ordered diverse triples under the
   same objective and id tie-break.

Both tests were confirmed to fail under the injected defect and to pass after
reverting it. Suite is now **122 passing**.

**Residual.** Test 2 covers a single eight-design fixture; cross-seed selection
remains pinned only by the recorded baselines.

### F3 — frontier-cut comment overclaimed (resolved)

**Severity: low (evidence honesty).** The comment above the frontier cut called
it "the constructive counterpart to the independent validator's
forbidden-pass-through check". Because the frontier is measured against the
spaces placed *so far*, the cut also discards layouts whose only transit is a
pass-through room that the room order places later.

**Evidence (temporary mutation, not committed).** With the frontier cut
disabled, every seed still produced 300 hard-valid layouts, but the found design
set and the selected triplet changed on all ten seeds — for example seed 01:
6,779 → 9,038 expansions with 124 → 123 distinct designs; seed 10: 9,250 →
13,948 expansions with 111 → 135 distinct designs.

**Fix.** The comment now states that the cut is a search heuristic, is not
certified by the tiny-grid oracle, and can discard valid layouts, while never
emitting an invalid one (every candidate still faces independent hard
validation). No behaviour changed.

### F4 — area cut admissibility and oracle credibility (verified, no action)

The minimum-area cut prunes only when the free footprint area is below the sum of
the remaining rooms' minimum areas, which no valid disjoint packing can satisfy —
admissible by construction. The oracle is independent of the production path
(occupied-cell enumeration vs rectangle decomposition), and the checked-in
artifact `pruning-oracle.json` reproduces exactly from the current oracle code:
`equivalent`, optimum key and score, exhaustive/pruned solution counts (8/8),
branch count (16), and every certificate `availableArea`/`minimumRemainingArea`
pair.

The oracle certifies the area cut only; F3 records the precise scope of the
frontier cut.

### F5 — determinism (verified, no action)

- No clock, randomness, or locale source exists anywhere in `src/domain/`
  (`Math.random`, `Date`, `performance`, `Intl`, unordered `for…in`).
- Two separate `node` processes produced the same full-result hash for seed 01.
- The benchmark's byte-equivalence replay gate passes for all ten seeds, and the
  new memo is per-call, identity-keyed, and derivation-pure (F1 evidence).
- Metric rounding is integer (`Math.round(utility * 100)`) and diagnostic ratios
  print at one decimal place; no test or report asserts precision beyond the
  quantised grid, so no false-precision change was required.

### F6 — open findings (not Stage 3 defects)

1. **Human hard gate.** The architect/user must still approve mathematical
   usefulness and the scoring language. This review deliberately makes no claim
   about it.
2. **Stage 0 benchmark evidence shape (from 2.5).** The derived-facts indexes in
   the serialized result still change the historical `outputHash` values and grow
   the canonical payload (~256 MB → ~342 MB). Unchanged by this bucket; still
   needs the user's accept-or-shrink decision before the Milestone 4 worker
   protocol.
3. **Tuning headroom, deliberately not taken.** Selection now costs ~56 ms, so
   `calibration.diversity.shortlistSize` (24 of a 300-candidate pool) and the
   metric breakpoints could be revisited cheaply — but any such change moves the
   selected triplets, which is scoring language and belongs to the hard gate.
   Nothing was retuned in this bucket.

## Reproduction

```text
npm test                                             # 122 passing
npm run typecheck                                    # 0 errors
npm run benchmark:stage0 -- --record-baseline         # full, gate PASS
npm run benchmark:stage0:check                        # baselineMatch: true
npm run benchmark:stage0 -- --record-baseline --bounded
npm run benchmark:stage0:bounded                      # baselineMatch: true
```

Machine-readable evidence: [`benchmark.json`](benchmark.json),
[`benchmark-baselines/full.json`](benchmark-baselines/full.json),
[`pruning-oracle.json`](pruning-oracle.json).
