/**
 * Exact editor draft -> canonical BriefV1. Authored metres become integer
 * millimetres; nothing is snapped to a grid and the legacy normalizer is never
 * consulted. The produced payload is validated with the same guards the service
 * uses, so the client cannot submit something the API would reject.
 */
import { parseMetresToMm } from "../domain/geometry.ts";
import { validateBriefV1, type ValidationIssue } from "./contract-validation.ts";
import {
  CONTRACT_LIMITS,
  type BriefV1,
  type RelationshipKind,
  type RoomClass,
  type RoomType,
  type Side,
} from "./contracts.ts";

export interface CompileIssue {
  path: string;
  message: string;
}

export interface EditorRoomDraft {
  id: string;
  label: string;
  type: RoomType;
  roomClass: RoomClass;
  sourceRequirementId: string;
  ordinal: number;
  required: boolean;
  targetAreaM2: string;
  minAreaM2: string;
  maxAreaM2: string;
  minShortSideMm: string;
  minWidthMm: string;
  minHeightMm: string;
  maxAspectRatio: string;
}

export interface EditorRelationshipDraft {
  id: string;
  a: string;
  b: string;
  kind: RelationshipKind;
  minSharedWallMm: string;
  minOpeningWidthMm: string;
}

export interface EditorBriefDraft {
  siteWidthM: string;
  siteDepthM: string;
  front: Side;
  setbacksM: { north: string; east: string; south: string; west: string };
  externalWallMm: string;
  internalWallMm: string;
  circulationMinWidthMm: string;
  doorMinWidthMm: string;
  building: { targetGfaM2: string | null; maxGfaM2: string | null };
  settings: { topK: number; topN: number; solverTimeLimitS: number; seed: number };
  rooms: EditorRoomDraft[];
  relationships: EditorRelationshipDraft[];
}

export type CompileResult =
  | { ok: true; brief: BriefV1 }
  | { ok: false; issues: CompileIssue[] };

const METRE_PATTERN = /^\d+(?:\.\d{1,3})?$/;
const AREA_PATTERN = /^\d+(?:\.\d{1,3})?$/;
const INTEGER_PATTERN = /^\d+$/;

/** Exact authored metres -> integer millimetres; rejects more than 3 decimals. */
export function parseExactMetresToMm(text: string, path: string,
                                     issues: CompileIssue[]): number | null {
  const trimmed = text.trim();
  if (!METRE_PATTERN.test(trimmed)) {
    issues.push({
      path,
      message: "enter metres with at most 3 decimals (for example 17.321)",
    });
    return null;
  }
  try {
    return parseMetresToMm(trimmed);
  } catch (error) {
    issues.push({ path, message: (error as Error).message });
    return null;
  }
}

export function parseExactAreaM2(text: string, path: string,
                                 issues: CompileIssue[]): number | null {
  const trimmed = text.trim();
  if (!AREA_PATTERN.test(trimmed)) {
    issues.push({ path, message: "enter square metres with at most 3 decimals" });
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    issues.push({ path, message: "area must be a finite number" });
    return null;
  }
  return value;
}

export function parseExactInteger(text: string, path: string,
                                  issues: CompileIssue[]): number | null {
  const trimmed = text.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    issues.push({ path, message: "enter a whole number of millimetres" });
    return null;
  }
  return Number(trimmed);
}

function parseOptionalArea(text: string | null, path: string,
                           issues: CompileIssue[]): number | null {
  if (text === null || text.trim() === "") {
    return null;
  }
  return parseExactAreaM2(text, path, issues);
}

export function compileEditorBrief(draft: EditorBriefDraft): CompileResult {
  const issues: CompileIssue[] = [];
  const siteWidthMm = parseExactMetresToMm(draft.siteWidthM, "site.widthMm", issues);
  const siteHeightMm = parseExactMetresToMm(draft.siteDepthM, "site.heightMm", issues);
  const setbacks: Record<string, number | null> = {};
  for (const side of ["north", "east", "south", "west"] as const) {
    setbacks[side] = parseExactMetresToMm(
      draft.setbacksM[side], `setbacks.${side}Mm`, issues,
    );
  }
  const externalMm = parseExactInteger(draft.externalWallMm, "walls.externalMm", issues);
  const internalMm = parseExactInteger(draft.internalWallMm, "walls.internalMm", issues);
  const circulationMm = parseExactInteger(
    draft.circulationMinWidthMm, "circulation.minWidthMm", issues,
  );
  const doorMm = parseExactInteger(draft.doorMinWidthMm, "doors.minWidthMm", issues);
  const targetGfa = parseOptionalArea(draft.building.targetGfaM2, "building.targetGfaM2", issues);
  const maxGfa = parseOptionalArea(draft.building.maxGfaM2, "building.maxGfaM2", issues);

  const rooms = draft.rooms.map((room, index) => {
    const path = `rooms[${index}]`;
    return {
      id: room.id,
      label: room.label,
      type: room.type,
      roomClass: room.roomClass,
      sourceRequirementId: room.sourceRequirementId,
      ordinal: room.ordinal,
      required: room.required,
      targetAreaM2: parseExactAreaM2(room.targetAreaM2, `${path}.targetAreaM2`, issues),
      minAreaM2: parseExactAreaM2(room.minAreaM2, `${path}.minAreaM2`, issues),
      maxAreaM2: parseExactAreaM2(room.maxAreaM2, `${path}.maxAreaM2`, issues),
      minShortSideMm: parseExactInteger(room.minShortSideMm, `${path}.minShortSideMm`, issues),
      minWidthMm: parseExactInteger(room.minWidthMm, `${path}.minWidthMm`, issues),
      minHeightMm: parseExactInteger(room.minHeightMm, `${path}.minHeightMm`, issues),
      maxAspectRatio: parseExactAreaM2(room.maxAspectRatio, `${path}.maxAspectRatio`, issues),
    };
  });

  const relationships = draft.relationships.map((rel, index) => {
    const path = `relationships[${index}]`;
    return {
      id: rel.id,
      a: rel.a,
      b: rel.b,
      kind: rel.kind,
      minSharedWallMm: parseExactInteger(rel.minSharedWallMm, `${path}.minSharedWallMm`, issues),
      minOpeningWidthMm: parseExactInteger(rel.minOpeningWidthMm, `${path}.minOpeningWidthMm`, issues),
    };
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const payload = {
    schemaVersion: "planlab.brief/1" as const,
    units: "mm" as const,
    site: { widthMm: siteWidthMm, heightMm: siteHeightMm, front: draft.front },
    setbacks: {
      northMm: setbacks.north, eastMm: setbacks.east,
      southMm: setbacks.south, westMm: setbacks.west,
    },
    walls: { externalMm, internalMm },
    circulation: { minWidthMm: circulationMm },
    doors: { minWidthMm: doorMm },
    rooms,
    relationships,
    building: { targetGfaM2: targetGfa, maxGfaM2: maxGfa },
    settings: { ...draft.settings },
  };

  const validated = validateBriefV1(payload);
  if (!validated.ok || !validated.value) {
    return {
      ok: false,
      issues: validated.issues.map((issue: ValidationIssue) => ({
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  return { ok: true, brief: validated.value };
}

export const LIMITS = CONTRACT_LIMITS;
