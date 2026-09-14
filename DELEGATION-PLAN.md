# PlanLab — delegation build plan

The approved product and technical plan lives in
[`knowledge/planlab/`](./knowledge/planlab/README.md). The live queue is
[`knowledge/BOARD.md`](./knowledge/BOARD.md), and resume state is in
[`HANDOFF.md`](./HANDOFF.md).

## Conventions

- One bucket is executed and verified before the next begins.
- Sol orchestrates; Luna executes bounded work by default; Terra handles cross-cutting work and independent review.
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
- [ ] **2.2 Portal geometry and access graph hardening.** Validate portals against real shared/exterior boundary intervals: minimum width and clearance, corner contact never creates a portal, endpoints must belong to the declared interval and wall side, and pedestrian/vehicle kinds stay distinct. Harden entrance-rooted pedestrian reachability and the pass-through policy (private/bathroom/WC/garage/laundry/storage may not be transit nodes; entry/circulation may; living/dining/kitchen only when the project policy permits open-plan circulation). Reachability must not be inferrable from mere adjacency. Verify portal boundary cases, graph reachability, and forbidden pass-through. — `luna-max`
- [ ] **2.3 Rule definitions, instances, and the ordered validator.** Add the typed evaluator registry: immutable definition ids/versions, rule instances carrying `enforcement`, `source`, `parameters`, and `scope`, and a stable ordered validation pipeline (schema/normalized input → site/envelope/footprint → rectangle integrity and containment → overlap/coverage → room presence and dimensions → portal geometry → reachability/pass-through → garage/frontage and hard relationships). Return all safe-to-compute violations with stable code, rule id/version, severity, subjects, expected/actual, geometry evidence, and a message descriptor; unknown definitions report `unsupported`, never pass. Migrate the existing spike checks onto the registry without changing any verdict. Escalated to Terra: this replaces the structure of a 23 kB module whose result shape is consumed by the generator and metrics, so it is integration-heavy and determinism-risky. — `terra-max` (reason: integration-heavy refactor across module boundaries)
- [ ] **2.4 Relationship, garage, and circulation hard rules.** Implement `mustShareWall` as exact geometric wall contact (not a doorway) with explicit selector aggregation (`any`/`all`/`nearest`/`average`), unresolved-selector intent rules, garage vehicle frontage on the south boundary plus the minimum garage preset, and minimum circulation width. Ensure multiple simultaneous violations are reported stably and in deterministic order. Verify selector aggregation, garage frontage, circulation width, and multi-violation stability. — `luna-max`
- [ ] **2.5 Independent Milestone 2 review.** Review the whole validation stack for indistinguishable-adjacency gaps, portals that admit traversal without a real shared interval, weak pass-through policy, unsupported evaluators passing silently, lost rule source/version provenance, verdict drift against Stage 1 behaviour, and property-test gaps. Fix only Stage 2 defects, run the complete suite, and record review evidence under `artifacts/planlab/milestone-2/`. — `terra-max` (reason: independent review; the orchestrator judges the Terra-authored 2.3 directly)

Future milestones remain defined in
[`knowledge/planlab/IMPLEMENTATION_PLAN.md`](./knowledge/planlab/IMPLEMENTATION_PLAN.md) and are not active.
