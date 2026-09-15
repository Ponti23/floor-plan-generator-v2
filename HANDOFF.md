# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

## DeepSeek-Flash takeover brief — 2026-09-15

The user is nearly out of tokens and explicitly asked to prepare this repository for a
DeepSeek-Flash takeover. **Do the work now; do not ask for permission to inspect or prepare the
decision package, and do not spawn sub-agents.** This handoff is not approval of the Milestone 5
hard gate.

**Visual direction is approved:** the frontend must closely recreate
`knowledge/PlanLab-Mockup.png`, following the measurable fidelity and screenshot-QA requirements in
`knowledge/planlab/FRONTEND_MOCKUP_BRIEF.md`. The current vertical-slice frontend is not an
acceptable visual approximation. The user subsequently authorized a starter implementation in the
existing Vite shell. `src/app/styles.css` now supplies the first visual foundation: white 56 px
toolbar, 310/flexible/385 desktop panes, blue action language, dense form styling, fine canvas grid,
site/footprint hierarchy, muted plan surface, north/zoom scaffolding, and horizontal option cards.
All worker/domain behavior remains unchanged. This visual approval does not freeze final product
copy.

**Flash continuation boundary:** do not redo the CSS foundation. Continue by restructuring
`src/app/main.ts` into the mockup composition and wiring real payload data. Highest-priority gaps are
the grouped semantic toolbar; Site/Rooms/Constraints editor rows; category-aware room classes and
area labels; actual option thumbnails; selected-option metrics, score bars and observations; and
real viewport controls. The starter was visually checked in the browser in both idle and completed
three-layout states. It is intentionally incomplete and must still pass the 1536 × 1024 comparison
loop in `FRONTEND_MOCKUP_BRIEF.md`.

1. Read `AGENTS.md`, `knowledge/PROGRESS.md`, `knowledge/BOARD.md`, `DELEGATION-PLAN.md`, and this
   handoff before acting.
2. Stay on clean, synchronized `main`. The user authorized the mockup-driven visual starter; do not
   interpret that as approval to freeze copy or expand scope beyond the fidelity brief.
3. Claim 5.1 and continue the frontend from the CSS foundation. In parallel, prepare one concise
   5.0 final-copy decision package containing:
   - the recommendation to retain the existing Vite/TS shell, with the short reason that this MVP
     has no backend, SSR, routing, or server actions requiring Next.js;
   - proposed final strategy names and one-line descriptions;
   - proposed conceptual-use disclaimer and prohibited-claims wording;
   - proposed metric labels; and
   - proposed honest infeasibility, partial-result, and budget-exceeded language.
4. The Vite shell and mockup-driven implementation are authorized. Do not freeze final copy or
   close 5.0 until the user explicitly approves the copy package.
5. Record the actual executor as `deepseek-flash` when Flash is used, and implement against
   `knowledge/planlab/FRONTEND_MOCKUP_BRIEF.md`. Execute buckets 5.1 → 5.2 → 5.3 sequentially, then
   route 5.4 plus independent review according to the delegation playbook. Each bucket must be
   verified and committed before the next begins. Do not declare UI completion without the required
   1536 × 1024 reference comparison and iteration.

Audit evidence immediately before handoff: clean/synced repository; 145/145 tests, typecheck,
production build, and canonical diagnostics all green; worker median 188.8 ms. The full Stage 0
gate passed with `baselineMatch: true` at 1,973.5 ms median / 2,070.5 ms p95. That median has only
~1.3% headroom against the <2,000 ms gate, while expansions are 15,456 / 20,000, so avoid adding
generator work without re-measuring on a quiet machine. Git uses the shared `Ponti23` author and
cannot prove which historical commits were Flash-authored; record actual ownership going forward.

**Status:** Stages 0–3 are complete. The **Stage 3 hard gate is answered** (2026-09-14): the user
did not approve the usefulness claim for D1 but directed a fix, approved the scoring language as the
default while requiring it to stay settable (D2/D3), and asked for the engineering-shaped decisions
to be done rather than returned as questions (D4). All of it is implemented, verified and green
(145 tests, full regression gate PASS at median 1,750 ms). Record:
[`artifacts/planlab/milestone-3/gate-amendment-d1-d4.md`](artifacts/planlab/milestone-3/gate-amendment-d1-d4.md).
**Milestone 4 is closed for browser smoke; Milestone 5 is staged. Next: close 5.0 (product copy +
Vite/Next.js decision), then execute 5.1–5.4.**

