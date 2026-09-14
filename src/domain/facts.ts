/**
 * The single geometry pass behind `LayoutFacts`.
 *
 * One immutable evaluation context is computed per candidate and shared by
 * validators, scorers, and diagnostics.  Everything here is pure geometry
 * (areas, overlaps, shared-wall intervals, exterior contact) with no project
 * semantics, so scoring rules can change without moving the indexes underneath
 * them — and the indexes can harden without moving any verdict.
 */

import { MIN_MEANINGFUL_SHARED_WALL_UNITS } from "./constants.ts";
import {
  area,
  exteriorContactBySide,
  intersection,
  intervalLength,
  isGridRect,
  overlapArea,
  sharedWallSegments,
  unallocatedInteriorArea,
  type CardinalSide,
  type GridInterval,
  type GridRect,
} from "./geometry.ts";
import type { Layout, PlacedSpace } from "./layout.ts";

/** A positive-area intersection between two placed spaces. */
export interface OverlapFact {
  a: string;
  b: string;
  areaUnits2: number;
  /** The intersecting rectangle, clipped to the positive-area overlap. */
  rect: GridRect;
}

/**
 * One continuous stretch of wall shared by two placed spaces.  A pair can
 * produce more than one interval (an L-shaped contact), so intervals carry the
 * faces they belong to rather than assuming a single side per space.
 */
export interface SharedWallIntervalFact {
  /** Earlier placed space in layout order; `aSide` faces `b`. */
  a: string;
  b: string;
  aSide: CardinalSide;
  bSide: CardinalSide;
  /** Wall line coordinate: `x` for vertical walls, `y` for horizontal ones. */
  fixed: number;
  interval: GridInterval;
  lengthUnits: number;
  meaningful: boolean;
}

export interface ExteriorContactFact {
  instanceId: string;
  /** Footprint-boundary contact by side, ignoring other spaces. */
  footprintBySide: Record<CardinalSide, number>;
  /** Footprint-boundary contact by side minus stretches blocked by other spaces. */
  exposedBySide: Record<CardinalSide, number>;
  exposedTotalUnits: number;
}

export interface LayoutIndexes {
  layoutId: string;
  /** Well-formed placed spaces in declared order; malformed rectangles are skipped. */
  spaces: readonly PlacedSpace[];
  /** Footprint resolved the way `LayoutFacts` resolves it, including the degenerate fallback. */
  footprint: GridRect;
  footprintValid: boolean;
  footprintAreaUnits2: number;
  /** Pairwise positive-area overlaps in declaration order (i < j). */
  overlaps: readonly OverlapFact[];
  overlapAreaUnits2: number;
  /** Every shared-wall interval for every well-formed pair, in declaration order. */
  sharedWallIntervals: readonly SharedWallIntervalFact[];
  /** The same intervals keyed by `a|b` with ids sorted, for pair lookups. */
  sharedWallIndex: Readonly<Record<string, readonly SharedWallIntervalFact[]>>;
  /** Exterior contact per placed space, aligned with `spaces`. */
  exteriorContacts: readonly ExteriorContactFact[];
  /** The same contacts keyed by instance id; the first occurrence wins for duplicate ids. */
  exteriorContactIndex: Readonly<Record<string, ExteriorContactFact>>;
  unallocatedInteriorAreaUnits2: number;
}

const EMPTY_FOOTPRINT: GridRect = Object.freeze({ x: 0, y: 0, width: 1, depth: 1 });

/** Stable pair key: ids sorted, so `a|b` and `b|a` address the same contact. */
export function spacePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Well-formed placed spaces in declared order; malformed rectangles are skipped. */
export function placedSpaces(layout: Layout): PlacedSpace[] {
  return (Array.isArray(layout.spaces) ? layout.spaces : []).filter(
    (space): space is PlacedSpace & { rect: GridRect } => isGridRect(space.rect),
  );
}

export function buildLayoutIndexes(layout: Layout): LayoutIndexes {
  const spaces = placedSpaces(layout);
  const rects = spaces.map((space) => space.rect);
  const footprintValid = isGridRect(layout.footprint);
  const footprint = footprintValid ? layout.footprint : EMPTY_FOOTPRINT;

  const overlaps: OverlapFact[] = [];
  const sharedWallIntervals: SharedWallIntervalFact[] = [];
  const sharedWallIndex: Record<string, SharedWallIntervalFact[]> = {};
  for (let first = 0; first < spaces.length; first += 1) {
    for (let second = first + 1; second < spaces.length; second += 1) {
      const a = spaces[first];
      const b = spaces[second];
      const overlap = intersection(a.rect, b.rect);
      if (overlap) {
        overlaps.push({
          a: a.instanceId,
          b: b.instanceId,
          areaUnits2: area(overlap),
          rect: Object.freeze({ ...overlap }),
        });
      }
      const key = spacePairKey(a.instanceId, b.instanceId);
      for (const segment of sharedWallSegments(a.rect, b.rect)) {
        const lengthUnits = intervalLength(segment.interval);
        if (lengthUnits <= 0) continue;
        const fact: SharedWallIntervalFact = Object.freeze({
          a: a.instanceId,
          b: b.instanceId,
          aSide: segment.aSide,
          bSide: segment.bSide,
          fixed: segment.fixed,
          interval: Object.freeze({ ...segment.interval }),
          lengthUnits,
          meaningful: lengthUnits >= MIN_MEANINGFUL_SHARED_WALL_UNITS,
        });
        sharedWallIntervals.push(fact);
        (sharedWallIndex[key] ??= []).push(fact);
      }
    }
  }

  const exteriorContacts: ExteriorContactFact[] = spaces.map((space) => {
    const footprintBySide = exteriorContactBySide(space.rect, footprint);
    const exposedBySide = exteriorContactBySide(space.rect, footprint, rects);
    return Object.freeze({
      instanceId: space.instanceId,
      footprintBySide: Object.freeze({ ...footprintBySide }),
      exposedBySide: Object.freeze({ ...exposedBySide }),
      exposedTotalUnits: Object.values(exposedBySide).reduce((sum, value) => sum + value, 0),
    });
  });
  const exteriorContactIndex: Record<string, ExteriorContactFact> = {};
  for (const contact of exteriorContacts) {
    exteriorContactIndex[contact.instanceId] ??= contact;
  }

  return Object.freeze({
    layoutId: layout.id,
    spaces: Object.freeze(spaces.slice()),
    footprint: Object.freeze({ ...footprint }),
    footprintValid,
    footprintAreaUnits2: area(footprint),
    overlaps: Object.freeze(overlaps),
    overlapAreaUnits2: overlapArea(rects),
    sharedWallIntervals: Object.freeze(sharedWallIntervals),
    sharedWallIndex: Object.freeze(
      Object.fromEntries(
        Object.entries(sharedWallIndex).map(([key, facts]) => [key, Object.freeze(facts.slice())]),
      ),
    ),
    exteriorContacts: Object.freeze(exteriorContacts),
    exteriorContactIndex: Object.freeze(exteriorContactIndex),
    unallocatedInteriorAreaUnits2: unallocatedInteriorArea(footprint, rects),
  });
}
