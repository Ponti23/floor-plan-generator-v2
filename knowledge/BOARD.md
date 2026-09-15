# BOARD — PlanLab active work

Active design: [`planlab/README.md`](./planlab/README.md) · staged plan: [`../DELEGATION-PLAN.md`](../DELEGATION-PLAN.md) · resume: [`../HANDOFF.md`](../HANDOFF.md)

`Status`: `todo` · `in-progress` · `needs-human` · `blocked` · `review` · `done`

| # | Bucket | Best agent | Owner | Status | Branch |
|---|---|---|---|---|---|
| 0.1 | Domain harness and canonical fixtures | luna-max | luna-max | done | `stage0-planlab-spike` (`4e045d9`) |
| 0.2 | Constructive circulation-aware generator | luna-max | luna-max | done | `stage0-planlab-spike` (`e15d97e`) |
| 0.3 | Metrics, scoring, diversity, diagnostics | luna-max | luna-max | done | `stage0-planlab-spike` (`88f88eb`) |
| 0.4 | Seed-suite feasibility benchmark | luna-max | luna-max | done | `stage0-planlab-spike` (`4d40d48`) |
| 0.5 | Independent technical review | terra-max | terra-max | done | `stage0-planlab-spike` (`605eb88`) |
| 0.6 | Architect usefulness review **(HARD GATE)** | astra-plan | user | done | `stage0-planlab-spike` (GO approved 2026-09-14) |
| 1.1 | Versioned domain schema and brief normalization | luna-max | luna-max | done | `main` (`0e8589b`) |
| 1.2 | Production geometry primitives and property oracles | luna-max | luna-max | done | `main` (`ff99f7c`) |
| 1.3 | Canonical serialization, fingerprinting, and diagnostics | luna-max | luna-max | done | `main` (`113d1d3`) |
| 1.4 | Independent domain API review | terra-max | terra-max | done | `main` (`e1c6f38`) |
| 2.1 | Layout facts pass and edge indexes | luna-max | luna-max | done | `main` (`9a24738`) |
| 2.2 | Portal geometry and access graph hardening | luna-max | luna-max | done | `main` (`7f87add`) |
| 2.3 | Rule definitions, instances, and ordered validator | terra-max | terra-max | done | `main` (`2a4f216`) |
| 2.4 | Relationship, garage, and circulation hard rules | luna-max | luna-max | done | `main` (`f93ddd3`) |
| 2.5 | Independent Milestone 2 review | terra-max | sol-max | done | `main` (`ded4d73`) |
| 3.1 | Metric formulas and false-precision controls | luna-max | luna-max | done | `main` (`6089c48`) |
| 3.2 | Strategy profiles and the calibration surface | luna-max | luna-max | done | `main` (`c5bff25`) |
| 3.3 | Interchangeable matching, diversity, joint selection | luna-max | luna-max | done | `main` (`e8d4b45`) |
| 3.4 | Determinism, pruning oracle, regression benchmark | luna-max | luna-max | done | `main` (`99e1904`) |
| 3.5 | Independent Milestone 3 review | terra-max | orchestrator (`/root`) | done | `main` (`d7f82b9`) |
| 3.6 | Stage 3 architect usefulness + scoring-language review **(HARD GATE)** | astra-plan | user | done | `main` (D1–D4 answered 2026-09-14) |
| 3.7 | D1 room-shape policy and preferred-area allocation | terra-max | orchestrator (`/root`) | done | `main` (`458b5ac`) |
| 3.8 | D2/D3 settable calibration surface | terra-max | orchestrator (`/root`) | done | `main` (`458b5ac`) |
| 3.9 | D4 generation-result payload projection | terra-max | orchestrator (`/root`) | done | `main` (`458b5ac`) |
| 4.1 | Milestone 4 UI shell (worker + three-pane app) | terra-max | orchestrator (`/root`) | done | `main` (`89b9fc7`) |
| 5.0 | Milestone 5 product copy + Vite/Next.js shell decision | astra-plan | user | done | `main` (approved 2026-09-15) |
| 5.1 | Brief editor state and committed form | luna-max | luna-max | done | `main` (`c63a1d2`) |
| 5.2 | SVG projection, layers, pan/zoom/fit, evidence highlight | luna-max | luna-max | done | `main` (`96ba89f`) |
| 5.3 | Result selector and analysis projection | luna-max | orchestrator (`/root`) | done | `main` (`09a9662`) |
| 5.4 | Generation states, stale-result affordances, keyboard/a11y | terra-max | orchestrator (`/root`) | done | `main` (`3a769e2`) |
| 5.5 | Independent Milestone 5 review | terra-max | sol-max | todo | `main` |
| 5.6 | Stage 0 baseline provenance fix | terra-max | orchestrator (`/root`) | done | `main` |
| 6.1 | Versioned local storage repository | luna-max | unassigned | todo | — |
| 6.2 | Sequential migrations and recovery key | luna-max | unassigned | todo | — |
| 6.3 | Debounced autosave, flush and save status | luna-max | unassigned | todo | — |
| 6.4 | Reset flow and destructive confirmation (copy = hard gate) | luna-max | unassigned | todo | — |
| 6.5 | Engine-version result invalidation | terra-max | unassigned | todo | — |
| 6.6 | Independent Stage 6 review | terra-max | sol-max | todo | — |
| 7.1 | Responsive panel collapse and accessibility sweep | terra-max | unassigned | todo | — |
| 7.2 | Production deployment config and support limitations | luna-max | unassigned | todo | — |
| 7.3 | Rendering and performance profile | terra-max | unassigned | todo | — |
| 7.4 | Release approval **(HARD GATE)** | astra-plan | user | todo | — |

