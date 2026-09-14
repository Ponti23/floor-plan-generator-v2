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
import {
  PROJECT_SCHEMA_VERSION,
  type NormalizedDimensionConstraints,
  type NormalizedProject,
  type NormalizedSite,
  type Offset,
  type ProjectBrief,
  type RelationshipRequirement,
  type RoomInstance,
  type RoomKind,
  type RoomRequirement,
  roomSelectorKey,
  type RoomSelector,
  type RoomTraits,
  type SiteBrief,
} from "./model.ts";

/** The largest bounded input the constructive V1 solver is designed for. */
export const MAX_ROOM_INSTANCES = 24;

export type NormalizationIssueCode =
  | "INVALID_BRIEF"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_SITE_DIMENSION"
  | "INVALID_SITE_FRONT_SIDE"
  | "INVALID_OFFSET"
  | "NON_POSITIVE_EXACT_ENVELOPE"
  | "NON_POSITIVE_GRID_ENVELOPE"
  | "INVALID_REQUIREMENT"
  | "DUPLICATE_REQUIREMENT_ID"
  | "DUPLICATE_INSTANCE_ID"
  | "PROGRAM_TOO_LARGE"
  | "ROOM_CANNOT_FIT_ENVELOPE"
  | "REQUIRED_MINIMUMS_EXCEED_ENVELOPE"
  | "INVALID_RELATIONSHIP"
  | "DUPLICATE_RELATIONSHIP_ID"
  | "UNRESOLVED_RELATIONSHIP_SELECTOR"
  | "INVALID_PLANNING_SETTINGS"
  | "INVALID_GENERATION_SETTINGS";

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  /** Dot/bracket path in the authored project document. */
  path: string;
  message: string;
  subjectId?: string;
  expected?: number | string;
  actual?: number | string | boolean | null;
}

export type NormalizationResult =
  | { ok: true; value: NormalizedProject }
  | { ok: false; issues: NormalizationIssue[] };

/**
 * Public error for an authored brief that cannot become solver input.
 *
 * Consumers can display `issues` without parsing an exception message.  The
 * message is intentionally only a concise fallback for logs and legacy
 * callers; paths/codes are the stable API.
 */
export class InvalidBriefError extends Error {
  readonly code = "INVALID_BRIEF" as const;
  readonly issues: readonly NormalizationIssue[];

  constructor(issues: readonly NormalizationIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "InvalidBriefError";
    this.issues = [...issues];
  }
}

/** Backwards-compatible name used by the Stage 0 generator boundary. */
export class NormalizationError extends InvalidBriefError {
  constructor(issues: readonly NormalizationIssue[]) {
    super(issues);
    this.name = "NormalizationError";
  }
}

const SIDES = ["north", "east", "south", "west"] as const;
const ROOM_KINDS = [
  "bedroom",
  "bathroom",
  "kitchen",
  "living",
  "dining",
  "laundry",
  "garage",
  "hallway",
  "study",
  "storage",
  "other",
] as const satisfies readonly RoomKind[];
const ROOM_ZONES = ["public", "transition", "private", "service"] as const;
const EXTERIOR_PREFERENCES = ["none", "low", "medium", "high"] as const;
const RELATIONSHIP_KINDS = [
  "mustShareWall",
  "preferShareWall",
  "preferNear",
  "avoidShareWall",
  "keepSeparate",
] as const;
const RELATIONSHIP_SOURCES = [
  "architect",
  "planlab",
  "planning",
  "building_code",
  "custom",
] as const;
const RELATIONSHIP_AGGREGATIONS = ["any", "all", "nearest", "average"] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function enumValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function issueActual(value: unknown): NormalizationIssue["actual"] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : null;
}

function addIssue(
  issues: NormalizationIssue[],
  code: NormalizationIssueCode,
  path: string,
  message: string,
  details: Partial<Pick<NormalizationIssue, "subjectId" | "expected" | "actual">> = {},
): void {
  issues.push({ code, path, message, ...details });
}

function safeAreaProduct(widthMm: number, depthMm: number): number | undefined {
  const area = widthMm * depthMm;
  return Number.isSafeInteger(area) && area >= 0 ? area : undefined;
}

function cloneTraits(traits: RoomTraits): RoomTraits {
  return {
    zone: traits.zone,
    wet: traits.wet,
    exteriorPreference: traits.exteriorPreference,
    mayBePassThrough: traits.mayBePassThrough,
    ...(traits.frontage ? { frontage: { ...traits.frontage } } : {}),
    ...(traits.vehicleSpaces === undefined ? {} : { vehicleSpaces: traits.vehicleSpaces }),
  };
}

