import type { CardinalSide, GridRect } from "./geometry.ts";

/** The sentinel used by a portal that touches the outside of the footprint. */
export const EXTERIOR_SPACE_ID = "exterior";

export type SpaceOrExteriorRef = string;
export type SpaceRole = "room" | "circulation" | "entry";

export interface PlacedSpace {
  /** Room instance ID, or a stable generated ID for circulation/entry spaces. */
  instanceId: string;
  role: SpaceRole;
  rect: GridRect;
}

export type PortalKind = "pedestrian" | "vehicle";

export interface AccessPortal {
  id: string;
  a: SpaceOrExteriorRef;
  b: SpaceOrExteriorRef;
  wall: CardinalSide;
  /** Coordinate along the selected wall, in grid units, half-open. */
  start: number;
  length: number;
  kind: PortalKind;
}

export type CirculationSkeletonKind = "straight" | "L" | "T";

export interface LayoutReproducibilityMetadata {
  engineVersion: string;
  ruleVersion: string;
  seed: string;
  topology: CirculationSkeletonKind;
  footprintVariant: string;
  expandedStates: number;
  candidateOrdinal: number;
}

export interface Layout {
  id: string;
  footprint: GridRect;
  spaces: PlacedSpace[];
  portals: AccessPortal[];
  entrancePortalId: string;
  metadata: LayoutReproducibilityMetadata;
}

export interface CirculationSkeleton {
  kind: CirculationSkeletonKind;
  /** Non-overlapping rectangles forming the circulation spine. */
  rectangles: GridRect[];
  entry: GridRect;
  /** Stable generated IDs corresponding to rectangles. */
  rectangleIds: string[];
  entryId: string;
}

export interface FootprintVariant {
  id: string;
  width: number;
  depth: number;
  area: number;
}
