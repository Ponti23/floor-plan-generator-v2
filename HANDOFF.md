# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stage 0 is complete and approved. Stage 1 is active; bucket 1.2 is complete and bucket 1.3 is next.

## Last checkpoint

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

1. Execute bucket 1.3: canonical serialization, fingerprinting, and diagnostics.
2. Then bucket 1.4, the independent domain API review, before any Milestone 2 work.

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 must preserve its approved semantics while replacing spike-only seams.
- Stage 1 is production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
