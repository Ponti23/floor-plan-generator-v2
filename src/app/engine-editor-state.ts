/**
 * Exact editor state: persistent room instance IDs, explicit expansion, and a
 * canonical brief compiled straight from the authored numbers (plan section 5.1).
 * Instance IDs are never renumbered, so a new room can never silently inherit a
 * removed room's relationships.
 */
import {
  DEFAULT_CIRCULATION_MM,
  DEFAULT_DOOR_MM,
  DEFAULT_MAX_AREA_FACTOR,
  DEFAULT_WALLS,
  idPrefixFor,
  labelFor,
  nextInstanceId,
  resolveClassDefaults,
} from "./room-policy.ts";
import {
  type CompileIssue,
  type CompileResult,
  type EditorBriefDraft,
  type EditorRelationshipDraft,
  type EditorRoomDraft,
  compileEditorBrief,
} from "../integration/brief-compiler.ts";
import type {
  EditorDocumentV2,
  RoomClass,
  RoomGroupV2,
  RoomType,
  Side,
} from "../integration/contracts.ts";

export interface RoomGroupState {
  requirementId: string;
  label: string;
  type: RoomType;
  roomClass: RoomClass;
  quantity: number;
  required: boolean;
  instanceIds: string[];
  retiredInstanceIds: string[];
}

export interface EngineEditorState {
  name: string;
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
  groups: RoomGroupState[];
  rooms: Record<string, EditorRoomDraft>;
  editedRooms: string[];
  relationships: EditorRelationshipDraft[];
  committedBriefVersionId: string | null;
  committedBriefHash: string | null;
  baseBriefVersionId: string | null;
  dirty: boolean;
}

export interface DefaultProgrammeEntry {
  type: RoomType;
  quantity: number;
  required?: boolean;
}

const GOLDEN_B: readonly DefaultProgrammeEntry[] = [
  { type: "bedroom", quantity: 3 },
  { type: "bathroom", quantity: 2 },
  { type: "kitchen", quantity: 1 },
  { type: "living", quantity: 1 },
  { type: "garage", quantity: 1 },
  { type: "laundry", quantity: 1 },
];

function draftRoom(
  state: Pick<EngineEditorState, "rooms" | "groups">,
  requirementId: string,
  type: RoomType,
  roomClass: RoomClass,
  ordinal: number,
  required: boolean,
): EditorRoomDraft {
  const defaults = resolveClassDefaults(type, roomClass);
  const used = [...Object.keys(state.rooms), ...collectRetired(state.groups)];
  const id = nextInstanceId(idPrefixFor(type), used);
  return {
    id,
    label: `${labelFor(type)} ${ordinal + 1}`,
    type,
    roomClass,
    sourceRequirementId: requirementId,
    ordinal,
    required,
    targetAreaM2: formatNumber(defaults.targetAreaM2),
    minAreaM2: formatNumber(defaults.minAreaM2),
    maxAreaM2: formatNumber(defaults.maxAreaM2),
    minShortSideMm: String(defaults.minShortSideMm),
    minWidthMm: String(defaults.minShortSideMm),
    minHeightMm: String(defaults.minShortSideMm),
    maxAspectRatio: formatNumber(defaults.maxAspectRatio),
  };
}

