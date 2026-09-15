import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  generateLayouts,
  projectGenerationResult,
} from "../src/domain/index.ts";
import { METRIC_CATEGORIES, type LayoutFacts } from "../src/domain/metrics.ts";
import type { Layout } from "../src/domain/layout.ts";
import {
  candidateEvidence,
  clearCandidateEvidenceCache,
  humaniseIdentifier,
  observationLabel,
  observationExplanations,
  projectCategoryRows,
  projectMetricRows,
  projectOptionCards,
  projectThumbnailSvg,
  selectedScorecard,
} from "../src/app/analysis-projection.ts";
import { RECOMMENDED_PRESENTATION_COPY } from "../src/app/presentation-copy.ts";

/**
 * Milestone 5.3: the result selector and the analysis panel may only show
 * values that exist.  These tests pin the projection rules: real thumbnails,
 * real metric rows, real rule verdicts, and honest empty slots.
 */

const BUDGET = { maxCandidatesPerTopology: 2, maxTotalCandidates: 6 } as const;
const SEED = "analysis-projection-tests";
const copy = RECOMMENDED_PRESENTATION_COPY;

const result = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: SEED, budget: BUDGET });
const payload = projectGenerationResult(result);
const selectedLayoutId = payload.selection.selected[0]?.layoutId ?? null;
const selectedLayout = payload.layouts.find((layout) => layout.id === selectedLayoutId);
if (!selectedLayout || !selectedLayoutId) throw new Error("fixture produced no selected layout");

test("option cards cover three slots with real thumbnails and honest empty slots", () => {
  clearCandidateEvidenceCache();
  const cards = projectOptionCards(payload, selectedLayoutId, CANONICAL_NORMALIZED_PROJECT, copy);

  assert.deepEqual(cards.map((card) => card.slot), ["A", "B", "C"]);
  assert.equal(cards[0]!.layoutId, selectedLayoutId);
  assert.equal(cards[0]!.selected, true);
  assert.ok(cards[0]!.thumbnail.includes("<rect"), "the selected card draws real room geometry");
  assert.ok(cards[0]!.thumbnail.includes("room-kind-"), "thumbnail uses the plan's room categories");

  const filled = cards.filter((card) => card.layoutId !== null);
  const ids = filled.map((card) => card.layoutId);
  assert.equal(new Set(ids).size, ids.length, "a plan never fills two slots");
  assert.equal(filled.length, payload.selection.selected.length);

  for (const card of cards.filter((entry) => entry.layoutId === null)) {
    assert.ok(card.emptyReason && card.emptyReason.length > 0, "an empty slot explains itself");
    assert.equal(card.thumbnail, "");
    assert.equal(card.score, null);
  }
});

test("option scores are whole numbers taken from the payload scorecards", () => {
  const cards = projectOptionCards(payload, null, CANONICAL_NORMALIZED_PROJECT, copy);
  for (const card of cards) {
    if (!card.layoutId) continue;
    const item = payload.selection.selected.find((entry) => entry.layoutId === card.layoutId)!;
    const candidate = payload.candidates.find((entry) => entry.layoutId === card.layoutId)!;
    const scorecard = candidate.scores.find((entry) => entry.profileId === item.strategy)!;
    assert.equal(card.score, Math.round(scorecard.overallScore));
    assert.equal(card.strategyLabel, copy.strategyNames[item.strategy]);
  }
});

