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

Future milestones remain defined in
[`knowledge/planlab/IMPLEMENTATION_PLAN.md`](./knowledge/planlab/IMPLEMENTATION_PLAN.md) and are not active.
