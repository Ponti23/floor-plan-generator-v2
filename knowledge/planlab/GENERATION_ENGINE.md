# Layout Generation Engine

## Recommended primary strategy

Use a **topology-seeded constructive beam search on the integer grid**, with explicit circulation skeletons and bounded seeded variation.

This is preferred over pure recursive slicing because it can place rooms along circulation/frontier edges without restricting every layout to a guillotine partition. It is preferred over free random packing, genetic algorithms, or simulated annealing because hard feasibility is maintained and failures are traceable. CP-SAT/MILP remains a future option if the domain proves stable; adding a heavy in-browser solver now would increase bundle/runtime and modeling complexity before the product is validated.

## Search pipeline

1. Normalize the brief, expand room quantities, compile rules, and run cheap infeasibility checks.
2. Derive a bounded set of footprint size/aspect variants from the approved floor-area policy.
3. Enumerate topology families in stable order. Start with straight, L-shaped, and T-shaped circulation spines; each includes a south entry and garage anchor when required.
4. Enumerate a small stable set of legal dimension variants for every room. Preferred sizes plateau; variants do not grow without benefit.
5. Anchor the most constrained elements: garage/entrance, circulation skeleton, required exterior rooms, then remaining rooms ordered by constraint degree and size.
6. Beam-search placements along footprint, circulation, and placed-room frontier edges. Reject partial states on overlap, containment, dimension, frontage, area-cap, or proven-unreachable remainder failures.
7. Rank partial states with an admissibility/feasibility heuristic plus the active strategy bias. Keep a fixed beam width with canonical tie-break keys.
8. Complete portal placement, then independently validate the finished layout.
9. Compute facts and all strategy scorecards for valid candidates.
10. Deduplicate and jointly select a diverse triplet, one label per strategy where possible.

Optional local mutations—sibling/room swaps, corridor variant changes, and one-cell dimension shifts—may be added only after the constructive prototype works. They use the same fixed expansion budget and PRNG.

## Why not the alternatives

| Approach | MVP assessment |
|---|---|
| Random/greedy packing | Simple but frequently traps circulation and gives unstable quality. Useful only for baselines. |
| Pure slicing/BSP | Valid tilings are easy, but layout class and adjacency choices are overly restricted. Useful as one topology family. |
| Simulated annealing | Flexible, but spends many moves in invalid states and is harder to diagnose. Possible later improver. |
| Genetic algorithm | High tuning cost, weak hard-constraint handling, and nondeterministic-feeling failure modes. Defer. |
| CP-SAT/MILP | Powerful constraints, but browser dependency and formulation complexity are premature. Revisit if the spike fails. |
| Exhaustive search | Combinatorial beyond toy programs. Only use for tiny oracle tests. |

## Partial-state pruning

At minimum prune when:

- used/minimum remaining area cannot fit the footprint;
- an unplaced frontage room has no eligible frontage interval;
- a required exterior room has no possible footprint boundary interval;
- remaining frontier intervals cannot fit a room's minimum short side;
- a placed room can no longer obtain an allowed access route;
- a hard must-share-wall relationship is impossible;
- the same canonical partial state has already been reached at equal or better cost.

Use analytical rectangles/intervals for placement and an optional small occupancy mask for rapid coverage/connectivity checks.

## Determinism

Generation is a pure function of:

```text
canonical normalized project
+ solver/rule/scoring versions
+ explicit seed
+ expansion/candidate budgets
```

Use an owned, tested, cross-browser integer PRNG (for example `xoshiro128**`) seeded through a specified string hash. Never call `Math.random()`. Define stable iteration order, stable serialization, explicit numeric rounding, and final tie-break keys. Wall-clock speed must not determine which candidates are accepted.

## Budgets and responsiveness

Use expansion and candidate budgets for semantic/reproducible stopping, plus a wall-clock watchdog only to protect the UI. Starting values to calibrate in Milestone 0:

- beam width 64;
- up to 15,000 state expansions per topology family;
- up to 100 valid candidates per family and 300 total;
- target median under 2 seconds and p95 under 4 seconds on an agreed reference device.

Run in a Web Worker. Report monotonic phase/expansion/valid-count progress and check cancellation frequently. A watchdog timeout returns `budgetExceeded` with diagnostics; it must not silently label a device-dependent partial result as reproducible completion.

## Circulation construction

Circulation is seeded before ordinary rooms rather than discovered as leftover space. A skeleton is an orthogonal union of grid-aligned corridor rectangles at the approved minimum width. Rooms attach through portal-capable shared intervals. The entrance node attaches to the south exterior. The access graph is recomputed and validated independently after construction.

## Infeasibility

The solver cannot guarantee three results for contradictory briefs. It should distinguish:

- input contradiction proved by preflight;
- search budget exhausted with no/few valid candidates;
- valid candidates found but not a sufficiently diverse triplet.

Diagnostics name tight constraints and explored topology families without claiming a mathematical proof unless one exists.

## Diversity and selection

First canonicalize interchangeable instances. Compare valid candidates using:

```text
distance =
  0.45 × adjacency-edge weighted-Jaccard distance
+ 0.35 × normalized matched-room centroid distance
+ 0.10 × (1 - footprint IoU)
+ 0.10 × (1 - circulation-area IoU)
```

Normalize centroids by the buildable envelope. Initial acceptance threshold: `distance >= 0.20`, calibrated against architect-reviewed examples. Decide whether north/south-preserving mirror images count as distinct before freezing the metric.

Select the triplet jointly: maximize strategy scores plus a diversity bonus subject to the threshold, rather than independently taking three top scores. If no diverse triplet exists, return fewer and explain why; never relabel near-duplicates.

## Milestone 0 go/no-go

The primary experiment is whether constructive search can jointly achieve hard validity, circulation, diversity, and browser latency. If it fails after bounded tuning, evaluate a CP-SAT proof-of-concept or narrow the space program/footprint class before building the application UI.

