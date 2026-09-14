import {
  GRID_MM,
  MAX_GFA_M2,
  MAX_UNALLOCATED_INTERIOR_RATIO,
  TARGET_GFA_M2,
} from "./constants.ts";
import {
  assertGridRect,
  containsRect,
  mm2ToGridAreaCeil,
  mmToGridCeil,
  mmToGridFloor,
  type GridRect,
} from "./geometry.ts";
import type {
  DimensionConstraintsMm,
  NormalizedDimensionConstraints,
  NormalizedProject,
  NormalizedSite,
  Offset,
  ProjectBrief,
  RoomInstance,
  RoomRequirement,
  SiteBrief,
} from "./model.ts";

export type NormalizationIssueCode =
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_SITE_DIMENSION"
  | "INVALID_OFFSET"
  | "NON_POSITIVE_EXACT_ENVELOPE"
  | "NON_POSITIVE_GRID_ENVELOPE"
  | "INVALID_REQUIREMENT"
  | "DUPLICATE_REQUIREMENT_ID"
  | "PROGRAM_TOO_LARGE"
  | "ROOM_CANNOT_FIT_ENVELOPE"
  | "REQUIRED_MINIMUMS_EXCEED_ENVELOPE"
  | "INVALID_PLANNING_SETTINGS";

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  path: string;
  message: string;
  subjectId?: string;
  expected?: number | string;
  actual?: number | string;
}

export type NormalizationResult =
  | { ok: true; value: NormalizedProject }
  | { ok: false; issues: NormalizationIssue[] };

export class NormalizationError extends Error {
  readonly issues: NormalizationIssue[];

  constructor(issues: NormalizationIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "NormalizationError";
    this.issues = issues;
  }
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeLength(
  value: number | undefined,
  path: string,
  issues: NormalizationIssue[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!isSafePositiveInteger(value)) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path,
      message: "dimension must be a positive integer number of millimetres",
      actual: value,
    });
    return undefined;
  }
  return value;
}

function normalizeDimensions(
  dimensions: DimensionConstraintsMm,
  path: string,
  issues: NormalizationIssue[],
): NormalizedDimensionConstraints | null {
  if (!isSafePositiveInteger(dimensions.minAreaMm2)) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path: `${path}.minAreaMm2`,
      message: "minimum area must be a positive safe integer in square millimetres",
      actual: dimensions.minAreaMm2,
    });
    return null;
  }

  const preferredAreaMm2 = dimensions.preferredAreaMm2;
  if (
    preferredAreaMm2 !== undefined &&
    !isSafePositiveInteger(preferredAreaMm2)
  ) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path: `${path}.preferredAreaMm2`,
      message: "preferred area must be a positive safe integer in square millimetres",
      actual: preferredAreaMm2,
    });
  }
  const minShortSideMm = normalizeLength(
    dimensions.minShortSideMm,
    `${path}.minShortSideMm`,
    issues,
  );
  const minWidthMm = normalizeLength(
    dimensions.minWidthMm,
    `${path}.minWidthMm`,
    issues,
  );
  const minDepthMm = normalizeLength(
    dimensions.minDepthMm,
    `${path}.minDepthMm`,
    issues,
  );
  if (
    dimensions.maxAspectRatio !== undefined &&
    (!Number.isFinite(dimensions.maxAspectRatio) || dimensions.maxAspectRatio < 1)
  ) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path: `${path}.maxAspectRatio`,
      message: "maximum aspect ratio must be a finite number at least 1",
      actual: dimensions.maxAspectRatio,
    });
  }

  return {
    minAreaMm2: dimensions.minAreaMm2,
    minAreaUnits2: mm2ToGridAreaCeil(dimensions.minAreaMm2),
    ...(preferredAreaMm2 !== undefined && isSafePositiveInteger(preferredAreaMm2)
      ? {
          preferredAreaMm2,
          preferredAreaUnits2: mm2ToGridAreaCeil(preferredAreaMm2),
        }
      : {}),
    ...(minShortSideMm !== undefined
      ? { minShortSideMm, minShortSideUnits: mmToGridCeil(minShortSideMm) }
      : {}),
    ...(minWidthMm !== undefined
      ? { minWidthMm, minWidthUnits: mmToGridCeil(minWidthMm) }
      : {}),
    ...(minDepthMm !== undefined
      ? { minDepthMm, minDepthUnits: mmToGridCeil(minDepthMm) }
      : {}),
    ...(dimensions.maxAspectRatio !== undefined &&
    Number.isFinite(dimensions.maxAspectRatio) &&
    dimensions.maxAspectRatio >= 1
      ? { maxAspectRatio: dimensions.maxAspectRatio }
      : {}),
  };
}

