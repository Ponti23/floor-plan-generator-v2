import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_NORMALIZED_PROJECT, generateLayouts } from "../src/domain/index.ts";
import { projectGenerationResult } from "../src/domain/resultPayload.ts";
import {
  buildVersionsFromPayload,
  CURRENT_RESULT_VERSIONS,
  projectStoredResult,
  readStoredResult,
  versionsMatch,
} from "../src/app/stored-result.ts";

/**
 * Milestone 6.5: the stored result document.  It must be small enough to write
 * on every generation, complete enough to rebuild the panel, and it must refuse
 * to be restored when the build that produced it has moved on.
 */

const BUDGET = { maxCandidatesPerTopology: 2, maxTotalCandidates: 6 } as const;
const result = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: "stored-result-tests", budget: BUDGET });
const payload = projectGenerationResult(result);

test("the stored projection keeps the selected layouts and drops the pool", () => {
  const stored = projectStoredResult(payload, "2026-09-15T00:00:00.000Z");
  const selectedIds = payload.selection.selected.map((item) => item.layoutId);

  assert.equal(stored.storeVersion, 1);
  assert.equal(stored.savedAt, "2026-09-15T00:00:00.000Z");
  assert.deepEqual(stored.payload.layouts.map((layout) => layout.id).sort(), [...selectedIds].sort());
  assert.deepEqual(stored.payload.candidates.map((candidate) => candidate.layoutId).sort(), [...selectedIds].sort());
  assert.equal(stored.payload.diagnostics.length, 0);
  assert.deepEqual(stored.payload.selection.selected, payload.selection.selected);
  assert.deepEqual(stored.payload.metadata, payload.metadata);

  // Every layout the panel can display must still be present.
  assert.ok(stored.payload.layouts.length > 0);
  assert.ok(stored.payload.layouts.length <= 3);

  const wholeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const storedBytes = Buffer.byteLength(JSON.stringify(stored), "utf8");
  // The fixture runs a 6-candidate budget, so the ratio here is mild. The real
  // shape is measured on the canonical full budget in the bucket record:
  // 3,403,986 bytes of payload → 35,967 bytes stored (3 of 300 candidates).
  assert.ok(storedBytes < wholeBytes, `stored ${storedBytes} bytes must be smaller than ${wholeBytes}`);
  assert.ok(
    stored.payload.candidates.length < payload.candidates.length,
    "the unfilled candidate pool is not written to storage",
  );
});

test("versions are read from the payload and compared field by field", () => {
  const versions = buildVersionsFromPayload(payload);
  assert.deepEqual(versions, CURRENT_RESULT_VERSIONS);
  assert.equal(versionsMatch(versions), true);

  for (const key of Object.keys(CURRENT_RESULT_VERSIONS)) {
    const tampered = { ...versions, [key]: "something-else" };
    assert.equal(versionsMatch(tampered), false, `${key} must participate in the version check`);
  }
  assert.equal(versionsMatch({}), false);
});

test("a usable stored result is returned intact", () => {
  const stored = projectStoredResult(payload);
  const outcome = readStoredResult(JSON.stringify(stored));
  assert.equal(outcome.status, "usable");
  if (outcome.status !== "usable") return;
  assert.deepEqual(outcome.document.payload.layouts.map((layout) => layout.id), stored.payload.layouts.map((layout) => layout.id));
});

test("a result from a different build is reported as outdated, never restored", () => {
  const stored = projectStoredResult(payload);
  const older = { ...stored, versions: { ...stored.versions, engineVersion: "planlab-generator-0.3" } };
  const outcome = readStoredResult(JSON.stringify(older));
  assert.equal(outcome.status, "outdated");
  if (outcome.status !== "outdated") return;
  assert.equal(outcome.stored.engineVersion, "planlab-generator-0.3");

  // A document with no version block at all is judged by the payload it carries.
  const { versions: _dropped, ...withoutVersions } = stored;
  assert.equal(readStoredResult(JSON.stringify(withoutVersions)).status, "usable");
});

test("missing, unparseable and foreign documents are classified without throwing", () => {
  assert.deepEqual(readStoredResult(null), { status: "empty" });
  assert.equal(readStoredResult("{nope").status, "corrupt");
  assert.equal(readStoredResult("[]").status, "corrupt");
  assert.equal(readStoredResult(JSON.stringify({ storeVersion: 99 })).status, "corrupt");
  assert.equal(readStoredResult(JSON.stringify({ storeVersion: 1, payload: {} })).status, "corrupt");
});
