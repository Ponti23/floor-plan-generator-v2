import type { CardinalSide, GridRect } from "./geometry.ts";

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
  from: string;
  to: string;
  kind: "mustShareWall" | "preferShareWall" | "preferNear" | "avoidShareWall" | "keepSeparate";
  strength?: number;
  minSharedWallM?: number;
  targetDistanceM?: number;
  source: "architect" | "planlab" | "planning" | "building_code" | "custom";
}

export interface PlanningSettings {
  minimumCirculationWidthMm: number;
  targetGfaMm2?: number;
  maxGfaMm2?: number;
  maxUnallocatedInteriorRatio: number;
}

export interface ProjectBrief {
  schemaVersion: 1;
  projectId: string;
  name: string;
  site: SiteBrief;
  program: RoomRequirement[];
  relationships: RelationshipRequirement[];
  planning: PlanningSettings;
  generation: { seed: string };
}

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
  schemaVersion: 1;
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
