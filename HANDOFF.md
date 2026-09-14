# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stage 0 is complete and approved. Stage 1 is complete; the independent domain API review (bucket 1.4) passed on 2026-09-14. **Stage 2 (access, rules, and validation) is staged and active** — buckets 2.1–2.5 are listed in `DELEGATION-PLAN.md` and `knowledge/BOARD.md`.

## Last checkpoint

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

1. Execute Stage 2 in plan order. Bucket 2.5 (independent Milestone 2 review) is the last bucket:
   review the whole validation stack, fix only Stage 2 defects, and record evidence under
   `artifacts/planlab/milestone-2/`. 2.3 is Terra-authored, so the orchestrator judged it directly;
   2.5 should provide the independent pass over 2.1/2.2/2.4 and re-check the deltas 2.3 recorded.
2. Bucket 2.3 is Terra-authored (integration-heavy registry refactor), so the orchestrator judges
   its result and 2.5 provides independent review of the whole validation stack.
3. Stage 2 must not change Stage 1 canonical fingerprints or existing fixture verdicts; a change is
   a defect, not a permitted side effect. (2.1 held this: the fingerprint is unchanged.)
4. Orchestrator note: the first two 2.1 executors stalled by reporting status and asking for
   authorization instead of implementing, and one spawned nested helpers. The bucket was finished
   and judged by the orchestrator, which also added the missing occupancy-grid oracle test. Future
   executor briefs must state "do the work now, do not ask, do not spawn sub-agents".

## Open findings

- None outstanding. The former 1.4 findings (typecheck errors, selector coercion) are closed in this checkpoint.
- New, not yet actioned: `src/domain/generator.ts` still has its own `mayBePassThrough || hallway`
  transit helper. Generated layouts remain hard-valid under the stricter policy today, so this is a
  latent consistency risk rather than a defect; align it when the generator is next opened
  (Milestone 3), or fold it into the 2.3 registry work if that turns out to be cheap.

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 preserved its approved semantics bit-for-bit.
- Stage 1 was production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
