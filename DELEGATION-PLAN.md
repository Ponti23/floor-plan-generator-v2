# PlanLab — delegation build plan

The approved product and technical plan lives in
[`knowledge/planlab/`](./knowledge/planlab/README.md). The live queue is
[`knowledge/BOARD.md`](./knowledge/BOARD.md), and resume state is in
[`HANDOFF.md`](./HANDOFF.md).

## Conventions

- One bucket is executed and verified before the next begins.
- Sol orchestrates; Luna executes bounded work by default; DeepSeek-Flash may execute routine
  buckets through a verified provider route; Terra handles cross-cutting work and independent
  review. Executor selection and fallback follow the delegation playbook.
- Milestone 0 is a mathematical feasibility spike, not product scaffolding.
- The architect usefulness review is a hard gate. Do not begin Milestone 1 or UI work without explicit approval.

## Approved prototype assumptions

- Target GFA 180 m²; hard maximum 200 m².
- One rectangular footprint with at most 5% unallocated interior area.
- Fixed 250 mm grid; integer geometry.
- Abstract access portals; no detailed doors.
- Transit through entry, hallway, living, and dining only.
- Two-car garage minimum 6 m × 6 m, included in GFA, south frontage required, internal access preferred.
- Meaningful shared wall threshold 1 m.
- Mirrored layouts do not count as distinct.
- Go/no-go target: three valid layouts across 10 fixed seeds, pairwise diversity ≥ 0.20, median runtime <2 s and p95 <4 s on the recorded reference environment.

## Stage 0 — Mathematical feasibility spike

- [x] **0.1 Domain harness and canonical fixtures.** Create only the minimal TypeScript test/spike harness needed for integer grid/site/envelope/rectangle geometry, room-instance normalization, approved constants, canonical fixture, and impossible fixtures. Verify exact 80 × 120 site and 68 × 88 envelope plus geometry invariants. — `luna-max` (`4e045d9`)
- [x] **0.2 Constructive circulation-aware generator.** Add deterministic PRNG, footprint variants, straight/L/T circulation skeletons, frontier-based constructive beam search, garage/entry anchoring, portal graph, and independent hard validation. Verify all emitted layouts pass validation and exact replay is stable. — `luna-max` (`e15d97e`)
- [x] **0.3 Metrics, scoring, diversity, and crude diagnostics.** Add the minimal approved category metrics, three strategy profiles, evidence-backed observations, interchangeable-room-aware diversity, joint triplet selection, and a crude SVG/text diagnostic suitable for architect review. — `luna-max` (`88f88eb`)
- [x] **0.4 Seed-suite feasibility benchmark.** Run the 10-seed canonical suite and impossible fixtures; record validity, diversity, determinism, expansion counts, timings, and failure diagnostics in a Milestone 0 report. Tune only centralized prototype constants within the approved model. — `luna-max` (`4d40d48`)
- [x] **0.5 Independent technical review.** Review the spike for invalid geometry, misleading metrics, determinism leaks, weak tests, and benchmark credibility. Fix only Stage 0 defects and record review evidence. — `terra-max` (`605eb88`)
- [x] **0.6 Architect usefulness review — go/no-go.** Present crude outputs and the feasibility report. Do not merge the spike or begin Milestone 1 until the user explicitly approves. **HARD GATE** — `astra-plan` (**GO approved by user 2026-09-14**)

## Stage 1 — Production domain and geometry core

