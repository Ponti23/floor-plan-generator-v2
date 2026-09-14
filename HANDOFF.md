# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stages 0–3 are complete. The **Stage 3 hard gate is answered** (2026-09-14): the user
did not approve the usefulness claim for D1 but directed a fix, approved the scoring language as the
default while requiring it to stay settable (D2/D3), and asked for the engineering-shaped decisions
to be done rather than returned as questions (D4). All of it is implemented, verified and green
(136 tests, full regression gate PASS at median 1,750 ms). Record:
[`artifacts/planlab/milestone-3/gate-amendment-d1-d4.md`](artifacts/planlab/milestone-3/gate-amendment-d1-d4.md).
**Next: answer D5 (push), then build Milestone 4.**

## Waiting on — D5 only

Everything else the gate asked for is settled. The one open decision is **D5: push `main` to
`origin/main`** (56 commits ahead since Stage 1). Nothing has been pushed, so nothing was committed
to a remote and no irreversible action has been taken.

Two things a resuming session should know before it re-measures anything:

1. **Timing numbers taken while sub-agents are running are not representative.** This session
   measured a 2.2 s median while two agents were loading the machine, then the same commit measured
   **1,750 ms** on a quiet machine. Re-measure before concluding a timing gate fails.
2. **The D4 payload projection reduced evidence resolution.** The benchmark's `evidenceHash` now
   hashes derived *schema keys* rather than every value, so a silent change to an individual derived
   value that leaves layouts byte-identical is no longer caught by that hash. A review that needs
   value-level derived drift must call `serializeCanonical(result)` explicitly.

**Milestone 4 status:** bucket 4.1 (worker + three-pane UI shell per
`knowledge/planlab/UI_ARCHITECTURE.md`) was dispatched to a sub-agent that stalled for ~40 minutes
without writing a single file and was interrupted. No `app/` directory exists. The bucket is back in
the queue.

## Last checkpoint

- Bucket 3.5 landed as `d7f82b9` (`perf: memoise PlanLab selection pair distances`, plus its
  review evidence). The recorded median-runtime gate failure was attributed to joint triplet
  selection recomputing `compareLayoutDiversity` for every one of the ~41,000 assignment pairs
  rather than the ~2,556 distinct pairs; an identity-keyed symmetric memo fixes it. Evidence:
  `serializeCanonical(GenerationResult)` is byte-identical for all ten canonical seeds before and
  after, expansion counts are unchanged, and the re-recorded baselines differ from the previous
  ones in exactly one field each (the input fingerprint, which hashes every domain module).
  Full gate now **PASS**: median **903.743 ms**, p95 **1,153.068 ms** (record run) and median
  **817.392 ms**, p95 **1,038.613 ms** (immediate `--check`). The same review found the memo had no
  test teeth — a deliberately wrong memo left `npm test` at 120/120 — so
  `test/diversity-selection.test.ts` gained a distance-consistency oracle and a brute-force
  triplet oracle, both mutation-verified. The frontier cut's comment was corrected to state that
  the tiny-grid oracle certifies the minimum-area cut only. Verification: `npm test` **122
  passing**; `npm run typecheck` 0 errors; `benchmark:stage0:check` and
  `benchmark:stage0:bounded` both `baselineMatch: true`. Review record:
  `artifacts/planlab/milestone-3/validation-review.md`. Open, not defects: the architect
  usefulness/scoring-language hard gate, the Stage 0 evidence-shape decision from 2.5, and
  deliberately untaken tuning headroom (`shortlistSize`, metric breakpoints).

- Bucket 3.4 landed as `99e1904` (`feat: pin PlanLab determinism and regression evidence`). Seeded
  tie-breaking, budgets, and search-policy constants are versioned; an independent tiny-grid
  exhaustive oracle verifies the minimum-area pruning condition and records certificates; and the
  Stage 0 suite is now a repeatable current-baseline harness with explicit environment metadata and
  separate historical/evidence-shape hashes. Verification: `npm test` **120 passing**;
  `npm run typecheck` 0 errors; canonical diagnostics clean; bounded and full baseline checks pass.
  The recorded ten-seed run produced three valid diverse layouts per seed, deterministic replays,
  and in-budget expansions, but the overall technical gate is **FAIL** because median runtime is
  **3,036.067 ms** against the approved **<2,000 ms** target (p95 **3,381.464 ms**, passing <4 s).
  No product semantics were retuned; this remains an explicit 3.5 review finding.