function validateTraits(
  value: unknown,
  path: string,
  issues: NormalizationIssue[],
): RoomTraits | null {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_REQUIREMENT", path, "room traits must be an object");
    return null;
  }
  const zone = value.zone;
  const wet = value.wet;
  const exteriorPreference = value.exteriorPreference;
  const mayBePassThrough = value.mayBePassThrough;
  if (!enumValue(ROOM_ZONES, zone)) {
    addIssue(issues, "INVALID_REQUIREMENT", `${path}.zone`, "room zone is not supported", {
      actual: issueActual(zone),
    });
  }
  if (typeof wet !== "boolean") {
    addIssue(issues, "INVALID_REQUIREMENT", `${path}.wet`, "wet must be boolean");
  }
  if (!enumValue(EXTERIOR_PREFERENCES, exteriorPreference)) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      `${path}.exteriorPreference`,
      "exterior preference is not supported",
      { actual: issueActual(exteriorPreference) },
    );
  }
  if (typeof mayBePassThrough !== "boolean") {
    addIssue(issues, "INVALID_REQUIREMENT", `${path}.mayBePassThrough`, "mayBePassThrough must be boolean");
  }

  let frontage: RoomTraits["frontage"];
  if (value.frontage !== undefined) {
    if (!isRecord(value.frontage) || value.frontage.side !== "south" ||
        !enumValue(["vehicle", "pedestrian"] as const, value.frontage.kind)) {
      addIssue(
        issues,
        "INVALID_REQUIREMENT",
        `${path}.frontage`,
        "frontage must specify south and vehicle or pedestrian kind",
      );
    } else {
      frontage = { side: "south", kind: value.frontage.kind };
    }
  }
  let vehicleSpaces: 1 | 2 | undefined;
  if (value.vehicleSpaces !== undefined) {
    if (value.vehicleSpaces !== 1 && value.vehicleSpaces !== 2) {
      addIssue(
        issues,
        "INVALID_REQUIREMENT",
        `${path}.vehicleSpaces`,
        "vehicleSpaces must be 1 or 2",
        { actual: issueActual(value.vehicleSpaces) },
      );
    } else {
      vehicleSpaces = value.vehicleSpaces;
    }
  }

  if (!enumValue(ROOM_ZONES, zone) || typeof wet !== "boolean" ||
      !enumValue(EXTERIOR_PREFERENCES, exteriorPreference) ||
      typeof mayBePassThrough !== "boolean") {
    return null;
  }
  return {
    zone,
    wet,
    exteriorPreference,
    mayBePassThrough,
    ...(frontage ? { frontage } : {}),
    ...(vehicleSpaces === undefined ? {} : { vehicleSpaces }),
  };
}

function normalizeLength(
  value: unknown,
  path: string,
  issues: NormalizationIssue[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!isSafePositiveInteger(value)) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      path,
      "dimension must be a positive safe integer number of millimetres",
      { actual: issueActual(value) },
    );
    return undefined;
  }
  return value;
}

function normalizeDimensions(
  value: unknown,
  path: string,
  issues: NormalizationIssue[],
): NormalizedDimensionConstraints | null {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_REQUIREMENT", path, "dimensions must be an object");
    return null;
  }
  const minAreaMm2 = value.minAreaMm2;
  if (!isSafePositiveInteger(minAreaMm2)) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      `${path}.minAreaMm2`,
      "minimum area must be a positive safe integer in square millimetres",
      { actual: issueActual(minAreaMm2) },
    );
    return null;
  }

  let preferredAreaMm2: number | undefined;
  if (value.preferredAreaMm2 !== undefined) {
    if (!isSafePositiveInteger(value.preferredAreaMm2)) {
      addIssue(
        issues,
        "INVALID_REQUIREMENT",
        `${path}.preferredAreaMm2`,
        "preferred area must be a positive safe integer in square millimetres",
        { actual: issueActual(value.preferredAreaMm2) },
      );
    } else {
      preferredAreaMm2 = value.preferredAreaMm2;
      if (preferredAreaMm2 < minAreaMm2) {
        addIssue(
          issues,
          "INVALID_REQUIREMENT",
          `${path}.preferredAreaMm2`,
          "preferred area cannot be smaller than the minimum area",
          { expected: minAreaMm2, actual: preferredAreaMm2 },
        );
      }
    }
  }

  const minShortSideMm = normalizeLength(value.minShortSideMm, `${path}.minShortSideMm`, issues);
  const minWidthMm = normalizeLength(value.minWidthMm, `${path}.minWidthMm`, issues);
  const minDepthMm = normalizeLength(value.minDepthMm, `${path}.minDepthMm`, issues);
  let maxAspectRatio: number | undefined;
  if (value.maxAspectRatio !== undefined) {
    if (typeof value.maxAspectRatio !== "number" ||
        !Number.isFinite(value.maxAspectRatio) || value.maxAspectRatio < 1) {
      addIssue(
        issues,
        "INVALID_REQUIREMENT",
        `${path}.maxAspectRatio`,
        "maximum aspect ratio must be a finite number at least 1",
        { actual: issueActual(value.maxAspectRatio) },
      );
    } else {
      maxAspectRatio = value.maxAspectRatio;
    }
  }

  return {
    minAreaMm2,
    minAreaUnits2: mm2ToGridAreaCeil(minAreaMm2),
    ...(preferredAreaMm2 === undefined ? {} : {
      preferredAreaMm2,
      preferredAreaUnits2: mm2ToGridAreaCeil(preferredAreaMm2),
    }),
    ...(minShortSideMm === undefined ? {} : {
      minShortSideMm,
      minShortSideUnits: mmToGridCeil(minShortSideMm),
    }),
    ...(minWidthMm === undefined ? {} : {
      minWidthMm,
      minWidthUnits: mmToGridCeil(minWidthMm),
    }),
    ...(minDepthMm === undefined ? {} : {
      minDepthMm,
      minDepthUnits: mmToGridCeil(minDepthMm),
    }),
    ...(maxAspectRatio === undefined ? {} : { maxAspectRatio }),
  };
}