function collectRetired(groups: RoomGroupState[]): string[] {
  return groups.flatMap((group) => group.retiredInstanceIds);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** A fresh editor with the golden B programme, or any supplied programme. */
export function createEngineEditorState(
  programme: readonly DefaultProgrammeEntry[] = GOLDEN_B,
  overrides: Partial<EngineEditorState> = {},
): EngineEditorState {
  const state: EngineEditorState = {
    name: "Untitled project",
    siteWidthM: "14.117",
    siteDepthM: "16.062",
    front: "south",
    setbacksM: { north: "1.5", east: "1", south: "3", west: "1" },
    externalWallMm: String(DEFAULT_WALLS.externalMm),
    internalWallMm: String(DEFAULT_WALLS.internalMm),
    circulationMinWidthMm: String(DEFAULT_CIRCULATION_MM),
    doorMinWidthMm: String(DEFAULT_DOOR_MM),
    building: { targetGfaM2: null, maxGfaM2: null },
    settings: { topK: 5, topN: 3, solverTimeLimitS: 30, seed: 20260923 },
    groups: [],
    rooms: {},
    editedRooms: [],
    relationships: [],
    committedBriefVersionId: null,
    committedBriefHash: null,
    baseBriefVersionId: null,
    dirty: false,
    ...overrides,
  };

  for (const entry of programme) {
    const requirementId = `${entry.type}`;
    const roomClass: RoomClass = "standard";
    const required = entry.required ?? true;
    const group: RoomGroupState = {
      requirementId,
      label: labelFor(entry.type),
      type: entry.type,
      roomClass,
      quantity: 0,
      required,
      instanceIds: [],
      retiredInstanceIds: [],
    };
    // allocate ids with the retired list visible so a fresh project never reuses ids
    const created: string[] = [];
    for (let index = 0; index < entry.quantity; index += 1) {
      const room = draftRoom(
        { rooms: state.rooms, groups: state.groups },
        requirementId,
        entry.type,
        roomClass,
        index,
        required,
      );
      state.rooms[room.id] = room;
      created.push(room.id);
    }
    group.instanceIds = created;
    group.quantity = created.length;
    state.groups.push(group);
  }
  return state;
}

export function groupFor(state: EngineEditorState, requirementId: string): RoomGroupState {
  const group = state.groups.find((entry) => entry.requirementId === requirementId);
  if (!group) {
    throw new Error(`unknown requirement ${requirementId}`);
  }
  return group;
}

export function expandRoomIds(state: EngineEditorState): string[] {
  return state.groups.flatMap((group) => group.instanceIds);
}

export function orderedRooms(state: EngineEditorState): EditorRoomDraft[] {
  return expandRoomIds(state).map((id) => state.rooms[id]).filter(Boolean);
}

function clone(state: EngineEditorState): EngineEditorState {
  return {
    ...state,
    setbacksM: { ...state.setbacksM },
    building: { ...state.building },
    settings: { ...state.settings },
    groups: state.groups.map((group) => ({
      ...group,
      instanceIds: [...group.instanceIds],
      retiredInstanceIds: [...group.retiredInstanceIds],
    })),
    rooms: { ...state.rooms },
    editedRooms: [...state.editedRooms],
    relationships: state.relationships.map((rel) => ({ ...rel })),
  };
}

function markDirty(state: EngineEditorState): EngineEditorState {
  return { ...state, dirty: true };
}

/** Add one instance to a group using the next free monotonic suffix. */
export function addRoomInstance(state: EngineEditorState, requirementId: string): EngineEditorState {
  const next = clone(state);
  const group = groupFor(next, requirementId);
  const ordinal = group.instanceIds.length;
  const room = draftRoom(next, requirementId, group.type, group.roomClass, ordinal, group.required);
  if (next.rooms[room.id]) {
    throw new Error(`instance id ${room.id} is already in use`);
  }
  next.rooms[room.id] = room;
  group.instanceIds.push(room.id);
  group.quantity = group.instanceIds.length;
  return markDirty(next);
}

export interface RemoveResult {
  state: EngineEditorState;
  removedRoomId: string | null;
  droppedRelationships: string[];
}

/** Remove one instance; its id stays reserved and dangling relationships are dropped. */
export function removeRoomInstance(
  state: EngineEditorState,
  requirementId: string,
  instanceId?: string,
): RemoveResult {
  const next = clone(state);
  const group = groupFor(next, requirementId);
  if (group.instanceIds.length <= 1) {
    return { state, removedRoomId: null, droppedRelationships: [] };
  }
  const target = instanceId ?? group.instanceIds[group.instanceIds.length - 1];
  if (!group.instanceIds.includes(target)) {
    return { state, removedRoomId: null, droppedRelationships: [] };
  }
  group.instanceIds = group.instanceIds.filter((id) => id !== target);
  group.quantity = group.instanceIds.length;
  if (!group.retiredInstanceIds.includes(target)) {
    group.retiredInstanceIds.push(target);
  }
  delete next.rooms[target];
  const dropped = next.relationships.filter((rel) => rel.a === target || rel.b === target);
  next.relationships = next.relationships.filter((rel) => rel.a !== target && rel.b !== target);
  next.editedRooms = next.editedRooms.filter((id) => id !== target);
  return { state: markDirty(next), removedRoomId: target, droppedRelationships: dropped.map((rel) => rel.id) };
}

export function setGroupQuantity(
  state: EngineEditorState,
  requirementId: string,
  quantity: number,
): RemoveResult {
  let next = state;
  const dropped: string[] = [];
  const group = groupFor(next, requirementId);
  const target = Math.max(1, Math.min(24, Math.trunc(quantity)));
  while (groupFor(next, requirementId).instanceIds.length < target) {
    next = addRoomInstance(next, requirementId);
  }
  while (groupFor(next, requirementId).instanceIds.length > target) {
    const result = removeRoomInstance(next, requirementId);
    next = result.state;
    dropped.push(...result.droppedRelationships);
  }
  return { state: next, removedRoomId: null, droppedRelationships: dropped };
}

/** Change a group's class: untouched instances are recomputed once, edited ones stand. */
export function setGroupClass(
  state: EngineEditorState,
  requirementId: string,
  roomClass: RoomClass,
): EngineEditorState {
  const next = clone(state);
  const group = groupFor(next, requirementId);
  group.roomClass = roomClass;
  const defaults = resolveClassDefaults(group.type, roomClass);
  for (const id of group.instanceIds) {
    const room = next.rooms[id];
    if (!room || next.editedRooms.includes(id)) {
      continue;
    }
    next.rooms[id] = {
      ...room,
      roomClass,
      targetAreaM2: formatNumber(defaults.targetAreaM2),
      minAreaM2: formatNumber(defaults.minAreaM2),
      maxAreaM2: formatNumber(defaults.maxAreaM2),
      minShortSideMm: String(defaults.minShortSideMm),
      minWidthMm: String(defaults.minShortSideMm),
      minHeightMm: String(defaults.minShortSideMm),
      maxAspectRatio: formatNumber(defaults.maxAspectRatio),
    };
  }
  return markDirty(next);
}

/** Explicit numeric edit: the class stays metadata and is never multiplied again. */
export function setRoomField(
  state: EngineEditorState,
  instanceId: string,
  field: keyof EditorRoomDraft,
  value: string,
): EngineEditorState {
  const next = clone(state);
  const room = next.rooms[instanceId];
  if (!room) {
    throw new Error(`unknown room ${instanceId}`);
  }
  next.rooms[instanceId] = { ...room, [field]: value } as EditorRoomDraft;
  if (!next.editedRooms.includes(instanceId)) {
    next.editedRooms.push(instanceId);
  }
  return markDirty(next);
}

export function patchEditorState(
  state: EngineEditorState,
  patch: Partial<Omit<EngineEditorState, "groups" | "rooms" | "relationships">>,
): EngineEditorState {
  return markDirty({ ...clone(state), ...patch });
}

export function toEditorDocument(state: EngineEditorState): EditorDocumentV2 {
  return {
    schemaVersion: "planlab.editor/2",
    name: state.name.slice(0, 80) || "Untitled project",
    roomGroups: state.groups.map<RoomGroupV2>((group) => ({
      requirementId: group.requirementId,
      label: group.label,
      type: group.type,
      roomClass: group.roomClass,
      quantity: group.instanceIds.length,
      required: group.required,
      instanceIds: [...group.instanceIds],
      retiredInstanceIds: [...group.retiredInstanceIds],
    })),
    legacyImport: null,
  };
}

export function fromEditorDocument(
  document: EditorDocumentV2,
  rooms: EditorRoomDraft[],
  overrides: Partial<EngineEditorState> = {},
): EngineEditorState {
  const base = createEngineEditorState([], overrides);
  base.name = document.name;
  base.groups = document.roomGroups.map((group) => ({
    requirementId: group.requirementId,
    label: group.label,
    type: group.type,
    roomClass: group.roomClass,
    quantity: group.instanceIds.length,
    required: group.required,
    instanceIds: [...group.instanceIds],
    retiredInstanceIds: [...group.retiredInstanceIds],
  }));
  for (const room of rooms) {
    base.rooms[room.id] = { ...room };
  }
  base.relationships = [];
  base.dirty = false;
  return base;
}

export function buildDraft(state: EngineEditorState): EditorBriefDraft {
  return {
    siteWidthM: state.siteWidthM,
    siteDepthM: state.siteDepthM,
    front: state.front,
    setbacksM: { ...state.setbacksM },
    externalWallMm: state.externalWallMm,
    internalWallMm: state.internalWallMm,
    circulationMinWidthMm: state.circulationMinWidthMm,
    doorMinWidthMm: state.doorMinWidthMm,
    building: { ...state.building },
    settings: { ...state.settings },
    rooms: orderedRooms(state),
    relationships: state.relationships.map((rel) => ({ ...rel })),
  };
}

export type EditorCompileResult =
  | { ok: true; brief: Extract<CompileResult, { ok: true }>["brief"]; document: EditorDocumentV2 }
  | { ok: false; issues: CompileIssue[] };

/** Compile the committed candidate; never used to mutate state. */
export function compileEditorState(state: EngineEditorState): EditorCompileResult {
  const issues: CompileIssue[] = [];
  const seen = new Set<string>();
  for (const room of orderedRooms(state)) {
    if (seen.has(room.id)) {
      issues.push({ path: `rooms.${room.id}`, message: "duplicate room instance id" });
    }
    seen.add(room.id);
    if (!room.label.trim()) {
      issues.push({ path: `rooms.${room.id}.label`, message: "a room needs a label" });
    }
  }
  for (const rel of state.relationships) {
    if (!seen.has(rel.a) || !seen.has(rel.b)) {
      issues.push({
        path: `relationships.${rel.id}`,
        message: "a relationship refers to a room that is not in the programme",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const compiled = compileEditorBrief(buildDraft(state));
  if (!compiled.ok) {
    return { ok: false, issues: compiled.issues };
  }
  return { ok: true, brief: compiled.brief, document: toEditorDocument(state) };
}

/** Applies the golden B defaults for a type (used by the Rooms controls). */
export function defaultsFor(type: RoomType, roomClass: RoomClass) {
  return resolveClassDefaults(type, roomClass);
}

export const MAX_AREA_FACTOR = DEFAULT_MAX_AREA_FACTOR;