- Bucket 3.3 landed as `e301ed4` plus review correction `e8d4b45` (`feat: harden PlanLab diversity
  and triplet outcomes`; `fix: keep empty PlanLab pools non-infeasible`). Interchangeable room labels
  and mirrors now share a canonical identity; diversity is deterministic, symmetric, and bounded;
  and selection distinguishes proved infeasibility, no candidates found, fewer than three valid
  candidates, and insufficient diversity. Orchestrator review caught and corrected an initial
  overclaim that labeled a budget-exhausted empty search “infeasible.” Verification: `npm test`
  **116 passing**; `npm run typecheck` 0 errors; canonical diagnostics clean.

- Bucket 3.2 landed as `c5bff25` (`feat: add PlanLab scoring calibration surface`). A frozen,
  validated calibration surface now owns the five-category strategy weights, metric and diversity
  thresholds, explanation limits, and semantic trade-off descriptors. Scoring and selection accept
  reviewed calibration while hard validation remains independent; diagnostics carry the calibration
  version and inspectable profile data. Verification: `npm test` **110 passing**;
  `npm run typecheck` 0 errors; `npm run diagnostics:canonical -- --check` clean.

- Bucket 3.1 landed as `6089c48` (`feat: pin PlanLab metric formulas and validity gates`). The five
  metric categories now use named, versioned breakpoints; utility helpers pin their bounds and
  documented monotonic behavior; planning efficiency and allocation ratio are distinct formulas
  with garage excluded from the habitable comparison; and stale validation results cannot preserve
  a PASS after geometry changes. Diagnostics expose the separate ratios without compliance
  language. Verification: `npm test` **105 passing**; `npm run typecheck` 0 errors;
  `npm run diagnostics:canonical -- --check` clean. The intentional metrics-version update changed
  the canonical project fingerprint to
  `sha256:b8f11f6232fbc26b15a49b610c391b62dffb4b002a2e57935bc74d70d44dbf03`.

- Bucket 2.5 landed as `ded4d73` (`test: add Milestone 2 independent validation review`), closing
  Stage 2. The review (evidence: `artifacts/planlab/milestone-2/validation-review.md`) used
  differential validation against the frozen Stage 1 implementation rather than reading alone:
  15 deliberately broken layouts keep their verdict and violation set, `serializeCanonical(GenerationResult)`
  is byte-identical from `9a24738` through this commit, and the domain stays framework-free and
  deterministic. It fixed three access-layer defects of the same class — the graph and the validator
  disagreeing about one portal — all of which pre-dated Stage 2 (verified at `e1c6f38`):
  1. an unsupported portal `kind` created a traversable edge while validation reported
     `PORTAL_KIND_INVALID`;  2. a repeated portal id added a second route while validation reported
     `DUPLICATE_PORTAL_ID`;  3. a malformed candidate (missing `portals`/`spaces`) threw a
     `TypeError` out of the access helpers instead of being reported invalid — a crash could take
     down a generation run or, later, a worker. It also aligned `src/domain/generator.ts` onto the
     shared `isTransitNode` policy so the constructor can no longer explore corridors validation
     forbids (output byte-identical). Verification: `npm test` **102 passing**; `npm run typecheck`
     0 errors; canonical fingerprint unchanged.

- Bucket 2.4 landed as `f93ddd3` (`feat: implement PlanLab relationship aggregation and hard rules`).
  `mustShareWall` is now aggregation-aware instead of implicitly `any`: `any` needs one qualifying
  expanded pair, `all` needs every pair (and an empty expansion is **not** vacuously satisfied),
  and the distance aggregations `nearest`/`average` are reported through a new
  `RELATIONSHIP_AGGREGATION_UNSUPPORTED` definition rather than silently read as `any` — one defect,
  one finding. Wall contact is exact shared-edge length from the facts index (corner contact and
  sub-threshold contact never satisfy it), garage south frontage / 6 m preset / vehicle portal and
  the project circulation-width setting are pinned by tests, and a multi-defect layout is asserted
  to report every finding deterministically in pipeline order. `test/relationship-rules.test.ts`
  adds 8 tests; the pipeline-order test in `test/rule-registry.test.ts` moves 32 → 33 definitions.
  Verification: `npm test` **99 passing**; `npm run typecheck` 0 errors; canonical fingerprint
  unchanged; and `serializeCanonical(GenerationResult)` for the canonical seed is byte-identical to
  `2a4f216`, so 2.4 moved no output. Both new behaviours were checked for teeth by temporarily
  restoring implicit-`any` (the tests failed as expected) and the mutation was reverted.

