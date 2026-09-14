# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stage 0 is complete and approved. Stage 1 is active; bucket 1.3 is complete and bucket 1.4 is next.

## Last checkpoint

- Bucket 1.3 landed in `113d1d3`. `src/domain/serialization.ts` owns the
  canonical text form (sorted keys, domain-ordered arrays, absent optional
  properties, typed rejection of NaN/Infinity/bigint/class instances/cycles)
  and an owned runtime-independent sha256 with `fingerprintCanonical` plus
  `fingerprintNormalizedProject`, which hashes the canonical normalized input
  together with the solver/rule/scoring versions. `src/domain/inspection.ts`
  renders the canonical fixture and the discretization evidence, exposed as
  `npm run diagnostics:canonical` (`--check` verifies without writing) with
  committed artifacts in `artifacts/planlab/milestone-1/diagnostics/`. The
  suite is 68 passing tests, 11 of them new.
- The recorded canonical project fingerprint is
  `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`;
  the literal is a drift guard in `test/serialization.test.ts`. Cross-process
  fingerprints match a fresh Node process, generated layouts replay
  byte-equivalently, and every single-field mutation tried (1 mm offset, name,
  seed, planning ratio, room area, relationship kind, portal length, space
  position) moves the fingerprint.
- The Stage 0 benchmark now consumes the domain serializer, and a scratch-copy
  rerun reproduced all ten recorded per-seed `outputHash`/`replayHash` values
  byte-for-byte with every gate passing (median 1,905.108 ms; p95 2,061.238 ms
  on the current machine). Stage 1 therefore preserved Stage 0 output semantics
  bit-for-bit; the committed `artifacts/planlab/milestone-0/benchmark.json` is
  still the historical Stage 0 record and was deliberately left untouched.
- Bucket 1.3 was executed by the root orchestrator: the dispatched executor ran
  for roughly forty minutes with no file writes and no reply to two pings, so it
  was stood down and the bucket was completed directly.
- Bucket 1.2 landed in `ff99f7c`. Geometry now documents the coordinate/unit
  invariants, rejects non-exact integer geometry, and owns the reviewed
  coverage APIs (`coveredAreaWithin`, `unallocatedInteriorArea`,
  `unallocatedInteriorRatio`, `overlapArea`, `intervalContainsSpan`).
  `validation.ts` and `metrics.ts` consume those APIs instead of local
  clip-and-union math. The suite is 57 passing tests, including 14 new
  geometry tests with occupancy-grid and unit-edge property oracles.
- Exactness is enforced in two tiers: `isGridRect` / `assertExactGridRect` is
  the strong predicate used once per input by the bulk coverage/total APIs,
  while the hot per-edge and per-pair helpers keep the cheap structural guard.
  An interleaved A/B over the ten canonical seeds showed no measurable
  regression versus `61e4322` (median 1,910.7 ms vs 1,923.3 ms on the current
  machine; the recorded reference environment remains 1,786.433 ms).
- Bucket 0.6 received the user's explicit **GO** on 2026-09-14. Technical review commit `605eb88` has 39 passing tests; the clean-worktree 10-seed benchmark passes every gate (median 1,786.433 ms; p95 1,944.396 ms).

## Next step

1. Execute bucket 1.4: the independent review of the Stage 1 schema,
   normalization, geometry, serialization, and the tests around them.
2. Only after that review passes: stage Milestone 2 work in
   `knowledge/planlab/IMPLEMENTATION_PLAN.md`.

## Open findings for bucket 1.4

- The repo has no TypeScript dev dependency and no typecheck step. Running
  `npx -p typescript@5 tsc --noEmit -p tsconfig.json` reports pre-existing
  errors that Stage 1 did not introduce and did not fix: `generator.ts` returns
  `NO_VALID_CANDIDATES`, which is absent from the result union, and `metrics.ts`
  has an incompatible overload plus call sites passing `number` where a literal
  grid constant is expected. The new Stage 1 modules (`serialization.ts`,
  `inspection.ts`) typecheck clean. Deciding whether the spike modules' errors
  are in scope for 1.4 is a review call.

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 must preserve its approved semantics while replacing spike-only seams.
- Stage 1 is production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
