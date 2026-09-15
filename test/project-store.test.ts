import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_PROJECT } from "../src/domain/fixtures.ts";
import { PROJECT_SCHEMA_VERSION } from "../src/domain/model.ts";
import type { ProjectBrief } from "../src/domain/model.ts";
import {
  createProjectStore,
  preserveUnreadableDocument,
  PROJECT_STORE_PREFIX,
  PROJECT_STORE_VERSION,
  recoveryKeyFor,
  storageNoticeKind,
  type StoragePort,
} from "../src/app/project-store.ts";
import { RECOMMENDED_PRESENTATION_COPY } from "../src/app/presentation-copy.ts";

/**
 * Milestone 6.1: the local project store.  Every test runs against an in-memory
 * port, so nothing here depends on a browser, and the failure modes (denied
 * storage, corrupt payload, future version) are exercised as values.
 */

class MemoryStorage implements StoragePort {
  private values = new Map<string, string>();
  failOnRead = false;
  failOnWrite = false;

  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null {
    if (this.failOnRead) throw new Error("storage denied");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
  raw(key: string): string | null { return this.values.get(key) ?? null; }
  plant(key: string, value: string): void { this.values.set(key, value); }
}

test("a written project round-trips through the store unchanged", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);
  const outcome = store.write(CANONICAL_PROJECT, "2026-09-15T00:00:00.000Z");

  assert.deepEqual(outcome, { status: "saved", savedAt: "2026-09-15T00:00:00.000Z" });
  assert.equal(store.key, `${PROJECT_STORE_PREFIX}project`);

  const read = store.read();
  assert.equal(read.status, "loaded");
  if (read.status !== "loaded") return;
  assert.equal(read.document.storeVersion, PROJECT_STORE_VERSION);
  assert.equal(read.document.savedAt, "2026-09-15T00:00:00.000Z");
  assert.deepEqual(read.document.project, CANONICAL_PROJECT);
  assert.equal(read.document.project.schemaVersion, PROJECT_SCHEMA_VERSION);
});

test("an untouched store reads as empty rather than as an error", () => {
  assert.deepEqual(createProjectStore(new MemoryStorage()).read(), { status: "empty" });
});

test("unparseable and semantically invalid documents are reported, never deleted", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);

  storage.plant(store.key, "{not json");
  const corruptJson = store.read();
  assert.equal(corruptJson.status, "corrupt");
  assert.match(corruptJson.status === "corrupt" ? corruptJson.reason : "", /not valid JSON/i);
  assert.equal(storage.raw(store.key), "{not json", "the original bytes survive the failed read");

  storage.plant(store.key, JSON.stringify({ storeVersion: 1, savedAt: "x", project: { nope: true } }));
  const invalidBrief = store.read();
  assert.equal(invalidBrief.status, "corrupt");
  assert.match(invalidBrief.status === "corrupt" ? invalidBrief.reason : "", /failed validation/i);

  storage.plant(store.key, JSON.stringify({ savedAt: "x", project: CANONICAL_PROJECT }));
  const missingVersion = store.read();
  assert.equal(missingVersion.status, "corrupt");
  assert.match(missingVersion.status === "corrupt" ? missingVersion.reason : "", /storeVersion/i);
});

test("version skew is classified instead of guessed at", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);

  storage.plant(store.key, JSON.stringify({ storeVersion: PROJECT_STORE_VERSION + 1, project: CANONICAL_PROJECT }));
  assert.deepEqual(store.read(), {
    status: "unsupportedVersion",
    foundVersion: PROJECT_STORE_VERSION + 1,
  });
  assert.notEqual(storage.raw(store.key), null, "a newer document is not overwritten by a read");

  storage.plant(store.key, JSON.stringify({ storeVersion: 0, project: CANONICAL_PROJECT }));
  // Version 0 was never written by a release, so it is corrupt rather than a
  // format a migration could recognise.
  assert.equal(store.read().status, "corrupt");

  // A reader that supports a later version classifies this document as outdated,
  // which is the branch bucket 6.2 will migrate from.
  storage.plant(store.key, JSON.stringify({ storeVersion: PROJECT_STORE_VERSION, project: CANONICAL_PROJECT }));
  const futureReader = createProjectStore(storage, { storeVersion: PROJECT_STORE_VERSION + 1 });
  assert.deepEqual(futureReader.read(), { status: "outdated", foundVersion: PROJECT_STORE_VERSION });
});

