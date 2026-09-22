/**
 * Runtime guards for every payload that crosses the PlanLab API boundary.
 *
 * The rules mirror `services/generation/planlab_service/contracts.py`; the
 * shared corpus in `test/integration/fixtures/` is executed against both, so a
 * payload accepted here is accepted there and vice versa. Validate before
 * rendering or caching: a rejected payload never reaches the viewer.
 */
import {
  CONTRACT_LIMITS,
  CONTRACT_VERSION,
  EDITOR_SCHEMA_VERSION,
  LAYOUT_SCHEMA_VERSION,
  RESERVED_IDS,
  VIRTUAL_NODES,
  type BriefV1,
  type EditorDocumentV2,
  type EngineVersionsV1,
  type FieldErrorV1,
  type GenerationRequestV1,
  type JobV1,
  type LayoutV1,
  type LayoutRoomV1,
  type OpeningV1,
  type ProblemV1,
  type ProjectV1,
  type RectMm,
  type RelationshipV1,
  type RemediationV1,
  type RoomGroupV2,
  type RoomV1,
  type ValidationCheckV1,
  type WallV1,
} from "./contracts.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  issues: ValidationIssue[];
  value: T | null;
}

export class ContractValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(label: string, issues: ValidationIssue[]) {
    super(`${label} failed ${issues.length} contract check(s): ${issues[0]?.path ?? ""} ${issues[0]?.message ?? ""}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

const ROOM_TYPES = [
  "bedroom",
  "bathroom",
  "wc",
  "kitchen",
  "living",
  "dining",
  "garage",
  "laundry",
  "study",
  "store",
] as const;
const ROOM_CLASSES = ["compact", "standard", "spacious"] as const;
const SIDES = ["north", "east", "south", "west"] as const;
const RELATIONSHIP_KINDS = ["mustShareWall", "directAccess"] as const;
const OPENING_KINDS = ["entry", "room_to_corridor", "direct_access"] as const;
const WALL_TYPES = ["external", "internal"] as const;
const ORIENTATIONS = ["horizontal", "vertical"] as const;
const GENERATION_STATUSES = [
  "QUEUED",
  "LOADING_MODEL",
  "GENERATING_TOPOLOGIES",
  "SOLVING",
  "VALIDATING",
  "RANKING",
  "COMPLETED",
  "INFEASIBLE",
  "FAILED",
  "CANCELLED",
] as const;
const ERROR_CODES = [
  "INVALID_BRIEF",
  "PROGRAMME_TOO_LARGE",
  "NO_VALID_LAYOUT",
  "ENGINE_UNAVAILABLE",
  "MODEL_LOAD_FAILURE",
  "SOLVER_TIMEOUT",
  "VALIDATION_FAILURE",
  "INTERNAL_GENERATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "QUEUE_FULL",
] as const;

/** Category, retryability and proof are a function of the error code. */
export const ERROR_SHAPE: Record<
  string,
  { category: ProblemV1["category"]; retryable: boolean; proof: ProblemV1["proof"] }
> = {
  INVALID_BRIEF: { category: "input", retryable: false, proof: null },
  PROGRAMME_TOO_LARGE: { category: "architectural", retryable: false, proof: "necessary_condition" },
  NO_VALID_LAYOUT: { category: "architectural", retryable: false, proof: "limited_search" },
  ENGINE_UNAVAILABLE: { category: "technical", retryable: true, proof: null },
  MODEL_LOAD_FAILURE: { category: "technical", retryable: true, proof: null },
  SOLVER_TIMEOUT: { category: "technical", retryable: true, proof: null },
  VALIDATION_FAILURE: { category: "technical", retryable: true, proof: null },
  INTERNAL_GENERATION_ERROR: { category: "technical", retryable: true, proof: null },
  NOT_FOUND: { category: "conflict", retryable: false, proof: null },
  CONFLICT: { category: "conflict", retryable: false, proof: null },
  QUEUE_FULL: { category: "conflict", retryable: true, proof: null },
};

const REMEDIATION_CODES = [
  "REDUCE_PROGRAMME",
  "REVIEW_DIMENSIONS",
  "REVIEW_SITE_OR_SETBACKS",
  "REVIEW_RELATIONSHIPS",
  "RETRY_GENERATION",
] as const;

class Checker {
  readonly issues: ValidationIssue[] = [];
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private path(local: string): string {
    return local ? `${this.prefix}.${local}` : this.prefix;
  }

  fail(local: string, message: string): undefined {
    this.issues.push({ path: this.path(local), message });
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(
  ctx: Checker,
  value: Record<string, unknown>,
  allowed: readonly string[],
  local = "",
): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  for (const key of extra) {
    ctx.fail(local ? `${local}.${key}` : key, "unexpected field");
  }
}

function intIn(
  ctx: Checker,
  value: unknown,
  local: string,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return ctx.fail(local, "must be a finite integer");
  }
  if (value < min || value > max) {
    return ctx.fail(local, `must be between ${min} and ${max}`);
  }
  return value;
}

function numIn(
  ctx: Checker,
  value: unknown,
  local: string,
  min: number,
  max: number,
  decimals?: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ctx.fail(local, "must be a finite number");
  }
  if (value < min || value > max) {
    return ctx.fail(local, `must be between ${min} and ${max}`);
  }
  if (decimals !== undefined) {
    const scaled = value * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      return ctx.fail(local, `allows at most ${decimals} decimal places`);
    }
  }
  return value;
}

function strIn(
  ctx: Checker,
  value: unknown,
  local: string,
  options: { pattern?: RegExp; min?: number; max?: number } = {},
): string | undefined {
  if (typeof value !== "string") {
    return ctx.fail(local, "must be a string");
  }
  if (options.min !== undefined && value.length < options.min) {
    return ctx.fail(local, `must be at least ${options.min} characters`);
  }
  if (options.max !== undefined && value.length > options.max) {
    return ctx.fail(local, `must be at most ${options.max} characters`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    return ctx.fail(local, "has the wrong format");
  }
  return value;
}

function enumIn<T extends string>(
  ctx: Checker,
  value: unknown,
  local: string,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return ctx.fail(local, `must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function boolIn(ctx: Checker, value: unknown, local: string): boolean | undefined {
  if (typeof value !== "boolean") {
    return ctx.fail(local, "must be a boolean");
  }
  return value;
}

function listIn(
  ctx: Checker,
  value: unknown,
  local: string,
  minLength: number,
  maxLength: number,
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return ctx.fail(local, "must be an array");
  }
  if (value.length < minLength || value.length > maxLength) {
    return ctx.fail(local, `must hold between ${minLength} and ${maxLength} entries`);
  }
  return value;
}

function rectIn(
  ctx: Checker,
  value: unknown,
  local: string,
  positive: boolean,
): RectMm | undefined {
  if (!isRecord(value)) {
    return ctx.fail(local, "must be an object");
  }
  unknownFields(ctx, value, ["xMm", "yMm", "widthMm", "heightMm"], local);
  const xMm = intIn(ctx, value.xMm, `${local}.xMm`, 0, CONTRACT_LIMITS.siteAxisMm[1]);
  const yMm = intIn(ctx, value.yMm, `${local}.yMm`, 0, CONTRACT_LIMITS.siteAxisMm[1]);
  const widthMm = intIn(
    ctx,
    value.widthMm,
    `${local}.widthMm`,
    positive ? 1 : 0,
    CONTRACT_LIMITS.siteAxisMm[1],
  );
  const heightMm = intIn(
    ctx,
    value.heightMm,
    `${local}.heightMm`,
    positive ? 1 : 0,
    CONTRACT_LIMITS.siteAxisMm[1],
  );
  if (xMm === undefined || yMm === undefined || widthMm === undefined || heightMm === undefined) {
    return undefined;
  }
  return { xMm, yMm, widthMm, heightMm };
}

function roomIn(
  ctx: Checker,
  value: unknown,
  local: string,
  extraKeys: readonly string[] = [],
): RoomV1 | undefined {
  if (!isRecord(value)) {
    return ctx.fail(local, "must be an object");
  }
  unknownFields(
    ctx,
    value,
    [
      "id",
      "label",
      "type",
      "roomClass",
      "sourceRequirementId",
      "ordinal",
      "required",
      "targetAreaM2",
      "minAreaM2",
      "maxAreaM2",
      "minShortSideMm",
      "minWidthMm",
      "minHeightMm",
      "maxAspectRatio",
      ...extraKeys,
    ],
    local,
  );
  const id = strIn(ctx, value.id, `${local}.id`, { pattern: ID_PATTERN });
  const label = strIn(ctx, value.label, `${local}.label`, {
    min: CONTRACT_LIMITS.labelCharacters[0],
    max: CONTRACT_LIMITS.labelCharacters[1],
  });
  const type = enumIn(ctx, value.type, `${local}.type`, ROOM_TYPES);
  const roomClass = enumIn(ctx, value.roomClass, `${local}.roomClass`, ROOM_CLASSES);
  const sourceRequirementId = strIn(
    ctx,
    value.sourceRequirementId,
    `${local}.sourceRequirementId`,
    { pattern: ID_PATTERN },
  );
  const ordinal = intIn(ctx, value.ordinal, `${local}.ordinal`, 0, 99);
  const required = boolIn(ctx, value.required, `${local}.required`);
  const targetAreaM2 = numIn(
    ctx,
    value.targetAreaM2,
    `${local}.targetAreaM2`,
    CONTRACT_LIMITS.roomAreaM2[0],
    CONTRACT_LIMITS.roomAreaM2[1],
    3,
  );
  const minAreaM2 = numIn(
    ctx,
    value.minAreaM2,
    `${local}.minAreaM2`,
    CONTRACT_LIMITS.roomAreaM2[0],
    CONTRACT_LIMITS.roomAreaM2[1],
    3,
  );
  const maxAreaM2 = numIn(
    ctx,
    value.maxAreaM2,
    `${local}.maxAreaM2`,
    CONTRACT_LIMITS.roomAreaM2[0],
    CONTRACT_LIMITS.roomAreaM2[1],
    3,
  );
  const minShortSideMm = intIn(
    ctx,
    value.minShortSideMm,
    `${local}.minShortSideMm`,
    CONTRACT_LIMITS.roomLengthMm[0],
    CONTRACT_LIMITS.roomLengthMm[1],
  );
  const minWidthMm = intIn(
    ctx,
    value.minWidthMm,
    `${local}.minWidthMm`,
    CONTRACT_LIMITS.roomLengthMm[0],
    CONTRACT_LIMITS.roomLengthMm[1],
  );
  const minHeightMm = intIn(
    ctx,
    value.minHeightMm,
    `${local}.minHeightMm`,
    CONTRACT_LIMITS.roomLengthMm[0],
    CONTRACT_LIMITS.roomLengthMm[1],
  );
  const maxAspectRatio = numIn(
    ctx,
    value.maxAspectRatio,
    `${local}.maxAspectRatio`,
    CONTRACT_LIMITS.aspectRatio[0],
    CONTRACT_LIMITS.aspectRatio[1],
    3,
  );
  if (
    id === undefined ||
    label === undefined ||
    type === undefined ||
    roomClass === undefined ||
    sourceRequirementId === undefined ||
    ordinal === undefined ||
    required === undefined ||
    targetAreaM2 === undefined ||
    minAreaM2 === undefined ||
    maxAreaM2 === undefined ||
    minShortSideMm === undefined ||
    minWidthMm === undefined ||
    minHeightMm === undefined ||
    maxAspectRatio === undefined
  ) {
    return undefined;
  }
  if (RESERVED_IDS.includes(id)) {
    ctx.fail(`${local}.id`, `${id} is a reserved id`);
    return undefined;
  }
  if (!(minAreaM2 <= targetAreaM2 && targetAreaM2 <= maxAreaM2)) {
    ctx.fail(local, "minAreaM2 <= targetAreaM2 <= maxAreaM2 is required");
  }
  if (minWidthMm < minShortSideMm || minHeightMm < minShortSideMm) {
    ctx.fail(local, "explicit axis minima cannot be below minShortSideMm");
  }
  return {
    id,
    label,
    type,
    roomClass,
    sourceRequirementId,
    ordinal,
    required,
    targetAreaM2,
    minAreaM2,
    maxAreaM2,
    minShortSideMm,
    minWidthMm,
    minHeightMm,
    maxAspectRatio,
  };
}

export function validateBriefV1(input: unknown): ValidationResult<BriefV1> {
  const ctx = new Checker("brief");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(
    ctx,
    input,
    [
      "schemaVersion",
      "units",
      "site",
      "setbacks",
      "walls",
      "circulation",
      "doors",
      "rooms",
      "relationships",
      "building",
      "settings",
    ],
  );

  if (input.schemaVersion !== "planlab.brief/1") {
    ctx.fail("schemaVersion", "must be planlab.brief/1");
  }
  if (input.units !== "mm") {
    ctx.fail("units", "must be mm");
  }

  const site = isRecord(input.site) ? input.site : undefined;
  let siteValue;
  if (!site) {
    ctx.fail("site", "must be an object");
  } else {
    unknownFields(ctx, site, ["widthMm", "heightMm", "front"], "site");
    const widthMm = intIn(
      ctx,
      site.widthMm,
      "site.widthMm",
      CONTRACT_LIMITS.siteAxisMm[0],
      CONTRACT_LIMITS.siteAxisMm[1],
    );
    const heightMm = intIn(
      ctx,
      site.heightMm,
      "site.heightMm",
      CONTRACT_LIMITS.siteAxisMm[0],
      CONTRACT_LIMITS.siteAxisMm[1],
    );
    const front = enumIn(ctx, site.front, "site.front", SIDES);
    if (widthMm !== undefined && heightMm !== undefined && front !== undefined) {
      siteValue = { widthMm, heightMm, front };
    }
  }

  const setbacks = isRecord(input.setbacks) ? input.setbacks : undefined;
  let setbacksValue;
  if (!setbacks) {
    ctx.fail("setbacks", "must be an object");
  } else {
    unknownFields(ctx, setbacks, ["northMm", "eastMm", "southMm", "westMm"], "setbacks");
    const northMm = intIn(
      ctx,
      setbacks.northMm,
      "setbacks.northMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const eastMm = intIn(
      ctx,
      setbacks.eastMm,
      "setbacks.eastMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const southMm = intIn(
      ctx,
      setbacks.southMm,
      "setbacks.southMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const westMm = intIn(
      ctx,
      setbacks.westMm,
      "setbacks.westMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    if (
      northMm !== undefined &&
      eastMm !== undefined &&
      southMm !== undefined &&
      westMm !== undefined
    ) {
      setbacksValue = { northMm, eastMm, southMm, westMm };
    }
  }

  const walls = isRecord(input.walls) ? input.walls : undefined;
  let wallsValue;
  if (!walls) {
    ctx.fail("walls", "must be an object");
  } else {
    unknownFields(ctx, walls, ["externalMm", "internalMm"], "walls");
    const externalMm = intIn(
      ctx,
      walls.externalMm,
      "walls.externalMm",
      CONTRACT_LIMITS.externalWallMm[0],
      CONTRACT_LIMITS.externalWallMm[1],
    );
    const internalMm = intIn(
      ctx,
      walls.internalMm,
      "walls.internalMm",
      CONTRACT_LIMITS.internalWallMm[0],
      CONTRACT_LIMITS.internalWallMm[1],
    );
    if (externalMm !== undefined && internalMm !== undefined) {
      wallsValue = { externalMm, internalMm };
    }
  }

  const circulation = isRecord(input.circulation) ? input.circulation : undefined;
  let circulationValue;
  if (!circulation) {
    ctx.fail("circulation", "must be an object");
  } else {
    unknownFields(ctx, circulation, ["minWidthMm"], "circulation");
    const minWidthMm = intIn(
      ctx,
      circulation.minWidthMm,
      "circulation.minWidthMm",
      CONTRACT_LIMITS.circulationMm[0],
      CONTRACT_LIMITS.circulationMm[1],
    );
    if (minWidthMm !== undefined) {
      circulationValue = { minWidthMm };
    }
  }

  const doors = isRecord(input.doors) ? input.doors : undefined;
  let doorsValue;
  if (!doors) {
    ctx.fail("doors", "must be an object");
  } else {
    unknownFields(ctx, doors, ["minWidthMm"], "doors");
    const minWidthMm = intIn(
      ctx,
      doors.minWidthMm,
      "doors.minWidthMm",
      CONTRACT_LIMITS.doorMm[0],
      CONTRACT_LIMITS.doorMm[1],
    );
    if (minWidthMm !== undefined) {
      doorsValue = { minWidthMm };
    }
  }

  const roomsRaw = listIn(
    ctx,
    input.rooms,
    "rooms",
    CONTRACT_LIMITS.rooms[0],
    CONTRACT_LIMITS.rooms[1],
  );
  const roomsValue: RoomV1[] = [];
  if (roomsRaw) {
    roomsRaw.forEach((entry, index) => {
      const room = roomIn(ctx, entry, `rooms[${index}]`);
      if (room) {
        roomsValue.push(room);
      }
    });
    const ids = roomsValue.map((room) => room.id);
    const duplicates = [...new Set(ids.filter((id) => ids.filter((other) => other === id).length > 1))];
    if (duplicates.length > 0) {
      ctx.fail("rooms", `duplicate room ids: ${duplicates.join(", ")}`);
    }
    const pairs = roomsValue.map((room) => `${room.sourceRequirementId}#${room.ordinal}`);
    if (new Set(pairs).size !== pairs.length) {
      ctx.fail("rooms", "room (sourceRequirementId, ordinal) pairs must be unique");
    }
    const fineCounts = new Map<string, number>();
    for (const room of roomsValue) {
      const key = room.type === "bathroom" || room.type === "wc" ? "bathroom" : room.type;
      fineCounts.set(key, (fineCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of fineCounts) {
      if (count > CONTRACT_LIMITS.fineTypeRooms) {
        ctx.fail(
          "rooms",
          `at most ${CONTRACT_LIMITS.fineTypeRooms} rooms of one topology fine type (${key}=${count})`,
        );
      }
    }
    if (!roomsValue.some((room) => room.required)) {
      ctx.fail("rooms", "at least one room must be required");
    }
    if (!roomsValue.some((room) => room.type === "living" || room.type === "dining")) {
      ctx.fail("rooms", "at least one living or dining room is required");
    }
  }

  const relationshipsRaw = listIn(
    ctx,
    input.relationships,
    "relationships",
    0,
    CONTRACT_LIMITS.relationships,
  );
  const relationshipsValue: RelationshipV1[] = [];
  if (relationshipsRaw) {
    relationshipsRaw.forEach((entry, index) => {
      const local = `relationships[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(
        ctx,
        entry,
        ["id", "a", "b", "kind", "minSharedWallMm", "minOpeningWidthMm"],
        local,
      );
      const id = strIn(ctx, entry.id, `${local}.id`, { pattern: ID_PATTERN });
      const a = strIn(ctx, entry.a, `${local}.a`, { pattern: ID_PATTERN });
      const b = strIn(ctx, entry.b, `${local}.b`, { pattern: ID_PATTERN });
      const kind = enumIn(ctx, entry.kind, `${local}.kind`, RELATIONSHIP_KINDS);
      const minSharedWallMm = intIn(
        ctx,
        entry.minSharedWallMm,
        `${local}.minSharedWallMm`,
        CONTRACT_LIMITS.relationshipMm[0],
        CONTRACT_LIMITS.relationshipMm[1],
      );
      const minOpeningWidthMm = intIn(
        ctx,
        entry.minOpeningWidthMm,
        `${local}.minOpeningWidthMm`,
        CONTRACT_LIMITS.doorMm[0],
        CONTRACT_LIMITS.relationshipMm[1],
      );
      if (
        id === undefined ||
        a === undefined ||
        b === undefined ||
        kind === undefined ||
        minSharedWallMm === undefined ||
        minOpeningWidthMm === undefined
      ) {
        return;
      }
      if (a === b) {
        ctx.fail(local, "a and b must be different rooms");
      }
      relationshipsValue.push({ id, a, b, kind, minSharedWallMm, minOpeningWidthMm });
    });

    const known = new Set(roomsValue.map((room) => room.id));
    const relIds = relationshipsValue.map((rel) => rel.id);
    const duplicateRelIds = [
      ...new Set(relIds.filter((id) => relIds.filter((other) => other === id).length > 1)),
    ];
    if (duplicateRelIds.length > 0) {
      ctx.fail("relationships", `duplicate relationship ids: ${duplicateRelIds.join(", ")}`);
    }
    const seenPairs = new Set<string>();
    for (const rel of relationshipsValue) {
      for (const endpoint of [rel.a, rel.b]) {
        if (!known.has(endpoint)) {
          ctx.fail("relationships", `relationship ${rel.id}: unknown room ${endpoint}`);
        }
      }
      const pair = [rel.a, rel.b].sort().join("|");
      if (seenPairs.has(pair)) {
        ctx.fail("relationships", `one relationship per unordered pair (${rel.a}, ${rel.b})`);
      }
      seenPairs.add(pair);
    }
  }

  const building = isRecord(input.building) ? input.building : undefined;
  let buildingValue;
  if (!building) {
    ctx.fail("building", "must be an object");
  } else {
    unknownFields(ctx, building, ["targetGfaM2", "maxGfaM2"], "building");
    const targetGfaM2 = building.targetGfaM2 === null
      ? null
      : numIn(
          ctx,
          building.targetGfaM2,
          "building.targetGfaM2",
          CONTRACT_LIMITS.buildingGfaM2[0],
          CONTRACT_LIMITS.buildingGfaM2[1],
          3,
        );
    const maxGfaM2 = building.maxGfaM2 === null
      ? null
      : numIn(
          ctx,
          building.maxGfaM2,
          "building.maxGfaM2",
          CONTRACT_LIMITS.buildingGfaM2[0],
          CONTRACT_LIMITS.buildingGfaM2[1],
          3,
        );
    if (targetGfaM2 !== undefined && maxGfaM2 !== undefined) {
      if (targetGfaM2 !== null && maxGfaM2 !== null && targetGfaM2 > maxGfaM2) {
        ctx.fail("building", "targetGfaM2 must not exceed maxGfaM2");
      }
      buildingValue = { targetGfaM2, maxGfaM2 };
    }
  }

  const settings = isRecord(input.settings) ? input.settings : undefined;
  let settingsValue;
  if (!settings) {
    ctx.fail("settings", "must be an object");
  } else {
    unknownFields(ctx, settings, ["topK", "topN", "solverTimeLimitS", "seed"], "settings");
    const topK = intIn(ctx, settings.topK, "settings.topK", CONTRACT_LIMITS.topK[0], CONTRACT_LIMITS.topK[1]);
    const topN = intIn(ctx, settings.topN, "settings.topN", CONTRACT_LIMITS.topN[0], CONTRACT_LIMITS.topN[1]);
    const solverTimeLimitS = intIn(
      ctx,
      settings.solverTimeLimitS,
      "settings.solverTimeLimitS",
      CONTRACT_LIMITS.solverTimeLimitS[0],
      CONTRACT_LIMITS.solverTimeLimitS[1],
    );
    const seed = intIn(ctx, settings.seed, "settings.seed", CONTRACT_LIMITS.seed[0], CONTRACT_LIMITS.seed[1]);
    if (topK !== undefined && topN !== undefined && topN > topK) {
      ctx.fail("settings", "topN must not exceed topK");
    }
    if (
      topK !== undefined &&
      topN !== undefined &&
      solverTimeLimitS !== undefined &&
      seed !== undefined
    ) {
      settingsValue = { topK, topN, solverTimeLimitS, seed };
    }
  }

  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      schemaVersion: "planlab.brief/1",
      units: "mm",
      site: siteValue!,
      setbacks: setbacksValue!,
      walls: wallsValue!,
      circulation: circulationValue!,
      doors: doorsValue!,
      rooms: roomsValue,
      relationships: relationshipsValue,
      building: buildingValue!,
      settings: settingsValue!,
    },
  };
}

export function assertBriefV1(input: unknown): BriefV1 {
  const result = validateBriefV1(input);
  if (!result.ok || !result.value) {
    throw new ContractValidationError("brief", result.issues);
  }
  return result.value;
}

export function validateGenerationRequestV1(
  input: unknown,
): ValidationResult<GenerationRequestV1> {
  const ctx = new Checker("request");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(ctx, input, ["schemaVersion", "projectId", "briefVersionId", "idempotencyKey"]);
  if (input.schemaVersion !== CONTRACT_VERSION) {
    ctx.fail("schemaVersion", `must be ${CONTRACT_VERSION}`);
  }
  const projectId = strIn(ctx, input.projectId, "projectId", { pattern: UUID_PATTERN });
  const briefVersionId = strIn(ctx, input.briefVersionId, "briefVersionId", { pattern: UUID_PATTERN });
  const idempotencyKey = strIn(ctx, input.idempotencyKey, "idempotencyKey", { min: 1, max: 128 });
  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      schemaVersion: CONTRACT_VERSION,
      projectId: projectId!,
      briefVersionId: briefVersionId!,
      idempotencyKey: idempotencyKey!,
    },
  };
}

export function validateEngineVersionsV1(input: unknown): ValidationResult<EngineVersionsV1> {
  const ctx = new Checker("versions");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(
    ctx,
    input,
    [
      "engineVersion",
      "engineSourceSha256",
      "modelVersion",
      "checkpointId",
      "checkpointSha256",
      "vocabularySha256",
      "serviceVersion",
      "contractVersion",
      "pythonVersion",
      "torchVersion",
      "ortoolsVersion",
    ],
  );
  const engineVersion = strIn(ctx, input.engineVersion, "engineVersion", { min: 1, max: 80 });
  const engineSourceSha256 = strIn(ctx, input.engineSourceSha256, "engineSourceSha256", {
    pattern: SHA256_PATTERN,
  });
  const checkpointSha256 = strIn(ctx, input.checkpointSha256, "checkpointSha256", {
    pattern: SHA256_PATTERN,
  });
  const vocabularySha256 = strIn(ctx, input.vocabularySha256, "vocabularySha256", {
    pattern: SHA256_PATTERN,
  });
  const serviceVersion = strIn(ctx, input.serviceVersion, "serviceVersion", { min: 1, max: 40 });
  const pythonVersion = strIn(ctx, input.pythonVersion, "pythonVersion", { min: 1, max: 40 });
  const torchVersion = strIn(ctx, input.torchVersion, "torchVersion", { min: 1, max: 40 });
  const ortoolsVersion = strIn(ctx, input.ortoolsVersion, "ortoolsVersion", { min: 1, max: 40 });
  if (input.modelVersion !== "topology_v1") {
    ctx.fail("modelVersion", "must be topology_v1");
  }
  if (input.checkpointId !== "full_v1a/best") {
    ctx.fail("checkpointId", "must be full_v1a/best");
  }
  if (input.contractVersion !== CONTRACT_VERSION) {
    ctx.fail("contractVersion", `must be ${CONTRACT_VERSION}`);
  }
  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      engineVersion: engineVersion!,
      engineSourceSha256: engineSourceSha256!,
      modelVersion: "topology_v1",
      checkpointId: "full_v1a/best",
      checkpointSha256: checkpointSha256!,
      vocabularySha256: vocabularySha256!,
      serviceVersion: serviceVersion!,
      contractVersion: CONTRACT_VERSION,
      pythonVersion: pythonVersion!,
      torchVersion: torchVersion!,
      ortoolsVersion: ortoolsVersion!,
    },
  };
}

export function validateProblemV1(input: unknown): ValidationResult<ProblemV1> {
  const ctx = new Checker("problem");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(
    ctx,
    input,
    ["code", "category", "message", "retryable", "proof", "fieldErrors", "remediation", "correlationId"],
  );
  const code = enumIn(ctx, input.code, "code", ERROR_CODES);
  const message = strIn(ctx, input.message, "message", { min: 1, max: 500 });
  const correlationId = strIn(ctx, input.correlationId, "correlationId", { min: 1, max: 64 });
  const retryable = boolIn(ctx, input.retryable, "retryable");
  const category = enumIn(ctx, input.category, "category", [
    "input",
    "architectural",
    "technical",
    "conflict",
  ] as const);
  const proof =
    input.proof === null
      ? null
      : enumIn(ctx, input.proof, "proof", ["necessary_condition", "limited_search"] as const);

  const fieldErrorsRaw = listIn(ctx, input.fieldErrors, "fieldErrors", 0, 32);
  const fieldErrors: FieldErrorV1[] = [];
  if (fieldErrorsRaw) {
    fieldErrorsRaw.forEach((entry, index) => {
      const local = `fieldErrors[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(ctx, entry, ["path", "message"], local);
      const path = strIn(ctx, entry.path, `${local}.path`, { min: 1, max: 200 });
      const text = strIn(ctx, entry.message, `${local}.message`, { min: 1, max: 400 });
      if (path !== undefined && text !== undefined) {
        fieldErrors.push({ path, message: text });
      }
    });
  }

  const remediationRaw = listIn(ctx, input.remediation, "remediation", 0, 8);
  const remediation: RemediationV1[] = [];
  if (remediationRaw) {
    remediationRaw.forEach((entry, index) => {
      const local = `remediation[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(ctx, entry, ["code", "message", "roomIds", "fieldPaths"], local);
      const remediatedCode = enumIn(ctx, entry.code, `${local}.code`, REMEDIATION_CODES);
      const text = strIn(ctx, entry.message, `${local}.message`, { min: 1, max: 400 });
      const roomIdsRaw = listIn(ctx, entry.roomIds, `${local}.roomIds`, 0, 24) ?? [];
      const roomIds = roomIdsRaw
        .map((room, roomIndex) => strIn(ctx, room, `${local}.roomIds[${roomIndex}]`, { pattern: ID_PATTERN }))
        .filter((room): room is string => room !== undefined);
      const fieldPathsRaw = listIn(ctx, entry.fieldPaths, `${local}.fieldPaths`, 0, 32) ?? [];
      const fieldPaths = fieldPathsRaw
        .map((candidate, pathIndex) =>
          strIn(ctx, candidate, `${local}.fieldPaths[${pathIndex}]`, { min: 1, max: 200 }),
        )
        .filter((candidate): candidate is string => candidate !== undefined);
      if (remediatedCode !== undefined && text !== undefined) {
        remediation.push({ code: remediatedCode, message: text, roomIds, fieldPaths });
      }
    });
  }

  if (code !== undefined) {
    const shape = ERROR_SHAPE[code];
    if (category !== undefined && category !== shape.category) {
      ctx.fail("category", `error ${code} must use category ${shape.category}`);
    }
    if (proof !== undefined && proof !== shape.proof) {
      ctx.fail("proof", `error ${code} must use proof ${String(shape.proof)}`);
    }
    if (retryable !== undefined && retryable !== shape.retryable) {
      ctx.fail("retryable", `error ${code} must set retryable=${shape.retryable}`);
    }
  }

  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      code: code!,
      category: category!,
      message: message!,
      retryable: retryable!,
      proof: proof!,
      fieldErrors,
      remediation,
      correlationId: correlationId!,
    },
  };
}

function layoutRoomIn(ctx: Checker, value: unknown, local: string): LayoutRoomV1 | undefined {
  if (!isRecord(value)) {
    return ctx.fail(local, "must be an object");
  }
  const room = roomIn(ctx, value, local, ["present", "rect", "areaM2"]);
  const present = value.present === true;
  if (!present) {
    ctx.fail(`${local}.present`, "must be true for a returned room");
  }
  const rect = rectIn(ctx, value.rect, `${local}.rect`, true);
  const areaM2 = numIn(ctx, value.areaM2, `${local}.areaM2`, 0, Number.MAX_SAFE_INTEGER);
  if (!room || !rect || areaM2 === undefined) {
    return undefined;
  }
  const expected = (rect.widthMm * rect.heightMm) / 1_000_000;
  if (Math.abs(expected - areaM2) > 1e-9) {
    ctx.fail(`${local}.areaM2`, `must equal width*height/1e6 (${expected})`);
  }
  if (areaM2 < room.minAreaM2 - 1e-9 || areaM2 > room.maxAreaM2 + 1e-9) {
    ctx.fail(local, "returned area is outside the authored bounds");
  }
  if (Math.min(rect.widthMm, rect.heightMm) < room.minShortSideMm) {
    ctx.fail(local, "returned short side is below the authored minimum");
  }
  if (rect.widthMm < room.minWidthMm || rect.heightMm < room.minHeightMm) {
    ctx.fail(local, "returned axis extent is below the authored minimum");
  }
  return { ...room, present: true, rect, areaM2 };
}

export function validateLayoutV1(input: unknown): ValidationResult<LayoutV1> {
  const ctx = new Checker("layout");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(ctx, input, [
    "schemaVersion",
    "layoutId",
    "generationId",
    "projectId",
    "briefVersionId",
    "briefHash",
    "rank",
    "createdAt",
    "solverStatus",
    "validationStatus",
    "coordinateSystem",
    "site",
    "setbacks",
    "setbackEnvelope",
    "buildingEnvelope",
    "buildableEnvelope",
    "rooms",
    "omittedRoomIds",
    "circulation",
    "walls",
    "openings",
    "scores",
    "areas",
    "validation",
    "warnings",
    "remediation",
    "relaxations",
    "versions",
    "provenance",
  ]);

  if (input.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    ctx.fail("schemaVersion", `must be ${LAYOUT_SCHEMA_VERSION}`);
  }
  const layoutId = strIn(ctx, input.layoutId, "layoutId", { pattern: UUID_PATTERN });
  const generationId = strIn(ctx, input.generationId, "generationId", { pattern: UUID_PATTERN });
  const projectId = strIn(ctx, input.projectId, "projectId", { pattern: UUID_PATTERN });
  const briefVersionId = strIn(ctx, input.briefVersionId, "briefVersionId", { pattern: UUID_PATTERN });
  const briefHash = strIn(ctx, input.briefHash, "briefHash", { pattern: SHA256_PATTERN });
  const rank = intIn(ctx, input.rank, "rank", 1, 3);
  const createdAt = strIn(ctx, input.createdAt, "createdAt", { pattern: TIMESTAMP_PATTERN });
  const solverStatus = enumIn(ctx, input.solverStatus, "solverStatus", ["FEASIBLE", "OPTIMAL"] as const);
  if (input.validationStatus !== "PASSED") {
    ctx.fail("validationStatus", "must be PASSED");
  }
  if (input.coordinateSystem !== "site-sw-x-east-y-north-mm") {
    ctx.fail("coordinateSystem", "must be site-sw-x-east-y-north-mm");
  }

  const siteRecord = isRecord(input.site) ? input.site : undefined;
  let site;
  if (!siteRecord) {
    ctx.fail("site", "must be an object");
  } else {
    unknownFields(ctx, siteRecord, ["widthMm", "heightMm", "front"], "site");
    const widthMm = intIn(
      ctx,
      siteRecord.widthMm,
      "site.widthMm",
      CONTRACT_LIMITS.siteAxisMm[0],
      CONTRACT_LIMITS.siteAxisMm[1],
    );
    const heightMm = intIn(
      ctx,
      siteRecord.heightMm,
      "site.heightMm",
      CONTRACT_LIMITS.siteAxisMm[0],
      CONTRACT_LIMITS.siteAxisMm[1],
    );
    const front = enumIn(ctx, siteRecord.front, "site.front", SIDES);
    if (widthMm !== undefined && heightMm !== undefined && front !== undefined) {
      site = { widthMm, heightMm, front };
    }
  }

  const setbacksRecord = isRecord(input.setbacks) ? input.setbacks : undefined;
  let setbacks;
  if (!setbacksRecord) {
    ctx.fail("setbacks", "must be an object");
  } else {
    unknownFields(ctx, setbacksRecord, ["northMm", "eastMm", "southMm", "westMm"], "setbacks");
    const northMm = intIn(
      ctx,
      setbacksRecord.northMm,
      "setbacks.northMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const eastMm = intIn(
      ctx,
      setbacksRecord.eastMm,
      "setbacks.eastMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const southMm = intIn(
      ctx,
      setbacksRecord.southMm,
      "setbacks.southMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    const westMm = intIn(
      ctx,
      setbacksRecord.westMm,
      "setbacks.westMm",
      CONTRACT_LIMITS.setbackMm[0],
      CONTRACT_LIMITS.setbackMm[1],
    );
    if (
      northMm !== undefined &&
      eastMm !== undefined &&
      southMm !== undefined &&
      westMm !== undefined
    ) {
      setbacks = { northMm, eastMm, southMm, westMm };
    }
  }

  const setbackEnvelope = rectIn(ctx, input.setbackEnvelope, "setbackEnvelope", false);
  const buildingEnvelope = rectIn(ctx, input.buildingEnvelope, "buildingEnvelope", true);
  const buildableEnvelope = rectIn(ctx, input.buildableEnvelope, "buildableEnvelope", true);

  const roomsRaw = listIn(ctx, input.rooms, "rooms", 1, CONTRACT_LIMITS.rooms[1]);
  const rooms: LayoutRoomV1[] = [];
  if (roomsRaw) {
    roomsRaw.forEach((entry, index) => {
      const room = layoutRoomIn(ctx, entry, `rooms[${index}]`);
      if (room) {
        rooms.push(room);
      }
    });
    const ids = rooms.map((room) => room.id);
    const duplicates = [...new Set(ids.filter((id) => ids.filter((other) => other === id).length > 1))];
    if (duplicates.length > 0) {
      ctx.fail("rooms", `duplicate layout room ids: ${duplicates.join(", ")}`);
    }
  }

  const omittedRaw = listIn(ctx, input.omittedRoomIds, "omittedRoomIds", 0, CONTRACT_LIMITS.rooms[1]) ?? [];
  const omittedRoomIds = omittedRaw
    .map((entry, index) => strIn(ctx, entry, `omittedRoomIds[${index}]`, { pattern: ID_PATTERN }))
    .filter((entry): entry is string => entry !== undefined);
  const overlap = omittedRoomIds.filter((id) => rooms.some((room) => room.id === id));
  if (overlap.length > 0) {
    ctx.fail("omittedRoomIds", `rooms cannot be both present and omitted: ${overlap.join(", ")}`);
  }

  const circulationRecord = isRecord(input.circulation) ? input.circulation : undefined;
  let circulation;
  if (!circulationRecord) {
    ctx.fail("circulation", "must be an object");
  } else {
    unknownFields(
      ctx,
      circulationRecord,
      ["id", "rect", "minWidthMm", "measuredMinWidthMm", "areaM2", "entry"],
      "circulation",
    );
    if (circulationRecord.id !== "CORRIDOR") {
      ctx.fail("circulation.id", "must be CORRIDOR");
    }
    const rect = rectIn(ctx, circulationRecord.rect, "circulation.rect", true);
    const minWidthMm = intIn(
      ctx,
      circulationRecord.minWidthMm,
      "circulation.minWidthMm",
      CONTRACT_LIMITS.circulationMm[0],
      CONTRACT_LIMITS.circulationMm[1],
    );
    const measuredMinWidthMm = intIn(
      ctx,
      circulationRecord.measuredMinWidthMm,
      "circulation.measuredMinWidthMm",
      1,
      CONTRACT_LIMITS.siteAxisMm[1],
    );
    const areaM2 = numIn(ctx, circulationRecord.areaM2, "circulation.areaM2", 0, Number.MAX_SAFE_INTEGER);
    const entryRecord = isRecord(circulationRecord.entry) ? circulationRecord.entry : undefined;
    let entry;
    if (!entryRecord) {
      ctx.fail("circulation.entry", "must be an object");
    } else {
      unknownFields(ctx, entryRecord, ["side", "xMm", "yMm", "widthMm"], "circulation.entry");
      const side = enumIn(ctx, entryRecord.side, "circulation.entry.side", SIDES);
      const xMm = intIn(ctx, entryRecord.xMm, "circulation.entry.xMm", 0, CONTRACT_LIMITS.siteAxisMm[1]);
      const yMm = intIn(ctx, entryRecord.yMm, "circulation.entry.yMm", 0, CONTRACT_LIMITS.siteAxisMm[1]);
      const widthMm = intIn(
        ctx,
        entryRecord.widthMm,
        "circulation.entry.widthMm",
        1,
        CONTRACT_LIMITS.roomLengthMm[1],
      );
      if (side !== undefined && xMm !== undefined && yMm !== undefined && widthMm !== undefined) {
        entry = { side, xMm, yMm, widthMm };
      }
    }
    if (minWidthMm !== undefined && measuredMinWidthMm !== undefined && measuredMinWidthMm < minWidthMm) {
      ctx.fail("circulation.measuredMinWidthMm", "is below the brief minimum");
    }
    if (
      rect !== undefined &&
      minWidthMm !== undefined &&
      measuredMinWidthMm !== undefined &&
      areaM2 !== undefined &&
      entry !== undefined
    ) {
      circulation = { id: "CORRIDOR" as const, rect, minWidthMm, measuredMinWidthMm, areaM2, entry };
    }
  }

  const wallsRaw = listIn(ctx, input.walls, "walls", 0, 200);
  const walls: WallV1[] = [];
  if (wallsRaw) {
    wallsRaw.forEach((entry, index) => {
      const local = `walls[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(ctx, entry, ["id", "type", "thicknessMm", "rect", "orientation", "between"], local);
      const id = strIn(ctx, entry.id, `${local}.id`, { min: 1, max: 40 });
      const type = enumIn(ctx, entry.type, `${local}.type`, WALL_TYPES);
      const thicknessMm = intIn(ctx, entry.thicknessMm, `${local}.thicknessMm`, 1, CONTRACT_LIMITS.externalWallMm[1]);
      const rect = rectIn(ctx, entry.rect, `${local}.rect`, true);
      const orientation = enumIn(ctx, entry.orientation, `${local}.orientation`, ORIENTATIONS);
      const betweenRaw = listIn(ctx, entry.between, `${local}.between`, 0, 2) ?? [];
      const between = betweenRaw
        .map((candidate, betweenIndex) =>
          strIn(ctx, candidate, `${local}.between[${betweenIndex}]`, { pattern: ID_PATTERN }),
        )
        .filter((candidate): candidate is string => candidate !== undefined);
      if (
        id !== undefined &&
        type !== undefined &&
        thicknessMm !== undefined &&
        rect !== undefined &&
        orientation !== undefined
      ) {
        walls.push({ id, type, thicknessMm, rect, orientation, between });
      }
    });
    const wallIds = walls.map((wall) => wall.id);
    if (new Set(wallIds).size !== wallIds.length) {
      ctx.fail("walls", "wall ids must be unique");
    }
  }

  const openingsRaw = listIn(ctx, input.openings, "openings", 0, 200);
  const openings: OpeningV1[] = [];
  if (openingsRaw) {
    openingsRaw.forEach((entry, index) => {
      const local = `openings[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(
        ctx,
        entry,
        ["id", "wallId", "kind", "a", "b", "rect", "orientation", "fits"],
        local,
      );
      const id = strIn(ctx, entry.id, `${local}.id`, { min: 1, max: 40 });
      const wallId = strIn(ctx, entry.wallId, `${local}.wallId`, { min: 1, max: 40 });
      const kind = enumIn(ctx, entry.kind, `${local}.kind`, OPENING_KINDS);
      const a = strIn(ctx, entry.a, `${local}.a`, { pattern: ID_PATTERN });
      const b = strIn(ctx, entry.b, `${local}.b`, { pattern: ID_PATTERN });
      const rect = rectIn(ctx, entry.rect, `${local}.rect`, false);
      const orientation = enumIn(ctx, entry.orientation, `${local}.orientation`, ORIENTATIONS);
      if (entry.fits !== true) {
        ctx.fail(`${local}.fits`, "must be true");
      }
      if (
        id !== undefined &&
        wallId !== undefined &&
        kind !== undefined &&
        a !== undefined &&
        b !== undefined &&
        rect !== undefined &&
        orientation !== undefined
      ) {
        openings.push({ id, wallId, kind, a, b, rect, orientation, fits: true });
      }
    });
    const openingIds = openings.map((opening) => opening.id);
    if (new Set(openingIds).size !== openingIds.length) {
      ctx.fail("openings", "opening ids must be unique");
    }
    const knownWalls = new Set(walls.map((wall) => wall.id));
    const knownRooms = new Set(rooms.map((room) => room.id));
    for (const opening of openings) {
      if (!knownWalls.has(opening.wallId)) {
        ctx.fail("openings", `opening ${opening.id}: unknown wall ${opening.wallId}`);
      }
      for (const endpoint of [opening.a, opening.b]) {
        if (!knownRooms.has(endpoint) && !VIRTUAL_NODES.includes(endpoint)) {
          ctx.fail("openings", `opening ${opening.id}: unknown room ${endpoint}`);
        }
      }
    }
  }

  const scoresRecord = isRecord(input.scores) ? input.scores : undefined;
  let scores;
  if (!scoresRecord) {
    ctx.fail("scores", "must be an object");
  } else {
    unknownFields(ctx, scoresRecord, ["final", "topology", "geometry", "circulation", "preference", "constraint"], "scores");
    const keys = ["final", "topology", "geometry", "circulation", "preference", "constraint"] as const;
    const values: Record<string, number> = {};
    let complete = true;
    for (const key of keys) {
      const value = numIn(ctx, scoresRecord[key], `scores.${key}`, 0, 1);
      if (value === undefined) {
        complete = false;
      } else {
        values[key] = value;
      }
    }
    if (complete) {
      scores = values as unknown as LayoutV1["scores"];
    }
  }

  const areasRecord = isRecord(input.areas) ? input.areas : undefined;
  let areas;
  if (!areasRecord) {
    ctx.fail("areas", "must be an object");
  } else {
    unknownFields(ctx, areasRecord, ["grossExternalM2", "roomRectangleM2", "circulationM2", "residualM2"], "areas");
    const keys = ["grossExternalM2", "roomRectangleM2", "circulationM2", "residualM2"] as const;
    const values: Record<string, number> = {};
    let complete = true;
    for (const key of keys) {
      const value = numIn(ctx, areasRecord[key], `areas.${key}`, 0, Number.MAX_SAFE_INTEGER);
      if (value === undefined) {
        complete = false;
      } else {
        values[key] = value;
      }
    }
    if (complete) {
      areas = values as unknown as LayoutV1["areas"];
    }
  }

  const validationRecord = isRecord(input.validation) ? input.validation : undefined;
  let validation;
  if (!validationRecord) {
    ctx.fail("validation", "must be an object");
  } else {
    unknownFields(ctx, validationRecord, ["allPassed", "checks"], "validation");
    if (validationRecord.allPassed !== true) {
      ctx.fail("validation.allPassed", "must be true");
    }
    const checksRaw = listIn(ctx, validationRecord.checks, "validation.checks", 1, 64);
    const checks: ValidationCheckV1[] = [];
    if (checksRaw) {
      checksRaw.forEach((entry, index) => {
        const local = `validation.checks[${index}]`;
        if (!isRecord(entry)) {
          ctx.fail(local, "must be an object");
          return;
        }
        unknownFields(ctx, entry, ["id", "name", "passed", "detail"], local);
        const id = strIn(ctx, entry.id, `${local}.id`, { min: 1, max: 40 });
        const name = strIn(ctx, entry.name, `${local}.name`, { min: 1, max: 120 });
        const passed = boolIn(ctx, entry.passed, `${local}.passed`);
        const detail = strIn(ctx, entry.detail, `${local}.detail`, { min: 0, max: 500 });
        if (passed === false) {
          ctx.fail(`${local}.passed`, "a persisted layout cannot carry failed checks");
        }
        if (id !== undefined && name !== undefined && passed !== undefined && detail !== undefined) {
          checks.push({ id, name, passed, detail });
        }
      });
    }
    validation = { allPassed: true as const, checks };
  }

  const warningsRaw = listIn(ctx, input.warnings, "warnings", 0, 32) ?? [];
  const warnings = warningsRaw
    .map((entry, index) => strIn(ctx, entry, `warnings[${index}]`, { min: 0, max: 300 }))
    .filter((entry): entry is string => entry !== undefined);

  const relaxationsRaw = listIn(ctx, input.relaxations, "relaxations", 0, 8) ?? [];
  const relaxations = [];
  for (const [index, entry] of relaxationsRaw.entries()) {
    const local = `relaxations[${index}]`;
    if (!isRecord(entry)) {
      ctx.fail(local, "must be an object");
      continue;
    }
    unknownFields(ctx, entry, ["code", "description"], local);
    const code = strIn(ctx, entry.code, `${local}.code`, { min: 1, max: 40 });
    const description = strIn(ctx, entry.description, `${local}.description`, { min: 1, max: 200 });
    if (code !== undefined && description !== undefined) {
      relaxations.push({ code, description });
    }
  }

  const versions = validateEngineVersionsV1(input.versions);
  if (!versions.ok) {
    ctx.issues.push(...versions.issues);
  }

  const provenanceRecord = isRecord(input.provenance) ? input.provenance : undefined;
  let provenance;
  if (!provenanceRecord) {
    ctx.fail("provenance", "must be an object");
  } else {
    unknownFields(
      ctx,
      provenanceRecord,
      ["topologyCandidateId", "topologySource", "solverTimeLimitS", "solverWorkers", "seed", "attempts"],
      "provenance",
    );
    const topologyCandidateId = strIn(
      ctx,
      provenanceRecord.topologyCandidateId,
      "provenance.topologyCandidateId",
      { min: 1, max: 80 },
    );
    if (provenanceRecord.topologySource !== "topology_model_v1") {
      ctx.fail("provenance.topologySource", "must be topology_model_v1");
    }
    const solverTimeLimitS = intIn(
      ctx,
      provenanceRecord.solverTimeLimitS,
      "provenance.solverTimeLimitS",
      CONTRACT_LIMITS.solverTimeLimitS[0],
      CONTRACT_LIMITS.solverTimeLimitS[1],
    );
    const solverWorkers = intIn(ctx, provenanceRecord.solverWorkers, "provenance.solverWorkers", 1, 8);
    const seed = intIn(ctx, provenanceRecord.seed, "provenance.seed", 0, CONTRACT_LIMITS.seed[1]);
    const attempts = intIn(ctx, provenanceRecord.attempts, "provenance.attempts", 1, 16);
    if (
      topologyCandidateId !== undefined &&
      solverTimeLimitS !== undefined &&
      solverWorkers !== undefined &&
      seed !== undefined &&
      attempts !== undefined
    ) {
      provenance = {
        topologyCandidateId,
        topologySource: "topology_model_v1" as const,
        solverTimeLimitS,
        solverWorkers,
        seed,
        attempts,
      };
    }
  }

  const remediationRaw = listIn(ctx, input.remediation, "remediation", 0, 8) ?? [];
  const remediation: RemediationV1[] = [];
  for (const [index, entry] of remediationRaw.entries()) {
    const local = `remediation[${index}]`;
    if (!isRecord(entry)) {
      ctx.fail(local, "must be an object");
      continue;
    }
    unknownFields(ctx, entry, ["code", "message", "roomIds", "fieldPaths"], local);
    const code = enumIn(ctx, entry.code, `${local}.code`, REMEDIATION_CODES);
    const message = strIn(ctx, entry.message, `${local}.message`, { min: 1, max: 400 });
    const roomIdsRaw = listIn(ctx, entry.roomIds, `${local}.roomIds`, 0, 24) ?? [];
    const roomIds = roomIdsRaw
      .map((room, roomIndex) => strIn(ctx, room, `${local}.roomIds[${roomIndex}]`, { pattern: ID_PATTERN }))
      .filter((room): room is string => room !== undefined);
    const fieldPathsRaw = listIn(ctx, entry.fieldPaths, `${local}.fieldPaths`, 0, 32) ?? [];
    const fieldPaths = fieldPathsRaw
      .map((candidate, pathIndex) =>
        strIn(ctx, candidate, `${local}.fieldPaths[${pathIndex}]`, { min: 1, max: 200 }),
      )
      .filter((candidate): candidate is string => candidate !== undefined);
    if (code !== undefined && message !== undefined) {
      remediation.push({ code, message, roomIds, fieldPaths });
    }
  }

  if (buildingEnvelope && buildableEnvelope) {
    const inside =
      buildableEnvelope.xMm >= buildingEnvelope.xMm &&
      buildableEnvelope.yMm >= buildingEnvelope.yMm &&
      buildableEnvelope.xMm + buildableEnvelope.widthMm <=
        buildingEnvelope.xMm + buildingEnvelope.widthMm &&
      buildableEnvelope.yMm + buildableEnvelope.heightMm <=
        buildingEnvelope.yMm + buildingEnvelope.heightMm;
    if (!inside) {
      ctx.fail("buildableEnvelope", "must sit inside buildingEnvelope");
    }
  }
  if (buildingEnvelope && site) {
    if (
      buildingEnvelope.xMm + buildingEnvelope.widthMm > site.widthMm ||
      buildingEnvelope.yMm + buildingEnvelope.heightMm > site.heightMm
    ) {
      ctx.fail("buildingEnvelope", "must sit inside the site");
    }
  }

  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      layoutId: layoutId!,
      generationId: generationId!,
      projectId: projectId!,
      briefVersionId: briefVersionId!,
      briefHash: briefHash!,
      rank: rank!,
      createdAt: createdAt!,
      solverStatus: solverStatus!,
      validationStatus: "PASSED",
      coordinateSystem: "site-sw-x-east-y-north-mm",
      site: site!,
      setbacks: setbacks!,
      setbackEnvelope: setbackEnvelope!,
      buildingEnvelope: buildingEnvelope!,
      buildableEnvelope: buildableEnvelope!,
      rooms,
      omittedRoomIds,
      circulation: circulation!,
      walls,
      openings,
      scores: scores!,
      areas: areas!,
      validation: validation!,
      warnings,
      remediation,
      relaxations,
      versions: versions.value!,
      provenance: provenance!,
    },
  };
}

export function assertLayoutV1(input: unknown): LayoutV1 {
  const result = validateLayoutV1(input);
  if (!result.ok || !result.value) {
    throw new ContractValidationError("layout", result.issues);
  }
  return result.value;
}

export function validateJobV1(input: unknown): ValidationResult<JobV1> {
  const ctx = new Checker("job");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(ctx, input, [
    "schemaVersion",
    "generationId",
    "projectId",
    "briefVersionId",
    "briefHash",
    "status",
    "stateVersion",
    "progress",
    "createdAt",
    "startedAt",
    "finishedAt",
    "elapsedMs",
    "cancelRequested",
    "layoutIds",
    "versions",
    "error",
    "warnings",
  ]);
  if (input.schemaVersion !== CONTRACT_VERSION) {
    ctx.fail("schemaVersion", `must be ${CONTRACT_VERSION}`);
  }
  const generationId = strIn(ctx, input.generationId, "generationId", { pattern: UUID_PATTERN });
  const projectId = strIn(ctx, input.projectId, "projectId", { pattern: UUID_PATTERN });
  const briefVersionId = strIn(ctx, input.briefVersionId, "briefVersionId", { pattern: UUID_PATTERN });
  const briefHash = strIn(ctx, input.briefHash, "briefHash", { pattern: SHA256_PATTERN });
  const status = enumIn(ctx, input.status, "status", GENERATION_STATUSES);
  const stateVersion = intIn(ctx, input.stateVersion, "stateVersion", 0, Number.MAX_SAFE_INTEGER);
  const createdAt = strIn(ctx, input.createdAt, "createdAt", { pattern: TIMESTAMP_PATTERN });
  const elapsedMs = intIn(ctx, input.elapsedMs, "elapsedMs", 0, Number.MAX_SAFE_INTEGER);

  const progressRecord = isRecord(input.progress) ? input.progress : undefined;
  let progress;
  if (!progressRecord) {
    ctx.fail("progress", "must be an object");
  } else {
    unknownFields(
      ctx,
      progressRecord,
      ["stage", "candidateId", "candidatesCompleted", "candidatesTotal"],
      "progress",
    );
    const stage = enumIn(ctx, progressRecord.stage, "progress.stage", GENERATION_STATUSES);
    const candidateId = progressRecord.candidateId === null
      ? null
      : strIn(ctx, progressRecord.candidateId, "progress.candidateId", { pattern: ID_PATTERN });
    const candidatesCompleted = progressRecord.candidatesCompleted === null
      ? null
      : intIn(ctx, progressRecord.candidatesCompleted, "progress.candidatesCompleted", 0, 64);
    const candidatesTotal = progressRecord.candidatesTotal === null
      ? null
      : intIn(ctx, progressRecord.candidatesTotal, "progress.candidatesTotal", 0, 64);
    if (stage !== undefined && candidateId !== undefined && candidatesCompleted !== undefined && candidatesTotal !== undefined) {
      progress = { stage, candidateId, candidatesCompleted, candidatesTotal };
    }
  }

  const startedAt =
    input.startedAt === null
      ? null
      : (strIn(ctx, input.startedAt, "startedAt", { pattern: TIMESTAMP_PATTERN }) ?? null);
  const finishedAt =
    input.finishedAt === null
      ? null
      : (strIn(ctx, input.finishedAt, "finishedAt", { pattern: TIMESTAMP_PATTERN }) ?? null);
  const cancelRequested = boolIn(ctx, input.cancelRequested, "cancelRequested");
  const layoutIdsRaw = listIn(ctx, input.layoutIds, "layoutIds", 0, 3) ?? [];
  const layoutIds = layoutIdsRaw
    .map((entry, index) => strIn(ctx, entry, `layoutIds[${index}]`, { pattern: UUID_PATTERN }))
    .filter((entry): entry is string => entry !== undefined);
  const warningsRaw = listIn(ctx, input.warnings, "warnings", 0, 32) ?? [];
  const warnings = warningsRaw
    .map((entry, index) => strIn(ctx, entry, `warnings[${index}]`, { min: 0, max: 300 }))
    .filter((entry): entry is string => entry !== undefined);

  const versions =
    input.versions === null ? null : validateEngineVersionsV1(input.versions);
  if (versions && !versions.ok) {
    ctx.issues.push(...versions.issues);
  }
  const error = input.error === null ? null : validateProblemV1(input.error);
  if (error && !error.ok) {
    ctx.issues.push(...error.issues);
  }

  if (status !== undefined) {
    const terminal = ["COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED"].includes(status);
    if (terminal && finishedAt === null) {
      ctx.fail("finishedAt", "is required for a terminal job");
    }
    if (!terminal && finishedAt !== null) {
      ctx.fail("finishedAt", "must be null while the job is still running");
    }
    if (status === "COMPLETED") {
      if (layoutIds.length === 0) {
        ctx.fail("layoutIds", "a COMPLETED job must carry at least one layout id");
      }
      if (versions?.value == null) {
        ctx.fail("versions", "a COMPLETED job must carry engine versions");
      }
      if (error?.value != null) {
        ctx.fail("error", "a COMPLETED job must not carry an error");
      }
    }
    if ((status === "INFEASIBLE" || status === "FAILED") && error?.value == null) {
      ctx.fail("error", `a ${status} job must carry a ProblemV1`);
    }
    if (
      progress &&
      !terminal &&
      progress.stage !== status
    ) {
      ctx.fail("progress.stage", "must match status while the job is running");
    }
  }

  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      schemaVersion: CONTRACT_VERSION,
      generationId: generationId!,
      projectId: projectId!,
      briefVersionId: briefVersionId!,
      briefHash: briefHash!,
      status: status!,
      stateVersion: stateVersion!,
      progress: progress!,
      createdAt: createdAt!,
      startedAt,
      finishedAt,
      elapsedMs: elapsedMs!,
      cancelRequested: cancelRequested!,
      layoutIds,
      versions: versions?.value ?? null,
      error: error?.value ?? null,
      warnings,
    },
  };
}

export function validateEditorDocumentV2(
  input: unknown,
): ValidationResult<EditorDocumentV2> {
  const ctx = new Checker("editorDocument");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(ctx, input, ["schemaVersion", "name", "roomGroups", "legacyImport"]);
  if (input.schemaVersion !== EDITOR_SCHEMA_VERSION) {
    ctx.fail("schemaVersion", `must be ${EDITOR_SCHEMA_VERSION}`);
  }
  const name = strIn(ctx, input.name, "name", {
    min: CONTRACT_LIMITS.labelCharacters[0],
    max: CONTRACT_LIMITS.labelCharacters[1],
  });
  const groupsRaw = listIn(ctx, input.roomGroups, "roomGroups", 1, CONTRACT_LIMITS.rooms[1]);
  const roomGroups: RoomGroupV2[] = [];
  if (groupsRaw) {
    groupsRaw.forEach((entry, index) => {
      const local = `roomGroups[${index}]`;
      if (!isRecord(entry)) {
        ctx.fail(local, "must be an object");
        return;
      }
      unknownFields(
        ctx,
        entry,
        ["requirementId", "label", "type", "roomClass", "quantity", "required", "instanceIds", "retiredInstanceIds"],
        local,
      );
      const requirementId = strIn(ctx, entry.requirementId, `${local}.requirementId`, { pattern: ID_PATTERN });
      const label = strIn(ctx, entry.label, `${local}.label`, {
        min: CONTRACT_LIMITS.labelCharacters[0],
        max: CONTRACT_LIMITS.labelCharacters[1],
      });
      const type = enumIn(ctx, entry.type, `${local}.type`, ROOM_TYPES);
      const roomClass = enumIn(ctx, entry.roomClass, `${local}.roomClass`, ROOM_CLASSES);
      const quantity = intIn(ctx, entry.quantity, `${local}.quantity`, 1, CONTRACT_LIMITS.rooms[1]);
      const required = boolIn(ctx, entry.required, `${local}.required`);
      const instanceIdsRaw = listIn(ctx, entry.instanceIds, `${local}.instanceIds`, 1, CONTRACT_LIMITS.rooms[1]) ?? [];
      const instanceIds = instanceIdsRaw
        .map((value, valueIndex) =>
          strIn(ctx, value, `${local}.instanceIds[${valueIndex}]`, { pattern: ID_PATTERN }),
        )
        .filter((value): value is string => value !== undefined);
      const retiredRaw =
        listIn(ctx, entry.retiredInstanceIds, `${local}.retiredInstanceIds`, 0, 64) ?? [];
      const retiredInstanceIds = retiredRaw
        .map((value, valueIndex) =>
          strIn(ctx, value, `${local}.retiredInstanceIds[${valueIndex}]`, { pattern: ID_PATTERN }),
        )
        .filter((value): value is string => value !== undefined);
      if (quantity !== undefined && instanceIds.length !== quantity) {
        ctx.fail(local, "quantity must equal the number of instance ids");
      }
      const clash = instanceIds.filter((id) => retiredInstanceIds.includes(id));
      if (clash.length > 0) {
        ctx.fail(local, `instance ids cannot be retired as well: ${clash.join(", ")}`);
      }
      if (
        requirementId !== undefined &&
        label !== undefined &&
        type !== undefined &&
        roomClass !== undefined &&
        quantity !== undefined &&
        required !== undefined
      ) {
        roomGroups.push({
          requirementId,
          label,
          type,
          roomClass,
          quantity,
          required,
          instanceIds,
          retiredInstanceIds,
        });
      }
    });
    const ids = roomGroups.map((group) => group.requirementId);
    const duplicates = [...new Set(ids.filter((id) => ids.filter((other) => other === id).length > 1))];
    if (duplicates.length > 0) {
      ctx.fail("roomGroups", `duplicate requirementIds: ${duplicates.join(", ")}`);
    }
  }

  let legacyImport: EditorDocumentV2["legacyImport"] = null;
  if (input.legacyImport !== null) {
    const record = isRecord(input.legacyImport) ? input.legacyImport : undefined;
    if (!record) {
      ctx.fail("legacyImport", "must be an object or null");
    } else {
      unknownFields(ctx, record, ["sourceVersion", "sourceProjectId", "unsupportedItems"], "legacyImport");
      if (record.sourceVersion !== 1) {
        ctx.fail("legacyImport.sourceVersion", "must be 1");
      }
      const sourceProjectId = strIn(ctx, record.sourceProjectId, "legacyImport.sourceProjectId", {
        min: 1,
        max: 120,
      });
      const itemsRaw = listIn(ctx, record.unsupportedItems, "legacyImport.unsupportedItems", 0, 64) ?? [];
      const unsupportedItems = [];
      for (const [index, entry] of itemsRaw.entries()) {
        const local = `legacyImport.unsupportedItems[${index}]`;
        if (!isRecord(entry)) {
          ctx.fail(local, "must be an object");
          continue;
        }
        unknownFields(ctx, entry, ["path", "message", "acknowledged"], local);
        const path = strIn(ctx, entry.path, `${local}.path`, { min: 1, max: 200 });
        const message = strIn(ctx, entry.message, `${local}.message`, { min: 1, max: 400 });
        const acknowledged = boolIn(ctx, entry.acknowledged, `${local}.acknowledged`);
        if (path !== undefined && message !== undefined && acknowledged !== undefined) {
          unsupportedItems.push({ path, message, acknowledged });
        }
      }
      legacyImport = { sourceVersion: 1, sourceProjectId: sourceProjectId!, unsupportedItems };
    }
  }

  const candidate = {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    name: name!,
    roomGroups,
    legacyImport,
  };
  const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
  if (size > CONTRACT_LIMITS.editorDocumentBytes) {
    ctx.fail(
      "",
      `editor document exceeds ${CONTRACT_LIMITS.editorDocumentBytes} bytes (got ${size})`,
    );
  }

  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return { ok: true, issues: [], value: candidate as EditorDocumentV2 };
}

export function validateProjectV1(input: unknown): ValidationResult<ProjectV1> {
  const ctx = new Checker("project");
  if (!isRecord(input)) {
    ctx.fail("", "must be an object");
    return { ok: false, issues: ctx.issues, value: null };
  }
  unknownFields(ctx, input, [
    "projectId",
    "name",
    "revision",
    "currentBriefVersionId",
    "selectedLayoutId",
    "createdAt",
    "updatedAt",
  ]);
  const projectId = strIn(ctx, input.projectId, "projectId", { pattern: UUID_PATTERN });
  const name = strIn(ctx, input.name, "name", { min: 1, max: 120 });
  const revision = intIn(ctx, input.revision, "revision", 1, Number.MAX_SAFE_INTEGER);
  const currentBriefVersionId =
    input.currentBriefVersionId === null
      ? null
      : (strIn(ctx, input.currentBriefVersionId, "currentBriefVersionId", {
          pattern: UUID_PATTERN,
        }) ?? null);
  const selectedLayoutId =
    input.selectedLayoutId === null
      ? null
      : (strIn(ctx, input.selectedLayoutId, "selectedLayoutId", { pattern: UUID_PATTERN }) ?? null);
  const createdAt = strIn(ctx, input.createdAt, "createdAt", { pattern: TIMESTAMP_PATTERN });
  const updatedAt = strIn(ctx, input.updatedAt, "updatedAt", { pattern: TIMESTAMP_PATTERN });
  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues, value: null };
  }
  return {
    ok: true,
    issues: [],
    value: {
      projectId: projectId!,
      name: name!,
      revision: revision!,
      currentBriefVersionId,
      selectedLayoutId,
      createdAt: createdAt!,
      updatedAt: updatedAt!,
    },
  };
}
