---
title: floorplan-generator Progress
tags: [progress, resume]
---

# floorplan-generator — progress

## Resume here

- **Checkpoint date:** 2026-09-14 (later the same day as the Stage 1 checkpoint).
- **Current focus:** Stage 2 (access, rules, and validation) is **complete**. All five buckets
  landed on `main` (`9a24738`, `7f87add`, `2a4f216`, `f93ddd3`, `ded4d73`) and the independent
  review (2.5) returned **PASS WITH OPEN FINDINGS** on 2026-09-14, fixing three access-layer
  defects. The hard-validity stack is now authoritative: rule definitions/instances with
  provenance, the eight-stage ordered pipeline, unsupported evaluators and aggregations that fail
  instead of passing, and an access graph that can no longer disagree with the validator.
- **Open threads / waiting on user:**
  1. **Stage 0 benchmark evidence (decision).** Bucket 2.1 added the derived facts indexes to the
     serialized `GenerationResult`, so the ten recorded per-seed `outputHash` values no longer
     reproduce — `e1c6f38` (end of Stage 1) is the last commit that reproduces them. Generated
     layouts and selected triplets are byte-identical throughout, so this is an evidence-shape
     change, not a semantics change. Either accept the evolution or stop serializing the derived
     indexes so the canonical result stays byte-stable; the payload also grew ~256 MB → ~342 MB,
     which matters for the Milestone 4 worker protocol. Detail:
     `artifacts/planlab/milestone-2/validation-review.md`.
  2. **Nothing is pushed** — `main` is ~40 commits ahead of `origin/main`.
  3. Product/UX/copy and money/payment decisions remain human hard gates.
- **Next step:** Sol@Max stages Milestone 3 (generator, metrics, scoring, and diversity) from
  `knowledge/planlab/IMPLEMENTATION_PLAN.md`. Do not begin Milestone 3 implementation before that
  staging; its definition of done is the architect usefulness/scoring-language hard gate.
- **In-flight branches:** all work is on `main` (Milestone 0 baseline `8171058`, Stage 1
  `0e8589b`…`e1c6f38` plus typecheck infra `19916f1`, Stage 2 as listed above);
  `stage0-planlab-spike` is retained at the completed gate checkpoint `b8aba2a`.
- **Deferred:** Milestone 3+ product implementation (generator/scoring hardening, worker/UI
  scaffolding) is unstarted until staged. `INSTANCES_BY_PROJECT` in `rules.ts` caches instances per
  project object identity — revisit when the project document becomes editable (Milestone 6).

**Stage 2 evidence:** `npm test` 102 passing (68 → 70 in Stage 1, 99 after 2.4, 102 after the 2.5
review); `npm run typecheck` 0 errors; `npm run diagnostics:canonical -- --check` clean with the
canonical fingerprint unchanged at
`sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`; differential validation
of 15 deliberately broken layouts against `e1c6f38` shows identical verdicts and violation sets;
`serializeCanonical(GenerationResult)` is byte-identical from `9a24738` through `ded4d73`. Review
record: `artifacts/planlab/milestone-2/validation-review.md`.

**Process note:** every dispatched executor in Stage 2 stalled at least once by reporting status and
asking for authorization rather than implementing, and two spawned nested helpers. Four of the five
buckets were finished directly by the orchestrator, and every new behaviour was mutation-checked
(the fix was temporarily reverted and the new test confirmed to fail). Future briefs must say
"do the work now, do not ask, do not spawn sub-agents".

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