## D5 remote checkpoint — approved

The user approved pushing `main` to `origin/main` on 2026-09-15 before Milestone 4 begins. This
handoff update is part of that remote checkpoint.

**Push completed.** `main` was pushed to `origin/main` on 2026-09-15
(`60cfa73..baa9a54`). The pushed range includes the D1–D4 gate work and Milestone 4 bucket 4.1.

Two things a resuming session should know before it re-measures anything:

1. **Timing numbers taken while sub-agents are running are not representative.** This session
   measured a 2.2 s median while two agents were loading the machine, then the same commit measured
   **1,750 ms** on a quiet machine. Re-measure before concluding a timing gate fails.
2. **The D4 payload projection reduced evidence resolution.** The benchmark's `evidenceHash` now
   hashes derived *schema keys* rather than every value, so a silent change to an individual derived
   value that leaves layouts byte-identical is no longer caught by that hash. A review that needs
   value-level derived drift must call `serializeCanonical(result)` explicitly.

**Milestone 4 status:** bucket 4.1 (worker + three-pane UI shell per
`knowledge/planlab/UI_ARCHITECTURE.md`) is committed as `89b9fc7` on local `main`. It adds the
versioned worker protocol, `GenerationController`, cooperative cancellation through a shared
signal, progress counters with monotonic clamping, stale-response rejection, watchdog
`budgetExceeded`, worker crash/retry recovery, a plain three-pane shell, and a Node worker
benchmark. Verification this session: `npm test` **145 passing**, `npm run typecheck` 0 errors,
`npm run build` clean, `npm run diagnostics:canonical -- --check` clean, and
`npm run benchmark:worker` median **174.1 ms** on this machine (recorded reference 174.6 ms;
no regression).
`npm run benchmark:stage0:check` is **PASS** with `baselineMatch: true` after the Stage 0
regression baseline was refreshed to the Milestone 4 `package.json` input fingerprint; domain
output hashes were unchanged.

Browser smoke verification performed with the in-app browser: generate reaches `complete` with
three options and the plan SVG; cancel returns to `idle` and keeps the last compatible result;
committing a site edit (`18000 × 26000 mm`) regenerates a changed viewBox (`86x126` → `78x110`)
and layout set; an impossible envelope produces `infeasible`. The retry and worker-failure paths
are covered by `worker-controller.test.ts` and are now formally accepted rather than manually
re-simulated in the browser.

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

1. Close **5.0**: get user approval for Milestone 5 product copy (strategy names, conceptual-use
   disclaimer, metric names, infeasibility language) and the Vite-vs-Next.js shell decision.
   Recommended technical default: keep the existing Vite/TS shell; this client-only MVP has no
   backend, SSR, routing, or server actions that justify Next.js.
2. After 5.0, execute 5.1 → 5.2 → 5.3 → 5.4 with replaceable recommended copy until final copy is
   approved. Do not freeze copy unilaterally.
3. Run the Milestone 5 independent review (5.5) before closing the stage.
4. Orchestrator note for future stages: dispatched executors in this project have repeatedly stalled
   by asking for authorization instead of implementing. Brief them to "do the work now, do not ask,
   do not spawn sub-agents" and do a stalled bucket directly rather than re-dispatching it.

## Open findings

- Milestone 4 browser verification is closed: generate/cancel/edit are verified in the real browser;
  retry and worker-failure are accepted via `worker-controller.test.ts`.
- Milestone 5's reference implementation says Next.js while the current shell is Vite/TS. That is
  an architecture/product choice for Sol/Astra before implementation begins; the existing Vite/TS
  shell is the recommended technical default.
- Milestone 5 product copy is a hard gate: strategy names, the conceptual-use disclaimer, metric
  names, and infeasibility language must be user-approved before they are frozen.
- The Stage 0 evidence-shape question is resolved by D4: worker transport and normal canonical
  payloads use the semantic projection in `src/domain/resultPayload.ts`, and the current baseline
  intentionally records the evolved evidence shape. The remaining caveat is evidence resolution:
  use `serializeCanonical(result)` explicitly when a review must detect value-level drift inside
  recomputable derived indexes.
- `INSTANCES_BY_PROJECT` in `rules.ts` caches rule instances per project object identity; a caller
  that mutates a normalized project in place would keep stale parameters. No caller does this
  today; revisit when the project document becomes editable (Milestone 6).

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 preserved its approved semantics bit-for-bit.
- Stage 1 was production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
