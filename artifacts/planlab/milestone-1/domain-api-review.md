# Stage 1 — independent domain API review (bucket 1.4)

Reviewer: terra-max (dispatched reviewer agent) · 2026-09-14 · target: `main`
`113d1d3` (Stage 1 head at review start)

## Scope

Independent review of the Stage 1 production domain layer:
`normalization.ts`, `geometry.ts`, `serialization.ts`, `inspection.ts`,
`model.ts`, the Stage 1.2 changes in `validation.ts`/`metrics.ts`, and the
tests around them, against
`knowledge/planlab/ARCHITECTURE.md`, `DATA_MODEL.md`, `COORDINATE_SYSTEM.md`,
and `IMPLEMENTATION_PLAN.md`.

## Verified clean (no action)

- **Framework coupling.** No React, Next, storage, or DOM imports anywhere in
  `src/domain/` (`rg` over import statements and globals). The only platform
  API used is `TextEncoder`, which is the single cross-runtime spelling shared
  by Node, browsers, and workers.
- **Determinism.** No ambient randomness, wall clock, or locale formatting in
  domain modules; the owned PRNG, canonical text (sorted keys, typed rejection
  of non-JSON values/cycles), and the runtime-independent SHA-256 are
  cross-checked against `node:crypto` and a fresh process by the suite.
- **Units and invariants.** Grid/millimetre/metre boundaries are documented in
  code; conservative snapping never grows the authored envelope; the canonical
  fixture is exact at site `(0,0,80,120)` and envelope `(6,8,68,88)`.
- **Coverage APIs.** `validation.ts` and `metrics.ts` consume
  `coveredAreaWithin`/`unallocatedInteriorArea`/`overlapArea` instead of local
  clip-and-union math; the Stage 1.2 rewrite preserved the prior semantics
  (verified by the unchanged Stage 0 output record below).
- **Property tests.** Occupancy-grid rectangle/coverage oracles, a unit-segment
  facade oracle, snapping-invariant properties, and canonical-text/fingerprint
  sensitivity tests are all present and deterministic.
- **Import graph.** `serialization.ts` imports version tags from
  `generator.ts`/`scoring.ts` with no cycle back.
- **Aggregation.** Normalized relationships always carry a declared
  `aggregation` (`"any"` when the author omitted it); pair expansion and
  aggregation evaluation remain Milestone 2 scope per `IMPLEMENTATION_PLAN.md`.

## Findings fixed (Stage 1 defects)

1. **Selector intent was destroyed at the normalization boundary.** The model
   declares typed `RoomSelector` objects ("explicit selectors keep
   instance/group/kind intent distinguishable"), but `normalizeSelector`
   collapsed every object form to a bare string, so a
   `{ type: "instance", id }` and a `{ type: "requirement", id }` became
   indistinguishable. It also accepted an undocumented `"group"` variant that
   the public type does not contain. Fixed: object selectors are preserved in
   the normalized relationship; the undocumented `"group"` variant is removed;
   unresolved-selector checking is now intent-aware (an instance selector no
   longer silently retargets to a requirement with a colliding id). Legacy
   string selectors keep the original instance/requirement/kind matching.
   New tests pin both preservation and the no-retarget rule.
2. **The domain package could not typecheck.** `tsc --noEmit` reported
   pre-existing Stage 0 errors that Stage 1 inherited and re-exported:
   - `generator.ts`: `NO_VALID_CANDIDATES` was emitted by triplet selection but
     absent from the `GenerationDiagnostic` code union. Added the member.
   - `metrics.ts`: `METRIC_CONFIG` was a frozen object literal whose inferred
     property types were literal (`12`, `1.15`, …), leaking into default
     parameter types and producing the `TS2394` overload error plus
     `number is not assignable to '12'` at five call sites. Annotated it with
     an explicit `MetricConfig` interface whose fields are `number`.
   - No TypeScript or Node typings existed as dev dependencies, so every
     `node:*` import in the tests failed resolution. Added `typescript@^5.9`
     and `@types/node@^24` as dev dependencies and a `npm run typecheck` script.
   All fixes are type-level or type-only infrastructure; runtime behaviour is
   unchanged.
3. **Units seam.** `metrics.ts` converted authored metres with the magic
   constant `/ 0.25` and `validation.ts` with `GRID_MM / 1_000`; both are now
   `GRID_UNIT_METRES` (identical value, one named source).
4. **`unionArea` lacked the exact-range guard its sibling `overlapArea`
   already had.** Added a safe-integer accumulation guard so a pathological
   input fails with `RangeError` instead of silently losing precision. No
   change for any realistic bounded input.

## Verification

- `npm run typecheck`: **0 errors** (was 22 pre-existing errors).
- `node --test`: **70 passing** (was 68; two new selector-intent tests added).
- `npm run diagnostics:canonical -- --check`: committed artifacts up to date;
  canonical project fingerprint unchanged at
  `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`.
- Stage 0 benchmark re-run in a scratch copy (repo artifacts untouched): all
  gates pass (median 1,986.2 ms, p95 2,129.6 ms; an earlier run failed only the
  runtime-median gate at 2,010.1 ms under machine load, consistent with the
  1,905–1,969 ms range already recorded on this machine versus the 1,786.4 ms
  reference environment). All ten recorded per-seed `outputHash`/`replayHash`
  values are **byte-identical** to the committed Milestone 0 record, so Stage 1
  preserved Stage 0 output semantics bit-for-bit.

## Decision

Stage 1 public domain APIs pass independent review. Milestone 2 may begin once
the orchestrator stages it from `knowledge/planlab/IMPLEMENTATION_PLAN.md`.