- [x] **1.1 Versioned domain schema and brief normalization.** Replace spike-only input seams with framework-independent production domain types, a versioned project schema, strict integer-mm parsing, conservative grid normalization, stable IDs and quantity expansion, and structured invalid-brief errors. Preserve the approved Milestone 0 semantics and keep React/browser imports out of domain modules. Verify schema/unit boundaries, canonical normalization, malformed inputs, and stable expansion. — `luna-max` (`0e8589b`)
- [x] **1.2 Production geometry primitives and property oracles.** Harden site, envelope, footprint, rectangle, interval, and coverage operations behind reviewed domain APIs. Preserve the exact canonical envelope and document coordinate/unit invariants in code. Add the full geometry edge-case suite and property tests against small occupancy-grid oracles. — `luna-max` (`ff99f7c`)
- [x] **1.3 Canonical serialization, fingerprinting, and diagnostics.** Add deterministic canonical serialization and stable fingerprints for normalized project/domain values, plus inspectable canonical-fixture and discretization diagnostics. Verify insertion-order independence, replay stability, fingerprint sensitivity, and the documented manual inspection path. — `luna-max` (`113d1d3`)
- [x] **1.4 Independent domain API review.** Review the Stage 1 schema, normalization, geometry, serialization, and tests for leaky spike assumptions, ambiguous units, invalid-state seams, determinism risks, property-test gaps, and accidental framework coupling. Fix only Stage 1 defects, run the complete suite, and record review evidence. — `terra-max` (`e1c6f38`)

## Stage 2 — Access, rules, and validation

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 2): establish authoritative hard validity and
evidence-rich evaluation. Every candidate defect in scope must be detected independently, rule
source/version must be preserved, and unsupported evaluators must never pass silently.

Spec: [`knowledge/planlab/RULE_ENGINE.md`](./knowledge/planlab/RULE_ENGINE.md) (rule model,
evaluation results, hard rules, validation pipeline order, circulation policy) plus
[`DATA_MODEL.md`](./knowledge/planlab/DATA_MODEL.md) (`Layout`, `AccessPortal`, `LayoutFacts`,
area definitions) and [`COORDINATE_SYSTEM.md`](./knowledge/planlab/COORDINATE_SYSTEM.md)
(adjacency, shared edges, exterior contact). Existing seams: `src/domain/validation.ts`,
`src/domain/layout.ts`, `src/domain/geometry.ts`, `src/domain/model.ts`.

- [x] **2.1 Layout facts pass and edge indexes.** Compute one immutable `LayoutFacts` evaluation context per candidate: per-space area/aspect/centre, pairwise overlap areas, an indexed shared-wall interval table, footprint-boundary (exterior) contact index, area totals (footprint, programmed usable, garage, circulation, unallocated, overlap), portal graph, and entrance reachability. Validators and scorers consume these facts instead of recomputing them. Preserve existing verdicts and canonical fingerprints exactly. Verify fact/index correctness against small hand-checked layouts and confirm no fingerprint changes. — `luna-max` (`9a24738`)
- [x] **2.2 Portal geometry and access graph hardening.** Validate portals against real shared/exterior boundary intervals: minimum width and clearance, corner contact never creates a portal, endpoints must belong to the declared interval and wall side, and pedestrian/vehicle kinds stay distinct. Harden entrance-rooted pedestrian reachability and the pass-through policy (private/bathroom/WC/garage/laundry/storage may not be transit nodes; entry/circulation may; living/dining/kitchen only when the project policy permits open-plan circulation). Reachability must not be inferrable from mere adjacency. Verify portal boundary cases, graph reachability, and forbidden pass-through. — `luna-max` (`7f87add`)
- [x] **2.3 Rule definitions, instances, and the ordered validator.** Add the typed evaluator registry: immutable definition ids/versions, rule instances carrying `enforcement`, `source`, `parameters`, and `scope`, and a stable ordered validation pipeline (schema/normalized input → site/envelope/footprint → rectangle integrity and containment → overlap/coverage → room presence and dimensions → portal geometry → reachability/pass-through → garage/frontage and hard relationships). Return all safe-to-compute violations with stable code, rule id/version, severity, subjects, expected/actual, geometry evidence, and a message descriptor; unknown definitions report `unsupported`, never pass. Migrate the existing spike checks onto the registry without changing any verdict. Escalated to Terra: this replaces the structure of a 23 kB module whose result shape is consumed by the generator and metrics, so it is integration-heavy and determinism-risky. — `terra-max` (`2a4f216`; orchestrator-judged: 15/15 deliberately broken layouts keep the same verdict and the same violation set, with payloads equal-or-enriched and ordering now matching the documented pipeline)
- [x] **2.4 Relationship, garage, and circulation hard rules.** Implement `mustShareWall` as exact geometric wall contact (not a doorway) with explicit selector aggregation (`any`/`all`/`nearest`/`average`), unresolved-selector intent rules, garage vehicle frontage on the south boundary plus the minimum garage preset, and minimum circulation width. Ensure multiple simultaneous violations are reported stably and in deterministic order. Verify selector aggregation, garage frontage, circulation width, and multi-violation stability. — `luna-max` (`f93ddd3`)
- [x] **2.5 Independent Milestone 2 review.** Review the whole validation stack for indistinguishable-adjacency gaps, portals that admit traversal without a real shared interval, weak pass-through policy, unsupported evaluators passing silently, lost rule source/version provenance, verdict drift against Stage 1 behaviour, and property-test gaps. Fix only Stage 2 defects, run the complete suite, and record review evidence under `artifacts/planlab/milestone-2/`. — `terra-max` (reason: independent review; the orchestrator judges the Terra-authored 2.3 directly) (`ded4d73`; verdict **PASS WITH OPEN FINDINGS**, evidence in `artifacts/planlab/milestone-2/validation-review.md`)

