# PlanLab Planning Index

**Status:** Planning only. No application, scaffold, dependency, or Milestone 0 work is authorized by these documents.

## Recommended decisions at a glance

- Client-only Next.js/React/TypeScript application; pure domain engine; Web Worker solver; SVG projection; versioned `localStorage` project document.
- Integer-millimetre authored dimensions and a fixed 250 mm integer solver grid; north-west origin, +x east, +y south.
- One rectangular site, buildable envelope, storey, and recommended V1 building footprint; axis-aligned rectangular spaces.
- Explicit circulation geometry plus abstract access portals and an entrance-rooted graph.
- Typed/versioned evaluator registry; hard validation separate from soft metrics and optimization profiles.
- Topology-seeded constructive beam search with straight/L/T circulation skeletons, seeded deterministic tie-breaking, and fixed expansion budgets.
- Joint selection of Compact Efficiency, Best Flow, and Balanced candidates under a calibrated topology/geometry diversity threshold.
- Honest partial/infeasible outcomes; no silent hard-rule relaxation and no compliance claims.

## Documents

- [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) — purpose, user workflow, outputs, success/failure behaviour.
- [`MVP_SCOPE.md`](MVP_SCOPE.md) — smallest useful MVP, deferrals, and challenged assumptions.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — browser architecture, boundaries, worker, storage, and failure isolation.
- [`DATA_MODEL.md`](DATA_MODEL.md) — authored/normalized/layout models, rooms, relationships, portals, and areas.
- [`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md) — units, axes, envelope, geometry semantics, adjacency, and exterior contact.
- [`RULE_ENGINE.md`](RULE_ENGINE.md) — rule definitions/instances, validation, access graph, results, and versioning.
- [`GENERATION_ENGINE.md`](GENERATION_ENGINE.md) — algorithm comparison, chosen search, budgets, determinism, and diversity.
- [`SCORING_SYSTEM.md`](SCORING_SYSTEM.md) — metrics, formulas, initial profiles, explanations, and false-precision controls.
- [`UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) — professional workspace, SVG layers, state, and failure states.
- [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) — mandatory unit/property/integration/browser evidence.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — gated milestone sequence; it is a future plan, not authorization.
- [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) — decisions requiring user/architect input and the recommended next action.

## Master-plan question coverage

The 34 questions in the master plan are answered across the documents above:

| Topic | Primary document |
|---|---|
| Useful MVP, overengineering, missing requirements | `MVP_SCOPE.md` |
| Coordinates, units, grid, envelope, offsets | `COORDINATE_SYSTEM.md` |
| Rooms, garage, layout representation | `DATA_MODEL.md` |
| Circulation, adjacency, exterior contact | `RULE_ENGINE.md`, `COORDINATE_SYSTEM.md` |
| Waste and efficiency | `DATA_MODEL.md`, `SCORING_SYSTEM.md` |
| Hard/soft rules and explanations | `RULE_ENGINE.md` |
| Formula and three strategies | `SCORING_SYSTEM.md` |
| Algorithm, budgets, worker, determinism, diversity | `GENERATION_ENGINE.md` |
| Persistence and schema versions | `ARCHITECTURE.md` |
| Mandatory tests | `TESTING_STRATEGY.md` |
| Milestones and first prototype | `IMPLEMENTATION_PLAN.md` |
| Risks and unresolved decisions | `OPEN_QUESTIONS.md` |

## Approval boundary

Approval should first lock the P0 decisions in `OPEN_QUESTIONS.md`, then authorize only the mathematical feasibility spike. Product scaffolding and UI implementation remain blocked until that spike demonstrates hard validity, diversity, determinism, acceptable latency, and architect-perceived usefulness.

