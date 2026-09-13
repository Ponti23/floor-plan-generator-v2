# Open Questions and Approval Decisions

## P0 — Must be approved before Milestone 0

1. **Area policy:** Should users enter a target gross floor area with tolerance, a hard maximum, or should PlanLab derive a range? **Recommendation:** optional target plus hard maximum; when omitted, derive a disclosed range from preferred room areas, garage preset, and circulation allowance. Rename “Max Area” to “Compact Efficiency.”
2. **Footprint class:** Is V1 limited to one grid-aligned rectangular enclosed footprint? **Recommendation:** yes for the feasibility prototype; defer rectilinear unions/courtyards.
3. **Footprint coverage:** May the rectangle contain unallocated interior area? **Recommendation:** allow a small measured amount during search, penalize it, and set an architect-approved maximum; do not mislabel unused site as waste.
4. **Access semantics:** Are abstract portals on door-capable shared-wall intervals sufficient for MVP? **Recommendation:** yes; detailed doors/swings remain out of scope.
5. **Pass-through policy:** Which rooms may be on a route? **Recommendation:** entry/circulation always; living/dining and optionally kitchen only under an explicit open-plan policy; never bedroom, bathroom/WC, garage, laundry, or storage.
6. **Garage:** Does it remain in Milestone 0, and is it enclosed within footprint/GFA? **Recommendation:** keep it because it is central to the canonical brief, include it in gross footprint but report habitable/program efficiency separately.
7. **Garage dimensions/access:** Approve minimum one/two-car dimensions, vehicle opening width, internal pedestrian-access rule, and whether a clear driveway strip across the south offset is validated. **Recommendation:** architect supplies the dimensional preset; require south vehicle frontage and prefer, rather than require, internal access initially.
8. **Dimension meaning:** Does a bedroom “3 m minimum width” mean minimum short side regardless of rotation? **Recommendation:** yes; use axis-specific width/depth only when orientation is locked.
9. **Required adjacency:** May users create hard `mustShareWall` rules in MVP, and does that imply a portal? **Recommendation:** support a small advanced hard rule; shared wall and access portal are separate choices.
10. **Shared edge thresholds:** Approve useful adjacency/exterior contact and pedestrian portal thresholds/end clearance. **Recommendation:** start meaningful adjacency/exterior at 1.0 m, but do not invent a door clearance standard without architect input.
11. **Diversity:** Do east/west mirror images count as distinct? **Recommendation:** normally no unless site constraints or orientation scores make the mirror materially different.
12. **Go/no-go gate:** Approve seed suite, diversity threshold, candidate budget, reference device, and success rate. **Recommendation:** pairwise distance ≥ 0.20, median <2 s and p95 <4 s, with three valid results for every seed in a small agreed fixture suite; calibrate during the spike.

## P1 — Approve before UI integration

13. Final strategy names and descriptions.
14. Exact conceptual-use disclaimer and prohibited claims.
15. Whether entry is always solver-generated or can be a user-programmed space.
16. Whether open-plan kitchen/living/dining are separate rectangles connected by wide portals or may be a combined space. **Recommendation:** separate rectangles with wide abstract connections in V1.
17. Whether preferred/optional rooms may be omitted. **Recommendation:** required/optional inclusion is explicit; unmet optional rooms reduce program utility but do not invalidate.
18. Whether to persist the last three results or regenerate them. **Recommendation:** persist the brief and seed only until regeneration latency is proven problematic.
19. Whether score values should be visible at all during early architect testing. **Recommendation:** show category bands/raw metrics first and use whole-number scores only after calibration.
20. Supported desktop browsers and the reference performance device.

## Assumptions the prototype may make unless rejected

- Single storey, rectangular site/envelope/footprint, north up and south frontage.
- 250 mm fixed solver grid; exact authoring values are integer millimetres and the feasible envelope snaps inward.
- Zero-thickness planning boundaries and conceptual net room dimensions.
- Axis-aligned rectangular rooms; outdoor spaces, pantry, wardrobes, ensuite, and WC presets are deferred.
- Exterior contact means building-façade opportunity only.
- Hard failure may legitimately yield fewer than three layouts; PlanLab never relaxes hard constraints silently.
- No backend, account, database, remote rule pack, telemetry, or LLM.

## Biggest risks

**Technical:** circulation couples room placement, frontage, adjacency, and exterior allocation. The solver may find collision-free rectangles yet fail to produce three connected, diverse, plausible layouts within a deterministic browser budget.

**Product:** mathematically valid rectangle arrangements may look architecturally naive because V1 omits structure, openings, furniture clearances, wall thickness, and nuanced spatial intent. Architects may not find the options useful even when every encoded rule passes.

## Questions that do not need to block Milestone 0

Exact visual styling, mobile layout, export formats, accounts, future regulatory pack transport, LLM provider, cloud persistence, collaboration, and detailed solar methods can wait. Designing those now would not reduce the feasibility risk.

# RECOMMENDED NEXT ACTION

Hold one decision review covering P0 items 1–12. Record the approved area policy, rectangular-footprint restriction, portal/pass-through semantics, garage preset/frontage behaviour, adjacency thresholds, diversity treatment, and measurable spike gate. Then authorize **Milestone 0 only** as an intentionally crude mathematical feasibility experiment. Do not authorize application scaffolding or polished UI until the prototype passes the architect usefulness review.