function normalizeRequirement(
  requirement: RoomRequirement,
  index: number,
  issues: NormalizationIssue[],
): { requirement: RoomRequirement; dimensions: NormalizedDimensionConstraints } | null {
  const path = `program[${index}]`;
  if (
    typeof requirement.id !== "string" ||
    requirement.id.trim().length === 0 ||
    typeof requirement.label !== "string" ||
    requirement.label.trim().length === 0 ||
    !Number.isSafeInteger(requirement.quantity) ||
    requirement.quantity <= 0
  ) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path,
      message: "requirement id/label must be non-empty and quantity must be positive",
      subjectId: requirement.id,
    });
    return null;
  }
  if (
    requirement.kind === "garage" &&
    (requirement.traits.frontage?.kind !== "vehicle" ||
      requirement.traits.frontage.side !== "south")
  ) {
    issues.push({
      code: "INVALID_REQUIREMENT",
      path: `${path}.traits.frontage`,
      message: "a garage must declare south vehicle frontage in the Stage 0 model",
      subjectId: requirement.id,
    });
  }
  const dimensions = normalizeDimensions(requirement.dimensions, `${path}.dimensions`, issues);
  return dimensions === null ? null : { requirement, dimensions };
}

function validateOffset(offset: Offset, path: string, issues: NormalizationIssue[]): void {
  if (
    !isSafeNonNegativeInteger(offset.distanceMm) ||
    !["architect", "planning", "system", "custom"].includes(offset.source)
  ) {
    issues.push({
      code: "INVALID_OFFSET",
      path,
      message: "offset distance must be a non-negative safe integer and source must be known",
      actual: offset.distanceMm,
    });
  }
}

