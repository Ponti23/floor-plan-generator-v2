/**
 * Read-only import of the legacy `planlab:v1:*` project document (plan section 5.1).
 * The raw bytes are preserved untouched; only `planlab:v2:*` keys are ever written.
 * Anything the exact engine cannot represent becomes an explicit unsupported item
 * instead of being silently dropped.
 */
import {
  createEngineEditorState,
  defaultsFor,
  type EngineEditorState,
  type RoomGroupState,
} from "../app/engine-editor-state.ts";
import type { RelationshipKind, RoomClass, RoomType } from "./contracts.ts";
import { idPrefixFor, nextInstanceId } from "../app/room-policy.ts";

export interface UnsupportedItem {
  path: string;
  message: string;
  acknowledged: false;
}

export interface LegacyImportResult {
  sourceProjectId: string;
  rawPreserved: string;
  state: EngineEditorState;
  unsupported: UnsupportedItem[];
}

const KIND_TO_TYPE: Record<string, RoomType | null> = {
  bedroom: "bedroom",
  bathroom: "bathroom",
  kitchen: "kitchen",
  living: "living",
  dining: "dining",
  laundry: "laundry",
  garage: "garage",
  study: "study",
  storage: "store",   // legacy name maps onto the supported "store" type
  hallway: null,      // generated circulation already supplies this
  other: null,
};

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

function metres(mm: number): string {
  return String(Number((mm / 1000).toFixed(3)));
}

function area(m2: number | undefined, fallback: number): string {
  return String(Number((m2 ?? fallback).toFixed(3)));
}

function mmOr(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.round(value))
    : String(fallback);
}