## Handoff rules

- Claim a bucket before editing and do not take work already owned.
- DeepSeek-Flash may be selected for eligible future buckets per the delegation playbook. Record the
  executor actually used in `Owner`; record a Luna fallback when the DeepSeek route is unavailable.
- Each executor verifies and commits its bucket.
- Stage 1 hardens the approved domain semantics and remains isolated from product UI/scaffolding.
- Stage 1 public domain APIs passed independent review (1.4, `e1c6f38`). Stage
  Milestone 2 before beginning product implementation.
- Stage 2 (access, rules, validation) is staged and active. Buckets run in order; 2.3 is
  Terra-authored because it is an integration-heavy refactor, so the orchestrator judges it and
  2.5 provides independent review of the whole stack.
- Hard validity must stay authoritative: unsupported evaluators never pass, and Stage 2 must not
  change Stage 1 canonical fingerprints or verdicts for existing fixtures.
- Stage 2 is **complete** (`9a24738`, `7f87add`, `2a4f216`, `f93ddd3`, `ded4d73`). The independent
  review passed with open findings; see `artifacts/planlab/milestone-2/validation-review.md`.
  Milestone 3 is not active until the orchestrator stages it.
- Stage 3 (generator, metrics, scoring, diversity) is **complete** (`6089c48`, `c5bff25`,
  `e301ed4`, `e8d4b45`, `99e1904`, plus the 3.5 review). The review failed the median-runtime gate
  as recorded by 3.4, attributed it to redundant pairwise comparisons in joint selection, and
  fixed it without moving any recorded result (`artifacts/planlab/milestone-3/validation-review.md`).
- Stage 3's definition of done remains an open **user hard gate**: the architect approves
  mathematical usefulness and the scoring language before polished UI work; never merge that solo.
  Do not start Milestone 4 worker/UI scaffolding before that gate closes.
- Bucket 3.6 is the gate itself, owned by the user. Decision package:
  `artifacts/planlab/milestone-3/gate-brief.md` (D1 usefulness, D2 scoring language, D3 tuning,
  D4 Stage 0 evidence shape, D5 push). It stays `needs-human` until the user answers; no executor
  may claim or close it.
- Bucket 3.6 is **answered**: the user directed a D1 change rather than an approval, and asked for
  the engineering-shaped decisions to be done rather than returned as questions. Record:
  `artifacts/planlab/milestone-3/gate-amendment-d1-d4.md`. D5 was approved by the user on
  2026-09-15; the completed checkpoint is being pushed before Milestone 4 starts.
- Buckets 3.7–3.9 carry that work. The room-shape values, the calibration overrides and the payload
  projection are all **data or seam changes with the approved defaults preserved**, so the approved
  scoring language is still the default rather than a replaced one.
