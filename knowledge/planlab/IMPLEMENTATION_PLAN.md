# PlanLab Milestone Implementation Plan

## Gate before Milestone 0

Implementation is blocked until the decisions marked **P0** in `OPEN_QUESTIONS.md` are approved. Milestone 0 is an experiment, not permission to scaffold the product UI.

## Milestone 0 — Mathematical feasibility spike

**Goal:** Prove or disprove that the recommended bounded constructive search can produce three valid, circulation-connected, diverse layouts for the canonical fixture.

**Implementation tasks:** Encode minimal integer geometry, canonical fixture, room expansion, rectangular footprint variants, three circulation skeleton families, constructive beam search, independent hard validation, minimal scoring/diversity, deterministic seed/budget, and a crude SVG or textual diagnostic. Keep spike seams replaceable; no production UI.

**Acceptance criteria:** Approved area/footprint/access policies are encoded; an agreed fixed seed suite yields three valid results per seed within the expansion budget and diversity threshold; impossible fixtures return diagnostics; exact replay is byte-equivalent.

**Tests:** Geometry edge cases, portal graph, hard validator, deterministic PRNG/search, tiny-grid pruning oracles, canonical and impossible fixtures.

**Manual verification:** Architect reviews raw plans for obvious box-packing pathologies and judges whether the constrained layout class is useful enough to continue.

**Definition of done:** Evidence records validity, diversity, runtime, failure cases, and architect go/no-go. If the gate fails, narrow scope or test CP-SAT before any UI investment.

## Milestone 1 — Production domain and geometry core

**Goal:** Turn approved spike semantics into stable framework-independent domain foundations.

**Implementation tasks:** Versioned project schema, integer-mm parsing, conservative grid normalization, stable IDs/quantity expansion, site/envelope/footprint primitives, rectangle/interval/coverage operations, canonical serialization and fingerprinting.

**Acceptance criteria:** Domain invariants and unit boundaries are documented in code; canonical envelope is exact; invalid briefs produce structured errors; no React/browser imports exist in domain modules.

**Tests:** Full geometry/unit suite plus property tests against small occupancy-grid oracles.

**Manual verification:** Inspect normalized canonical fixture and discretization diagnostics.

**Definition of done:** Geometry/property suite is green and public domain APIs are reviewed before higher layers depend on them.

## Milestone 2 — Access, rules, and validation

**Goal:** Establish authoritative hard validity and evidence-rich evaluation.

**Implementation tasks:** Layout facts pass, shared/exterior edge indexes, portals, access graph, rule registry/instances, ordered validator, room/relationship/garage/circulation hard rules, structured evidence/message descriptors.

**Acceptance criteria:** Every candidate defect in scope is detected independently; reachability cannot be inferred from mere adjacency; rule source/version is preserved; unsupported evaluators never pass silently.

**Tests:** Rule boundaries, portal geometry, graph reachability, forbidden pass-through, garage frontage, selector aggregation, multi-violation stability.

**Manual verification:** Inspect highlighted violations on deliberately broken layouts.

**Definition of done:** Hard-validation suite is green and downstream scoring cannot accept invalid candidates.

## Milestone 3 — Generator, metrics, scoring, and diversity

**Goal:** Deliver the production deterministic layout pipeline and three strategy results.

**Implementation tasks:** Footprint/topology enumeration, dimension variants, beam search/pruning, seeded tie-breaking, candidate pool, metrics, normalized utilities, strategy profiles, explanations, interchangeable-instance matching, distance metric, joint triplet selection.

**Acceptance criteria:** Canonical seed suite meets the approved validity/diversity/expansion gates; all output is reproducible; fewer-than-three and infeasibility are distinct outcomes; profiles never alter hard validity.

**Tests:** Determinism, pruning oracle, formula breakpoints, monotonic metrics, explanation provenance, mirror/duplicate/topology diversity fixtures, regression benchmarks.

**Manual verification:** Architect compares strategy trade-offs and calibrates thresholds/weights using ugly diagnostic rendering.

**Definition of done:** Architect approves mathematical usefulness and scoring language. This is the hard gate before polished UI.

## Milestone 4 — Worker vertical slice

**Goal:** Isolate generation from the UI thread with a reliable protocol.

**Implementation tasks:** Versioned messages, controller, progress counters, request IDs, cooperative cancellation, stale-response rejection, watchdog outcomes, worker error recovery.

**Acceptance criteria:** Editing/rendering remains responsive; cancellation is prompt; same seed/budget yields the same result; device speed does not change semantic search completion.

**Tests:** Protocol parsing, progress monotonicity, cancellation, stale result, crash/retry, worker/domain integration.

**Manual verification:** Generate, cancel, edit mid-run, retry, and simulate worker failure in a browser.

**Definition of done:** Worker integration is stable under repeated/cancelled requests and benchmarked on the reference device.

## Milestone 5 — Minimal functional workspace

**Goal:** Let an architect edit the canonical brief, generate, inspect, and compare actual results.

**Implementation tasks:** Next.js shell, toolbar, brief panels, result selector/analysis, layered SVG, pan/zoom/fit, evidence highlighting, all generation/error states. Use approved product copy; exclude decorative plan detail and export.

**Acceptance criteria:** End-to-end edit → generate → compare works with real engine data; stale results are obvious; plan layers and units are correct; keyboard navigation and non-colour statuses work.

**Tests:** Focused component interactions and Playwright critical path/error states.

**Manual verification:** Architect completes a brief without developer assistance and correctly explains the option trade-offs.

**Definition of done:** Core workflow is usable and no UI layer owns authoritative geometry, validation, or scoring logic.

## Milestone 6 — Local persistence and recovery

**Goal:** Make the single local project resilient across refreshes and schema evolution.

**Implementation tasks:** Storage repository, namespaced record, debounce/flush, runtime parse, sequential migrations, recovery key, reset flow, save status, engine-version result invalidation.

**Acceptance criteria:** Valid state restores; corrupt/old data recovers safely; reset removes only PlanLab-owned keys; storage failure is visible and non-destructive.

**Tests:** Adapter/unit tests and refresh/reset Playwright coverage.

**Manual verification:** Refresh, upgrade fixture schema, inject corrupt JSON, deny storage, and reset.

**Definition of done:** Recovery behaviours are documented and verified without IndexedDB or backend.

## Milestone 7 — UX, performance, and deployment

**Goal:** Prepare the validated MVP for responsible public use.

**Implementation tasks:** Responsive panel collapse, accessibility pass, rendering/performance profiling, calibrated budgets/weights, failure copy, conceptual-use notice, production build, Vercel configuration, README/support limitations.

**Acceptance criteria:** Approved browser/device matrix passes; performance target is met or clearly revised; no regulatory or construction-ready implication; production build/deploy checks pass.

**Tests:** Full suite, build/type/lint checks, browser smoke, accessibility checks, production worker path.

**Manual verification:** Architect acceptance session using multiple briefs, not only the canonical fixture.

**Definition of done:** Deployment is reproducible, limitations are visible, and the user explicitly approves product/UX/copy and release.

## Sequencing rationale

The original plan placed a UI shell before production geometry and repeated engine work across several milestones. This sequence proves feasibility first, then hardens domain semantics, then exposes the actual engine through a thin UI. Each milestone ends at a reviewable boundary and no milestone is allowed to mask a failed predecessor.

