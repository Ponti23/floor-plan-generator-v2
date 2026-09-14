import {
  GRID_MM,
  GRID_MM2,
  GRID_M2,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
} from "./constants.ts";

export type CardinalSide = "north" | "east" | "south" | "west";

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridSize {
  width: number;
  depth: number;
}

/** An axis-aligned rectangle using half-open intervals. */
export interface GridRect extends GridPoint, GridSize {}

export interface GridInterval {
  start: number;
  end: number;
}

export interface EdgeSegment {
  side: CardinalSide;
  fixed: number;
  interval: GridInterval;
}

export interface SharedWallSegment {
  aSide: CardinalSide;
  bSide: CardinalSide;
  fixed: number;
  interval: GridInterval;
}

export interface MillimetreRect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

function assertSafeInteger(value: number, label: string): void {
  if (!isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  assertSafeInteger(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be positive`);
  }
}

export function isGridRect(value: unknown): value is GridRect {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<GridRect>;
  const { x, y, width, depth } = candidate;
  return (
    isSafeInteger(x ?? NaN) &&
    isSafeInteger(y ?? NaN) &&
    isSafeInteger(width ?? NaN) &&
    isSafeInteger(depth ?? NaN) &&
    width !== undefined &&
    depth !== undefined &&
    width > 0 &&
    depth > 0
  );
}

export function assertGridRect(rect: GridRect, label = "rectangle"): void {
  if (!isGridRect(rect)) {
    throw new TypeError(
      `${label} must contain integer x/y and positive integer width/depth`,
    );
  }
}

export function right(rect: GridRect): number {
  assertGridRect(rect);
  return rect.x + rect.width;
}

export function bottom(rect: GridRect): number {
  assertGridRect(rect);
  return rect.y + rect.depth;
}

export function area(rect: GridRect): number {
  assertGridRect(rect);
  return rect.width * rect.depth;
}

export function areaM2(rect: GridRect): number {
  return area(rect) * GRID_M2;
}

export function containsPoint(rect: GridRect, point: GridPoint): boolean {
  assertGridRect(rect);
  assertSafeInteger(point.x, "point.x");
  assertSafeInteger(point.y, "point.y");
  return (
    point.x >= rect.x &&
    point.x < right(rect) &&
    point.y >= rect.y &&
    point.y < bottom(rect)
  );
}

/** True when the complete child rectangle lies in the parent rectangle. */
export function containsRect(parent: GridRect, child: GridRect): boolean {
  assertGridRect(parent, "parent");
  assertGridRect(child, "child");
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    right(child) <= right(parent) &&
    bottom(child) <= bottom(parent)
  );
}

/** The positive-area intersection; edge/corner contact returns null. */
export function intersection(a: GridRect, b: GridRect): GridRect | null {
  assertGridRect(a, "a");
  assertGridRect(b, "b");
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const rightEdge = Math.min(right(a), right(b));
  const bottomEdge = Math.min(bottom(a), bottom(b));
  if (rightEdge <= left || bottomEdge <= top) return null;
  return {
    x: left,
    y: top,
    width: rightEdge - left,
    depth: bottomEdge - top,
  };
}

export function intersectionArea(a: GridRect, b: GridRect): number {
  const overlap = intersection(a, b);
  return overlap === null ? 0 : area(overlap);
}

export const overlaps = (a: GridRect, b: GridRect): boolean =>
  intersectionArea(a, b) > 0;

export const positiveAreaOverlap = overlaps;

export function intervalLength(interval: GridInterval): number {
  assertSafeInteger(interval.start, "interval.start");
  assertSafeInteger(interval.end, "interval.end");
  return Math.max(0, interval.end - interval.start);
}

export function intervalIntersection(
  a: GridInterval,
  b: GridInterval,
): GridInterval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

export function edgeSegment(rect: GridRect, side: CardinalSide): EdgeSegment {
  assertGridRect(rect);
  switch (side) {
    case "north":
      return { side, fixed: rect.y, interval: { start: rect.x, end: right(rect) } };
    case "east":
      return {
        side,
        fixed: right(rect),
        interval: { start: rect.y, end: bottom(rect) },
      };
    case "south":
      return {
        side,
        fixed: bottom(rect),
        interval: { start: rect.x, end: right(rect) },
      };
    case "west":
      return { side, fixed: rect.x, interval: { start: rect.y, end: bottom(rect) } };
  }
}

/**
 * Return every positive-length coincident edge between two rectangles.
 * Corner contact and overlapping interiors do not produce a shared wall.
 */
export function sharedWallSegments(
  a: GridRect,
  b: GridRect,
): SharedWallSegment[] {
  assertGridRect(a, "a");
  assertGridRect(b, "b");
  const segments: SharedWallSegment[] = [];

  if (right(a) === b.x) {
    const interval = intervalIntersection(
      { start: a.y, end: bottom(a) },
      { start: b.y, end: bottom(b) },
    );
    if (interval) {
      segments.push({ aSide: "east", bSide: "west", fixed: b.x, interval });
    }
  }
  if (right(b) === a.x) {
    const interval = intervalIntersection(
      { start: a.y, end: bottom(a) },
      { start: b.y, end: bottom(b) },
    );
    if (interval) {
      segments.push({ aSide: "west", bSide: "east", fixed: a.x, interval });
    }
  }
  if (bottom(a) === b.y) {
    const interval = intervalIntersection(
      { start: a.x, end: right(a) },
      { start: b.x, end: right(b) },
    );
    if (interval) {
      segments.push({ aSide: "south", bSide: "north", fixed: b.y, interval });
    }
  }
  if (bottom(b) === a.y) {
    const interval = intervalIntersection(
      { start: a.x, end: right(a) },
      { start: b.x, end: right(b) },
    );
    if (interval) {
      segments.push({ aSide: "north", bSide: "south", fixed: a.y, interval });
    }
  }
  return segments;
}

export function sharedWallLength(a: GridRect, b: GridRect): number {
  return sharedWallSegments(a, b).reduce(
    (sum, segment) => sum + intervalLength(segment.interval),
    0,
  );
}

export function meaningfulAdjacency(
  a: GridRect,
  b: GridRect,
  thresholdUnits = MIN_MEANINGFUL_SHARED_WALL_UNITS,
): boolean {
  assertPositiveInteger(thresholdUnits, "thresholdUnits");
  return sharedWallLength(a, b) >= thresholdUnits;
}

export const isMeaningfullyAdjacent = meaningfulAdjacency;

/** Manhattan distance between the closest points on two rectangles. */
export function boundaryDistance(a: GridRect, b: GridRect): number {
  assertGridRect(a, "a");
  assertGridRect(b, "b");
  const horizontal = Math.max(a.x - right(b), b.x - right(a), 0);
  const vertical = Math.max(a.y - bottom(b), b.y - bottom(a), 0);
  return horizontal + vertical;
}

export function centre(rect: GridRect): { x: number; y: number } {
  assertGridRect(rect);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.depth / 2 };
}

export function centreAsRational(rect: GridRect): {
  xNumerator: number;
  yNumerator: number;
  denominator: 2;
} {
  assertGridRect(rect);
  return {
    xNumerator: 2 * rect.x + rect.width,
    yNumerator: 2 * rect.y + rect.depth,
    denominator: 2,
  };
}

function unionLength(intervals: GridInterval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals
    .filter((interval) => intervalLength(interval) > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = 0;
  let start = sorted[0]?.start;
  let end = sorted[0]?.end;
  if (start === undefined || end === undefined) return 0;
  for (const interval of sorted.slice(1)) {
    if (interval.start > end) {
      covered += end - start;
      start = interval.start;
      end = interval.end;
    } else {
      end = Math.max(end, interval.end);
    }
  }
  return covered + end - start;
}

/** Exact union area for a bounded list of axis-aligned integer rectangles. */
export function unionArea(rectangles: readonly GridRect[]): number {
  if (rectangles.length === 0) return 0;
  rectangles.forEach((rect, index) => assertGridRect(rect, `rectangles[${index}]`));
  const xEdges = [
    ...new Set(rectangles.flatMap((rect) => [rect.x, right(rect)])),
  ].sort((a, b) => a - b);
  let total = 0;
  for (let index = 0; index < xEdges.length - 1; index += 1) {
    const xStart = xEdges[index];
    const xEnd = xEdges[index + 1];
    if (xEnd <= xStart) continue;
    const yIntervals = rectangles
      .filter((rect) => rect.x < xEnd && right(rect) > xStart)
      .map((rect) => ({ start: rect.y, end: bottom(rect) }));
    total += (xEnd - xStart) * unionLength(yIntervals);
  }
  return total;
}

export const coverageArea = unionArea;

function subtractInterval(
  base: GridInterval,
  occluders: GridInterval[],
): GridInterval[] {
  let remaining = [base];
  for (const occluder of occluders) {
    const next: GridInterval[] = [];
    for (const interval of remaining) {
      const overlap = intervalIntersection(interval, occluder);
      if (!overlap) {
        next.push(interval);
        continue;
      }
      if (interval.start < overlap.start) {
        next.push({ start: interval.start, end: overlap.start });
      }
      if (overlap.end < interval.end) {
        next.push({ start: overlap.end, end: interval.end });
      }
    }
    remaining = next;
  }
  return remaining;
}

/**
 * Exterior edge opportunity for one room. The optional occluders remove facade
 * intervals hidden by other enclosed spaces.
 */
export function exteriorWallContact(
  rect: GridRect,
  footprint: GridRect,
  side: CardinalSide,
  occluders: readonly GridRect[] = [],
): number {
  assertGridRect(rect, "rect");
  assertGridRect(footprint, "footprint");
  if (!containsRect(footprint, rect)) return 0;
  const roomEdge = edgeSegment(rect, side);
  const footprintEdge = edgeSegment(footprint, side);
  if (roomEdge.fixed !== footprintEdge.fixed) return 0;
  const contact = intervalIntersection(roomEdge.interval, footprintEdge.interval);
  if (!contact) return 0;

  const obscuringIntervals = occluders
    .filter((other) => other !== rect && isGridRect(other))
    .flatMap((other) => {
      const edge = edgeSegment(other, side);
      return edge.fixed === footprintEdge.fixed ? [edge.interval] : [];
    });
  return subtractInterval(contact, obscuringIntervals).reduce(
    (sum, interval) => sum + intervalLength(interval),
    0,
  );
}

export function exteriorContactBySide(
  rect: GridRect,
  footprint: GridRect,
  occluders: readonly GridRect[] = [],
): Record<CardinalSide, number> {
  return {
    north: exteriorWallContact(rect, footprint, "north", occluders),
    east: exteriorWallContact(rect, footprint, "east", occluders),
    south: exteriorWallContact(rect, footprint, "south", occluders),
    west: exteriorWallContact(rect, footprint, "west", occluders),
  };
}

export function totalExteriorWallContact(
  rect: GridRect,
  footprint: GridRect,
  occluders: readonly GridRect[] = [],
): number {
  return Object.values(exteriorContactBySide(rect, footprint, occluders)).reduce(
    (sum, length) => sum + length,
    0,
  );
}

export function mmToGridFloor(mm: number): number {
  assertSafeInteger(mm, "millimetres");
  return Math.floor(mm / GRID_MM);
}

export function mmToGridCeil(mm: number): number {
  assertSafeInteger(mm, "millimetres");
  return Math.ceil(mm / GRID_MM);
}

export function mm2ToGridAreaCeil(mm2: number): number {
  assertSafeInteger(mm2, "square millimetres");
  return Math.ceil(mm2 / GRID_MM2);
}

/**
 * Parse a committed non-negative millimetre value.
 *
 * The project boundary stores dimensions as safe integer millimetres.  This
 * helper deliberately does not coerce arbitrary strings (units, exponents,
 * signs, whitespace, or decimal values) because doing so would make the
 * authored document ambiguous.  A decimal string is accepted only by
 * `parseMetresToMm`, the presentation-to-domain conversion below.
 */
export function parseIntegerMillimetres(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("millimetres must be a non-negative safe integer");
    }
    return value;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("millimetres must be a non-negative integer with no units or decimals");
  }
  const millimetres = BigInt(value);
  if (millimetres > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("millimetre value is outside the safe integer range");
  }
  return Number(millimetres);
}

export const parseMillimetres = parseIntegerMillimetres;
export const parseMillimetresToMm = parseIntegerMillimetres;
export const parseMm = parseIntegerMillimetres;
export const parseIntegerMm = parseIntegerMillimetres;

/** Parse a non-negative metre value exactly to integer millimetres. */
export function parseMetresToMm(value: unknown): number {
  const text = typeof value === "number"
    ? Number.isFinite(value) ? String(value) : ""
    : typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(text)) {
    throw new TypeError(`metres must be a non-negative decimal with at most 3 places: ${text}`);
  }
  const [whole = "0", fraction = ""] = text.split(".");
  // BigInt keeps the conversion exact even near the safe-integer boundary;
  // using Number arithmetic here could round an authored value by a millimetre.
  const millimetres = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0") || "0");
  if (millimetres > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("metre value is outside the safe integer range in millimetres");
  }
  return Number(millimetres);
}

export const metresToMm = parseMetresToMm;

/** Presentation-only conversion; geometry never uses this result. */
export function formatMmAsMetres(mm: number, fractionDigits = 2): string {
  assertSafeInteger(mm, "millimetres");
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new RangeError("fractionDigits must be an integer between 0 and 6");
  }
  return (mm / 1_000).toFixed(fractionDigits);
}

export const formatMetres = formatMmAsMetres;
