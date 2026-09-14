/**
 * Constants approved for the PlanLab mathematical feasibility spike.
 *
 * Geometry is persisted in millimetres at the project boundary and is
 * normalized to these fixed planning-grid units before any solver work.
 */

export const GRID_MM = 250;
export const GRID_UNIT_METRES = GRID_MM / 1_000;
export const GRID_M2 = GRID_UNIT_METRES * GRID_UNIT_METRES;
export const GRID_MM2 = GRID_MM * GRID_MM;

export const TARGET_GFA_M2 = 180;
export const MAX_GFA_M2 = 200;
export const MAX_UNALLOCATED_INTERIOR_RATIO = 0.05;

export const MIN_MEANINGFUL_SHARED_WALL_M = 1;
export const MIN_MEANINGFUL_SHARED_WALL_UNITS =
  MIN_MEANINGFUL_SHARED_WALL_M / GRID_UNIT_METRES;
/** Abstract portal width used by the feasibility spike, in grid units. */
export const MIN_PORTAL_WIDTH_UNITS = MIN_MEANINGFUL_SHARED_WALL_UNITS;

export const GARAGE_MIN_WIDTH_M = 6;
export const GARAGE_MIN_DEPTH_M = 6;
export const GARAGE_MIN_WIDTH_MM = GARAGE_MIN_WIDTH_M * 1_000;
export const GARAGE_MIN_DEPTH_MM = GARAGE_MIN_DEPTH_M * 1_000;
export const GARAGE_MIN_WIDTH_UNITS = GARAGE_MIN_WIDTH_MM / GRID_MM;
export const GARAGE_MIN_DEPTH_UNITS = GARAGE_MIN_DEPTH_MM / GRID_MM;
export const GARAGE_FRONT_SIDE = "south" as const;
export const MIRRORED_LAYOUTS_COUNT_AS_DISTINCT = false;

/**
 * Room shape and preferred-size policy approved at the Stage 3 usefulness gate
 * (2026-09-14, user decision D1).
 *
 * Minimum area alone admits unusable slivers: a 7.00 x 0.75 m bathroom satisfies a
 * 5 m2 minimum exactly, which is how the canonical brief passed hard validity while
 * producing a bathroom nobody could enter. Every habitable room row therefore carries
 * an explicit minimum short side as well as its minimum area.
 *
 * Preferred areas are quality targets and never validity. They make it expensive to
 * dump surplus floor area into a room that is already large enough, which is why the
 * canonical brief produced 35 / 27 / 10.6 m2 interchangeable bedrooms. `maxAspectRatio`
 * is the general anti-sliver guard: a room may not be shaped like a corridor even if
 * its area and short side are satisfied.
 *
 * These are authored brief values, not solver behaviour. A room row in the project
 * document sets them, so a brief editor can change any of them without touching the
 * generator, the validator, or the scoring surface.
 */
export const ROOM_SHAPE_POLICY = Object.freeze({
  bedroom: Object.freeze({ minShortSideM: 3, preferredAreaM2: 16, maxAspectRatio: 2 }),
  bathroom: Object.freeze({ minShortSideM: 1.5, preferredAreaM2: 10, maxAspectRatio: 2 }),
  kitchen: Object.freeze({ minShortSideM: 3, preferredAreaM2: 24, maxAspectRatio: 2 }),
  living: Object.freeze({ minShortSideM: 3, preferredAreaM2: 34, maxAspectRatio: 2 }),
  laundry: Object.freeze({ minShortSideM: 1.5, preferredAreaM2: 8, maxAspectRatio: 2 }),
});

/** Room kinds carrying an approved shape and preferred-size policy. */
export type ShapedRoomKind = keyof typeof ROOM_SHAPE_POLICY;

export const CANONICAL_SITE_WIDTH_M = 20;
export const CANONICAL_SITE_DEPTH_M = 30;
export const CANONICAL_SITE_WIDTH_MM = CANONICAL_SITE_WIDTH_M * 1_000;
export const CANONICAL_SITE_DEPTH_MM = CANONICAL_SITE_DEPTH_M * 1_000;
export const CANONICAL_SITE_WIDTH_UNITS = CANONICAL_SITE_WIDTH_MM / GRID_MM;
export const CANONICAL_SITE_DEPTH_UNITS = CANONICAL_SITE_DEPTH_MM / GRID_MM;

export const CANONICAL_OFFSET_NORTH_M = 2;
export const CANONICAL_OFFSET_EAST_M = 1.5;
export const CANONICAL_OFFSET_SOUTH_M = 6;
export const CANONICAL_OFFSET_WEST_M = 1.5;
export const CANONICAL_OFFSET_NORTH_MM = CANONICAL_OFFSET_NORTH_M * 1_000;
export const CANONICAL_OFFSET_EAST_MM = CANONICAL_OFFSET_EAST_M * 1_000;
export const CANONICAL_OFFSET_SOUTH_MM = CANONICAL_OFFSET_SOUTH_M * 1_000;
export const CANONICAL_OFFSET_WEST_MM = CANONICAL_OFFSET_WEST_M * 1_000;

export const APPROVED_CONSTANTS = Object.freeze({
  GRID_MM,
  GRID_UNIT_METRES,
  GRID_M2,
  TARGET_GFA_M2,
  MAX_GFA_M2,
  MAX_UNALLOCATED_INTERIOR_RATIO,
  MIN_MEANINGFUL_SHARED_WALL_M,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
  MIN_PORTAL_WIDTH_UNITS,
  GARAGE_MIN_WIDTH_M,
  GARAGE_MIN_DEPTH_M,
  GARAGE_MIN_WIDTH_MM,
  GARAGE_MIN_DEPTH_MM,
  GARAGE_MIN_WIDTH_UNITS,
  GARAGE_MIN_DEPTH_UNITS,
  GARAGE_FRONT_SIDE,
  MIRRORED_LAYOUTS_COUNT_AS_DISTINCT,
  FRONT_SIDE: "south" as const,
  FOOTPRINT_CLASS: "rectangle" as const,
});