export function normalizeSite(site: SiteBrief): NormalizedSite {
  const issues: NormalizationIssue[] = [];
  if (!isSafePositiveInteger(site.widthMm)) {
    issues.push({
      code: "INVALID_SITE_DIMENSION",
      path: "site.widthMm",
      message: "site width must be a positive safe integer in millimetres",
      actual: site.widthMm,
    });
  }
  if (!isSafePositiveInteger(site.depthMm)) {
    issues.push({
      code: "INVALID_SITE_DIMENSION",
      path: "site.depthMm",
      message: "site depth must be a positive safe integer in millimetres",
      actual: site.depthMm,
    });
  }
  for (const side of ["north", "east", "south", "west"] as const) {
    validateOffset(site.offsets[side], `site.offsets.${side}`, issues);
  }

  const exactEnvelopeWidth =
    site.widthMm - site.offsets.west.distanceMm - site.offsets.east.distanceMm;
  const exactEnvelopeDepth =
    site.depthMm - site.offsets.north.distanceMm - site.offsets.south.distanceMm;
  if (exactEnvelopeWidth <= 0 || exactEnvelopeDepth <= 0) {
    issues.push({
      code: "NON_POSITIVE_EXACT_ENVELOPE",
      path: "site.offsets",
      message: "opposing offsets leave no positive exact envelope",
      expected: "width/depth greater than zero",
      actual: `${exactEnvelopeWidth} × ${exactEnvelopeDepth} mm`,
    });
  }
  if (issues.length > 0) throw new NormalizationError(issues);

  const siteGrid: GridRect = {
    x: 0,
    y: 0,
    width: mmToGridFloor(site.widthMm),
    depth: mmToGridFloor(site.depthMm),
  };
  const leftGrid = mmToGridCeil(site.offsets.west.distanceMm);
  const topGrid = mmToGridCeil(site.offsets.north.distanceMm);
  // Maximum edges are absolute site coordinates, so only the corresponding
  // east/south offset is subtracted here. The west/north inset is represented
  // by the minimum edge (leftGrid/topGrid) above.
  const exactRightBoundary = site.widthMm - site.offsets.east.distanceMm;
  const exactBottomBoundary = site.depthMm - site.offsets.south.distanceMm;
  const rightGrid = mmToGridFloor(exactRightBoundary);
  const bottomGrid = mmToGridFloor(exactBottomBoundary);
  const envelope: GridRect = {
    x: leftGrid,
    y: topGrid,
    width: rightGrid - leftGrid,
    depth: bottomGrid - topGrid,
  };
  if (!isSafePositiveInteger(siteGrid.width) || !isSafePositiveInteger(siteGrid.depth)) {
    issues.push({
      code: "INVALID_SITE_DIMENSION",
      path: "site",
      message: "site is smaller than one planning-grid unit",
    });
  }
  if (!isSafePositiveInteger(envelope.width) || !isSafePositiveInteger(envelope.depth)) {
    issues.push({
      code: "NON_POSITIVE_GRID_ENVELOPE",
      path: "site.offsets",
      message: "conservative grid snapping leaves no positive envelope",
    });
  }
  if (issues.length > 0) throw new NormalizationError(issues);

  assertGridRect(siteGrid, "normalized site");
  assertGridRect(envelope, "normalized envelope");
  if (!containsRect(siteGrid, envelope)) {
    throw new NormalizationError([
      {
        code: "NON_POSITIVE_GRID_ENVELOPE",
        path: "site.offsets",
        message: "snapped envelope is outside the normalized site",
      },
    ]);
  }

  const exactEnvelopeMm = {
    x: site.offsets.west.distanceMm,
    y: site.offsets.north.distanceMm,
    width: exactEnvelopeWidth,
    depth: exactEnvelopeDepth,
  };
  const snappedEnvelopeMm = {
    x: envelope.x * GRID_MM,
    y: envelope.y * GRID_MM,
    width: envelope.width * GRID_MM,
    depth: envelope.depth * GRID_MM,
  };
  const exactArea = exactEnvelopeMm.width * exactEnvelopeMm.depth;
  const snappedArea = snappedEnvelopeMm.width * snappedEnvelopeMm.depth;

  return {
    site: siteGrid,
    envelope,
    exactSiteMm: { x: 0, y: 0, width: site.widthMm, depth: site.depthMm },
    exactEnvelopeMm,
    snappedEnvelopeMm,
    gridInsetLossMm: {
      north: snappedEnvelopeMm.y - exactEnvelopeMm.y,
      west: snappedEnvelopeMm.x - exactEnvelopeMm.x,
      east:
        exactEnvelopeMm.x + exactEnvelopeMm.width -
        (snappedEnvelopeMm.x + snappedEnvelopeMm.width),
      south:
        exactEnvelopeMm.y + exactEnvelopeMm.depth -
        (snappedEnvelopeMm.y + snappedEnvelopeMm.depth),
    },
    discretizationLossMm2: exactArea - snappedArea,
  };
}

