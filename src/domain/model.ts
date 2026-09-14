import type { CardinalSide, GridRect } from "./geometry.ts";

/**
 * Version of the editable project document understood by the V1 domain.
 *
 * Keep this value in the domain package (rather than in a UI/storage module)
 * so every boundary agrees on which authored shape it is handling.  A future
 * schema is a migration/API decision; it must not be silently interpreted as
 * V1 by the solver.
 */
export const PROJECT_SCHEMA_VERSION = 1 as const;
export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION;

export type OffsetSource = "architect" | "planning" | "system" | "custom";

export interface Offset {
  distanceMm: number;
  source: OffsetSource;
  sourceRef?: string;
}

export interface SiteBrief {
  widthMm: number;
  depthMm: number;
  offsets: Record<CardinalSide, Offset>;
  frontSide: "south";
}

export type RoomKind =
  | "bedroom"
  | "bathroom"
  | "kitchen"
  | "living"
  | "dining"
  | "laundry"
  | "garage"
  | "hallway"
  | "study"
  | "storage"
  | "other";

/** Explicit selectors keep instance/group/kind intent distinguishable at the authored boundary. */
export type RoomSelector =
  | string
  | { type: "instance"; id: string }
  | { type: "requirement"; id: string }
  | { type: "kind"; kind: RoomKind };

export type RelationshipAggregation = "any" | "all" | "nearest" | "average";

/** Stable textual key used by legacy validators after selector normalization. */
export function roomSelectorKey(selector: RoomSelector): string {
  if (typeof selector === "string") return selector;
  return selector.type === "kind" ? selector.kind : selector.id;
}

export type RoomZone = "public" | "transition" | "private" | "service";

export interface RoomTraits {
  zone: RoomZone;
  wet: boolean;
  exteriorPreference: "none" | "low" | "medium" | "high";
  mayBePassThrough: boolean;
  frontage?: { side: "south"; kind: "vehicle" | "pedestrian" };
  vehicleSpaces?: 1 | 2;
}

export interface DimensionConstraintsMm {
  minAreaMm2: number;
  preferredAreaMm2?: number;
  minShortSideMm?: number;
  minWidthMm?: number;
  minDepthMm?: number;
  maxAspectRatio?: number;
}

export interface RoomRequirement {
  id: string;
  label: string;
  kind: RoomKind;
  quantity: number;
  inclusion: "required" | "optional";
  dimensions: DimensionConstraintsMm;
  traits: RoomTraits;
}

export interface RelationshipRequirement {
  id: string;
  from: RoomSelector;
  to: RoomSelector;
  kind: "mustShareWall" | "preferShareWall" | "preferNear" | "avoidShareWall" | "keepSeparate";
  strength?: number;
  minSharedWallM?: number;
  targetDistanceM?: number;
  aggregation?: RelationshipAggregation;
  source: "architect" | "planlab" | "planning" | "building_code" | "custom";
}

export interface PlanningSettings {
  minimumCirculationWidthMm: number;
  targetGfaMm2?: number;
  maxGfaMm2?: number;
  maxUnallocatedInteriorRatio: number;
}

export interface ProjectBrief {
  schemaVersion: ProjectSchemaVersion;
  projectId: string;
  name: string;
  site: SiteBrief;
  program: RoomRequirement[];
  relationships: RelationshipRequirement[];
  planning: PlanningSettings;
  generation: { seed: string };
}

/** The persisted project-document name used by the storage boundary. */
export type ProjectDocument = ProjectBrief;

export interface NormalizedDimensionConstraints {
  minAreaMm2: number;
  minAreaUnits2: number;
  preferredAreaMm2?: number;
  preferredAreaUnits2?: number;
  minShortSideMm?: number;
  minShortSideUnits?: number;
  minWidthMm?: number;
  minWidthUnits?: number;
  minDepthMm?: number;
  minDepthUnits?: number;
  maxAspectRatio?: number;
}

export interface RoomInstance {
  id: string;
  requirementId: string;
  ordinal: number;
  displayName: string;
  kind: RoomKind;
  inclusion: "required" | "optional";
  dimensions: NormalizedDimensionConstraints;
  traits: RoomTraits;
}

export interface NormalizedSite {
  site: GridRect;
  envelope: GridRect;
  exactSiteMm: { x: 0; y: 0; width: number; depth: number };
  exactEnvelopeMm: { x: number; y: number; width: number; depth: number };
  snappedEnvelopeMm: { x: number; y: number; width: number; depth: number };
  gridInsetLossMm: { north: number; east: number; south: number; west: number };
  discretizationLossMm2: number;
}

export interface NormalizedProject {
  schemaVersion: ProjectSchemaVersion;
  projectId: string;
  name: string;
  site: NormalizedSite;
  rooms: RoomInstance[];
  relationships: RelationshipRequirement[];
  planning: {
    minimumCirculationWidthMm: number;
    minimumCirculationWidthUnits: number;
    targetGfaMm2?: number;
    maxGfaMm2?: number;
    maxUnallocatedInteriorRatio: number;
  };
  generation: { seed: string };
}

// Layout/access shapes are kept in their behaviour-owning module, while these
// type re-exports keep the domain model convenient for callers that import all
// persisted shapes from one module.
export type {
  AccessPortal,
  CirculationSkeleton,
  CirculationSkeletonKind,
  FootprintVariant,
  Layout,
  LayoutReproducibilityMetadata,
  PlacedSpace,
  PortalKind,
  SpaceOrExteriorRef,
  SpaceRole,
} from "./layout.ts";
