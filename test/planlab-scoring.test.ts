import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  DEFAULT_DIVERSITY_THRESHOLD,
  METRIC_CATEGORIES,
  STRATEGY_PROFILE_IDS,
  aspectUtility,
  compareLayoutDiversity,
  computeLayoutFacts,
  createCrudeDiagnostic,
  evaluateLayoutMetrics,
  generateLayouts,
  preferredAreaUtility,
  scoreCandidates,
  scoreLayout,
  scoreLayoutProfiles,
  selectDiverseTriplet,
  unionArea,
  type Layout,
  type NormalizedProject,
} from "../src/domain/index.ts";

const project = CANONICAL_NORMALIZED_PROJECT;
const generated = generateLayouts(project, {
  seed: "bucket-0.3-tests",
  budget: { maxCandidatesPerTopology: 3, maxTotalCandidates: 9 },
});
const layout = generated.layouts[0];
if (!layout) throw new Error("canonical test fixture did not generate a layout");

function mirrorRect(rect: Layout["footprint"], source: NormalizedProject): Layout["footprint"] {
  const envelope = source.site.envelope;
  return {
    x: envelope.x + envelope.width - (rect.x - envelope.x) - rect.width,
    y: rect.y,
    width: rect.width,
    depth: rect.depth,
  };
}

function mirroredLayout(source: Layout, normalized: NormalizedProject): Layout {
  const mirrorSide = (side: "north" | "east" | "south" | "west") =>
    side === "east" ? "west" : side === "west" ? "east" : side;
  const envelope = normalized.site.envelope;
  return {
    ...structuredClone(source),
    id: `${source.id}-mirror`,
    footprint: mirrorRect(source.footprint, normalized),
    spaces: source.spaces.map((space) => ({
      ...space,
      rect: mirrorRect(space.rect, normalized),
    })),
    portals: source.portals.map((portal) => {
      const wall = mirrorSide(portal.wall);
      const horizontal = wall === "north" || wall === "south";
      return {
        ...portal,
        wall,
        start: horizontal
          ? envelope.x + envelope.width - (portal.start - envelope.x) - portal.length
          : portal.start,
      };
    }),
  };
}

function relabelBedrooms(source: Layout): Layout {
  const swap = new Map([["bedroom-1", "bedroom-2"], ["bedroom-2", "bedroom-1"]]);
  const remap = (id: string): string => swap.get(id) ?? id;
  return {
    ...structuredClone(source),
    id: `${source.id}-relabelled`,
    spaces: source.spaces.map((space) => ({ ...space, instanceId: remap(space.instanceId) })),
    portals: source.portals.map((portal) => ({ ...portal, a: remap(portal.a), b: remap(portal.b) })),
  };
}

test("approved utility breakpoints are bounded and monotone", () => {
  assert.equal(preferredAreaUtility(0, 100), 0);
  assert.equal(preferredAreaUtility(50, 100), 0.5);
  assert.equal(preferredAreaUtility(100, 100), 1);
  assert.equal(preferredAreaUtility(115, 100), 1);
  assert.equal(preferredAreaUtility(200, 100), 0);
  assert.equal(aspectUtility(1.5, 1.5, 3), 1);
  assert.equal(aspectUtility(2.25, 1.5, 3), 0.5);
  assert.equal(aspectUtility(3, 1.5, 3), 0);
  assert.equal(aspectUtility(2, 2, 1, 1), 1);
  assert.equal(aspectUtility(3, 2, 1, 1), 0);
  for (const value of [0, 0.25, 1, 1.15, 2, 10]) {
    assert.ok(preferredAreaUtility(value * 100, 100) >= 0);
    assert.ok(preferredAreaUtility(value * 100, 100) <= 1);
  }
});

test("facts preserve the approved area identities and one shared context", () => {
  const validation = generated.analyses[0]?.validation;
  const facts = computeLayoutFacts(layout, project, validation);
  const transit = layout.spaces
    .filter((space) => space.role === "entry" || space.role === "circulation")
    .map((space) => space.rect);
  assert.equal(facts.circulationAreaUnits2, unionArea(transit));
  assert.equal(
    facts.unallocatedInteriorAreaUnits2,
    Math.max(0, facts.footprintAreaUnits2 - unionArea(layout.spaces.map((space) => space.rect))),
  );
  assert.equal(facts.overlapAreaUnits2, 0);
  assert.equal(facts.gfaDeltaFromTargetUnits2, facts.footprintAreaUnits2 - facts.targetGfaUnits2);
  assert.equal(facts.gfaDeltaFromMaxUnits2, facts.footprintAreaUnits2 - facts.maxGfaUnits2);
  assert.equal(facts.requiredRoomCount, project.rooms.filter((room) => room.inclusion === "required").length);
  assert.ok(facts.roomFacts.every((fact) => Object.keys(fact.exteriorContactBySide).length === 4));
  assert.equal(facts.reachableRequiredRoomCount, facts.requiredRoomCount);
});