test("a denied or full store becomes a typed outcome, not a thrown error", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);

  storage.failOnWrite = true;
  const write = store.write(CANONICAL_PROJECT);
  assert.equal(write.status, "failed");
  assert.match(write.status === "failed" ? write.reason : "", /quota exceeded/);

  storage.failOnRead = true;
  const read = store.read();
  assert.equal(read.status, "unavailable");
  assert.match(read.status === "unavailable" ? read.reason : "", /storage denied/);
});

test("clearing removes only this app's keys", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);
  store.write(CANONICAL_PROJECT);
  storage.plant("someone-elses-app:token", "keep me");
  storage.plant(`${PROJECT_STORE_PREFIX}recovery:2026-09-15`, "old copy");

  const removed = store.clear();
  assert.deepEqual(removed.sort(), [
    `${PROJECT_STORE_PREFIX}project`,
    `${PROJECT_STORE_PREFIX}recovery:2026-09-15`,
  ]);
  assert.equal(storage.raw("someone-elses-app:token"), "keep me");
  assert.equal(store.read().status, "empty");
  assert.deepEqual(store.ownedKeys(), []);
});

test("owned keys are namespaced, and an unreadable store reports none", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);
  storage.plant("foreign:key", "x");
  store.write(CANONICAL_PROJECT);
  assert.deepEqual(store.ownedKeys(), [`${PROJECT_STORE_PREFIX}project`]);

  storage.failOnRead = true;
  storage.plant("x", "y");
  const blocked = createProjectStore(new class extends MemoryStorage {
    override key(): string { throw new Error("denied"); }
  }());
  assert.deepEqual(blocked.ownedKeys(), []);
});

test("an unreadable document is preserved under a recovery key before being replaced", () => {
  const storage = new MemoryStorage();
  const store = createProjectStore(storage);
  storage.plant(store.key, "{broken");

  const preservedKey = preserveUnreadableDocument(storage, store, "2026-09-15T12:00:00.000Z");
  assert.equal(preservedKey, recoveryKeyFor("2026-09-15T12:00:00.000Z"));
  assert.equal(storage.raw(preservedKey!), "{broken");
  assert.equal(storage.raw(store.key), null, "the live key is free for a fresh write");
  assert.deepEqual(store.ownedKeys(), [preservedKey]);

  // A second failure must not overwrite the first recovery copy.
  storage.plant(store.key, "{broken again");
  const second = preserveUnreadableDocument(storage, store, "2026-09-15T12:00:01.000Z");
  assert.notEqual(second, preservedKey);
  assert.equal(storage.raw(preservedKey!), "{broken");
  assert.equal(storage.raw(second!), "{broken again");

  // With nothing to preserve there is nothing to report.
  assert.equal(preserveUnreadableDocument(storage, store), null);
});

test("two stores with different prefixes never see each other's documents", () => {
  const storage = new MemoryStorage();
  const first = createProjectStore(storage, { prefix: "planlab-a:" });
  const second = createProjectStore(storage, { prefix: "planlab-b:" });
  const otherProject: ProjectBrief = { ...CANONICAL_PROJECT, projectId: "other", name: "Other" };

  first.write(CANONICAL_PROJECT);
  second.write(otherProject);
  const firstRead = first.read();
  const secondRead = second.read();
  assert.equal(firstRead.status, "loaded");
  assert.equal(secondRead.status, "loaded");
  if (firstRead.status !== "loaded" || secondRead.status !== "loaded") return;
  assert.equal(firstRead.document.project.projectId, CANONICAL_PROJECT.projectId);
  assert.equal(secondRead.document.project.projectId, "other");
});

test("each read outcome maps to the notice the workspace should show", () => {
  assert.equal(storageNoticeKind({ status: "empty" }), null);
  assert.equal(storageNoticeKind({ status: "loaded", document: { storeVersion: 1, savedAt: "x", project: CANONICAL_PROJECT } }), null);
  assert.equal(storageNoticeKind({ status: "corrupt", reason: "bad" }), "recovered");
  assert.equal(storageNoticeKind({ status: "unsupportedVersion", foundVersion: 2 }), "newerVersion");
  assert.equal(storageNoticeKind({ status: "outdated", foundVersion: 0 }), "olderVersion");
  assert.equal(storageNoticeKind({ status: "unavailable", reason: "denied" }), "unavailable");
});

