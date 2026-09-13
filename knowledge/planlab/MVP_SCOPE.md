# PlanLab MVP Scope

## Smallest genuinely useful MVP

The smallest useful product proves one narrow planning problem well:

- one rectangular, level site;
- one rectangular buildable envelope produced by four non-negative offsets;
- one storey and one detached, rectangular building footprint;
- axis-aligned rectangular spaces on a fixed 250 mm planning grid;
- a predefined set of room types plus `other`;
- explicit entrance, circulation spaces, and abstract access portals;
- minimum room area/dimensions, basic adjacency/avoidance, exterior contact, garage frontage, and reachability;
- three deterministic strategies, structured validation, explainable scoring, SVG display, and local persistence.

The rectangular-footprint and slicing-layout restriction is a recommended V1 constraint, not a fact already decided. It must be approved before Milestone 0 because it determines the generator family.

## Included

- Structured site and room-program editing.
- Quantity expansion into stable room instances.
- Optional target/max gross floor area, or an explicitly approved derived-area policy.
- Integer grid geometry and exact hard validation.
- Conceptual access portals sufficient to prove graph reachability.
- Deterministic topology-first generation with bounded search.
- Compact Efficiency, Best Flow, and Balanced selection.
- Candidate deduplication and strategy-specific explanations.
- SVG plan, dimensions, grid, north arrow, lot/envelope/footprint distinction.
- Autosave/restore/reset using versioned `localStorage` records.
- Web Worker generation, progress, timeout, and cancellation.

## Deferred

- Irregular sites, non-uniform/angled setbacks, easements, obstacles, and multiple buildable polygons.
- Non-rectangular footprints, courtyards, disconnected wings, L-shaped/irregular rooms, and multi-storey plans.
- Manual drag/resize/lock, regeneration around locked geometry, undo/redo, and exports.
- Detailed doors, door swings, windows, furniture, wall thickness, and construction assemblies.
- Regulatory rule packs or any compliance guarantee.
- Accessibility, fire egress, structure, plumbing, electrical, HVAC, solar simulation, views, and terrain.
- Accounts, cloud storage, sharing, collaboration, database, backend, and analytics.
- LLM/chat/natural-language changes.

## Scope challenges to the master plan

1. **"Max Area" is ill-posed.** Without a target or cap, it trivially fills the 374 m² envelope. Rename the strategy **Compact Efficiency** and minimize footprint/excess area while satisfying the program, or require a maximum gross floor area.
2. **Circulation needs portals.** Reachability cannot be proved from rectangles alone. V1 needs abstract portal edges even if door symbols and swings are not rendered.
3. **"Required adjacency" is usually too strong.** Only use it when the brief truly makes non-adjacency infeasible; most relationships belong in scoring.
4. **Exterior-wall contact is opportunity, not daylight.** The UI and score names must not imply window, ventilation, or solar performance.
5. **A generic user-authored rule language is premature.** V1 should use a typed evaluator registry plus configurable instances; a DSL/editor can wait.
6. **User-selectable grid resolution is premature.** Fix 250 mm for V1 so validation, fixtures, determinism, and performance remain stable.
7. **Polished room-specific behaviour can expand endlessly.** V1 models only the garage as a special frontage-bearing space; pantry, WC, ensuite, wardrobes, and outdoor areas remain typed rooms with a few flags.

## Missing requirements added to MVP planning

- A floor-area policy (target/cap or derived range).
- A precise portal/access model and pass-through-room policy.
- A wall-thickness convention: V1 geometry represents clear planning zones with zero-thickness shared boundaries; displayed areas are conceptual net areas.
- Infeasible-input and fewer-than-three result states.
- Explicit solver/version metadata for reproduction.
- Numeric limits for site size, room count, and generation budget.
- Browser support and data-loss expectations for local-only persistence.

## MVP limits proposed for approval

- Site dimensions: 3–100 m per side.
- At most 24 generated space instances, including circulation.
- 250 mm grid only.
- One entrance on the south footprint edge and at least one garage vehicle portal on that edge when a garage exists.
- One rectangular footprint contained in the buildable envelope.
- Search stops at the first of 2 seconds elapsed, 20,000 expanded states, or 300 hard-valid candidates; exact values should be tuned by the spike.

These are guardrails, not architectural or regulatory standards.