test("all five categories and all three profiles use bounded metrics and evidence", () => {
  const scorecards = scoreLayoutProfiles(layout, project);
  assert.deepEqual(Object.keys(scorecards.scorecards), STRATEGY_PROFILE_IDS);
  assert.equal(scorecards.profiles.length, 3);
  assert.equal(scorecards.profiles[0]?.metrics, scorecards.metrics);
  for (const category of METRIC_CATEGORIES) {
    assert.ok(scorecards.metrics.categories[category]);
    assert.ok(scorecards.metrics.categories[category].utility >= 0);
    assert.ok(scorecards.metrics.categories[category].utility <= 1);
    for (const metric of scorecards.metrics.categories[category].metrics) {
      assert.ok(metric.utility >= 0 && metric.utility <= 1, metric.id);
      assert.ok(metric.evidenceRefs.length > 0, metric.id);
    }
  }
  assert.ok(scorecards.profiles.every((item) => item.valid));
  assert.ok(scorecards.profiles.every((item) => item.explanations.every((item) => item.message && item.evidenceRefs.length > 0)));
});

test("invalid geometry is never rescued by a design score", () => {
  const invalid = structuredClone(layout);
  const rooms = invalid.spaces.filter((space) => space.role === "room");
  assert.ok(rooms.length >= 2);
  rooms[1]!.rect = rooms[0]!.rect;
  const scorecard = scoreLayout(invalid, project, "balanced");
  assert.equal(scorecard.valid, false);
  assert.equal(scorecard.designScore, null);
  assert.equal(scorecard.overallScore, 0);
  assert.ok(scorecard.validation.violations.some((violation) => violation.code === "SPACE_OVERLAP"));
  assert.ok(scorecard.explanations.some((item) => item.key.startsWith("validation.")));

  const malformed = structuredClone(layout);
  (malformed as unknown as { footprint: unknown }).footprint = null;
  const malformedScorecard = scoreLayout(malformed, project, "balanced");
  assert.equal(malformedScorecard.valid, false);
  assert.equal(malformedScorecard.designScore, null);
  assert.equal(malformedScorecard.overallScore, 0);
});

test("interchangeable room relabelling and mirrors do not create diversity", () => {
  const relabelled = relabelBedrooms(layout);
  const relabelledComparison = compareLayoutDiversity(layout, relabelled, project);
  assert.equal(relabelledComparison.distance, 0);
  assert.equal(relabelledComparison.diverse, false);
  const mirrored = mirroredLayout(layout, project);
  const mirroredComparison = compareLayoutDiversity(layout, mirrored, project);
  assert.equal(mirroredComparison.distance, 0);
  assert.equal(mirroredComparison.diverse, false);
  assert.equal(mirroredComparison.mirroredComparison, true);
});

test("joint selection returns a diverse triplet or an honest partial result", () => {
  const selection = generated.selection;
  if (selection.complete) {
    assert.equal(selection.selected.length, 3);
    assert.equal(selection.pairwiseDistances.length, 3);
    assert.ok(selection.pairwiseDistances.every((pair) => pair.diverse && pair.distance >= DEFAULT_DIVERSITY_THRESHOLD));
    assert.equal(new Set(selection.selected.map((item) => item.layout.id)).size, 3);
  } else {
    assert.equal(selection.partial, true);
    assert.ok(selection.diagnostics.length > 0);
    assert.ok(selection.selected.length < 3);
  }
  const duplicateOnly = selectDiverseTriplet([layout, relabelBedrooms(layout)], project);
  assert.equal(duplicateOnly.selected.length, 1);
  assert.equal(duplicateOnly.reason, "INSUFFICIENT_CANDIDATES");
});

test("diagnostic rendering stays crude, deterministic, and inspectable", () => {
  const diagnostic = createCrudeDiagnostic(layout, project);
  assert.equal(diagnostic.version, "planlab-diagnostic-0.3");
  assert.match(diagnostic.svg, /^<svg /);
  assert.match(diagnostic.svg, /data-space-id="/);
  assert.match(diagnostic.svg, /<title/);
  assert.match(diagnostic.text, /Validity: PASS/);
  assert.match(diagnostic.text, /Planning efficiency:/);
  assert.match(diagnostic.text, /Scores:/);
  assert.equal(diagnostic.text, createCrudeDiagnostic(layout, project).text);
});

test("candidate analysis computes all profiles while retaining only hard-valid inputs", () => {
  const invalid = structuredClone(layout);
  invalid.spaces[0]!.rect = { ...invalid.spaces[0]!.rect, x: project.site.envelope.x - 1 };
  const analyzed = scoreCandidates([layout, invalid], project);
  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]?.profiles.length, 3);
  assert.deepEqual(analyzed[0]?.scores, Object.fromEntries(
    analyzed[0]!.profiles.map((profile) => [profile.profileId, profile.overallScore]),
  ));
});
