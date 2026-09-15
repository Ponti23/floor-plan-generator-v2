---
title: floorplan-generator Progress
tags: [progress, resume]
---

# floorplan-generator — progress

## Resume here

- **Checkpoint date:** 2026-09-15.
- **Current focus:** **Milestones 5, 6 and the engineering half of 7 are complete.** Milestone 5 closed
  after an independent review; Stage 6 (local persistence and recovery) finished with its own
  independent review; Stage 7's 7.1 (responsive/accessibility), 7.2 (deployment config + README
  limitations) and 7.3 (performance profile, including a quiet-machine Stage 0 re-measure) are done.
  **The only unfinished bucket is 7.4 — release approval, which is the user's hard gate** — plus the
  two pending user decisions below (push, and the 6.4 reset-confirmation wording).
- **What Stage 6/7 changed for the user.** The brief and the last generation survive a refresh; the
  workspace says `Saved locally` / `Saving…` / `Local save failed`; a corrupt or foreign saved
  document is preserved and explained rather than silently replaced; Reset project asks first, then
  removes only PlanLab-owned keys; stored layouts are discarded (with a notice) when a different build
  produced them. Below 1180 px, two toolbar toggles fold the brief or analysis pane so the plan keeps
  a usable width, and the tertiary text colour moved from a failing 4.02:1 to 5.26:1.
- **What closed this session (Milestone 5).**
  - **5.0 copy and shell gate — closed by the user on 2026-09-15**: keep Vite/TS (static build
    verified Vercel-deployable: `npm run build` → `dist/`, no server runtime), the three strategy
    names, a five-row score breakdown, real-value-only metric rows, and the disclaimer /
    prohibited-claims / failure wording. Record:
    `artifacts/planlab/milestone-5/5.0-copy-decision-package.md`. Copy in
    `src/app/presentation-copy.ts` is final but still one replaceable object.
  - **5.3 result selector + analysis projection** (`09a9662`): real option thumbnails, selected-option
    summary with six real-value-only metric rows, whole-number category bars, PASS/WARNING/FAIL rule
    checks from the authoritative evaluator, honest empty/infeasible states. Record:
    `artifacts/planlab/milestone-5/5.3-result-selector.md`.
  - **5.4 generation states + stale affordances + keyboard/a11y** (`3a769e2`): all eight states,
    stale banner with a working Regenerate action, elapsed/watchdog progress, disabled out-of-scope
    shell controls, deterministic "new variations" seed bump. Record:
    `artifacts/planlab/milestone-5/5.4-generation-states.md`.
  - **5.5 independent review** (review by `/root/milestone5_review`, judged by the orchestrator):
    seven defects found and fixed (shared `planViewBox`, inline SVG icons, card geometry, expand-button
    accessible name, `aria-pressed` toggles, landmark roles, deterministic number formatting). Record
    and judgment: `artifacts/planlab/milestone-5/5.5-independent-review.md`.
  - **5.6 Stage 0 baseline provenance** (`47c078c`): the manifest hashed raw working-tree bytes, so
    `core.autocrlf` changed the fingerprint and `baselineMatch` failed on Windows. Now hashes
    LF-normalised content; the re-record is proven drift-free (every canonical hash, impossible
    fixture, historical baseline, budget and seed value identical; only the fingerprint moved).
    `benchmark:stage0:check` is **pass: true, baselineMatch: true**. Record:
    `artifacts/planlab/milestone-5/5.6-baseline-provenance.md`.
- **Open threads:**
  1. **Push not yet done.** `main` is local-only since `baa9a54` (`c69bc8c`…`784b9b8` are unpushed).
     Pushing is the user's call; ask before pushing.
  2. **Runtime margin.** Stage 0 median passed at 1,807–1,919 ms against the <2,000 ms gate while
     agents loaded the machine, and expansions run ~15.4k of the 20k cap. Re-measure on a quiet
     machine before any generator change.
  3. **Evidence integrity.** The 5.5 review tree briefly produced `5.5-review.png`/`.json` that were
     byte-identical copies of `5.4-complete`; its own child caught and deleted them and the standing
     captures were hash-checked. Hash unattributed screenshot pairs before citing them.
  4. **Optional `.gitattributes` `eol=lf`** would remove the checkout line-ending difference entirely,
     at the cost of one bulk renormalisation commit.
  5. **`INSTANCES_BY_PROJECT`** in `rules.ts` caches instances per project object identity — revisit
     when the project document becomes editable under Stage 6.
- **Next step:** nothing engineering-shaped is left in the staged plan. **7.4 (release approval) is the
  user's gate**, and it wants an architect acceptance session across several briefs rather than the
  canonical fixture alone. Everything else is staged, executed, reviewed, verified and recorded:
  Milestone 5 (5.0–5.6), Stage 6 (6.1–6.6) and Stage 7 (7.1–7.3), with per-bucket records under
  `artifacts/planlab/milestone-{5,6,7}/`. If the user wants more, the highest-value next work is a
  second real brief in the fixtures (only the canonical brief has ever been exercised end to end) and
  a deploy the Vercel headers can actually be checked against.