- Bucket 2.3 landed as `2a4f216` (`feat: add PlanLab rule registry and ordered validator`).
  `src/domain/rules.ts` now holds the typed evaluator registry: one immutable `planlab-core`
  definition per violation code, hard rule instances carrying `enforcement`, `source`, validated
  `parameters`, and `scope`, evaluated in the eight-stage `RULE_ENGINE.md` pipeline order; an
  unknown definition id or version mismatch evaluates to `unsupported` and fails, never passes.
  Portal geometry/graph/transit policy moved to `src/domain/portalGraph.ts` (no import cycle), and
  `validation.ts` is now a façade that builds one `RuleContext` and projects fail evaluations onto
  the unchanged `ValidationResult` shape (violations additionally carry `geometryEvidence`).
  Orchestrator review (2.3 is Terra-authored, so the author was not the reviewer): 15 deliberately
  broken layouts were validated on `e1c6f38` and on this commit and compared field by field — every
  case keeps the same valid/invalid verdict and the same violation set. Three documented deltas:
  (a) violation order now follows the documented pipeline instead of the old inline order (6/15
  cases reordered, sets identical); (b) `ruleId` separators changed from underscores to kebab-case
  (`planlab-core.portal-not-on-shared-edge`); nothing in the repo consumes the old format (checked);
  (c) some violations gained additive fields (`expected`/`actual`, a layout subject) and a
  duplicate-space-id fixture now additionally reports the reachability consequences, which is the
  "return all safe-to-compute violations" rule. Verification: `npm test` **91 passing**;
  `npm run typecheck` 0 errors; canonical fingerprint unchanged; and a full
  `serializeCanonical(GenerationResult)` for the canonical seed is byte-identical between `9a24738`
  (bucket 2.1) and this commit, so buckets 2.2 and 2.3 introduced no serialization drift.

### Stage 0 benchmark reproduction — accepted drift from bucket 2.1

Verified independently (scratch worktrees at `e1c6f38` and `9a24738`, same machine):

- `e1c6f38` (end of Stage 1) reproduces all ten recorded per-seed `outputHash` values byte-for-byte.
- `9a24738` (bucket 2.1) does **not**: all ten hashes change. The cause is the enriched derived-facts
  evidence (`factsVersion` 0.4 → 0.5 plus the new `overlaps` / `sharedWallIntervals` /
  `sharedWallIndex` / `exteriorContacts` / `exteriorContactIndex` fields) being part of the
  serialized `GenerationResult`.
- The generated **layouts** and the **selected triplet** are byte-identical between `e1c6f38` and
  `9a24738`, so layout and selection semantics are unchanged; only the derived evidence payload
  moved (and grew the canonical result from ~256 MB to ~342 MB for the canonical seed).

Consequence: the recorded Milestone 0 benchmark hashes are historical evidence, not a live gate —
`e1c6f38` is the last commit that reproduces them. This needs a decision (not a hard gate): either
accept it as intended evidence evolution, or stop serializing the derived indexes so the canonical
result stays byte-stable and the Stage 0 benchmark keeps reproducing. The payload size also matters
for the Milestone 4 worker protocol. Raised for bucket 2.5 and for the user.

- Bucket 2.2 landed as `7f87add` (`fix: harden PlanLab portal geometry and access graph`).
  Two real defects closed: (a) `buildPortalGraph` added an edge for *any* portal whose
  endpoints resolved, so reachability could be established through a portal `validateLayout`
  simultaneously rejected — the graph now filters through the new exported `portalSpanValid`,
  which is the single predicate the validator's own portal step calls, and `reachableSpaceIds(layout)`
  resolves a bare layout through the pedestrian graph (vehicle frontage proves frontage, never a
  route); (b) `isTransitNode` granted transit rights to any room whose traits said so, so a private
  bedroom tagged `mayBePassThrough` could act as a corridor — private/service rooms and the
  bedroom/bathroom/garage/laundry/storage kinds are now never transit nodes, while living/dining/
  kitchen join the through-route only when the brief explicitly opts in. Verification: `npm test`
  **84 passing** (77 + 7 new in `test/portal-access.test.ts`); `npm run typecheck` 0 errors;
  canonical fingerprint unchanged. Both new test groups were checked for teeth by temporarily
  restoring the old behaviour (each failed as expected), and the mutation was reverted.