interface NormalizedRequirementInput {
  id: string;
  label: string;
  kind: RoomKind;
  quantity: number;
  inclusion: "required" | "optional";
  dimensions: NormalizedDimensionConstraints;
  traits: RoomTraits;
}

function normalizeRequirement(
  value: unknown,
  index: number,
  issues: NormalizationIssue[],
): NormalizedRequirementInput | null {
  const path = `program[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_REQUIREMENT", path, "room requirement must be an object");
    return null;
  }

  const rawId = value.id;
  const rawLabel = value.label;
  const rawKind = value.kind;
  const rawQuantity = value.quantity;
  const rawInclusion = value.inclusion;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  const kind = enumValue(ROOM_KINDS, rawKind) ? rawKind : undefined;
  const inclusion = enumValue(["required", "optional"] as const, rawInclusion)
    ? rawInclusion
    : undefined;
  const quantity = isSafePositiveInteger(rawQuantity) ? rawQuantity : undefined;
  let valid = true;
  if (id.length === 0 || label.length === 0) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      path,
      "requirement id and label must be non-empty strings",
      { subjectId: id || undefined },
    );
    valid = false;
  }
  if (!enumValue(ROOM_KINDS, rawKind)) {
    addIssue(issues, "INVALID_REQUIREMENT", `${path}.kind`, "room kind is not supported", {
      subjectId: id || undefined,
      actual: issueActual(rawKind),
    });
    valid = false;
  }
  if (!enumValue(["required", "optional"] as const, rawInclusion)) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      `${path}.inclusion`,
      "inclusion must be required or optional",
      { subjectId: id || undefined, actual: issueActual(rawInclusion) },
    );
    valid = false;
  }
  if (!isSafePositiveInteger(rawQuantity)) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      `${path}.quantity`,
      "quantity must be a positive safe integer",
      { subjectId: id || undefined, actual: issueActual(rawQuantity) },
    );
    valid = false;
  }
  const dimensions = normalizeDimensions(value.dimensions, `${path}.dimensions`, issues);
  const traits = validateTraits(value.traits, `${path}.traits`, issues);
  if (dimensions === null || traits === null || !valid ||
      kind === undefined || inclusion === undefined || quantity === undefined) return null;

  if (quantity !== undefined && quantity > MAX_ROOM_INSTANCES) {
    addIssue(
      issues,
      "PROGRAM_TOO_LARGE",
      `${path}.quantity`,
      `the V1 solver supports at most ${MAX_ROOM_INSTANCES} generated space instances`,
      { subjectId: id, expected: MAX_ROOM_INSTANCES, actual: quantity },
    );
    return null;
  }
  if (kind === "garage" &&
      (traits.frontage?.kind !== "vehicle" || traits.frontage.side !== "south")) {
    addIssue(
      issues,
      "INVALID_REQUIREMENT",
      `${path}.traits.frontage`,
      "a garage must declare south vehicle frontage in the Stage 0 model",
      { subjectId: id },
    );
    return null;
  }
  return {
    id,
    label,
    kind,
    quantity,
    inclusion,
    dimensions,
    traits,
  };
}

function validateOffset(
  value: unknown,
  path: string,
  issues: NormalizationIssue[],
): Offset | null {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_OFFSET", path, "offset must be an object");
    return null;
  }
  if (!isSafeNonNegativeInteger(value.distanceMm) ||
      !enumValue(["architect", "planning", "system", "custom"] as const, value.source)) {
    addIssue(
      issues,
      "INVALID_OFFSET",
      path,
      "offset distance must be a non-negative safe integer and source must be known",
      { actual: issueActual(value.distanceMm) },
    );
    return null;
  }
  if (value.sourceRef !== undefined && !isNonEmptyString(value.sourceRef)) {
    addIssue(issues, "INVALID_OFFSET", `${path}.sourceRef`, "sourceRef must be a non-empty string when provided");
    return null;
  }
  return {
    distanceMm: value.distanceMm,
    source: value.source,
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef.trim() }),
  };
}

/**
 * Normalize exact authored site dimensions into the conservative fixed grid.
 * Minimum edges use ceil and maximum edges use floor, so every grid point is
 * contained by the exact millimetre envelope; authored space is never grown.
 */
export function normalizeSite(site: SiteBrief): NormalizedSite {
  const issues: NormalizationIssue[] = [];
  if (!isRecord(site)) {
    throw new NormalizationError([{
      code: "INVALID_SITE_DIMENSION",
      path: "site",
      message: "site must be an object",
    }]);
  }
  const widthMm = site.widthMm;
  const depthMm = site.depthMm;
  if (!isSafePositiveInteger(widthMm)) {
    addIssue(issues, "INVALID_SITE_DIMENSION", "site.widthMm", "site width must be a positive safe integer in millimetres", {
      actual: issueActual(widthMm),
    });
  }
  if (!isSafePositiveInteger(depthMm)) {
    addIssue(issues, "INVALID_SITE_DIMENSION", "site.depthMm", "site depth must be a positive safe integer in millimetres", {
      actual: issueActual(depthMm),
    });
  }
  if (site.frontSide !== "south") {
    addIssue(issues, "INVALID_SITE_FRONT_SIDE", "site.frontSide", "V1 requires south as the front side", {
      expected: "south",
      actual: issueActual(site.frontSide),
    });
  }
  const offsetsValue = site.offsets;
  const offsets: Partial<Record<(typeof SIDES)[number], Offset>> = {};
  for (const side of SIDES) {
    const offset = validateOffset(
      isRecord(offsetsValue) ? offsetsValue[side] : undefined,
      `site.offsets.${side}`,
      issues,
    );
    if (offset) offsets[side] = offset;
  }
  if (issues.length > 0) throw new NormalizationError(issues);

  const exactEnvelopeWidth = widthMm - offsets.west!.distanceMm - offsets.east!.distanceMm;
  const exactEnvelopeDepth = depthMm - offsets.north!.distanceMm - offsets.south!.distanceMm;
  if (exactEnvelopeWidth <= 0 || exactEnvelopeDepth <= 0) {
    addIssue(
      issues,
      "NON_POSITIVE_EXACT_ENVELOPE",
      "site.offsets",
      "opposing offsets leave no positive exact envelope",
      {
        expected: "width/depth greater than zero",
        actual: `${exactEnvelopeWidth} × ${exactEnvelopeDepth} mm`,
      },
    );
  }
  const exactSiteArea = safeAreaProduct(widthMm, depthMm);
  const exactEnvelopeArea = safeAreaProduct(exactEnvelopeWidth, exactEnvelopeDepth);
  if (exactSiteArea === undefined || exactEnvelopeArea === undefined) {
    addIssue(issues, "INVALID_SITE_DIMENSION", "site", "site and envelope areas must remain safe integers");
  }
  if (issues.length > 0) throw new NormalizationError(issues);

  const siteGrid: GridRect = {
    x: 0,
    y: 0,
    width: mmToGridFloor(widthMm),
    depth: mmToGridFloor(depthMm),
  };
  const leftGrid = mmToGridCeil(offsets.west!.distanceMm);
  const topGrid = mmToGridCeil(offsets.north!.distanceMm);
  const rightGrid = mmToGridFloor(widthMm - offsets.east!.distanceMm);
  const bottomGrid = mmToGridFloor(depthMm - offsets.south!.distanceMm);
  const envelope: GridRect = {
    x: leftGrid,
    y: topGrid,
    width: rightGrid - leftGrid,
    depth: bottomGrid - topGrid,
  };
  if (!isSafePositiveInteger(siteGrid.width) || !isSafePositiveInteger(siteGrid.depth)) {
    addIssue(issues, "INVALID_SITE_DIMENSION", "site", "site is smaller than one planning-grid unit");
  }
  if (!isSafePositiveInteger(envelope.width) || !isSafePositiveInteger(envelope.depth)) {
    addIssue(issues, "NON_POSITIVE_GRID_ENVELOPE", "site.offsets", "conservative grid snapping leaves no positive envelope");
  }
  if (issues.length > 0) throw new NormalizationError(issues);

  assertGridRect(siteGrid, "normalized site");
  assertGridRect(envelope, "normalized envelope");
  if (!containsRect(siteGrid, envelope)) {
    throw new NormalizationError([{
      code: "NON_POSITIVE_GRID_ENVELOPE",
      path: "site.offsets",
      message: "snapped envelope is outside the normalized site",
    }]);
  }

  const exactEnvelopeMm = {
    x: offsets.west!.distanceMm,
    y: offsets.north!.distanceMm,
    width: exactEnvelopeWidth,
    depth: exactEnvelopeDepth,
  };
  const snappedEnvelopeMm = {
    x: envelope.x * GRID_MM,
    y: envelope.y * GRID_MM,
    width: envelope.width * GRID_MM,
    depth: envelope.depth * GRID_MM,
  };
  const snappedArea = safeAreaProduct(snappedEnvelopeMm.width, snappedEnvelopeMm.depth);
  if (snappedArea === undefined || exactEnvelopeArea === undefined) {
    throw new NormalizationError([{
      code: "INVALID_SITE_DIMENSION",
      path: "site",
      message: "snapped envelope area must remain a safe integer",
    }]);
  }
  const gridInsetLossMm = {
    north: snappedEnvelopeMm.y - exactEnvelopeMm.y,
    east: exactEnvelopeMm.x + exactEnvelopeMm.width -
      (snappedEnvelopeMm.x + snappedEnvelopeMm.width),
    south: exactEnvelopeMm.y + exactEnvelopeMm.depth -
      (snappedEnvelopeMm.y + snappedEnvelopeMm.depth),
    west: snappedEnvelopeMm.x - exactEnvelopeMm.x,
  };
  if (Object.values(gridInsetLossMm).some((loss) => loss < 0 || loss >= GRID_MM)) {
    throw new NormalizationError([{
      code: "NON_POSITIVE_GRID_ENVELOPE",
      path: "site.offsets",
      message: "conservative grid snapping produced an invalid inset loss",
    }]);
  }
  return {
    site: siteGrid,
    envelope,
    exactSiteMm: { x: 0, y: 0, width: widthMm, depth: depthMm },
    exactEnvelopeMm,
    snappedEnvelopeMm,
    gridInsetLossMm,
    discretizationLossMm2: exactEnvelopeArea - snappedArea,
  };
}

/** Expand authored quantities in input order into stable, independently addressable instances. */
export function normalizeRoomRequirements(
  requirements: readonly RoomRequirement[],
): RoomInstance[] {
  const issues: NormalizationIssue[] = [];
  if (!Array.isArray(requirements)) {
    throw new NormalizationError([{
      code: "INVALID_REQUIREMENT",
      path: "program",
      message: "program must be an array of room requirements",
    }]);
  }
  const seenRequirementIds = new Set<string>();
  const seenInstanceIds = new Set<string>();
  const normalized: RoomInstance[] = [];
  let instanceCount = 0;
  for (const [index, value] of requirements.entries()) {
    const result = normalizeRequirement(value, index, issues);
    if (result === null) continue;
    if (seenRequirementIds.has(result.id)) {
      addIssue(
        issues,
        "DUPLICATE_REQUIREMENT_ID",
        `program[${index}].id`,
        `requirement id '${result.id}' is duplicated`,
        { subjectId: result.id },
      );
      continue;
    }
    seenRequirementIds.add(result.id);
    if (instanceCount + result.quantity > MAX_ROOM_INSTANCES) {
      addIssue(
        issues,
        "PROGRAM_TOO_LARGE",
        `program[${index}].quantity`,
        `the V1 solver supports at most ${MAX_ROOM_INSTANCES} generated space instances`,
        { subjectId: result.id, expected: MAX_ROOM_INSTANCES, actual: instanceCount + result.quantity },
      );
      continue;
    }
    for (let ordinal = 1; ordinal <= result.quantity; ordinal += 1) {
      const id = `${result.id}-${ordinal}`;
      if (seenInstanceIds.has(id)) {
        addIssue(
          issues,
          "DUPLICATE_INSTANCE_ID",
          `program[${index}].id`,
          `expanded instance id '${id}' is not unique`,
          { subjectId: id },
        );
        continue;
      }
      seenInstanceIds.add(id);
      normalized.push({
        id,
        requirementId: result.id,
        ordinal,
        displayName: result.quantity === 1 ? result.label : `${result.label} ${ordinal}`,
        kind: result.kind,
        inclusion: result.inclusion,
        // Each sibling owns its own normalized object so downstream edits or
        // tests cannot accidentally mutate every quantity-expanded instance.
        dimensions: { ...result.dimensions },
        traits: cloneTraits(result.traits),
      });
      instanceCount += 1;
    }
  }
  if (issues.length > 0) throw new NormalizationError(issues);
  return normalized;
}

function normalizePlanningSettings(
  value: unknown,
  issues: NormalizationIssue[],
): ProjectBrief["planning"] | null {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_PLANNING_SETTINGS", "planning", "planning settings must be an object");
    return null;
  }
  const minimumCirculationWidthMm = value.minimumCirculationWidthMm;
  const maxUnallocatedInteriorRatio = value.maxUnallocatedInteriorRatio;
  const validMinimumCirculationWidthMm = isSafePositiveInteger(minimumCirculationWidthMm)
    ? minimumCirculationWidthMm
    : undefined;
  const validMaxUnallocatedInteriorRatio = typeof maxUnallocatedInteriorRatio === "number" &&
      Number.isFinite(maxUnallocatedInteriorRatio) && maxUnallocatedInteriorRatio >= 0 &&
      maxUnallocatedInteriorRatio <= 1
    ? maxUnallocatedInteriorRatio
    : undefined;
  let valid = true;
  if (validMinimumCirculationWidthMm === undefined) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning.minimumCirculationWidthMm",
      "circulation width must be a positive safe integer in millimetres",
      { actual: issueActual(minimumCirculationWidthMm) },
    );
    valid = false;
  }
  if (validMaxUnallocatedInteriorRatio === undefined) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning.maxUnallocatedInteriorRatio",
      "unallocated-area ratio must be a finite number between 0 and 1",
      { actual: issueActual(maxUnallocatedInteriorRatio) },
    );
    valid = false;
  }
  const targetGfaMm2 = value.targetGfaMm2;
  const maxGfaMm2 = value.maxGfaMm2;
  const validTargetGfaMm2 = targetGfaMm2 === undefined
    ? undefined
    : isSafePositiveInteger(targetGfaMm2) ? targetGfaMm2 : null;
  const validMaxGfaMm2 = maxGfaMm2 === undefined
    ? undefined
    : isSafePositiveInteger(maxGfaMm2) ? maxGfaMm2 : null;
  if (targetGfaMm2 !== undefined && !isSafePositiveInteger(targetGfaMm2)) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning.targetGfaMm2",
      "target GFA must be a positive square-millimetre integer",
      { actual: issueActual(targetGfaMm2) },
    );
    valid = false;
  }
  if (maxGfaMm2 !== undefined && !isSafePositiveInteger(maxGfaMm2)) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning.maxGfaMm2",
      "maximum GFA must be a positive square-millimetre integer",
      { actual: issueActual(maxGfaMm2) },
    );
    valid = false;
  }
  const approvedMaxGfaMm2 = MAX_GFA_M2 * 1_000_000;
  if (validMaxGfaMm2 !== undefined && validMaxGfaMm2 !== null && validMaxGfaMm2 > approvedMaxGfaMm2) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning.maxGfaMm2",
      `maximum GFA cannot exceed the approved ${MAX_GFA_M2} m² hard cap`,
      { expected: approvedMaxGfaMm2, actual: validMaxGfaMm2 },
    );
    valid = false;
  }
  const effectiveMaxGfaMm2 = Math.min(validMaxGfaMm2 ?? approvedMaxGfaMm2, approvedMaxGfaMm2);
  if (validTargetGfaMm2 !== undefined && validTargetGfaMm2 !== null && validTargetGfaMm2 > effectiveMaxGfaMm2) {
    addIssue(
      issues,
      "INVALID_PLANNING_SETTINGS",
      "planning",
      "target GFA cannot exceed the effective maximum GFA",
      { expected: effectiveMaxGfaMm2, actual: validTargetGfaMm2 },
    );
    valid = false;
  }
  if (!valid || validMinimumCirculationWidthMm === undefined ||
      validMaxUnallocatedInteriorRatio === undefined) return null;
  return {
    minimumCirculationWidthMm: validMinimumCirculationWidthMm,
    maxUnallocatedInteriorRatio: validMaxUnallocatedInteriorRatio,
    ...(validTargetGfaMm2 === undefined || validTargetGfaMm2 === null ? {} : { targetGfaMm2: validTargetGfaMm2 }),
    ...(validMaxGfaMm2 === undefined || validMaxGfaMm2 === null ? {} : { maxGfaMm2: validMaxGfaMm2 }),
  };
}

function normalizeSelector(
  value: unknown,
  path: string,
  issues: NormalizationIssue[],
): string | null {
  if (typeof value === "string") {
    const selector = value.trim();
    if (selector.length > 0) return selector;
  } else if (isRecord(value)) {
    if ((value.type === "instance" || value.type === "requirement" || value.type === "group") &&
        isNonEmptyString(value.id)) {
      return value.id.trim();
    }
    if (value.type === "kind" && enumValue(ROOM_KINDS, value.kind)) return value.kind;
  }
  addIssue(
    issues,
    "INVALID_RELATIONSHIP",
    path,
    "selector must be a non-empty string or an instance, requirement, or kind selector",
  );
  return null;
}

function normalizeRelationship(
  value: unknown,
  index: number,
  issues: NormalizationIssue[],
): RelationshipRequirement | null {
  const path = `relationships[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_RELATIONSHIP", path, "relationship must be an object");
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const from = normalizeSelector(value.from, `${path}.from`, issues);
  const to = normalizeSelector(value.to, `${path}.to`, issues);
  const kind = enumValue(RELATIONSHIP_KINDS, value.kind) ? value.kind : undefined;
  const source = enumValue(RELATIONSHIP_SOURCES, value.source) ? value.source : undefined;
  const aggregation = value.aggregation === undefined
    ? "any" as const
    : enumValue(RELATIONSHIP_AGGREGATIONS, value.aggregation) ? value.aggregation : undefined;
  const strength = value.strength === undefined
    ? undefined
    : typeof value.strength === "number" && Number.isFinite(value.strength) && value.strength >= 0
      ? value.strength
      : null;
  const minSharedWallM = value.minSharedWallM === undefined
    ? undefined
    : typeof value.minSharedWallM === "number" && Number.isFinite(value.minSharedWallM) && value.minSharedWallM >= 0
      ? value.minSharedWallM
      : null;
  const targetDistanceM = value.targetDistanceM === undefined
    ? undefined
    : typeof value.targetDistanceM === "number" && Number.isFinite(value.targetDistanceM) && value.targetDistanceM >= 0
      ? value.targetDistanceM
      : null;
  let valid = true;
  if (!id || from === null || to === null) {
    addIssue(issues, "INVALID_RELATIONSHIP", path, "relationship id must be a non-empty string and from/to must be valid selectors", {
      subjectId: id || undefined,
    });
    valid = false;
  }
  if (aggregation === undefined) {
    addIssue(issues, "INVALID_RELATIONSHIP", `${path}.aggregation`, "aggregation must be any, all, nearest, or average", {
      subjectId: id || undefined,
    });
    valid = false;
  }
  if (!enumValue(RELATIONSHIP_KINDS, value.kind)) {
    addIssue(issues, "INVALID_RELATIONSHIP", `${path}.kind`, "relationship kind is not supported", {
      subjectId: id || undefined,
    });
    valid = false;
  }
  if (!enumValue(RELATIONSHIP_SOURCES, value.source)) {
    addIssue(issues, "INVALID_RELATIONSHIP", `${path}.source`, "relationship source is not supported", {
      subjectId: id || undefined,
    });
    valid = false;
  }
  for (const key of ["strength", "minSharedWallM", "targetDistanceM"] as const) {
    const candidate = value[key];
    if (candidate !== undefined &&
        (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0)) {
      addIssue(issues, "INVALID_RELATIONSHIP", `${path}.${key}`, `${key} must be a finite non-negative number`, {
        subjectId: id || undefined,
        actual: issueActual(candidate),
      });
      valid = false;
    }
  }
  if (!valid || kind === undefined || source === undefined || aggregation === undefined ||
      from === null || to === null ||
      strength === null || minSharedWallM === null || targetDistanceM === null) return null;
  return {
    id,
    from,
    to,
    kind,
    aggregation,
    ...(strength === undefined ? {} : { strength }),
    ...(minSharedWallM === undefined ? {} : { minSharedWallM }),
    ...(targetDistanceM === undefined ? {} : { targetDistanceM }),
    source,
  };
}

function normalizeRelationships(
  values: readonly RelationshipRequirement[],
  rooms: readonly RoomInstance[],
): RelationshipRequirement[] {
  const issues: NormalizationIssue[] = [];
  if (!Array.isArray(values)) {
    throw new NormalizationError([{
      code: "INVALID_RELATIONSHIP",
      path: "relationships",
      message: "relationships must be an array",
    }]);
  }
  const normalized: RelationshipRequirement[] = [];
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const relationship = normalizeRelationship(value, index, issues);
    if (!relationship) continue;
    if (seen.has(relationship.id)) {
      addIssue(
        issues,
        "DUPLICATE_RELATIONSHIP_ID",
        `relationships[${index}].id`,
        `relationship id '${relationship.id}' is duplicated`,
        { subjectId: relationship.id },
      );
      continue;
    }
    seen.add(relationship.id);
    const selectorKnown = (selector: RoomSelector): boolean => {
      const key = roomSelectorKey(selector);
      return rooms.some((room) => room.id === key || room.requirementId === key || room.kind === key);
    };
    const fromKey = roomSelectorKey(relationship.from);
    const toKey = roomSelectorKey(relationship.to);
    if (!selectorKnown(relationship.from)) {
      addIssue(
        issues,
        "UNRESOLVED_RELATIONSHIP_SELECTOR",
        `relationships[${index}].from`,
        `relationship selector '${fromKey}' does not match a room instance, requirement, or kind`,
        { subjectId: relationship.id, actual: fromKey },
      );
    }
    if (!selectorKnown(relationship.to)) {
      addIssue(
        issues,
        "UNRESOLVED_RELATIONSHIP_SELECTOR",
        `relationships[${index}].to`,
        `relationship selector '${toKey}' does not match a room instance, requirement, or kind`,
        { subjectId: relationship.id, actual: toKey },
      );
    }
    normalized.push(relationship);
  }
  if (issues.length > 0) throw new NormalizationError(issues);
  return normalized;
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
  const shortSideFits = dimensions.minShortSideUnits === undefined ||
    (dimensions.minShortSideUnits <= envelope.width && dimensions.minShortSideUnits <= envelope.depth);
  if (!shortSideFits || (!directOrientation && !rotatedOrientation)) return false;
  return dimensions.minAreaUnits2 <= envelope.width * envelope.depth;
}

