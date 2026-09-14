# Milestone 0 independent technical review

## Review result

**Technical result: PASS.** The Stage 0 feasibility spike meets its technical
benchmark gates after the fixes recorded below. This is not the architect
usefulness decision: bucket 0.6 remains the required human hard gate.

The review covered authoritative geometry/validation, generated facts and
scores, diversity selection, deterministic search, regression coverage, and
benchmark provenance.

## Findings fixed

| Area | Finding | Review fix and regression evidence |
|---|---|---|
| Coverage and overlap facts | Coverage could count area outside the footprint, and pairwise overlap summation over-counted a triple overlap. | Clip coverage to the footprint in facts and validation; calculate multiply allocated area as sum minus union. Tests cover an outside room and a triple overlap. |
| Human access and flow evidence | Vehicle portals could make a garage appear pedestrian-reachable; route distance was a portal-hop count rather than an interpretable grid distance. | Build a pedestrian-only validation graph and calculate portal-to-centre Manhattan routes with deterministic Dijkstra traversal. Tests prove vehicle frontage is not human access and route evidence is geometric. |
| Hard versus soft scoring | Meeting minimum room area was receiving design-score credit. | Remove it from scoreable program metrics; it remains an explicit hard-validation PASS. |
| Normalization and preflight | A minimum short side was checked against only the larger envelope axis; footprint preflight also collapsed rotateable width/depth constraints and double-counted the largest room as reserve. | Check both axes, preserve rotateable dimension feasibility, and reserve circulation only once. Tests cover typed contradiction, rotated-room footprint enumeration, and non-shared room-instance dimensions. |
| Approved hard policies | A supplied project could raise the 200 m² cap; a `garage` kind could omit south vehicle frontage. | Reject oversized project settings, cap defensive normalized callers, and require/enforce the Stage 0 garage frontage policy. |
| Room access and relationships | An optional room was exempt from reachability once placed; hard relationship selectors accepted IDs/requirement IDs but not room kinds. | Apply pedestrian reachability/pass-through policy to every placed room and support kind selectors consistently with scoring. |
| Diversity | Unmatched optional instances were excluded from centroid comparison, making materially different programs appear closer than they are. | Charge every unmatched placement the maximum normalized centroid distance. |
| Determinism and evidence | Benchmark provenance relied on Git HEAD despite dirty source, measured one timing per seed, and applied gates after display rounding. | Hash all benchmark inputs, retain worktree status, run three timed generations per seed plus replay, and apply timing/diversity gates to raw values. The benchmark records rounded display values separately. |

## Verification evidence

- `npm test` — **39 passed, 0 failed**.
- `npm run benchmark:stage0` — **PASS** on 2026-09-14T00:34:42.880Z against committed review source `605eb88` with a clean worktree at benchmark start.
  - Fixed 10-seed suite; 30 measured generations plus deterministic replay.
  - Every seed: 300/300 independently valid candidates and 3/3 independently valid selected layouts.
  - Minimum selected-triplet distance: **0.3203629583969335**, above the 0.20 threshold.
  - Median **1,786.433 ms**; p95 **1,944.396 ms**; approved limits are <2,000 ms and <4,000 ms.
  - All three impossible fixtures terminated with typed normalization diagnostics and zero candidates.
  - Input fingerprint: `5914900b9515d7825baf0e0f6b4f9a1c4187c91924121aeaefb0efc7eeaf55f4`.

The machine-readable evidence is [benchmark.json](benchmark.json); the
human-readable summary is [benchmark.md](benchmark.md).

## Residual limitations

- This remains a mathematical spike over the single canonical brief. Score
  weights, diversity threshold, and the usefulness of the constrained layout
  class still require architect judgement at bucket 0.6.
- Timing is a Node reference-host measurement, not a browser/worker
  measurement. The benchmark records the host, committed source revision, and
  a source fingerprint; the final orchestrator rerun began from a clean worktree.
- There is no package-defined typecheck/build script and no local TypeScript
  compiler dependency. Runtime test execution parses the TypeScript sources on
  the supported Node runtime; adding a production build/typecheck gate belongs
  to a later product milestone rather than this spike.
