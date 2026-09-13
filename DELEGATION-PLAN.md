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

- [ ] **0.1 Domain harness and canonical fixtures.** Create only the minimal TypeScript test/spike harness needed for integer grid/site/envelope/rectangle geometry, room-instance normalization, approved constants, canonical fixture, and impossible fixtures. Verify exact 80 × 120 site and 68 × 88 envelope plus geometry invariants. — `luna-max`
- [ ] **0.2 Constructive circulation-aware generator.** Add deterministic PRNG, footprint variants, straight/L/T circulation skeletons, frontier-based constructive beam search, garage/entry anchoring, portal graph, and independent hard validation. Verify all emitted layouts pass validation and exact replay is stable. — `luna-max`
- [ ] **0.3 Metrics, scoring, diversity, and crude diagnostics.** Add the minimal approved category metrics, three strategy profiles, evidence-backed observations, interchangeable-room-aware diversity, joint triplet selection, and a crude SVG/text diagnostic suitable for architect review. — `luna-max`
- [ ] **0.4 Seed-suite feasibility benchmark.** Run the 10-seed canonical suite and impossible fixtures; record validity, diversity, determinism, expansion counts, timings, and failure diagnostics in a Milestone 0 report. Tune only centralized prototype constants within the approved model. — `luna-max`
- [ ] **0.5 Independent technical review.** Review the spike for invalid geometry, misleading metrics, determinism leaks, weak tests, and benchmark credibility. Fix only Stage 0 defects and record review evidence. — `terra-max`
- [ ] **0.6 Architect usefulness review — go/no-go.** Present crude outputs and the feasibility report. Do not merge the spike or begin Milestone 1 until the user explicitly approves. **HARD GATE** — `astra-plan`

Future milestones remain defined in
[`knowledge/planlab/IMPLEMENTATION_PLAN.md`](./knowledge/planlab/IMPLEMENTATION_PLAN.md) and are not active.