function isBriefShape(value: unknown): value is UnknownRecord {
  return isRecord(value);
}

function cloneDocumentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneDocumentValue(item));
  if (!isRecord(value)) return value;
  const clone: UnknownRecord = {};
  for (const [key, nested] of Object.entries(value)) clone[key] = cloneDocumentValue(nested);
  return clone;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as UnknownRecord)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Normalize an unknown runtime value as a V1 project document.  Although the
 * TypeScript API is typed, local storage/worker messages are untrusted at
 * runtime, so malformed values become structured issues rather than property
 * access exceptions.
 */
export function tryNormalizeProject(project: unknown): NormalizationResult {
  if (!isBriefShape(project)) {
    return {
      ok: false,
      issues: [{ code: "INVALID_BRIEF", path: "", message: "project brief must be an object" }],
    };
  }
  const issues: NormalizationIssue[] = [];
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    addIssue(issues, "INVALID_SCHEMA_VERSION", "schemaVersion", `only project schema version ${PROJECT_SCHEMA_VERSION} is supported`, {
      expected: PROJECT_SCHEMA_VERSION,
      actual: typeof project.schemaVersion === "number" || typeof project.schemaVersion === "string"
        ? project.schemaVersion
        : null,
    });
  }
  const projectId = typeof project.projectId === "string" ? project.projectId.trim() : "";
  const name = typeof project.name === "string" ? project.name.trim() : "";
  if (!projectId) addIssue(issues, "INVALID_BRIEF", "projectId", "projectId must be a non-empty string");
  if (!name) addIssue(issues, "INVALID_BRIEF", "name", "name must be a non-empty string");
  if (!Array.isArray(project.program)) addIssue(issues, "INVALID_REQUIREMENT", "program", "program must be an array of room requirements");
  if (!Array.isArray(project.relationships)) addIssue(issues, "INVALID_RELATIONSHIP", "relationships", "relationships must be an array");
  if (!isRecord(project.generation) || typeof project.generation.seed !== "string") {
    addIssue(issues, "INVALID_GENERATION_SETTINGS", "generation.seed", "generation.seed must be a string");
  }
  const planning = normalizePlanningSettings(project.planning, issues);
  if (issues.length > 0 || planning === null) return { ok: false, issues };

  let site: NormalizedSite;
  let rooms: RoomInstance[];
  try {
    site = normalizeSite(project.site as SiteBrief);
  } catch (error) {
    if (error instanceof InvalidBriefError) return { ok: false, issues: [...error.issues] };
    throw error;
  }
  try {
    rooms = normalizeRoomRequirements(project.program as readonly RoomRequirement[]);
  } catch (error) {
    if (error instanceof InvalidBriefError) return { ok: false, issues: [...error.issues] };
    throw error;
  }
  const fitIssues: NormalizationIssue[] = [];
  const requiredRooms = rooms.filter((room) => room.inclusion === "required");
  const requiredArea = requiredRooms.reduce((sum, room) => sum + room.dimensions.minAreaUnits2, 0);
  for (const room of requiredRooms) {
    if (!roomCanFitEnvelope(room, site.envelope)) {
      addIssue(
        fitIssues,
        "ROOM_CANNOT_FIT_ENVELOPE",
        `program.${room.requirementId}`,
        `${room.displayName} minimum dimensions/area cannot fit the envelope`,
        { subjectId: room.id },
      );
    }
  }
  if (requiredArea > site.envelope.width * site.envelope.depth) {
    addIssue(
      fitIssues,
      "REQUIRED_MINIMUMS_EXCEED_ENVELOPE",
      "program",
      "required room minimum areas exceed envelope area",
      { expected: site.envelope.width * site.envelope.depth, actual: requiredArea },
    );
  }
  if (fitIssues.length > 0) return { ok: false, issues: fitIssues };

  let relationships: RelationshipRequirement[];
  try {
    relationships = normalizeRelationships(project.relationships as readonly RelationshipRequirement[], rooms);
  } catch (error) {
    if (error instanceof InvalidBriefError) return { ok: false, issues: [...error.issues] };
    throw error;
  }

  const normalized: NormalizedProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    name,
    site,
    rooms,
    relationships,
    planning: {
      minimumCirculationWidthMm: planning.minimumCirculationWidthMm,
      minimumCirculationWidthUnits: Math.ceil(planning.minimumCirculationWidthMm / GRID_MM),
      ...(planning.targetGfaMm2 === undefined ? {} : { targetGfaMm2: planning.targetGfaMm2 }),
      ...(planning.maxGfaMm2 === undefined ? {} : { maxGfaMm2: planning.maxGfaMm2 }),
      maxUnallocatedInteriorRatio: planning.maxUnallocatedInteriorRatio,
    },
    generation: { seed: (project.generation as UnknownRecord).seed as string },
  };
  // Normalized values are a solver input snapshot.  Freezing the graph at
  // this boundary prevents a UI/editor mutation from changing a run that is
  // already in flight; callers can still clone it when intentionally editing.
  return { ok: true, value: deepFreeze(normalized) };
}

