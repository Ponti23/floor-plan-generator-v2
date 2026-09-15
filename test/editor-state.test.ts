import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_PROJECT } from "../src/domain/fixtures.ts";
import {
  commitBriefDraft,
  createBriefEditorState,
  editBriefDraft,
  markBriefResultCurrent,
  type BriefEditorState,
} from "../src/app/editor-state.ts";

test("draft input stays separate from the committed normalized project", () => {
  const initial = createBriefEditorState(CANONICAL_PROJECT);
  const edited = editBriefDraft(initial, {
    site: { widthM: "18" },
    offsets: { east: { distanceM: "1.25" } },
  });

  assert.equal(edited.dirty, true);
  assert.equal(edited.draft.site.widthM, "18");
  assert.equal(edited.draft.offsets.east.distanceM, "1.25");
  assert.equal(initial.committedProject.site.exactSiteMm.width, 20_000);
  assert.equal(edited.committedProject.site.exactSiteMm.width, 20_000);
  assert.equal(edited.committedBrief.site.widthMm, 20_000);

  const committed = commitBriefDraft(edited);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.state.dirty, false);
  assert.equal(committed.state.revision, 1);
  assert.equal(committed.project.site.widthMm, 18_000);
  assert.equal(committed.normalized.site.exactSiteMm.width, 18_000);
  assert.equal(committed.normalized.site.envelope.x, 6);
  assert.equal(committed.normalized.site.envelope.width, 61);
});

test("an incomplete numeric field fails commit without replacing the last normalized snapshot", () => {
  const initial = createBriefEditorState(CANONICAL_PROJECT);
  const edited = editBriefDraft(initial, { site: { depthM: "" } });
  const committed = commitBriefDraft(edited);

  assert.equal(committed.ok, false);
  if (committed.ok) return;
  assert.ok(committed.issues.some((issue) => issue.path === "site.depthMm"));
  assert.equal(committed.state.dirty, true);
  assert.equal(committed.state.draft.site.depthM, "");
  assert.equal(committed.state.committedProject.site.exactSiteMm.depth, 30_000);
  assert.equal(committed.state.revision, 0);
});

test("a changed brief marks an accepted result stale until the matching revision completes", () => {
  const initial = createBriefEditorState(CANONICAL_PROJECT);
  const withResult = markBriefResultCurrent(initial, initial.revision);
  assert.equal(withResult.resultsStale, false);
  assert.equal(withResult.resultRevision, 0);

  const edited = editBriefDraft(withResult, { name: "Updated brief" });
  assert.equal(edited.resultsStale, true);

  const committed = commitBriefDraft(edited);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.state.resultsStale, true);
  assert.equal(committed.state.revision, 1);
  assert.equal(committed.state.resultRevision, 0);

  // A late worker response from revision 0 cannot make the new brief current.
  const late = markBriefResultCurrent(committed.state, 0);
  assert.equal(late.resultsStale, true);
  assert.equal(late.resultRevision, 0);

  const fresh = markBriefResultCurrent(committed.state, 1);
  assert.equal(fresh.resultsStale, false);
  assert.equal(fresh.resultRevision, 1);
});

test("committing unchanged display text does not manufacture a new revision", () => {
  const initial: BriefEditorState = createBriefEditorState(CANONICAL_PROJECT);
  const touched = editBriefDraft(initial, { site: { widthM: "20.000" } });
  const committed = commitBriefDraft(touched);

  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.state.revision, initial.revision);
  assert.equal(committed.state.dirty, false);
  assert.deepEqual(committed.state.committedBrief, initial.committedBrief);
});
