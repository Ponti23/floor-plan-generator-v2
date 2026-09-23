/**
 * S06: read-only legacy import with explicit unsupported items.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { importLegacyProject } from "../../src/integration/legacy-import.ts";

const LEGACY = JSON.stringify({
  schemaVersion: 1,
  id: "canonical-planlab-project",
  name: "Canonical prototype",
  site: {
    widthMm: 20_000,
    depthMm: 30_000,
    frontSide: "south",
    offsets: {
      north: { distanceMm: 2000 },
      east: { distanceMm: 1500 },
      south: { distanceMm: 2000 },
      west: { distanceMm: 1500 },
    },
  },
  rooms: [
    { id: "bedroom-1", label: "Bedroom 1", kind: "bedroom",
      dimensions: { minAreaMm2: 10_000_000, preferredAreaMm2: 16_000_000, minShortSideMm: 3000 } },
    { id: "storage-1", label: "Store", kind: "storage",
      dimensions: { minAreaMm2: 2_000_000, preferredAreaMm2: 3_000_000 } },
    { id: "hallway-1", label: "Hall", kind: "hallway" },
    { id: "other-1", label: "Whatever", kind: "other" },
    { id: "garage-1", label: "Garage", kind: "garage",
      traits: { frontage: { side: "south", kind: "vehicle" } },
      dimensions: { minAreaMm2: 36_000_000, preferredAreaMm2: 36_000_000 } },
  ],
  relationships: [
    { kind: "mustShareWall", aggregation: "all", a: "bedroom-1", b: "storage-1" },
    { kind: "preferShareWall", aggregation: "any", a: "bedroom-1", b: "garage-1" },
    { kind: "mustShareWall", aggregation: "any", a: "bedroom-1", b: "garage-1" },
  ],
  planning: { maxUnallocatedInteriorFraction: 0.05, maxGfaM2: 200 },
});

test("legacy rooms map onto supported types and keep their authored sizes", () => {
  const result = importLegacyProject(LEGACY);
  assert.equal(result.sourceProjectId, "canonical-planlab-project");
  assert.equal(result.rawPreserved, LEGACY, "raw bytes must be preserved untouched");
  assert.equal(result.state.siteWidthM, "20");
  assert.equal(result.state.siteDepthM, "30");
  assert.deepEqual(result.state.setbacksM, { north: "2", east: "1.5", south: "2", west: "1.5" });
  assert.equal(result.state.rooms["bedroom-1"].type, "bedroom");
  assert.equal(result.state.rooms["bedroom-1"].targetAreaM2, "16");
  assert.equal(result.state.rooms["storage-1"].type, "store", "storage maps to store");
  assert.equal(result.state.rooms["garage-1"].type, "garage");
  assert.equal(result.state.rooms["garage-1"].minAreaM2, "36");
});

test("unsupported legacy inputs become explicit, unacknowledged items", () => {
  const result = importLegacyProject(LEGACY);
  const messages = result.unsupported.map((item) => `${item.path}: ${item.message}`).join("\n");
  assert.match(messages, /hallway/);
  assert.match(messages, /"other"/);
  assert.match(messages, /vehicle frontage/);
  assert.match(messages, /preferShareWall/);
  assert.match(messages, /unallocated/);
  assert.ok(result.unsupported.every((item) => item.acknowledged === false));
  assert.equal(result.state.rooms["hallway-1"], undefined, "an unsupported room is not invented");
});

test("hard relationships expand to explicit pairs, everything else is flagged", () => {
  const result = importLegacyProject(LEGACY);
  assert.deepEqual(
    result.state.relationships.map((rel) => `${rel.a}->${rel.b}`),
    ["bedroom-1->storage-1", "bedroom-1->garage-1"],
  );
  assert.ok(result.state.relationships.every((rel) => rel.kind === "mustShareWall"));
});

test("corrupt or absent legacy storage never throws and never destroys the original", () => {
  const corrupt = importLegacyProject("{not json");
  assert.equal(corrupt.rawPreserved, "{not json");
  assert.ok(corrupt.unsupported.length === 1);
  assert.equal(corrupt.state.groups.length > 0, true, "a fresh default programme is offered");

  const empty = importLegacyProject(null);
  assert.equal(empty.rawPreserved, "");
  assert.equal(empty.unsupported.length, 0);
});