export function normalizeProject(project: ProjectBrief): NormalizedProject {
  const result = tryNormalizeProject(project);
  if (!result.ok) throw new NormalizationError(result.issues);
  return result.value;
}

/** Naming aliases for callers that work in terms of an authored brief. */
export const tryNormalizeBrief = tryNormalizeProject;
export const normalizeBrief = normalizeProject;

/**
 * Parse a runtime value as an authored project document.  Semantic checks
 * (units, room constraints, envelope feasibility) still run through the same
 * authoritative normalization path; this helper is useful at storage/worker
 * boundaries where the value starts as `unknown`.
 */
export function parseProjectBrief(value: unknown): ProjectBrief {
  if (!isBriefShape(value)) {
    throw new InvalidBriefError([{
      code: "INVALID_BRIEF",
      path: "",
      message: "project brief must be an object",
    }]);
  }
  const result = tryNormalizeProject(value);
  if (!result.ok) throw new InvalidBriefError(result.issues);
  // Keep parsing side-effect free: callers receive an authored-shaped copy,
  // while normalization remains the only path to solver geometry.
  return cloneDocumentValue(value) as ProjectBrief;
}

export const DEFAULT_PLANNING_SETTINGS = Object.freeze({
  minimumCirculationWidthMm: GRID_MM * 4,
  targetGfaMm2: TARGET_GFA_M2 * 1_000_000,
  maxGfaMm2: MAX_GFA_M2 * 1_000_000,
  maxUnallocatedInteriorRatio: MAX_UNALLOCATED_INTERIOR_RATIO,
});
