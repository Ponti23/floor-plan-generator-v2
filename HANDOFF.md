# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stage 0 is complete and approved. Stage 1 is complete; the independent domain API review (bucket 1.4) passed on 2026-09-14. **Stage 2 (access, rules, and validation) is staged and active** — buckets 2.1–2.5 are listed in `DELEGATION-PLAN.md` and `knowledge/BOARD.md`.

## Last checkpoint

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

1. Execute Stage 2 in plan order. Bucket 2.2 (portal geometry and access graph hardening,
   `luna-max`) is the next dispatch.
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

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 preserved its approved semantics bit-for-bit.
- Stage 1 was production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
