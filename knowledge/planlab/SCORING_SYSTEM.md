# Scoring, Metrics, and Explanations

## Principles

- Validate first; invalid candidates receive no design score.
- Measure facts once, normalize through documented functions, then weight.
- Scores compare candidates generated for the same brief; they are not compliance or universal design grades.
- Preferred-area utility plateaus so oversized rooms cannot inflate a score indefinitely.
- Display whole numbers and raw evidence; retain higher internal precision only for stable ranking.

## Category model

Every metric yields a utility in `[0, 1]` and evidence. Weighted category means become 0–100 scores.

1. **Program & Space** — preferred-area satisfaction, proportions, unallocated interior area, excess/shortfall against target footprint.
2. **Flow** — entrance reachability quality, circulation area/length, route distances, dead ends, inappropriate pass-through penalties.
3. **Relationships** — preferred shared walls, nearness, avoidance, and bedroom grouping.
4. **Liveability** — useful exterior contact, simple north opportunity, public/private zoning and privacy depth.
5. **Services & Site** — wet-area clustering, garage relationships/frontage quality, footprint compactness and placement.

Hard room requirements appear as PASS in the rule report and are not awarded score points.

## Core formulas

Area metrics are defined in `DATA_MODEL.md`.

Suggested normalized utilities:

- Preferred area: `min(actual / preferred, 1)` below target, plateau at 1 until an approved oversize tolerance, then a mild decline.
- Aspect: 1 at/below preferred ratio, piecewise decline to 0 at the hard maximum.
- Adjacency: capped useful shared length divided by target shared length.
- Nearness: `max(0, 1 - edgeManhattanDistance / targetDistance)`.
- Exterior: capped orientation-weighted contact length divided by room-kind target length.
- Circulation ratio: 1 at/below target, piecewise decline to 0 at an unacceptable-but-still-valid bound.
- Unallocated ratio: `1 - unallocatedInteriorArea / footprintArea`, with a stronger penalty for narrow disconnected pockets if those are measured reliably.
- Wet clustering: average pair utility using shared-wall bonus plus capped edge distance.
- Bedroom grouping: inverse normalized dispersion of bedroom centres or their access-graph cluster, never an all-pairs adjacency requirement.

Every piecewise breakpoint is a named, versioned configuration value. The canonical fixture must make formula snapshots inspectable.

## Initial category weights

Weights are hypotheses to validate with architects:

| Strategy | Program & Space | Flow | Relationships | Liveability | Services & Site |
|---|---:|---:|---:|---:|---:|
| Compact Efficiency | 40% | 20% | 15% | 10% | 15% |
| Best Flow | 15% | 40% | 25% | 15% | 5% |
| Balanced | 25% | 25% | 20% | 20% | 10% |

All three profiles share identical hard rules and underlying metrics. Search ordering may use profile bias, but candidate analysis calculates all three scorecards so trade-offs remain visible.

The domain exports one frozen `CALIBRATION_SURFACE` (also available as
`SCORING_CALIBRATION`) containing the metric breakpoints, three normalized
profile weight maps, diversity coefficients/threshold, explanation limit, and
semantic `tradeoffs` message descriptors. The descriptor keys and category
values are inspectable domain data; a presentation adapter supplies any final
wording. Hard-rule thresholds remain in the rule/geometry policy and are not
part of a strategy profile, so changing calibration can change desirability or
ordering but cannot make an invalid layout valid or make an infeasible brief
feasible.

## Efficiency reporting

Report, do not conflate:

- site area and buildable area;
- gross footprint area;
- programmed enclosed room area;
- garage area;
- circulation area;
- unallocated interior area;
- planning efficiency (excluding garage from numerator and denominator as defined in `DATA_MODEL.md`) and circulation ratio;
- delta from target/max gross floor area.

Do not reward buildable-envelope coverage. Do not display “87% compliant.” Rule state is PASS/WARNING/FAIL, with unsupported/not-applicable where needed.

## Explanation generation

Every evaluator emits a message descriptor and evidence. A scorecard stores the highest positive and negative contributions per category. A deterministic explanation selector:

1. includes all hard passes/failures in the rule report;
2. selects the most material positive observations;
3. selects the most material trade-offs/warnings;
4. de-duplicates messages about the same subjects/fact;
5. orders by category then absolute impact with stable tie-breaks.

Example domain output:

```ts
{
  message: {
    key: "relationship.preferNear.missed",
    values: { from: "Bathroom", to: "Bedroom 3", distanceM: 7.25 }
  },
  impact: -0.06,
  evidenceRefs: ["distance:bathroom:bedroom-03"]
}
```

The UI formats this record; it does not hardcode the finding. Observations must avoid claims stronger than the metric (say “has 3.0 m north façade contact,” not “has good daylight”).

## False precision controls

- Display whole-number category/overall scores.
- Show raw dimensions/areas beside important findings.
- Mark the score model version.
- Use qualitative comparison when two overall scores round to the same value.
- Avoid adjectives such as compliant, optimal, accessible, or buildable unless their limited PlanLab meaning is explicit.