export function normalizeRoomRequirements(
  requirements: readonly RoomRequirement[],
): RoomInstance[] {
  const issues: NormalizationIssue[] = [];
  const seenIds = new Set<string>();
  const normalized: RoomInstance[] = [];
  for (const [index, requirement] of requirements.entries()) {
    if (seenIds.has(requirement.id)) {
      issues.push({
        code: "DUPLICATE_REQUIREMENT_ID",
        path: `program[${index}].id`,
        message: `requirement id '${requirement.id}' is duplicated`,
        subjectId: requirement.id,
      });
      continue;
    }
    seenIds.add(requirement.id);
    const result = normalizeRequirement(requirement, index, issues);
    if (result === null) continue;
    for (let ordinal = 1; ordinal <= requirement.quantity; ordinal += 1) {
      normalized.push({
        id: `${requirement.id}-${ordinal}`,
        requirementId: requirement.id,
        ordinal,
        displayName:
          requirement.quantity === 1
            ? requirement.label
            : `${requirement.label} ${ordinal}`,
        kind: requirement.kind,
        inclusion: requirement.inclusion,
        // Instances are independently addressable after quantity expansion.
        // Keep their normalized dimensions isolated too, so an edit to one
        // room cannot silently change every sibling of the requirement.
        dimensions: { ...result.dimensions },
        traits: {
          ...requirement.traits,
          ...(requirement.traits.frontage
            ? { frontage: { ...requirement.traits.frontage } }
            : {}),
        },
      });
    }
  }
  if (normalized.length > 24) {
    issues.push({
      code: "PROGRAM_TOO_LARGE",
      path: "program",
      message: "the prototype supports at most 24 generated space instances",
      expected: 24,
      actual: normalized.length,
    });
  }
  if (issues.length > 0) throw new NormalizationError(issues);
  return normalized;
}

function validatePlanningSettings(
  planning: ProjectBrief["planning"],
  issues: NormalizationIssue[],
): void {
  const approvedMaxGfaMm2 = MAX_GFA_M2 * 1_000_000;
  if (
    !isSafePositiveInteger(planning.minimumCirculationWidthMm) ||
    planning.maxUnallocatedInteriorRatio < 0 ||
    planning.maxUnallocatedInteriorRatio > 1 ||
    !Number.isFinite(planning.maxUnallocatedInteriorRatio)
  ) {
    issues.push({
      code: "INVALID_PLANNING_SETTINGS",
      path: "planning",
      message: "circulation width and unallocated-area ratio are invalid",
    });
  }
  if (
    planning.targetGfaMm2 !== undefined &&
    !isSafePositiveInteger(planning.targetGfaMm2)
  ) {
    issues.push({
      code: "INVALID_PLANNING_SETTINGS",
      path: "planning.targetGfaMm2",
      message: "target GFA must be a positive square-millimetre integer",
      actual: planning.targetGfaMm2,
    });
  }
  if (
    planning.maxGfaMm2 !== undefined &&
    !isSafePositiveInteger(planning.maxGfaMm2)
  ) {
    issues.push({
      code: "INVALID_PLANNING_SETTINGS",
      path: "planning.maxGfaMm2",
      message: "maximum GFA must be a positive square-millimetre integer",
      actual: planning.maxGfaMm2,
    });
  }
  if (
    planning.maxGfaMm2 !== undefined &&
    isSafePositiveInteger(planning.maxGfaMm2) &&
    planning.maxGfaMm2 > approvedMaxGfaMm2
  ) {
    issues.push({
      code: "INVALID_PLANNING_SETTINGS",
      path: "planning.maxGfaMm2",
      message: `maximum GFA cannot exceed the approved ${MAX_GFA_M2} m² hard cap`,
      expected: approvedMaxGfaMm2,
      actual: planning.maxGfaMm2,
    });
  }
  const effectiveMaxGfaMm2 = Math.min(
    planning.maxGfaMm2 ?? approvedMaxGfaMm2,
    approvedMaxGfaMm2,
  );
  if (
    planning.targetGfaMm2 !== undefined &&
    isSafePositiveInteger(planning.targetGfaMm2) &&
    planning.targetGfaMm2 > effectiveMaxGfaMm2
  ) {
    issues.push({
      code: "INVALID_PLANNING_SETTINGS",
      path: "planning",
      message: "target GFA cannot exceed the effective maximum GFA",
      expected: effectiveMaxGfaMm2,
      actual: planning.targetGfaMm2,
    });
  }
}

