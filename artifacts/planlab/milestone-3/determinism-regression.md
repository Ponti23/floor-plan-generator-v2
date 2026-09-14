# Stage 3.4 determinism and regression evidence

## Result

The Stage 0 ten-seed benchmark is now a repeatable regression harness. Stable
signatures are recorded in [`benchmark-baselines/full.json`](benchmark-baselines/full.json)
and checked with:

```text
npm run benchmark:stage0:check
```

The bounded CI-friendly check covers the first two fixed seeds with one timed
run each and the same approved generation budget:

```text
npm run benchmark:stage0:bounded
```

Both checks compare canonical result, layout, selection, evidence-shape,
counts, diagnostics, and expansion signatures. Timing samples and host details
are retained in the run report but are intentionally excluded from the stable
baseline, so a faster/slower machine cannot create a false semantic diff.

## Historical Stage 0 evidence

The historical baseline is anchored to commit `e1c6f38` and the committed
artifact [`../milestone-0/benchmark.json`](../milestone-0/benchmark.json).
Bucket 2.1 added derived-facts indexes to the serialized `GenerationResult`;
therefore historical full-result hashes no longer reproduce even though the
generated layouts and selected triplets did at that checkpoint. Stage 3.4 also
pins a versioned seeded tie-break policy, so the current layout/selection
signatures are the new deterministic baseline rather than an attempted replay
of pre-policy candidate order. This bucket records the mechanical consequence
explicitly:

- historical `outputHash` values remain reference evidence, not a live gate;
- current baselines keep separate `outputHash`, `layoutHash`, `selectionHash`,
  and evidence-shape signatures;
- the current derived-facts serialization policy is preserved pending the user
  decision; no product semantics were changed to force historical hashes.

## Pruning oracle

[`src/domain/pruning.ts`](../../../src/domain/pruning.ts) runs an exhaustive
occupied-cell enumeration on tiny grids and compares it with the independent
minimum-remaining-area-pruned run. Every area-pruned branch carries a
certificate with `availableArea < minimumRemainingArea`, which proves that the
branch has no valid completion and therefore cannot contain the selected
exhaustive optimum. The oracle is not imported by the production generator;
`test/determinism-pruning.test.ts` asserts the optimum and certificate against
a hand-checked fixture; the recorded machine-readable result is
[`pruning-oracle.json`](pruning-oracle.json).

## Raw benchmark observation

On the recorded Windows/Node reference host, the full 300-candidate generation
currently reports median **3036.067 ms** and p95 **3381.464 ms**. The approved
Stage 0 latency target remains visible in `benchmark.json`; bounded mode does
not apply that timing gate. This is evidence only and does not trigger product
or scoring retuning in bucket 3.4.