test("thumbnails draw one rectangle per placed space plus real portals", () => {
  const svg = projectThumbnailSvg(selectedLayout, CANONICAL_NORMALIZED_PROJECT, copy);
  const spaceCount = (svg.match(/class="thumbnail-space/g) ?? []).length;
  assert.equal(spaceCount, selectedLayout.spaces.length);
  const portalCount = (svg.match(/class="thumbnail-portal/g) ?? []).length;
  assert.equal(portalCount, selectedLayout.portals.length);
  assert.ok(svg.includes(`aria-label="${copy.analysis.thumbnailAria} ${selectedLayout.id}"`));
  assert.equal(svg.includes("<image"), false, "no decorative imagery is fabricated");
});

test("metric rows carry real values and drop anything that is not a number", () => {
  const evidence = candidateEvidence(selectedLayout, CANONICAL_NORMALIZED_PROJECT);
  const rows = projectMetricRows(evidence.facts, copy);
  const ids = rows.map((row) => row.id);
  assert.deepEqual(ids, [
    "usableArea",
    "footprintArea",
    "efficiency",
    "circulationLength",
    "targetGfa",
    "unallocatedInterior",
  ]);
  for (const row of rows) {
    assert.ok(row.value && row.value.length > 0, `${row.id} shows a value`);
    assert.ok(row.definition.length > 0, `${row.id} explains how it is derived`);
    assert.equal(/\b(NaN|Infinity|undefined|null)\b/.test(row.value!), false);
  }
  assert.ok(rows.some((row) => row.value!.includes(copy.ui.units.squareMetre)));
  assert.ok(rows.some((row) => row.value!.includes(copy.ui.units.percent)));

  // A facts object with a missing number must drop that row rather than print a
  // placeholder for it.
  const broken: LayoutFacts = { ...evidence.facts, footprintAreaM2: Number.NaN };
  const brokenRows = projectMetricRows(broken, copy);
  assert.equal(brokenRows.some((row) => row.id === "footprintArea"), false);
  assert.equal(brokenRows.length, rows.length - 1);
});

test("rule checks report real PASS/FAIL verdicts from the authoritative evaluator", () => {
  clearCandidateEvidenceCache();
  const evidence = candidateEvidence(selectedLayout, CANONICAL_NORMALIZED_PROJECT);
  assert.equal(payload.candidates.find((entry) => entry.layoutId === selectedLayoutId)!.valid, true);
  assert.deepEqual(evidence.rules.failures, []);
  assert.equal(evidence.rules.warnings.length, 0);
  assert.ok(evidence.rules.passedCount > 0, "a valid layout still reports the checks it passed");

  // Mutation check: an overlapping placement must surface as a FAIL row with the
  // validator's own code, not as a hand-written UI status.
  const first = selectedLayout.spaces[0]!;
  const second = selectedLayout.spaces[1]!;
  const tampered: Layout = {
    ...selectedLayout,
    id: `${selectedLayout.id}-tampered`,
    spaces: selectedLayout.spaces.map((space, index) => index === 1
      ? { ...space, rect: { ...space.rect, x: first.rect.x, y: first.rect.y } }
      : space),
  };
  assert.equal(second.rect.x === first.rect.x && second.rect.y === first.rect.y, false);
  clearCandidateEvidenceCache();
  const tamperedEvidence = candidateEvidence(tampered, CANONICAL_NORMALIZED_PROJECT);
  assert.ok(tamperedEvidence.rules.failures.length > 0, "the tampered layout fails a rule");
  assert.ok(
    tamperedEvidence.rules.failures.some((row) => row.code === "SPACE_OVERLAP"),
    "the reported code comes from the domain validator",
  );
  assert.ok(tamperedEvidence.rules.failures.every((row) => row.label.length > 0));
});

test("evidence is memoised per project snapshot and never reused across briefs", () => {
  clearCandidateEvidenceCache();
  const first = candidateEvidence(selectedLayout, CANONICAL_NORMALIZED_PROJECT);
  assert.equal(
    candidateEvidence(selectedLayout, CANONICAL_NORMALIZED_PROJECT),
    first,
    "the same snapshot reuses its evidence",
  );

  // A new committed brief is a new project object.  The cache keys on that
  // identity, so evidence from the previous brief can never leak into it.
  const nextSnapshot = { ...CANONICAL_NORMALIZED_PROJECT };
  const second = candidateEvidence(selectedLayout, nextSnapshot);
  assert.notEqual(second, first, "a different snapshot recomputes rather than reusing evidence");
  assert.equal(candidateEvidence(selectedLayout, nextSnapshot), second);

  clearCandidateEvidenceCache();
  assert.notEqual(candidateEvidence(selectedLayout, CANONICAL_NORMALIZED_PROJECT), first);
});

test("category rows use the five approved categories and whole numbers", () => {
  const scorecard = selectedScorecard(payload, selectedLayoutId)!;
  const rows = projectCategoryRows(scorecard, METRIC_CATEGORIES, copy);
  assert.deepEqual(rows.map((row) => row.category), [...METRIC_CATEGORIES]);
  assert.deepEqual(rows.map((row) => row.label), METRIC_CATEGORIES.map((category) => copy.metricLabels[category]));
  for (const row of rows) {
    assert.ok(Number.isInteger(row.score), `${row.category} is displayed as a whole number`);
  }
  assert.deepEqual(projectCategoryRows(null, METRIC_CATEGORIES, copy), []);
});

test("the selected card and the analysis summary describe one strategy", () => {
  const cards = projectOptionCards(payload, selectedLayoutId, CANONICAL_NORMALIZED_PROJECT, copy);
  const selectedCard = cards.find((card) => card.selected)!;
  const scorecard = selectedScorecard(payload, selectedLayoutId)!;
  assert.equal(selectedCard.layoutId, selectedLayoutId);
  assert.equal(selectedCard.strategyLabel, copy.strategyNames[scorecard.strategy]);
  assert.equal(selectedCard.score, Math.round(scorecard.overallScore));

  // A different profile on the same layout must not be reported as the answer.
  const otherProfile = payload.candidates
    .find((entry) => entry.layoutId === selectedLayoutId)!
    .scores.find((entry) => entry.profileId !== scorecard.strategy);
  if (otherProfile) {
    assert.notEqual(scorecard.strategy, otherProfile.profileId);
    assert.equal(projectCategoryRows(scorecard, METRIC_CATEGORIES, copy)[0]!.score, Math.round(scorecard.categoryScores.programSpace!));
  }
});

test("the duplicated validation explanation is not repeated as an observation", () => {
  const scorecard = selectedScorecard(payload, selectedLayoutId)!;
  assert.ok(scorecard.explanations.some((explanation) => explanation.key.startsWith("validation.")));
  assert.equal(observationExplanations(scorecard).some((explanation) => explanation.key.startsWith("validation.")), false);
  assert.deepEqual(observationExplanations(null), []);
});

test("observation labels are readable and identifiers are humanised", () => {
  assert.equal(observationLabel("programSpace.preferredArea.strong", copy), "Preferred area (strong)");
  assert.equal(observationLabel("flow.routeDistance.weak", copy), "Route distance (weak)");
  assert.equal(observationLabel("circulation.deadEnd", copy), "Circulation · Dead end");
  assert.equal(observationLabel("programSpace.preferredArea.notApplicable", copy), "Preferred area (not applicable)");
  assert.equal(humaniseIdentifier("SPACE_OVERLAP"), "Space overlap");
  assert.equal(humaniseIdentifier("preferred-area"), "Preferred area");
});
