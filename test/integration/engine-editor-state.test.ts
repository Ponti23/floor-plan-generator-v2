/**
 * S06: persistent instance IDs, class applied once, and storage behaviour.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addRoomInstance,
  compileEditorState,
  createEngineEditorState,
  orderedRooms,
  removeRoomInstance,
  setGroupClass,
  setGroupQuantity,
  setRoomField,
} from "../../src/app/engine-editor-state.ts";
import {
  clearDraft,
  draftIsCurrent,
  loadDraft,
  loadPointer,
  saveDraft,
  savePointer,
} from "../../src/app/engine-project-store.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

test("instances expand in group order with stable ids", () => {
  const state = createEngineEditorState();
  assert.deepEqual(
    orderedRooms(state).map((room) => room.id),
    ["B1", "B2", "B3", "Bath1", "Bath2", "K1", "L1", "G1", "La1"],
  );
  const withExtra = addRoomInstance(state, "bedroom");
  assert.deepEqual(
    withExtra.groups.find((group) => group.requirementId === "bedroom")?.instanceIds,
    ["B1", "B2", "B3", "B4"],
  );
  assert.equal(withExtra.groups[0].quantity, 4);
});

test("a removed instance stays reserved and its relationships are dropped", () => {
  let state = createEngineEditorState();
  state.relationships = [
    { id: "REL-B1-L1", a: "B1", b: "L1", kind: "mustShareWall",
      minSharedWallMm: "1200", minOpeningWidthMm: "820" },
  ];
  const removed = removeRoomInstance(state, "bedroom", "B1");
  state = removed.state;
  assert.equal(removed.removedRoomId, "B1");
  assert.deepEqual(removed.droppedRelationships, ["REL-B1-L1"]);
  assert.deepEqual(state.relationships, []);
  assert.ok(state.groups[0].retiredInstanceIds.includes("B1"));

  const readded = addRoomInstance(state, "bedroom");
  const ids = readded.groups[0].instanceIds;
  assert.ok(!ids.includes("B1"), "a retired id must never be reused");
  assert.ok(ids.includes("B4"));
  // surviving rooms keep their ids: no renumbering on removal
  assert.deepEqual(state.groups[0].instanceIds, ["B2", "B3"]);
});

test("quantity changes add and remove instances without renumbering", () => {
  const state = createEngineEditorState();
  const bigger = setGroupQuantity(state, "bathroom", 4).state;
  assert.equal(bigger.groups.find((group) => group.requirementId === "bathroom")?.quantity, 4);
  const smaller = setGroupQuantity(bigger, "bathroom", 1).state;
  const group = smaller.groups.find((entry) => entry.requirementId === "bathroom");
  assert.equal(group?.quantity, 1);
  assert.deepEqual(group?.instanceIds, ["Bath1"]);
  assert.ok(group?.retiredInstanceIds.length === 3);
});

test("a class change applies its multiplier once and edits stand", () => {
  const base = createEngineEditorState();
  const changed = setGroupClass(base, "bedroom", "spacious");
  const room = changed.rooms.B1;
  assert.equal(room.roomClass, "spacious");
  assert.equal(Number(room.targetAreaM2), 14.4); // 12.0 base x 1.20 applied once
  assert.equal(Number(room.minAreaM2), 10.8);
  assert.equal(Number(room.minShortSideMm), 3240);

  const again = setGroupClass(changed, "bedroom", "spacious");
  assert.equal(Number(again.rooms.B1.targetAreaM2), 14.4, "multiplier must not compound");

  const edited = setRoomField(changed, "B1", "targetAreaM2", "18.5");
  const afterClass = setGroupClass(edited, "bedroom", "compact");
  assert.equal(afterClass.rooms.B1.targetAreaM2, "18.5", "an explicit edit is final");
  assert.equal(afterClass.rooms.B2.roomClass, "compact");
  assert.equal(Number(afterClass.rooms.B2.targetAreaM2), 10.2);
});

test("compiled briefs are immutable snapshots of the committed state", () => {
  const state = createEngineEditorState();
  const compiled = compileEditorState(state);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) {
    return;
  }
  // 13 m2 stays inside the authored band (min 9, policy default max 13.8)
  const changed = setRoomField(state, "B1", "targetAreaM2", "13");
  // the standard-class bedroom policy default is 12 m2 (not the golden fixture's 14)
  assert.equal(compiled.brief.rooms[0].targetAreaM2, 12, "the saved brief must not track later edits");
  const recompiled = compileEditorState(changed);
  assert.equal(recompiled.ok, true);
  if (recompiled.ok) {
    assert.equal(recompiled.brief.rooms[0].targetAreaM2, 13);
  }
});

test("draft storage keeps only the pointer and unsaved text, and tolerates denial", () => {
  const storage = memoryStorage();
  assert.equal(savePointer("project-1", storage), true);
  assert.equal(loadPointer(storage), "project-1");

  const state = createEngineEditorState();
  assert.equal(saveDraft("project-1", state, "brief-version-1", storage), true);
  const loaded = loadDraft("project-1", storage);
  assert.ok(loaded);
  assert.equal(loaded?.baseBriefVersionId, "brief-version-1");
  assert.equal(draftIsCurrent(loaded!, "brief-version-1"), true);
  assert.equal(draftIsCurrent(loaded!, "brief-version-2"), false);
  assert.equal(Object.keys(storage).includes("planlab:v1:project"), false);

  storage.setItem("planlab:v2:draft:project-1", "{not json");
  assert.equal(loadDraft("project-1", storage), null);
  clearDraft("project-1", storage);
  assert.equal(loadDraft("project-1", storage), null);

  const denied = {
    length: 0,
    clear: () => undefined,
    getItem: () => {
      throw new Error("denied");
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;
  assert.equal(savePointer("p", denied), false);
  assert.equal(loadPointer(denied), null);
  assert.equal(saveDraft("p", state, null, denied), false);
});