export function importLegacyProject(raw: string | null): LegacyImportResult {
  const unsupported: UnsupportedItem[] = [];
  const empty: LegacyImportResult = {
    sourceProjectId: "legacy-unknown",
    rawPreserved: raw ?? "",
    state: createEngineEditorState(),
    unsupported,
  };
  if (!raw) {
    return empty;
  }
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    unsupported.push({
      path: "planlab:v1:project",
      message: "the saved v1 project could not be parsed; a fresh project was loaded instead",
      acknowledged: false,
    });
    return empty;
  }

  const site = (source.site ?? {}) as Record<string, unknown>;
  const offsets = (site.offsets ?? {}) as Record<string, { distanceMm?: number }>;
  const widthMm = typeof site.widthMm === "number" ? site.widthMm : 14_117;
  const depthMm = typeof site.depthMm === "number" ? site.depthMm : 16_062;
  const front = typeof site.frontSide === "string" ? site.frontSide : "south";
  if (front !== "south") {
    unsupported.push({
      path: "site.frontSide",
      message: `the v1 project fixed the front to south; ${front} is not carried over`,
      acknowledged: false,
    });
  }

  const state = createEngineEditorState([], {
    name: typeof source.name === "string" && source.name.trim()
      ? source.name.trim().slice(0, 80)
      : "Imported project",
    siteWidthM: metres(widthMm),
    siteDepthM: metres(depthMm),
    front: "south",
    setbacksM: {
      north: metres(Number(offsets.north?.distanceMm ?? 1500)),
      east: metres(Number(offsets.east?.distanceMm ?? 1000)),
      south: metres(Number(offsets.south?.distanceMm ?? 3000)),
      west: metres(Number(offsets.west?.distanceMm ?? 1000)),
    },
  });

  const legacyRooms = Array.isArray(source.rooms) ? (source.rooms as Record<string, unknown>[]) : [];
  for (const [index, room] of legacyRooms.entries()) {
    const path = `rooms[${index}]`;
    const kind = String(room.kind ?? room.type ?? "");
    const mapped = KIND_TO_TYPE[kind];
    if (mapped === undefined) {
      unsupported.push({
        path,
        message: `room type "${kind}" is not part of the exact contract`,
        acknowledged: false,
      });
      continue;
    }
    if (mapped === null) {
      unsupported.push({
        path,
        message: kind === "hallway"
          ? "hallway requirements are not needed: the engine generates circulation, so remove this requirement"
          : `room type "${kind}" needs a supported type before generation`,
        acknowledged: false,
      });
      continue;
    }
    const traits = (room.traits ?? {}) as Record<string, unknown>;
    const dimensions = (room.dimensions ?? {}) as Record<string, number | undefined>;
    if (traits.frontage) {
      unsupported.push({
        path: `${path}.traits.frontage`,
        message: "vehicle frontage is not modelled by this engine; the requirement is recorded but not satisfied",
        acknowledged: false,
      });
    }

    const roomClass: RoomClass = "standard";
    const defaults = defaultsFor(mapped, roomClass);
    const requestedId = typeof room.id === "string" ? room.id : "";
    const usedIds = Object.keys(state.rooms);
    const id = ID_PATTERN.test(requestedId) ? requestedId : nextInstanceId(idPrefixFor(mapped), usedIds);
    if (id !== requestedId && requestedId) {
      unsupported.push({
        path: `${path}.id`,
        message: `identifier "${requestedId}" is not valid in the contract; the room was renamed to ${id}`,
        acknowledged: false,
      });
    }
    const requirementId = id;
    const group: RoomGroupState = {
      requirementId,
      label: typeof room.label === "string" && room.label.trim()
        ? room.label.trim().slice(0, 80)
        : `${mapped} ${index + 1}`,
      type: mapped,
      roomClass,
      quantity: 1,
      required: room.required === undefined ? true : Boolean(room.required),
      instanceIds: [id],
      retiredInstanceIds: [],
    };
    state.groups.push(group);
    state.rooms[id] = {
      id,
      label: group.label,
      type: mapped,
      roomClass,
      sourceRequirementId: requirementId,
      ordinal: 0,
      required: group.required,
      targetAreaM2: area(
        dimensions.preferredAreaMm2 !== undefined ? dimensions.preferredAreaMm2 / 1e6 : undefined,
        defaults.targetAreaM2,
      ),
      minAreaM2: area(
        dimensions.minAreaMm2 !== undefined ? dimensions.minAreaMm2 / 1e6 : undefined,
        defaults.minAreaM2,
      ),
      maxAreaM2: String(
        Number(
          Math.max(
            defaults.maxAreaM2,
            (dimensions.preferredAreaMm2 ?? defaults.targetAreaM2 * 1e6) / 1e6 * 1.15,
          ).toFixed(3),
        ),
      ),
      minShortSideMm: mmOr(dimensions.minShortSideMm, defaults.minShortSideMm),
      minWidthMm: mmOr(dimensions.minWidthMm ?? dimensions.minShortSideMm, defaults.minShortSideMm),
      minHeightMm: mmOr(dimensions.minDepthMm ?? dimensions.minShortSideMm, defaults.minShortSideMm),
      maxAspectRatio: String(Number((dimensions.maxAspectRatio ?? defaults.maxAspectRatio).toFixed(3))),
    };
  }

  const relationships = Array.isArray(source.relationships)
    ? (source.relationships as Record<string, unknown>[])
    : [];
  const knownIds = new Set(Object.keys(state.rooms));
  for (const [index, rel] of relationships.entries()) {
    const path = `relationships[${index}]`;
    const kind = String(rel.kind ?? "");
    const aggregation = String(rel.aggregation ?? "any");
    const endpoints = [rel.a, rel.b].map((value) => selectRoomIds(value, knownIds));
    if (kind === "mustShareWall" && aggregation === "all") {
      if (endpoints[0].length === 0 || endpoints[1].length === 0) {
        unsupported.push({
          path,
          message: "relationship endpoints could not be resolved to explicit rooms",
          acknowledged: false,
        });
        continue;
      }
      for (const a of endpoints[0]) {
        for (const b of endpoints[1]) {
          if (a !== b) {
            state.relationships.push(newRelationship(`REL-${a}-${b}`, a, b, "mustShareWall"));
          }
        }
      }
      continue;
    }
    if (kind === "mustShareWall" && aggregation === "any") {
      if (endpoints[0].length === 1 && endpoints[1].length === 1) {
        state.relationships.push(
          newRelationship(`REL-${endpoints[0][0]}-${endpoints[1][0]}`, endpoints[0][0], endpoints[1][0], "mustShareWall"),
        );
      } else {
        unsupported.push({
          path,
          message: "an \"any\" requirement must be resolved to one explicit room pair before generation",
          acknowledged: false,
        });
      }
      continue;
    }
    unsupported.push({
      path,
      message: `"${kind}" (${aggregation}) is not applied by this engine; it is saved in the import record only`,
      acknowledged: false,
    });
  }

  const planning = (source.planning ?? {}) as Record<string, unknown>;
  if (planning.maxUnallocatedInteriorFraction !== undefined || planning.maxGfaM2 !== undefined) {
    unsupported.push({
      path: "planning",
      message:
        "the old 5% unallocated rule and 200 m2 cap are replaced by the engine's 10% residual check and the explicit max GFA field",
      acknowledged: false,
    });
  }

  return {
    sourceProjectId:
      typeof source.id === "string" ? source.id : (typeof source.name === "string" ? source.name : "legacy-project"),
    rawPreserved: raw,
    state: { ...state, dirty: false },
    unsupported,
  };
}

function selectRoomIds(selector: unknown, known: Set<string>): string[] {
  if (typeof selector === "string") {
    return known.has(selector) ? [selector] : [];
  }
  if (selector && typeof selector === "object") {
    const record = selector as Record<string, unknown>;
    if (typeof record.id === "string" && known.has(record.id)) {
      return [record.id];
    }
  }
  return [];
}

function newRelationship(id: string, a: string, b: string, kind: RelationshipKind) {
  return {
    id,
    a,
    b,
    kind,
    minSharedWallMm: "900",
    minOpeningWidthMm: "820",
  };
}
