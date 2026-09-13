# PlanLab Domain and Data Model

## Modeling principles

- Editable intent (`ProjectBrief`) is distinct from normalized solver input.
- Quantities are authoring convenience; the solver operates on individual stable instances.
- Geometry uses integer grid units only.
- Derived facts are computed once as evidence, not copied into editable state.
- Hard constraints, preferences, and strategy weights are separate concepts.

The following shapes are design-level TypeScript, not implementation.

## Project document

```ts
type ProjectDocument = {
  schemaVersion: 1;
  projectId: string;
  name: string;
  site: SiteBrief;
  program: RoomRequirement[];
  relationships: RelationshipRequirement[];
  planning: PlanningSettings;
  generation: { seed: string };
};
```

`SiteBrief` stores width/depth and front/north/east/west offsets as integer millimetres, plus `frontSide: "south"` and source metadata on every offset. The UI formats millimetres as metres. Normalization derives an exact millimetre envelope and a conservatively inset grid envelope.

`PlanningSettings` contains minimum circulation width, target/max gross floor area policy, and enabled preference settings. Grid resolution is a schema constant for V1, not a user preference.

## Room requirement and instances

```ts
type RoomRequirement = {
  id: string;
  label: string;
  kind: RoomKind;
  quantity: number;
  inclusion: "required" | "optional";
  dimensions: {
    minAreaMm2: number;
    preferredAreaMm2?: number;
    minShortSideMm?: number;
    minWidthMm?: number;
    minDepthMm?: number;
    maxAspectRatio?: number;
  };
  traits: RoomTraits;
};

type RoomInstance = {
  id: string;                 // stable, e.g. requirement ID + ordinal
  requirementId: string;
  ordinal: number;
  displayName: string;
  kind: RoomKind;
  dimensions: NormalizedDimensionConstraints;
  traits: RoomTraits;
};
```

Quantity is expanded before generation. Interchangeable instances retain ordinals for identity and persistence, but diversity comparison optimally matches them so a bedroom-number swap is not treated as a new design.

Committed lengths and areas are safe integers in millimetres and square millimetres; the UI parses/formats metres and square metres. Avoid a `priority: required|preferred` field on a room: it conflates whether the room may be omitted with whether its dimensions are hard. Use `inclusion` and explicit dimension constraints.

## Room traits

Keep traits small and composable:

```ts
type RoomTraits = {
  zone: "public" | "transition" | "private" | "service";
  wet: boolean;
  exteriorPreference: "none" | "low" | "medium" | "high";
  mayBePassThrough: boolean;
  frontage?: { side: "south"; kind: "vehicle" | "pedestrian" };
  vehicleSpaces?: 1 | 2;
};
```

Defaults come from `RoomKind` but remain visible and overrideable only where the MVP UI supports it. Garage is a room instance with a vehicle-frontage trait and garage dimension preset; it is not a separate geometry system. Entry and hallway are solver-managed circulation spaces unless the architect explicitly adds area targets.

Outdoor spaces are excluded from MVP because they break enclosed-footprint and efficiency semantics.

## Relationships

```ts
type RelationshipRequirement = {
  id: string;
  from: RoomSelector;
  to: RoomSelector;
  kind: "mustShareWall" | "preferShareWall" | "preferNear" |
        "avoidShareWall" | "keepSeparate";
  strength?: number;
  minSharedWallM?: number;
  targetDistanceM?: number;
  source: RuleSource;
};
```

Selectors may reference an instance, a requirement group, or a room kind. Normalization expands group relationships into explicit evaluation pairs using declared aggregation (`any`, `all`, `nearest`, or `average`). Do not leave aggregation implicit.

`mustShareWall` means geometric wall contact, not necessarily a doorway. Access is represented separately.

## Site and offsets

```ts
type Offset = {
  distanceMm: number;
  source: "architect" | "planning" | "system" | "custom";
  sourceRef?: string;
};
```

Offsets are non-negative project constraints, not claims of statutory setbacks. For V1, the buildable envelope is the exact inset rectangle. Normalization rejects offsets whose opposing sums leave no positive envelope and reports any area lost when its solver grid is snapped inward.

## Layout geometry

```ts
type Layout = {
  id: string;
  footprint: GridRect;
  spaces: PlacedSpace[];
  portals: AccessPortal[];
  entrancePortalId: string;
  metadata: ReproducibilityMetadata;
};

type PlacedSpace = {
  instanceId: string;
  role: "room" | "circulation" | "entry";
  rect: GridRect;
};

type AccessPortal = {
  id: string;
  a: SpaceOrExteriorRef;
  b: SpaceOrExteriorRef;
  wall: CardinalSide;
  start: number;
  length: number;
  kind: "pedestrian" | "vehicle";
};
```

V1 spaces are axis-aligned rectangles. A hallway may be represented by multiple non-overlapping rectangles whose union forms one logical circulation component. Portals are abstract traversable edge intervals; no swing or construction detail is implied.

## Derived layout metrics

`LayoutFacts` is an immutable evaluation context containing bounds, overlaps, per-space area/aspect/centre, shared-wall intervals, footprint-boundary contact, portal graph, entrance reachability, room distances, zone transitions, area totals, and service clusters. Validators and scorers consume these same facts.

## Area definitions

- **Site area:** site width × site depth.
- **Buildable area:** envelope width × envelope depth.
- **Footprint area:** V1 footprint rectangle area.
- **Programmed usable area:** union area of non-circulation, non-garage placed rooms.
- **Garage area:** garage union area, always reported separately.
- **Circulation area:** union area of entry/hallway spaces.
- **Unallocated interior area:** footprint area not covered by any placed space.
- **Overlap area:** multiply allocated area; always a hard failure and never subtracted to make totals appear valid.
- **Planning efficiency:** programmed usable area ÷ (footprint area − garage area). This leaves entry/circulation/unallocated area in the denominator while preventing the garage from inflating or unfairly depressing the habitable comparison.
- **Allocation ratio:** (programmed usable area + garage area + circulation area) ÷ footprint area. This diagnoses voids but is not a quality score by itself.

Never call buildable-envelope utilization “layout efficiency.” A smaller sensible building can be better than filling the envelope.
