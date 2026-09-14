---
title: floorplan-generator Progress
tags: [progress, resume]
---

# floorplan-generator — progress

## Resume here

- **Checkpoint date:** 2026-09-14 (later the same day as the Stage 3 review).
- **Current focus:** the Stage 3 hard gate is **answered**. The user did not approve the usefulness
  claim; they directed a fix (D1), approved the scoring language as the default while requiring it to
  stay settable (D2/D3), and asked for the engineering-shaped decisions to be done rather than
  returned as questions (D4). All of that is implemented and green. Full record:
  `artifacts/planlab/milestone-3/gate-amendment-d1-d4.md`.
- **What changed (D1).** Minimum area alone admitted unusable rooms: the brief declared no minimum
  **short side** for the bathroom, kitchen, living room or laundry, so seed 01 passed hard validity
  with a **7.00 × 0.75 m bathroom**. A `ROOM_SHAPE_POLICY` table in `src/domain/constants.ts`,
  expanded into ordinary brief data in `src/domain/fixtures.ts`, now gives every habitable room a
  minimum short side, a preferred area and a 2.0 aspect cap. Separately, the generator divided free
  area **equally** and ignored `preferredAreaUnits2` entirely — which is why three interchangeable
  bedrooms came out 35 / 27 / 10.6 m² — so `src/domain/generator.ts` now allocates in proportion to
  declared preference. Seed 01 now yields 18.0 / 18.0 / 18.0 m² bedrooms, a 6.00 × 6.00 m living
  room and no sliver rooms, at 81 / 79 / 83 and 3/3 selection on all ten seeds.
- **What changed (D2/D3).** `resolveCalibrationSurface(overrides)` makes category weights, metric
  breakpoints, `shortlistSize`, the diversity threshold and the explanation limit editable without a
  source change. An unconfigured run stays bit-identical to `planlab-calibration-0.1`, a derived
  surface is labelled `…+custom`, and a hostile calibration cannot move a hard verdict.
- **What changed (D4).** Measured: the canonical full result is **324.6 MB**, of which the plans are
  **0.9 MB** and the recomputable derived indexes are 99.6%. `src/domain/resultPayload.ts` projects
  the result onto its semantics for serialization and transport; the in-memory result still carries
  the indexes. **Reduced resolution:** the benchmark's `evidenceHash` now hashes derived schema keys
  rather than every value, so a silent value-level change that leaves layouts byte-identical is no
  longer caught by that hash.
- **Cost, stated honestly.** Expansions per seed rose **6,779 → 15,456** and the full-gate median
  **904 ms → 1,750 ms**. Targets still met (median <2,000, p95 <4,000, 20,000 expansions) but the
  median margin fell from ~55% to ~13%, and expansions now sit close to the cap.
- **Open threads / waiting on user:**
  1. **D5 — push.** `main` is 56 commits ahead of `origin/main`; still nothing pushed.
  2. **Milestone 4 (UI).** Unblocked by D1/D2. Bucket 4.1 was dispatched to a sub-agent that stalled
     for ~40 minutes without writing a single file and was interrupted; it is back in the queue.
  3. Product/UX/copy and money/payment decisions remain human hard gates. The calibration override
     seam deliberately makes copy-adjacent values *settable* without freezing them.
  4. **Evidence-resolution caveat** in D4 above — a future review needing value-level derived drift
     detection must use `serializeCanonical(result)` explicitly.
- **Next step:** answer D5, then build Milestone 4 (worker/UI scaffolding) from
  `knowledge/planlab/IMPLEMENTATION_PLAN.md`, following `knowledge/planlab/UI_ARCHITECTURE.md`.
- **In-flight branches:** all work is on `main` (Milestone 0 baseline `8171058`, Stage 1
  `0e8589b`…`e1c6f38` plus typecheck infra `19916f1`, Stage 2 `9a24738`…`ded4d73`, Stage 3
  `6089c48`…`99e1904` plus the 3.5 review); `stage0-planlab-spike` is retained at the completed gate
  checkpoint `b8aba2a`.
- **Deferred:** Milestone 4+ product implementation (worker/UI scaffolding) is unstarted until the
  Stage 3 gate closes. `INSTANCES_BY_PROJECT` in `rules.ts` caches instances per project object
  identity — revisit when the project document becomes editable (Milestone 6).

**Evidence after the gate amendment:** `npm test` **136 passing** (122 → 129 → 136: +4 room-shape
policy, +7 calibration overrides, +3 result payload); `npm run typecheck` 0 errors;
`npm run diagnostics:canonical -- --check` clean at fingerprint `sha256:8efe5b5e…`;
`npm run benchmark:stage0:check` **`baselineMatch: true`** with every gate line PASS at median
**1,749.5 ms** / p95 **1,831.1 ms** (record run 1,786.9 ms; bounded 1,774.8 ms) on a quiet machine.
The room-shape tests were mutation-checked (relaxing the bedroom aspect cap broke three of four).
Earlier timings of ~2.2 s were measured while sub-agents were loading the machine and are not
representative — re-measure before drawing any timing conclusion.

**Process note:** the 3.5 review was performed by the orchestrator because no separate agent was
available in the session, so it leans on differential evidence (frozen prior commit in a scratch
worktree, injected defects, a second process, independent oracles) rather than on reading alone.
Both new behaviours were mutation-checked: a deliberately wrong selection memo failed the two new
oracles, and a temporarily disabled frontier cut was used to measure that cut's real effect. A cold
resume that wants a genuinely independent Stage 3 review should re-do it with a different agent.

_(This block is rewritten by the `save-progress` skill. Everything below is the append-only timeline.)_

---

## 2026-09-13

No merge has occurred yet; the timeline begins with the first real merge.

---

## 2026-09-14

- Stage 1 completed: versioned domain schema/normalization (`0e8589b`), production geometry
  primitives and property oracles (`ff99f7c`), canonical serialization/fingerprints/diagnostics
  (`113d1d3`), independent domain API review (`e1c6f38`) plus a TypeScript typecheck gate
  (`19916f1`) → next: stage Milestone 2.
- Stage 2 staged as five buckets (2.1–2.5) in `DELEGATION-PLAN.md` and `knowledge/BOARD.md`
  (`7b58820`).
- Stage 2 delivered and reviewed: layout facts pass and edge indexes (`9a24738`, with an
  occupancy-grid oracle property test), portal geometry and access-graph hardening (`7f87add`),
  typed rule registry and ordered validator (`2a4f216`), relationship aggregation and
  garage/circulation hard rules (`f93ddd3`), independent validation-review pass with three
  access-layer fixes (`ded4d73`) → next: Sol@Max stages Milestone 3.
- Stage 3 delivered and reviewed: named metric breakpoints and validity gates (`6089c48`), frozen
  calibration surface (`c5bff25`), canonical diversity identity plus joint triplet selection
  (`e301ed4`, `e8d4b45`), determinism policy, pruning oracle, and regression baselines (`99e1904`),
  then the 3.5 review that fixed the recorded median-runtime failure with an identity-keyed
  selection memo (`d7f82b9`; median 3,036 ms → 904 ms, byte-identical results) and added the
  missing selection oracles → next: the Stage 3 architect usefulness/scoring-language hard gate,
  then stage Milestone 4.