Stage 2 is complete. All five buckets landed on `main` and the independent review passed on
2026-09-14 with three access-layer defects fixed and three open findings recorded (one is a user
decision about Stage 0 benchmark evidence; see `HANDOFF.md`). Stage 3 and beyond remain defined in
[`knowledge/planlab/IMPLEMENTATION_PLAN.md`](./knowledge/planlab/IMPLEMENTATION_PLAN.md) and are not
active until staged.

## Stage 3 — Generator, metrics, scoring, and diversity

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 3): deliver the production deterministic layout
pipeline and three strategy results. Acceptance: the canonical seed suite meets the approved
validity/diversity/expansion gates; all output is reproducible; "fewer than three" and
"infeasible" are distinct outcomes; profiles never alter hard validity. **Definition of done is a
user hard gate** — the architect approves mathematical usefulness and the scoring language.

Spec: [`SCORING_SYSTEM.md`](./knowledge/planlab/SCORING_SYSTEM.md), [`GENERATION_ENGINE.md`](./knowledge/planlab/GENERATION_ENGINE.md),
[`DATA_MODEL.md`](./knowledge/planlab/DATA_MODEL.md), [`TESTING_STRATEGY.md`](./knowledge/planlab/TESTING_STRATEGY.md).
Existing seams: `src/domain/generator.ts`, `metrics.ts`, `scoring.ts`, `diversity.ts`,
`scripts/benchmark-stage0.mjs`, `test/planlab-scoring.test.ts`, `test/generator.test.ts`.
Much of this already exists as a Stage 0 prototype; the work here is hardening it to production
contracts and proving the claims it currently asserts.

- [x] **3.1 Metric formulas and false-precision controls.** Pin the five category metrics and their
  documented formulas against `SCORING_SYSTEM.md`: breakpoints, boundedness, monotonicity where the
  spec claims it, and the efficiency-reporting rules (planning efficiency vs allocation ratio,
  garage never inflating habitable comparison). Keep false-precision controls honest — no
  compliance percentage, no metric rescued by a score, invalid geometry always invalid regardless
  of score. Verify formula breakpoints, monotonic responses, bound saturation, and the
  invalid-geometry-never-rescued rule. — `luna-max` (`6089c48`)
- [x] **3.2 Strategy profiles and the calibration surface.** Consolidate every profile weight and
  threshold into one auditable calibration surface, prove a profile can never change hard validity
  or feasibility, and make the strategy trade-off language inspectable so the architect can
  calibrate thresholds. Verify weights normalize as documented, profiles differ only through
  weights, and a profile change cannot flip a hard verdict. — `luna-max` (`c5bff25`)