- **Two decisions are waiting on the user:**
  1. **Push.** `main` is unpushed since `baa9a54`; everything after it (Milestones 5 and the Stage 6
     work) is local. Pushing is the user's call.
  2. **Reset copy.** The 6.4 confirmation wording is new user-facing copy that the 5.0 gate does not
     cover. It ships as a replaceable default and is marked `needs-human` on the board.
- **In-flight branches:** all work is on `main` (Milestone 0 baseline `8171058`, Stage 1
  `0e8589b`…`e1c6f38` plus typecheck infra `19916f1`, Stage 2 `9a24738`…`ded4d73`, Stage 3
  `6089c48`…`99e1904`, Stage 4 `89b9fc7`, Stage 5 `c63a1d2`…`784b9b8`); `stage0-planlab-spike` is
  retained at the completed gate checkpoint `b8aba2a`.
- **Deferred:** nothing beyond the open threads above.

**Evidence this session:** `npm test` **176 passing** (159 at session start), `npm run typecheck` 0
errors, `npm run build` clean, `npm run diagnostics:canonical -- --check` clean at
`sha256:8efe5b5e…` (the domain was untouched for the whole session), `npm run benchmark:stage0:check`
**pass: true / baselineMatch: true** at median 1,807–1,919 ms and p95 1,841–2,209 ms. Browser evidence
at 1536 × 1024 with DOM digests: `5.3-workspace-1536x1024.png`, `5.3-infeasible-state.png`,
`5.4-idle|generating|complete|stale*.png`, `5.5-review|idle|stale.png`, `5.5-card-fix.png`; panes
measured 310 / 841 / 385 px and the toolbar 56 px. The screenshot harness is
`scripts/capture-ui.mjs` (`--no-generate`, `--immediate`, `--pre`, `--post`).

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

---

## 2026-09-15

- **Milestone 5 closed.** The 5.0 copy and shell hard gate was answered by the user in five separate
  decisions (Vite/TS kept — verified Vercel-deployable as a static build; three strategy names; five
  score-breakdown rows; real-value-only metric rows; disclaimer, banned claims and failure wording).
  Record: `artifacts/planlab/milestone-5/5.0-copy-decision-package.md` (`c69bc8c`).
- **5.3 result selector and analysis projection** (`09a9662`): real thumbnails from layout geometry,
  selected-option summary with six real-value-only metric rows, whole-number category bars,
  PASS/WARNING/FAIL rule checks by re-running the authoritative evaluator, honest
  empty/partial/infeasible states. The analysis panel reads the *selected card's* strategy scorecard
  — a fixed-profile read had printed another card's score (81 vs 80). Record:
  `artifacts/planlab/milestone-5/5.3-result-selector.md`.
- **5.4 generation states, stale affordances, keyboard/a11y** (`3a769e2`): `startedAt`/`watchdogMs`
  exposed by the controller, elapsed-vs-watchdog progress readout updated in place without re-render,
  stale banner with a working Regenerate action, disabled out-of-scope shell controls, and a
  deterministic `bumpVariationSeed` for "new variations". Record:
  `artifacts/planlab/milestone-5/5.4-generation-states.md`.
- **5.5 independent review** (independent agent, judged by the orchestrator): seven defects found and
  fixed — shared `planViewBox` removing pointer/zoom anchor drift, inline SVG toolbar icons, card
  geometry restored to the reference height, an accessible name for the expand-room control,
  `aria-pressed` on the viewport toggles, landmark roles, and locale-independent number formatting.
  The review tree briefly produced two screenshot files that were byte-identical copies of
  `5.4-complete`; its own child agent detected and deleted them, and the standing captures were hashed
  against every 5.4 capture before being cited. The orchestrator found one defect the review missed —
  option-card strategy names clipping mid-word — and fixed it at closure. Record:
  `artifacts/planlab/milestone-5/5.5-independent-review.md`.
- **5.6 Stage 0 baseline provenance** (`47c078c`): the benchmark input manifest hashed raw
  working-tree bytes, so `core.autocrlf=true` changed the fingerprint and `baselineMatch` failed on
  Windows for reasons unrelated to any code change. Now hashes LF-normalised content; the baseline was
  re-recorded and the comparison proves no drift was masked (every canonical per-seed hash, impossible
  fixture, historical baseline, budget and seed value is identical; only the fingerprint moved).
  Record: `artifacts/planlab/milestone-5/5.6-baseline-provenance.md`.
- **Tooling:** `scripts/capture-ui.mjs`, a dependency-free headless-Chrome harness that drives the real
  worker path and emits a PNG plus a DOM digest for the 1536 × 1024 fidelity loop.
- **Stages 6–7 staged** in `DELEGATION-PLAN.md` and `knowledge/BOARD.md` (6.1–6.6 persistence and
  recovery, 7.1–7.4 UX/performance/deployment with 7.4 as the release hard gate). Stage 6 is next;
  only 6.4's reset-confirmation wording needs user approval and must ship as a replaceable default.