function roomCanFitEnvelope(room: RoomInstance, envelope: GridRect): boolean {
  const { dimensions } = room;
  const directOrientation =
    (dimensions.minWidthUnits === undefined || dimensions.minWidthUnits <= envelope.width) &&
    (dimensions.minDepthUnits === undefined || dimensions.minDepthUnits <= envelope.depth);
  const rotatedOrientation =
    dimensions.minWidthUnits !== undefined &&
    dimensions.minDepthUnits !== undefined &&
    dimensions.minWidthUnits <= envelope.depth &&
    dimensions.minDepthUnits <= envelope.width;
  // A short-side constraint applies to both rectangle axes.  Comparing it to
  // only the larger envelope dimension can accept a room that cannot fit in
  // either orientation, then misclassify a known input contradiction as a
  // search failure.
  const shortSideFits =
    dimensions.minShortSideUnits === undefined ||
    (dimensions.minShortSideUnits <= envelope.width &&
      dimensions.minShortSideUnits <= envelope.depth);
  if (!shortSideFits || (!directOrientation && !rotatedOrientation)) return false;
  if (dimensions.minAreaUnits2 > envelope.width * envelope.depth) return false;
  return true;
}

export function tryNormalizeProject(project: ProjectBrief): NormalizationResult {
  const issues: NormalizationIssue[] = [];
  if (project.schemaVersion !== 1) {
    issues.push({
      code: "INVALID_SCHEMA_VERSION",
      path: "schemaVersion",
      message: "only project schema version 1 is supported",
      expected: 1,
      actual: project.schemaVersion,
    });
  }
  validatePlanningSettings(project.planning, issues);
  if (issues.length > 0) return { ok: false, issues };

  let site: NormalizedSite;
  let rooms: RoomInstance[];
  try {
    site = normalizeSite(project.site);
  } catch (error) {
    if (error instanceof NormalizationError) return { ok: false, issues: error.issues };
    throw error;
  }
  try {
    rooms = normalizeRoomRequirements(project.program);
  } catch (error) {
    if (error instanceof NormalizationError) return { ok: false, issues: error.issues };
    throw error;
  }

  const fitIssues: NormalizationIssue[] = [];
  const requiredArea = rooms
    .filter((room) => room.inclusion === "required")
    .reduce((sum, room) => sum + room.dimensions.minAreaUnits2, 0);
  for (const room of rooms) {
    if (!roomCanFitEnvelope(room, site.envelope)) {
      fitIssues.push({
        code: "ROOM_CANNOT_FIT_ENVELOPE",
        path: `program.${room.requirementId}`,
        message: `${room.displayName} minimum dimensions/area cannot fit the envelope`,
        subjectId: room.id,
      });
    }
  }
  if (requiredArea > site.envelope.width * site.envelope.depth) {
    fitIssues.push({
      code: "REQUIRED_MINIMUMS_EXCEED_ENVELOPE",
      path: "program",
      message: "required room minimum areas exceed envelope area",
      expected: site.envelope.width * site.envelope.depth,
      actual: requiredArea,
    });
  }
  if (fitIssues.length > 0) return { ok: false, issues: fitIssues };

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      projectId: project.projectId,
      name: project.name,
      site,
      rooms,
      relationships: project.relationships.map((relationship) => ({ ...relationship })),
      planning: {
        minimumCirculationWidthMm: project.planning.minimumCirculationWidthMm,
        minimumCirculationWidthUnits: Math.ceil(
          project.planning.minimumCirculationWidthMm / GRID_MM,
        ),
        ...(project.planning.targetGfaMm2 !== undefined
          ? { targetGfaMm2: project.planning.targetGfaMm2 }
          : {}),
        ...(project.planning.maxGfaMm2 !== undefined
          ? { maxGfaMm2: project.planning.maxGfaMm2 }
          : {}),
        maxUnallocatedInteriorRatio: project.planning.maxUnallocatedInteriorRatio,
      },
      generation: { seed: project.generation.seed },
    },
  };
}

export function normalizeProject(project: ProjectBrief): NormalizedProject {
  const result = tryNormalizeProject(project);
  if (!result.ok) throw new NormalizationError(result.issues);
  return result.value;
}

export const DEFAULT_PLANNING_SETTINGS = Object.freeze({
  minimumCirculationWidthMm: GRID_MM * 4,
  targetGfaMm2: TARGET_GFA_M2 * 1_000_000,
  maxGfaMm2: MAX_GFA_M2 * 1_000_000,
  maxUnallocatedInteriorRatio: MAX_UNALLOCATED_INTERIOR_RATIO,
});
