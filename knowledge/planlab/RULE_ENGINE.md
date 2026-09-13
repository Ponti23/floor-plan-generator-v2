# Rules, Validation, and Explainability

## Central design decision

Use a typed evaluator registry, not a generic expression language. A rule definition is executable application code; a rule instance is serializable project/rule-pack configuration. This is generic enough for versioned packs without building a DSL before the domain is understood.

Do not model `optimization` as a third rule severity. Optimization is a scoring profile that assigns weights to soft measures. Rule enforcement has two levels:

- `hard`: violation invalidates a layout;
- `soft`: evaluator contributes measurements, normalized score, and observations.

Warnings are explanatory findings, not a third validity state.

## Rule model

```ts
type RuleInstance<P> = {
  id: string;
  definitionId: string;
  definitionVersion: number;
  enabled: boolean;
  enforcement: "hard" | "soft";
  source: RuleSource;
  parameters: P;
  scope: RuleScope;
};

type RuleDefinition<P> = {
  id: string;
  version: number;
  category: RuleCategory;
  validateParameters(value: unknown): P;
  evaluate(context: LayoutFacts, rule: RuleInstance<P>): RuleEvaluation;
};
```

`RuleSource` is metadata (`architect`, `planlab`, `planning`, `building_code`, `custom`) and may include issuer/reference/version. It never changes enforcement by itself. A planning-sourced rule is not automatically hard or legally authoritative.

## Evaluation results

```ts
type RuleEvaluation = {
  ruleInstanceId: string;
  status: "pass" | "fail" | "warning" | "notApplicable";
  subjects: EntityRef[];
  evidence: EvidenceValue[];
  score?: { raw: number; normalized: number; weightKey: string };
  message: { key: string; values: Record<string, string | number> };
};
```

Messages are semantic templates produced by the domain layer and localized/formatted in a presentation adapter. React receives a message key and evidence; it does not invent explanations. Evidence includes expected/actual values and geometry references so the UI can highlight the affected rooms.

## Hard rules recommended for MVP

- Valid, representable site/offset/program input.
- Positive buildable envelope and footprint contained within it.
- One footprint matching the approved V1 footprint class.
- Every required room instance present exactly once.
- All placed rectangles have positive integer dimensions and lie in the footprint.
- No positive-area space overlap.
- Required minimum area, width/depth or short-side, and approved maximum aspect ratio.
- One pedestrian entrance on the south footprint boundary.
- Every occupiable room reachable from the entrance through valid portals.
- Forbidden private/service pass-through policy respected.
- Minimum circulation width.
- Garage vehicle frontage on south and garage minimum preset when present.
- Explicit user `mustShareWall` relationships, if hard adjacency is allowed in MVP.

Hard rules must be independently re-run on every completed candidate. Constructor assumptions do not replace validation.

## Soft rules recommended for MVP

- Preferred areas/dimensions and proportions.
- Preferred/avoided adjacency and near/separate relationships.
- Shorter, lower-area circulation and fewer dead ends.
- Public-to-private zoning transitions.
- Room-type-weighted exterior boundary contact.
- North-side opportunity for living/outdoor spaces (simple orientation only).
- Wet-area clustering.
- Garage proximity to entry/kitchen/laundry and separation from bedrooms.
- Unallocated footprint area and excess footprint beyond target.

Avoid fake hard rules such as "all bedrooms require exterior walls" unless the architect explicitly declares them required and accepts infeasibility.

## Validation pipeline

Run checks in a stable order and return all safe-to-compute violations:

1. schema and normalized-input validity;
2. site/envelope/footprint;
3. rectangle integrity and containment;
4. overlap and coverage;
5. room presence and dimensions;
6. portal geometry;
7. entrance/circulation graph reachability and pass-through;
8. garage/frontage and hard relationships.

Each violation has stable code, rule ID/version, severity, subjects, expected, actual, geometry evidence, and message descriptor. Validation output includes `valid`, ordered violations, and counts, but never a compliance percentage.

## Circulation interaction

Geometry answers where spaces and shared boundaries exist. Portals state which boundaries are traversable. The access graph has nodes for entrance/exterior, each room, and circulation components; portal edges connect them. Breadth-first search proves conceptual reachability.

Recommended policy for approval:

- private, bathroom, WC, garage, laundry, and storage spaces may not be transit nodes;
- circulation and entry may be transit nodes;
- living/dining/kitchen pass-through is allowed only if the project policy explicitly permits open-plan circulation;
- corner contact never creates a portal;
- a portal requires a shared interval of sufficient width and clearance.

This is conceptual flow validation, not accessibility or egress compliance.

## Rule packs and versioning

MVP ships one built-in `planlab-core` pack with explicit semantic version and immutable definition versions. A project stores rule instances plus pack/version provenance. Unknown definitions produce `unsupported`, not pass. Future regulatory packs should be signed/static data mapped only to installed evaluators; do not execute arbitrary downloaded rule code.