- [x] **3.3 Interchangeable matching, diversity, and joint triplet selection.** Harden
  interchangeable-instance matching so a bedroom-number swap or a mirror is not a new design, keep
  the diversity distance metric symmetric and bounded, and ensure joint triplet selection reports
  "fewer than three" and "infeasible" as distinct outcomes rather than conflating them. Verify
  mirror/duplicate/topology diversity fixtures, distance symmetry and bounds, and the
  distinct-outcome matrix. — `luna-max` (`e301ed4`, `e8d4b45`)
- [x] **3.4 Determinism, pruning oracle, and regression benchmark.** Pin seeded tie-breaking and the
  fixed expansion budgets, add a pruning oracle proving a pruned branch could not have contained the
  selected optimum, and turn the Stage 0 benchmark into a repeatable regression harness with
  recorded baselines and explicit environment metadata. Verify replay byte-equivalence, budget
  determinism, and benchmark reproducibility. Whatever the outcome of the Stage 0 benchmark
  evidence decision (see `HANDOFF.md`), record its mechanical consequence here rather than changing
  product semantics unilaterally. — `luna-max` (`99e1904`; benchmark deterministic, median-runtime gate open for 3.5 review)
- [x] **3.5 Independent Milestone 3 review.** Review the generator, metrics, scoring, and diversity
  stack for misleading metrics, false precision, determinism leaks, weak tests, pruning-oracle
  credibility, and benchmark honesty. Fix only Stage 3 defects, run the complete suite, and record
  evidence under `artifacts/planlab/milestone-3/`. — `terra-max` (reason: independent review; the
  orchestrator judges Terra-authored work). Reviewed by the orchestrator (no separate agent was
  available in the session) against differential evidence (`d7f82b9`): the median-runtime gate failure was
  attributed to redundant pair comparisons in joint selection and fixed with an identity-keyed
  memo, byte-identical results for all ten canonical seeds, median now **904 ms** (was 3,036 ms);
  the memo had no test teeth, so a brute-force selection oracle and a distance-consistency oracle
  were added; a frontier-cut comment that overstated the tiny-grid oracle's scope was corrected.
  Evidence: `artifacts/planlab/milestone-3/validation-review.md`. All other Stage 3 findings are
  user/architect decisions, not defects.

**Hard gate at the end of Stage 3:** the architect/user explicitly approves mathematical usefulness
and the scoring language before any polished UI work. Do not merge that decision solo.

## Stage 4 — Worker vertical slice

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 4): isolate generation from the UI thread with a
reliable, versioned protocol so editing/rendering stays responsive and cancellation is prompt.

- [x] **4.1 Worker + three-pane UI shell.** Add the versioned worker protocol, `GenerationController`,
  cooperative cancellation through a shared signal, monotonic progress clamping, stale-response
  rejection, watchdog `budgetExceeded`, worker crash/retry recovery, a plain three-pane Vite/TS
  shell, and a Node worker benchmark. Verify protocol parsing, cancellation, stale results, crash
  recovery, integration, and the browser generate/cancel/edit path. — `terra-max` (`89b9fc7`)

Stage 4 is complete. The remaining manual retry/worker-failure browser simulation is accepted as
covered by `test/worker-controller.test.ts`; generate, cancel, and edit/regenerate were verified in
the real browser on 2026-09-15.

## Stage 5 — Minimal functional workspace

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 5): let an architect edit the canonical brief,
generate, inspect, and compare actual results. **This stage is staged, not active.** Two
preconditions block implementation: product/UX/copy approval and the Vite/Next.js shell decision.
The existing Vite/TS shell is the recommended technical default because this is a client-only app
with no backend, SSR, routing, or server actions.

Spec: [`UI_ARCHITECTURE.md`](./knowledge/planlab/UI_ARCHITECTURE.md),
[`PRODUCT_SPEC.md`](./knowledge/planlab/PRODUCT_SPEC.md),
[`TESTING_STRATEGY.md`](./knowledge/planlab/TESTING_STRATEGY.md), and the user-approved visual
direction plus screenshot acceptance contract in
[`FRONTEND_MOCKUP_BRIEF.md`](./knowledge/planlab/FRONTEND_MOCKUP_BRIEF.md).

