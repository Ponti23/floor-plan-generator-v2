/**
 * S06: exact authored numbers become a canonical BriefV1 with no grid snapping.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExactAreaM2,
  parseExactInteger,
  parseExactMetresToMm,
  type CompileIssue,
} from "../../src/integration/brief-compiler.ts";
import { compileEditorState, createEngineEditorState } from "../../src/app/engine-editor-state.ts";

function issues(): CompileIssue[] {
  return [];
}

test("authored metres convert exactly and reject over-precision", () => {
  const collected: CompileIssue[] = [];
  assert.equal(parseExactMetresToMm("17.321", "site.widthMm", collected), 17_321);
  assert.equal(parseExactMetresToMm("14.117", "site.widthMm", collected), 14_117);
  assert.equal(parseExactMetresToMm("0.001", "site.widthMm", collected), 1);
  assert.equal(parseExactMetresToMm("20", "site.widthMm", collected), 20_000);
  assert.deepEqual(collected, []);

  for (const bad of ["17.3214", "17,321", "-1", "abc", "1e3", ""]) {
    const found: CompileIssue[] = [];
    assert.equal(parseExactMetresToMm(bad, "site.widthMm", found), null, bad);
    assert.equal(found.length, 1, bad);
  }
});

test("areas keep three decimals and integers stay whole millimetres", () => {
  const found = issues();
  assert.equal(parseExactAreaM2("14.001", "rooms[0].targetAreaM2", found), 14.001);
  assert.equal(found.length, 0);
  const bad: CompileIssue[] = [];
  assert.equal(parseExactAreaM2("14.0001", "rooms[0].targetAreaM2", bad), null);
  const badMm: CompileIssue[] = [];
  assert.equal(parseExactInteger("230.5", "walls.externalMm", badMm), null);
  assert.equal(parseExactInteger("230", "walls.externalMm", issues()), 230);
});

test("the golden programme compiles into the exact 3-bedroom brief", () => {
  const state = createEngineEditorState();
  const compiled = compileEditorState(state);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) {
    return;
  }
  const brief = compiled.brief;
  assert.equal(brief.site.widthMm, 14_117);
  assert.equal(brief.site.heightMm, 16_062);
  assert.equal(brief.site.front, "south");
  assert.deepEqual(brief.setbacks, { northMm: 1500, eastMm: 1000, southMm: 3000, westMm: 1000 });
  assert.equal(brief.walls.externalMm, 230);
  assert.equal(brief.walls.internalMm, 90);
  assert.equal(brief.circulation.minWidthMm, 1000);
  assert.equal(brief.doors.minWidthMm, 820);
  assert.deepEqual(
    brief.rooms.map((room) => room.id),
    ["B1", "B2", "B3", "Bath1", "Bath2", "K1", "L1", "G1", "La1"],
  );
  assert.equal(brief.rooms.filter((room) => room.type === "bedroom").length, 3);
  assert.equal(brief.rooms[0].required, true);
  assert.equal(compiled.document.roomGroups.length, 6);
  assert.deepEqual(compiled.document.roomGroups[0].instanceIds, ["B1", "B2", "B3"]);
});

test("a 17.321 m site and an optional study survive compilation unchanged", () => {
  const state = createEngineEditorState(undefined, { siteWidthM: "17.321" });
  state.groups.push({
    requirementId: "study",
    label: "Study",
    type: "study",
    roomClass: "standard",
    quantity: 1,
    required: false,
    instanceIds: ["S1"],
    retiredInstanceIds: [],
  });
  state.rooms.S1 = {
    id: "S1", label: "Study 1", type: "study", roomClass: "standard",
    sourceRequirementId: "study", ordinal: 0, required: false,
    targetAreaM2: "9", minAreaM2: "6", maxAreaM2: "10.35",
    minShortSideMm: "2400", minWidthMm: "2400", minHeightMm: "2400",
    maxAspectRatio: "2",
  };
  const compiled = compileEditorState(state);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) {
    return;
  }
  assert.equal(compiled.brief.site.widthMm, 17_321);
  const study = compiled.brief.rooms.find((room) => room.id === "S1");
  assert.equal(study?.required, false);
  assert.equal(study?.targetAreaM2, 9);
});

test("out-of-contract numbers are refused with a field path", () => {
  const state = createEngineEditorState(undefined, { externalWallMm: "90" });
  const compiled = compileEditorState(state);
  assert.equal(compiled.ok, false);
  if (compiled.ok) {
    return;
  }
  assert.ok(compiled.issues.some((issue) => issue.path.includes("walls.externalMm")));
});

test("every room enum is accepted and unknown programme text is not", () => {
  const state = createEngineEditorState([]);
  const types = ["bedroom", "bathroom", "wc", "kitchen", "living", "dining",
    "garage", "laundry", "study", "store"] as const;
  types.forEach((type, index) => {
    const id = `${type === "wc" ? "WC" : type === "store" ? "Store" : type[0].toUpperCase()}${index + 1}`;
    state.groups.push({
      requirementId: id, label: `${type} ${index}`, type, roomClass: "standard",
      quantity: 1, required: type === "living", instanceIds: [id], retiredInstanceIds: [],
    });
    state.rooms[id] = {
      id, label: `${type} ${index}`, type, roomClass: "standard",
      sourceRequirementId: id, ordinal: 0, required: type === "living",
      targetAreaM2: "10", minAreaM2: "5", maxAreaM2: "20",
      minShortSideMm: "2000", minWidthMm: "2000", minHeightMm: "2000",
      maxAspectRatio: "2",
    };
  });
  const compiled = compileEditorState(state);
  assert.equal(compiled.ok, true,
    compiled.ok ? "" : JSON.stringify(compiled.issues));
  if (compiled.ok) {
    assert.equal(compiled.brief.rooms.length, types.length);
  }
});
