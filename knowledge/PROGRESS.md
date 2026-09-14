---
title: floorplan-generator Progress
tags: [progress, resume]
---

# floorplan-generator — progress

## Resume here

- **Checkpoint date:** 2026-09-14 (later the same day as the Stage 2 checkpoint).
- **Current focus:** Stage 3 (generator, metrics, scoring, and diversity) is **complete**. Buckets
  3.1–3.4 landed on `main` (`6089c48`, `c5bff25`, `e301ed4` + `e8d4b45`, `99e1904`) and the 3.5
  review closed the one blocking finding: the recorded median-runtime gate failure (3,036 ms vs
  <2,000 ms) came from joint triplet selection recomputing `compareLayoutDiversity` for every one of
  the ~41,000 assignment pairs instead of the ~2,556 distinct pairs. An identity-keyed symmetric
  memo in `src/domain/diversity.ts` fixes it with byte-identical results; the full gate is now
  **PASS** at median **904 ms** / p95 **1,153 ms**. Review also added the missing selection test
  teeth (brute-force triplet oracle + distance-consistency oracle, mutation-verified) and corrected
  a comment that overstated the tiny-grid oracle's scope. Evidence:
  `artifacts/planlab/milestone-3/validation-review.md`.
- **Open threads / waiting on user:**
  1. **Stage 3 hard gate (architect/user).** The architect must approve mathematical usefulness and
     the scoring language before any polished UI work. This is the definition of done for Stage 3
     and was deliberately not claimed by the review. Do not start Milestone 4 scaffolding before it
     closes.
  2. **Stage 0 benchmark evidence (decision).** Since bucket 2.1 the derived facts indexes are part
     of the serialized `GenerationResult`, so the ten recorded per-seed `outputHash` values no longer
     reproduce — `e1c6f38` is the last commit that reproduces them — and the canonical payload grew
     ~256 MB → ~342 MB, which matters for the Milestone 4 worker protocol. Layouts and selected
     triplets are byte-identical throughout. Accept the evidence-shape evolution or stop serializing
     the derived indexes. Detail: `artifacts/planlab/milestone-2/validation-review.md`.
  3. **Nothing is pushed** — `main` is ~50 commits ahead of `origin/main`.
  4. Product/UX/copy and money/payment decisions remain human hard gates.
  5. **Deliberately untaken tuning headroom.** Selection now costs ~56 ms, so
     `calibration.diversity.shortlistSize` (24 of a 300-candidate pool) and the metric breakpoints
     could be revisited cheaply, but every such change moves selected triplets — that is scoring
     language and belongs to the hard gate above.
- **Next step:** the user's Stage 3 gate decision (usefulness + scoring language). Only then stage
  Milestone 4 (worker/UI scaffolding) from `knowledge/planlab/IMPLEMENTATION_PLAN.md`.
- **In-flight branches:** all work is on `main` (Milestone 0 baseline `8171058`, Stage 1
  `0e8589b`…`e1c6f38` plus typecheck infra `19916f1`, Stage 2 `9a24738`…`ded4d73`, Stage 3
  `6089c48`…`99e1904` plus the 3.5 review); `stage0-planlab-spike` is retained at the completed gate
  checkpoint `b8aba2a`.
- **Deferred:** Milestone 4+ product implementation (worker/UI scaffolding) is unstarted until the
  Stage 3 gate closes. `INSTANCES_BY_PROJECT` in `rules.ts` caches instances per project object
  identity — revisit when the project document becomes editable (Milestone 6).

**Stage 3 evidence:** `npm test` 122 passing (105 → 110 → 116 → 120 → 122 with the 3.5 oracles);
`npm run typecheck` 0 errors; `npm run diagnostics:canonical -- --check` clean;
`npm run benchmark:stage0:check` and `npm run benchmark:stage0:bounded` both `baselineMatch: true`
with every gate line PASS (median 817 ms, p95 1,039 ms on the immediate re-run);
`serializeCanonical(GenerationResult)` byte-identical for all ten canonical seeds across the 3.5
fix, with expansion counts unchanged (6,779 / 7,108 / 8,641 / …); the re-recorded baselines differ
from the previous ones in exactly one field each — the benchmark input fingerprint, which hashes
every domain module. Review record: `artifacts/planlab/milestone-3/validation-review.md`.

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