- [x] **5.0 Product copy + shell decision.** Confirm the final strategy names, conceptual-use
  disclaimer, metric names, infeasibility/budget language, and whether the MVP continues on the
  existing Vite/TS shell or migrates to Next.js. — `astra-plan`; **HARD GATE, owned by the user**
  (answered 2026-09-15: Vite/TS retained, three strategy names, five score rows,
  real-value-only metric rows, disclaimer/prohibited-claims/failure wording all approved; record:
  `artifacts/planlab/milestone-5/5.0-copy-decision-package.md`)
- [x] **5.1 Brief editor state and committed form.** Replace the vertical-slice form with typed
  editor state: site, offsets, area policy, room program, relationships, and planning assumptions.
  Keep local form state separate from committed normalized project state; a changed brief marks
  previous results stale. Use replaceable recommended copy. — `luna-max` (`c63a1d2`)
- [x] **5.2 SVG projection, layers, pan/zoom/fit, and evidence highlight.** Render stable layers in
  order (grid, site, envelope, footprint, spaces/portals, labels, evidence, north/scale) using a
  grid-unit viewBox and a single viewport transform. Add zoom/fit and observation-to-geometry
  highlighting without letting rendering own authoritative geometry. Match the centre-viewport
  hierarchy, framing, palette, and controls in `PlanLab-Mockup.png` without fabricating decorative
  architectural data. — `luna-max` (`96ba89f`)
- [x] **5.3 Result selector and analysis projection.** Show up to three strategy options with honest
  empty/partial states, selection updates the main plan, and the analysis panel projects raw metrics,
  whole-number category scores, observations, and PASS/WARNING/FAIL rule checks from the canonical
  result payload. Match the mockup's horizontal thumbnail cards, selected-option summary, score
  bars, observations, and notice hierarchy. — `luna-max` (`09a9662`; actual executor:
  orchestrator `/root` — Git cannot distinguish the two)
- [x] **5.4 Generation states, stale-result affordances, keyboard/a11y.** Cover `idle`,
  `invalidBrief`, `generating`, `complete`, `partial`, `infeasible`, `budgetExceeded`, and
  `workerError`; make stale results obvious; provide labels, visible focus, keyboard order, and
  non-colour status indicators. — `terra-max` (`3a769e2`; actual executor: orchestrator `/root`)
- [x] **5.5 Independent Milestone 5 review.** Review the editor/projection stack for state ownership
  leaks, stale-result handling, copy hard-gate compliance, SVG accessibility, keyboard behaviour, and
  false-precision presentation. Fix only Milestone 5 defects and record evidence under
  `artifacts/planlab/milestone-5/`. Include a 1536 × 1024 side-by-side comparison against
  `knowledge/PlanLab-Mockup.png`; functional equivalence without recognizable visual fidelity is a
  review failure. — `terra-max` (independent review; Sol judges)

## Stage 6 — Local persistence and recovery

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 6): make the single local project survive a refresh and
a schema change without a backend. **Staged 2026-09-15; active once 5.5 closes.** No user decision
blocks the engineering work. One copy item is a hard gate and stays replaceable until answered:
the reset-confirmation wording and the save-failure wording (see 6.4).

Spec: [`UI_ARCHITECTURE.md`](./knowledge/planlab/UI_ARCHITECTURE.md) "Persistence experience",
[`TESTING_STRATEGY.md`](./knowledge/planlab/TESTING_STRATEGY.md).

- [x] **6.1 Versioned local storage repository.** `1eb5f58`; record `artifacts/planlab/milestone-6/6.1-local-storage-repository.md`. A `ProjectStore` adapter over `localStorage` behind
  an interface: namespaced keys (`planlab:v1:*`), a stored schema/engine version, runtime parse and
  validation of whatever is read, and an injectable storage port so tests never touch a real browser
  store. Acceptance: a round-tripped project is byte-identical after canonical normalization; a
  missing key, a corrupt payload, and an unknown future schema version each return a typed outcome
  rather than throwing. — `luna-max`
