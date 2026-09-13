# Testing Strategy

## Test philosophy

The domain engine must be testable without React, the DOM, a browser, or storage. Prefer invariant and property tests over large brittle snapshots. Use a small versioned golden seed suite only where exact determinism is the contract.

Recommended tools for the eventual TypeScript stack:

- Vitest for unit/integration tests;
- `fast-check` for property-based geometry and solver invariants;
- Playwright for the small end-to-end browser path;
- Testing Library for interaction-focused component tests where valuable.

No dependency should be installed during planning; these are implementation recommendations.

## Mandatory geometry tests

- metre text → integer millimetre parsing and formatting;
- conservative millimetre-to-grid snapping and reported loss;
- canonical 80 × 120 site and 68 × 88 feasible envelope;
- half-open rectangle intersection, containment, and positive-area overlap;
- edge/corner cases for shared-wall intervals and meaningful adjacency;
- boundary-to-boundary distance;
- exterior contact by cardinal side;
- union/coverage area for multi-rectangle circulation;
- footprint, room, circulation, unallocated, and overlap area identities;
- rotated dimension constraints and aspect ratios.

Property tests should generate bounded integer rectangles and assert symmetry, non-negative areas, containment transitivity where applicable, and agreement between analytical operations and a tiny occupancy-grid oracle.

## Mandatory rules and validation tests

- every hard rule pass/fail boundary;
- all violations are structured, stable, and point to subjects/evidence;
- invalid geometry cannot be rescued by scoring;
- no room omission/duplication after quantity expansion;
- portal must lie on a sufficient shared edge;
- corner touch does not connect rooms;
- entrance reachability and disconnected-room detection;
- forbidden private/service pass-through;
- garage pedestrian versus vehicle portals and south frontage;
- relationship selector/aggregation semantics;
- unknown rule/evaluator versions do not silently pass.

## Mandatory scoring tests

- every normalization function at endpoints and breakpoints;
- utilities remain in `[0, 1]` and respond monotonically where intended;
- preferred-area benefit plateaus and oversize does not inflate indefinitely;
- category/overall weights sum correctly;
- the same facts produce three profile scores without changing validity;
- explanation records trace to evidence and select deterministically;
- hard PASS results do not add design points.

## Mandatory generator tests

- same normalized project + versions + seed + expansion budget gives byte-equivalent canonical layout output;
- no call path uses ambient randomness or wall time for candidate acceptance;
- every emitted recommendation independently passes the validator;
- partial-state pruning never removes known feasible tiny fixtures;
- impossible/contradictory fixtures terminate with typed diagnostics;
- fixed seed suite on the canonical brief meets the approved success-rate/budget target;
- interchangeable room relabeling does not create false diversity;
- identical, mirrored, near-identical, and topologically different pairs exercise the diversity threshold;
- selected triplet satisfies pairwise diversity or explicitly returns partial.

Use exhaustive enumeration on tiny grids as an oracle for selected pruning and feasibility tests.

## Worker and storage tests

- versioned message parsing, monotonic progress, cooperative cancellation, and stale-request rejection;
- worker exception recovery preserves editor state;
- autosave debounce and lifecycle flush;
- schema migration chain;
- corrupt/unknown records are quarantined and never overwrite recovery data;
- data from incompatible engine versions is not presented as current analysis.

## UI/end-to-end tests

One high-value Playwright path is sufficient initially:

1. edit canonical site/program;
2. generate and observe progress;
3. select each distinct option and inspect a linked observation;
4. refresh and verify project restoration;
5. reset and confirm local data removal.

Also test keyboard navigation, visible focus, non-colour rule states, invalid input, cancellation, infeasible brief, fewer-than-three results, and local save failure.

## Milestone 0 acceptance matrix

Before UI-shell approval, the prototype must show:

- exact canonical envelope result;
- three independently hard-valid layouts for each seed in an agreed small seed suite;
- pairwise diversity at or above the calibrated threshold;
- byte-equivalent repeat runs;
- structured impossible-case diagnostics;
- recomputable scores/explanations;
- benchmark evidence on an agreed reference browser/device.

Proposed starting performance target: median under 2 seconds, p95 under 4 seconds. The architect/user must approve the target and seed-suite success criterion before it becomes a gate.