- Bucket 2.1 landed as `9a24738` (`refactor: add PlanLab layout facts pass and edge indexes`).
  `src/domain/facts.ts` now computes one immutable geometry index per candidate — per-space
  coverage, pairwise overlaps with clipped rects, shared-wall intervals plus a `a|b` pair index,
  footprint-boundary and exposed exterior contact per space per side, and unallocated interior
  area — and `metrics.ts` / `validation.ts` consume it instead of rescanning pairs. New
  `test/layout-facts.test.ts` covers hand-checked cases and an **occupancy-grid oracle** property
  test over 60 generated layouts that shares no code with `geometry.ts` (verified to have teeth by
  a temporary mutation of the shared-wall scan, which it caught). Verification: `npm test` 77
  passing; `npm run typecheck` 0 errors; `npm run diagnostics:canonical -- --check` clean with the
  fingerprint unchanged at `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`.
- Bucket 1.4 passed and landed as `e1c6f38` (`fix: resolve Stage 1 review findings in domain APIs`) plus `19916f1` (`build: add TypeScript typecheck gate and node typings`). Review evidence: [`artifacts/planlab/milestone-1/domain-api-review.md`](./artifacts/planlab/milestone-1/domain-api-review.md).
- Four Stage 1 findings fixed:
  1. Normalization collapsed typed `RoomSelector` objects to strings and accepted an undocumented `"group"` variant. Object selectors are now preserved in normalized relationships, `"group"` is removed, and unresolved-selector checks are intent-aware (an instance selector no longer silently retargets to a colliding requirement id). Two new tests pin preservation and the no-retarget rule.
  2. The domain package could not typecheck. `NO_VALID_CANDIDATES` joined the `GenerationDiagnostic` union, `METRIC_CONFIG` received an explicit `number`-typed interface (fixing the `TS2394` overload error and the literal-`12` call sites), and `typescript`/`@types/node` dev dependencies plus a `npm run typecheck` script were added. All fixes are type-level; runtime behaviour is unchanged.
  3. Hardcoded metre conversions (`/ 0.25`, `GRID_MM / 1_000`) in `metrics.ts`/`validation.ts` now use `GRID_UNIT_METRES` (identical value, one named source).
  4. `unionArea` gained the same exact-range accumulation guard as `overlapArea`.
- Verification: `npm run typecheck` reports **0 errors** (was 22 pre-existing); `node --test` reports **70 passing** (was 68); `npm run diagnostics:canonical -- --check` is up to date with the canonical fingerprint unchanged at `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`; a scratch-copy Stage 0 benchmark passes all gates and reproduces all ten recorded per-seed `outputHash`/`replayHash` values byte-for-byte, so Stage 1 preserved Stage 0 output semantics bit-for-bit.
- Working tree is clean; `main` is 26 commits ahead of `origin/main` and nothing is pushed. The disposable scratch copies under `%TEMP%\fp-bench-*` / `%TEMP%\fp-review-*` have been removed by the orchestrator.

## Next step

1. Execute Stage 3 in plan order. Bucket 3.5 independent Milestone 3 review (`terra-max`) is next.
   It must investigate the failed median-runtime gate and may not declare Stage 3 complete while the
   approved technical acceptance criterion remains unmet.
2. Stage 3's definition of done is the architect usefulness/scoring-language **hard gate** — it
   stops for the user and is never merged solo.
3. The Stage 0 benchmark evidence decision below is waiting on the user; it is not a blocker for
   Stage 3, but it should be settled before the Milestone 4 worker protocol fixes message payloads
   (bucket 3.4 records its mechanical consequence).
3. Orchestrator note for future stages: every dispatched executor in Stage 2 stalled at least once
   by reporting status and asking for authorization instead of implementing, and two spawned nested
   helpers. Four of the five buckets were finished by the orchestrator. Executor briefs must state
   "do the work now, do not ask, do not spawn sub-agents" — and a stalled executor should be
   interrupted and the bucket done directly rather than re-dispatched a third time.

## Open findings

- None outstanding. The former 1.4 findings (typecheck errors, selector coercion) are closed in this checkpoint.
- **Waiting on the user (decision, not a blocker):** the Stage 0 benchmark hashes no longer
  reproduce after bucket 2.1 (derived-facts evidence is serialized into `GenerationResult`;
  layouts and selections are byte-identical). Either accept the evidence evolution or stop
  serializing the derived indexes so the canonical result stays byte-stable. The 342 MB canonical
  result also bears on the Milestone 4 worker protocol. Full detail in the checkpoint note above
  and in `artifacts/planlab/milestone-2/validation-review.md`.
- `INSTANCES_BY_PROJECT` in `rules.ts` caches rule instances per project object identity; a caller
  that mutates a normalized project in place would keep stale parameters. No caller does this
  today; revisit when the project document becomes editable (Milestone 6).

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 preserved its approved semantics bit-for-bit.
- Stage 1 was production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