test("every storage notice and save label has real copy", () => {
  const storage = RECOMMENDED_PRESENTATION_COPY.storage;
  for (const label of [storage.savedLabel, storage.savingLabel, storage.failedLabel, storage.unavailableLabel]) {
    assert.ok(typeof label === "string" && label.length > 0);
  }
  for (const kind of ["recovered", "newerVersion", "olderVersion", "resultsOutdated", "resetIncomplete", "unavailable"] as const) {
    assert.ok(storage.notices[kind].length > 0, `${kind} notice is written`);
  }
  // The failure copy must not claim the data was saved.
  assert.equal(/saved/i.test(storage.failedLabel), false);
  assert.equal(/saved/i.test(storage.unavailableLabel), false);
});

test("migrations run one version at a time and only rewrite after every step succeeds", () => {
  const storage = new MemoryStorage();
  const older = JSON.stringify({ storeVersion: 1, savedAt: "2026-01-01T00:00:00.000Z", project: CANONICAL_PROJECT });
  storage.plant(`${PROJECT_STORE_PREFIX}project`, older);

  const store = createProjectStore(storage, {
    storeVersion: 3,
    migrations: [
      { from: 1, to: 2, migrate: (document) => ({ ...document, project: document.project }) },
      { from: 2, to: 3, migrate: (document) => ({ ...document, project: document.project }) },
    ],
  });

  assert.deepEqual(store.migrate(), { status: "migrated", fromVersion: 1, toVersion: 3 });
  const migrated = JSON.parse(storage.raw(store.key)!);
  assert.equal(migrated.storeVersion, 3);
  assert.deepEqual(migrated.project, CANONICAL_PROJECT);
  assert.equal(store.migrate().status, "notNeeded", "a second run has nothing to do");
});

test("a missing or failing migration leaves the original document untouched", () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({ storeVersion: 1, project: { legacy: true } });

  storage.plant(`${PROJECT_STORE_PREFIX}project`, original);
  const noStep = createProjectStore(storage, { storeVersion: 2 });
  const missing = noStep.migrate();
  assert.equal(missing.status, "failed");
  assert.match(missing.status === "failed" ? missing.reason : "", /no migration from store version 1/);
  assert.equal(storage.raw(noStep.key), original);

  const throwing = createProjectStore(storage, {
    storeVersion: 2,
    migrations: [{ from: 1, to: 2, migrate: () => { throw new Error("bad document"); } }],
  });
  const failed = throwing.migrate();
  assert.equal(failed.status, "failed");
  assert.match(failed.status === "failed" ? failed.reason : "", /threw/);
  assert.equal(storage.raw(throwing.key), original);

  const empty = createProjectStore(storage, {
    storeVersion: 2,
    migrations: [{ from: 1, to: 2, migrate: () => null }],
  });
  assert.equal(empty.migrate().status, "failed");
  assert.equal(storage.raw(empty.key), original);

  const invalid = createProjectStore(storage, {
    storeVersion: 2,
    migrations: [{ from: 1, to: 2, migrate: (document) => ({ ...document, project: { notAProject: true } }) }],
  });
  const invalidOutcome = invalid.migrate();
  assert.equal(invalidOutcome.status, "failed");
  assert.match(invalidOutcome.status === "failed" ? invalidOutcome.reason : "", /failed validation/i);
  assert.equal(storage.raw(invalid.key), original);

  const newer = createProjectStore(storage, { storeVersion: 0 });
  const refused = newer.migrate();
  assert.equal(refused.status, "failed");
  assert.match(refused.status === "failed" ? refused.reason : "", /newer store version/);
  assert.equal(storage.raw(newer.key), original);
});

test("an empty store has nothing to migrate", () => {
  const store = createProjectStore(new MemoryStorage(), { storeVersion: 2 });
  assert.deepEqual(store.migrate(), { status: "notNeeded" });
});