- [x] **6.2 Sequential migrations and recovery key.** `c163df9`; mechanism + recovery keys, no v2 to migrate yet — record `artifacts/planlab/milestone-6/6.2-migrations.md`. Migrate older stored documents forward one
  version at a time; when a document cannot be migrated, retain the original under a separate
  recovery key instead of deleting it, and surface that fact in the UI. Acceptance: an old fixture
  migrates to current; a corrupt fixture is preserved under the recovery key and the app still starts.
  — `luna-max`
- [x] **6.3 Debounced autosave, flush and save status.** `b3d47bc`; record `artifacts/planlab/milestone-6/6.3-autosave-restore.md`. Commit-triggered debounce, immediate flush on
  Generate and on page hide, and a save-status projection (`Saved locally` / `Saving` / `Local save
  failed`) that never claims success after a failed write. Acceptance: simulating a storage failure
  leaves the in-memory project intact and shows the failure state; a successful write clears it.
  — `luna-max`
- [x] **6.4 Reset flow and destructive confirmation.** `76299f6`; copy still `needs-human` — record `artifacts/planlab/milestone-6/6.4-reset-flow.md`. Reset removes only PlanLab-owned keys (proved
  by a test that plants a foreign key), requires an explicit confirmation, and states that local data
  will be removed. **Copy is a user hard gate**: ship replaceable defaults and record the pending
  approval rather than freezing wording. — `luna-max`
- [x] **6.5 Engine-version result invalidation.** `c163df9`; record `artifacts/planlab/milestone-6/6.5-result-persistence.md`. A stored result whose engine/scoring version no
  longer matches the running build must be marked stale rather than shown as current. Acceptance: a
  stored payload written under an older version surfaces the stale affordance and is regenerated on
  demand. — `terra-max`
- [x] **6.6 Independent Stage 6 review.** `cd20ff3` (seven fixes) plus `d4da15a`; record `artifacts/planlab/milestone-6/6.6-independent-review.md`. Adversarial pass over storage, migration, failure and reset
  paths: injected corrupt documents, denied storage, version skew, and a refresh/restore browser run.
  Record under `artifacts/planlab/milestone-6/`. — `terra-max` (independent; Sol judges)

## Stage 7 — UX, performance, and deployment

Goal (from `IMPLEMENTATION_PLAN.md` Milestone 7): make the validated MVP responsibly deployable.
**Not active.** Engineering items (7.1–7.3) can be staged without a user decision; 7.4 is a hard
gate owned by the user.

- [x] **7.1 Responsive panel collapse and accessibility sweep.** `7866045`; record `artifacts/planlab/milestone-7/7.1-responsive-accessibility.md`. Panel collapse below the desktop
  breakpoint without shrinking the plan into a sliver; contrast, focus order, and non-colour status
  re-checked across every state. — `terra-max`
- [x] **7.2 Production deployment configuration and support limitations.** `7f9e37f`; record `artifacts/planlab/milestone-7/7.2-deployment.md`. Reproducible Vite
  production build, static-host configuration (Vercel preset: build `npm run build`, output `dist`),
  a README that states the conceptual-use limitation, and a production worker-path smoke test.
  — `luna-max`
- [x] **7.3 Rendering and performance profile with recorded budgets.** `7f9e37f`, re-measured `626dd3e`; record `artifacts/planlab/milestone-7/7.3-performance-profile.md`. Measure the real workspace
  (generation, first paint, SVG projection, thumbnail rendering) and either meet the recorded target
  or revise it explicitly with evidence. Must re-measure the Stage 0 timing gate on a quiet machine
  because its margin is thin. — `terra-max`
- [ ] **7.4 Release approval.** Architect acceptance session using several briefs (not only the
  canonical fixture), plus explicit user approval of product/UX/copy and release. **HARD GATE, owned
  by the user.** — `astra-plan`
