---
title: floorplan-generator Progress
tags: [progress, resume]
---

# floorplan-generator — progress

## Resume here

- **Checkpoint date:** 2026-09-15.
- **Current focus:** Milestone 5 frontend work is complete; the **5.5 independent review is PASS
  WITH OPEN FINDINGS** and is ready for Sol to judge. The
  **5.0 copy and shell hard gate closed on 2026-09-15**: the user answered all five decisions
  separately and approved each one (keep Vite/TS, the three strategy names, five score-breakdown
  rows, real-value-only metric rows, and the disclaimer/prohibited-claims/failure wording). Record:
  `artifacts/planlab/milestone-5/5.0-copy-decision-package.md`.
  The user
  authorized continuing in the existing Vite shell and selected `knowledge/PlanLab-Mockup.png` as
  the required visual target. A first CSS-only foundation is implemented and verified; DeepSeek-
  Final product copy is
  still a human hard gate and must remain centralized and replaceable. The implementation and
  screenshot-QA contract is in
  `knowledge/planlab/FRONTEND_MOCKUP_BRIEF.md`. Full Stage 3 record:
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
- **Cost, stated honestly.** Expansions per seed rose **6,779 → 15,456**. The recorded quiet
  full-gate median is **1,709.8 ms**, but the 2026-09-15 takeover audit reproduced a PASS at
  **1,973.5 ms** median / **2,070.5 ms** p95. The median had only ~1.3% headroom against the
  <2,000 ms gate on that run, and expansions use ~77% of the 20,000 cap. Treat runtime margin as a
  yellow risk, not a closed performance concern.
- **Open threads:**
  1. **D5 — push.** Approved and completed. `main` was pushed to `origin/main` on 2026-09-15
     (`60cfa73..baa9a54`).
  2. **Milestone 4 (UI).** Complete enough to close the manual-verification gap. Bucket 4.1 is
     committed as `89b9fc7` on `main`: versioned worker protocol, controller, cooperative
     cancellation, progress monotonicity, stale-response rejection, watchdog/crash recovery, a
     three-pane shell, and a Node worker benchmark. This session re-ran the full verification green
     (145 tests, typecheck, build, diagnostics) and smoke-tested the real browser path: generate,
     cancel, and edit/regenerate all behave as expected. Retry and worker-failure remain unit-tested
     (`worker-controller.test.ts`) and are formally accepted rather than browser-simulated. The
     worker benchmark measured median **174.1 ms** on this machine, matching the recorded reference.
     `benchmark:stage0:check` is **PASS** with `baselineMatch: true` and domain output hashes
     unchanged.
  3. Milestone 5 copy is **approved and closed** (5.0, 2026-09-15); the copy in
     `src/app/presentation-copy.ts` is final but remains centralized and overridable. Money/payment
     decisions have not been raised and remain a human hard gate if ever in scope.
  4. **Evidence-resolution caveat** in D4 above — a future review needing value-level derived drift
     detection must use `serializeCanonical(result)` explicitly.
  5. DeepSeek-Flash authorship cannot be reconstructed from Git because commits use the shared
     `Ponti23` identity and completed buckets do not record Flash as owner. Record the actual
     executor in `knowledge/BOARD.md` for every future claimed bucket; do not rewrite provenance
     retroactively without evidence.
  6. **Milestone 5 independent review is complete.** Bucket 5.5 is **PASS WITH OPEN FINDINGS**;
     record: `artifacts/planlab/milestone-5/5.5-independent-review.md`. The review fixed pointer/
     zoom anchor drift, Unicode toolbar/viewport glyph fallback, option-card geometry mismatch,
     expand-button accessible names, missing `aria-pressed`, missing landmark roles, and
     locale-sensitive metric formatting. Stage 6 is staged but remains inactive until Sol judges
     5.5 closed.
- **Next step:** Sol judges `artifacts/planlab/milestone-5/5.5-independent-review.md`, then closes
  Milestone 5 or dispatches the recorded residual visual-review independence caveat. Stages 6–7
  are already written into `DELEGATION-PLAN.md` and `knowledge/BOARD.md` but are not active until
  Milestone 5 is closed.
- **Baseline provenance fixed (bucket 5.6).** `benchmarkInputManifest()` now hashes LF-normalised
  content, so the fingerprint describes the source instead of the checkout. The re-record is proven
  drift-free: every canonical per-seed hash, impossible fixture, historical baseline, budget and seed
  value is identical between the old and new baselines — only the fingerprint moved.
  `benchmark:stage0:check` is now **pass: true, baselineMatch: true** at median 1815.5 ms / p95
  1845.0 ms (measured with a review agent loading the machine). Record:
  `artifacts/planlab/milestone-5/5.6-baseline-provenance.md`.
- **In-flight branches:** all work is on `main` (Milestone 0 baseline `8171058`, Stage 1
  `0e8589b`…`e1c6f38` plus typecheck infra `19916f1`, Stage 2 `9a24738`…`ded4d73`, Stage 3
  `6089c48`…`99e1904` plus the 3.5 review); `stage0-planlab-spike` is retained at the completed gate
  checkpoint `b8aba2a`.
- **Deferred:** `INSTANCES_BY_PROJECT` in `rules.ts` caches
  instances per project object identity — revisit when the project document becomes editable
  (Milestone 6).

**Evidence this session:** takeover audit reproduced `npm test` **176 passing**;
`npm run typecheck` 0 errors; `npm run build` clean; `npm run diagnostics:canonical -- --check`
clean at fingerprint `sha256:8efe5b5e…`; `npm run benchmark:stage0:check`
**`baselineMatch: true`** with every gate line PASS at median **1,918.6 ms** / p95
**2,208.6 ms**; `npm run benchmark:worker` median **188.8 ms**. The earlier quiet reference was
1,709.8 ms / 1,779.6 ms and 174.1 ms respectively. Browser smoke remains:
generate reaches `complete` with three options and an SVG plan; cancel returns to `idle` and keeps
the last compatible result; committing a site edit (`18000 × 26000 mm`) regenerates a changed
viewBox (`86x126` → `78x110`) and layout set. The 5.5 review adds idle, complete and stale captures
at 1536 × 1024 under `artifacts/planlab/milestone-5/`.

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