- Milestone 4 is unblocked. Bucket 4.1 is complete on `main`: versioned worker
  protocol, `GenerationController`, cooperative cancellation via a shared
  signal, progress monotonicity, stale-response rejection, watchdog outcomes,
  worker error recovery, a plain three-pane UI shell, and a Node worker
  benchmark. Verification: 145 tests, typecheck clean, Vite build clean,
  diagnostics clean, Stage 0 `baselineMatch: true` after refreshing the
  input fingerprint, and browser smoke checks for generate/cancel/edit.
  Retry/worker-failure are unit-tested but not manually re-simulated.
- Milestone 5 frontend implementation is active by explicit user direction on 2026-09-15. Continue
  in the existing Vite/TS shell and use `knowledge/PlanLab-Mockup.png` as the visual target; fidelity
  and screenshot-QA requirements are in `knowledge/planlab/FRONTEND_MOCKUP_BRIEF.md`.
- **Bucket 5.0 is closed.** The user approved D1–D5 on 2026-09-15 in five separate answers: keep
  Vite/TS (Vercel-deployable static build, verified `npm run build` → `dist/`), the three strategy
  names, a five-row score breakdown, real-value-only metric rows, and the disclaimer/prohibited-claims/
  failure wording. Decision record:
  `artifacts/planlab/milestone-5/5.0-copy-decision-package.md`. Copy is still centralized in
  `src/app/presentation-copy.ts` and stays replaceable, but it is no longer pending approval — no
  executor needs to re-ask, and no executor may silently reword it.
- **Bucket 5.3 is complete** (`main`, record:
  `artifacts/planlab/milestone-5/5.3-result-selector.md`). Claimed as `deepseek-flash` at `fabf607`;
  the actual executor was the orchestrator (`/root`), recorded here because Git cannot distinguish
  them. Real thumbnails, selected-option summary with six real-value-only metric rows, whole-number
  category bars, PASS/WARNING/FAIL rule checks from the authoritative evaluator, and honest
  empty/infeasible states. 169 tests, typecheck/build/diagnostics clean, browser 1536 × 1024 evidence
  captured with a DOM digest.
- **Bucket 5.6 closes the baseline-provenance finding.** `benchmarkInputManifest()` now hashes
  LF-normalised content, so the fingerprint describes the source rather than the checkout, and the
  baseline was re-recorded. Record: `artifacts/planlab/milestone-5/5.6-baseline-provenance.md`. Proof
  the re-record hid no drift: comparing the old and new baselines, every canonical per-seed hash,
  impossible fixture, historical baseline, budget and seed value is byte-identical — only
  `benchmarkInputFingerprint` moved. `benchmark:stage0:check` is now **pass: true,
  baselineMatch: true** at median 1815.5 ms / p95 1845.0 ms (measured with a review agent loaded on
  the machine). A `.gitattributes` with `eol=lf` would remove the underlying checkout difference
  entirely and can be done with a bulk renormalisation commit later.
- **Bucket 5.4 is complete** (record: `artifacts/planlab/milestone-5/5.4-generation-states.md`).
  All eight generation states render honestly, the stale affordance is a banner with a working
  Regenerate action (plus an amber status dot and a dimmed plan), the progress readout shows elapsed
  time against the watchdog budget, and the out-of-scope toolbar controls are now genuinely disabled
  instead of looking live. "New variations" implements the UI_ARCHITECTURE retry-vs-new-variations
  split with a deterministic seed bump. 175 tests, typecheck/build/diagnostics clean, four
  1536 × 1024 state captures with DOM digests.
- **Bucket 5.5 is the active bucket** (`todo`, owner `sol-max`). It needs an agent that did not
  author 5.3/5.4, a real 1536 × 1024 comparison against `knowledge/PlanLab-Mockup.png`, and Sol's
  judgment. Two housekeeping facts for whoever picks it up: the committed
  `5.5-review.png` / `5.5-review.json` were byte-identical copies of the 5.4 `complete` capture and
  were removed (they asserted evidence for a review that had not run), and the toolbar/plan
  composition in `5.4-complete.png` is visibly below the mockup, so a fidelity pass may be required
  before 5.5 can pass. 2026-09-15 session constraint: the user asked for the stage to be run without
  a sub-agent fleet, so the fidelity work is done inline and only the independent review is
  delegated.
