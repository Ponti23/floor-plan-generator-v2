/**
 * Checked-in room policy (`contracts/room-policy-v1.json`, derived once from the
 * engine's TYPE_FALLBACK / ROOM_CLASS_FACTORS). Class multipliers are applied
 * exactly once, here — never again on a submitted number.
 */
import policyJson from "../../contracts/room-policy-v1.json" with { type: "json" };
import type { RoomClass, RoomType } from "../integration/contracts.ts";

export interface ResolvedRoomDefaults {
  targetAreaM2: number;
  minAreaM2: number;
  maxAreaM2: number;
  minShortSideMm: number;
  maxAspectRatio: number;
}

export interface RoomPolicyEntry {
  label: string;
  idPrefix: string;
  engineType: string;
  classes: Record<RoomClass, ResolvedRoomDefaults>;
}

export interface RoomPolicy {
  policyVersion: number;
  contractVersion: string;
  rules: {
    defaultMaxAreaFactor: number;
    defaultWalls: { externalMm: number; internalMm: number };
    defaultCirculationMinWidthMm: number;
    defaultDoorMinWidthMm: number;
    reservedIds: string[];
  };
  limits: Record<string, number | number[]>;
  types: Record<RoomType, RoomPolicyEntry>;
}

export const ROOM_POLICY = policyJson as unknown as RoomPolicy;

export const ROOM_TYPES: readonly RoomType[] = [
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
];

export const ROOM_CLASSES: readonly RoomClass[] = ["compact", "standard", "spacious"];

export function policyFor(type: RoomType): RoomPolicyEntry {
  const entry = ROOM_POLICY.types[type];
  if (!entry) {
    throw new Error(`no room policy for type ${type}`);
  }
  return entry;
}

/** Class defaults for a fresh room instance, or after an explicit class change. */
export function resolveClassDefaults(type: RoomType, roomClass: RoomClass): ResolvedRoomDefaults {
  const entry = policyFor(type);
  const resolved = entry.classes[roomClass];
  if (!resolved) {
    throw new Error(`no policy for ${type}/${roomClass}`);
  }
  return { ...resolved };
}

export function idPrefixFor(type: RoomType): string {
  return policyFor(type).idPrefix;
}

export function labelFor(type: RoomType): string {
  return policyFor(type).label;
}

export const DEFAULT_WALLS = ROOM_POLICY.rules.defaultWalls;
export const DEFAULT_CIRCULATION_MM = ROOM_POLICY.rules.defaultCirculationMinWidthMm;
export const DEFAULT_DOOR_MM = ROOM_POLICY.rules.defaultDoorMinWidthMm;
export const DEFAULT_MAX_AREA_FACTOR = ROOM_POLICY.rules.defaultMaxAreaFactor;
export const RESERVED_IDS = ROOM_POLICY.rules.reservedIds;
export const POLICY_LIMITS = ROOM_POLICY.limits;

/**
 * Allocate the next instance id for a prefix, skipping every id this project has
 * ever used. Removed instances stay reserved, so a new room never silently
 * inherits an old room's relationships.
 */
export function nextInstanceId(
  prefix: string,
  usedIds: Iterable<string>,
  reservedIds: Iterable<string> = [],
): string {
  const taken = new Set<string>([...usedIds, ...reservedIds, ...RESERVED_IDS]);
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${prefix}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no free instance id left for prefix ${prefix}`);
}
