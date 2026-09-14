import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_SURFACE,
  CANONICAL_NORMALIZED_PROJECT,
  IMPOSSIBLE_FIXTURES,
  canonicalLayoutKey,
  compareLayoutDiversity,
  generateLayouts,
  scoreCandidates,
  selectDiverseTriplet,
  type Layout,
  type NormalizedProject,
} from "../src/domain/index.ts";

const project = CANONICAL_NORMALIZED_PROJECT;
const generated = generateLayouts(project, {
  seed: "bucket-3.3-diversity-tests",
  budget: { maxCandidatesPerTopology: 3, maxTotalCandidates: 9 },
});
const layout = generated.layouts[0];
if (!layout) throw new Error("diversity fixture did not generate a layout");

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

test("interchangeable and mirrored designs share one canonical identity", () => {
  const relabelled = relabelBedrooms(layout);
  const mirrored = mirroredLayout(layout, project);
  assert.equal(canonicalLayoutKey(layout, project), canonicalLayoutKey(relabelled, project));
  assert.equal(canonicalLayoutKey(layout, project), canonicalLayoutKey(mirrored, project));
  assert.equal(compareLayoutDiversity(layout, relabelled, project).distance, 0);
  assert.equal(compareLayoutDiversity(layout, mirrored, project).distance, 0);
});

test("diversity distance is exactly symmetric and every signal is bounded", () => {
  const other = generated.layouts.find((candidate) => candidate.id !== layout.id);
  assert.ok(other);
  const first = compareLayoutDiversity(layout, other!, project);
  const second = compareLayoutDiversity(other!, layout, project);
  assert.deepEqual(second.components, first.components);
  assert.equal(second.distance, first.distance);
  for (const comparison of [first, second]) {
    assert.ok(comparison.distance >= 0 && comparison.distance <= 1);
    for (const component of Object.values(comparison.components)) {
      assert.ok(component >= 0 && component <= 1);
    }
  }
});

test("a topology change remains a distinct design", () => {
  const other = generated.layouts.find((candidate) => candidate.metadata.topology !== layout.metadata.topology);
  assert.ok(other, "fixture should include more than one circulation topology");
  const comparison = compareLayoutDiversity(layout, other!, project);
  assert.ok(comparison.distance > 0);
  assert.ok(comparison.components.adjacency > 0 || comparison.components.circulation > 0);
});

test("selection distinguishes no-candidate, fewer-than-three, and insufficient-diversity outcomes", () => {
  const other = generated.layouts.find((candidate) => candidate.id !== layout.id);
  assert.ok(other);
  const mirrored = mirroredLayout(layout, project);

  const noCandidates = selectDiverseTriplet([], project);
  assert.equal(noCandidates.status, "partial");
  assert.equal(noCandidates.partial, true);
  assert.equal(noCandidates.reason, "NO_VALID_CANDIDATES");

  const fewer = selectDiverseTriplet([layout, other!], project);
  assert.equal(fewer.status, "partial");
  assert.equal(fewer.partial, true);
  assert.equal(fewer.reason, "INSUFFICIENT_CANDIDATES");

  const duplicates = selectDiverseTriplet([layout, relabelBedrooms(layout), mirrored], project);
  assert.equal(duplicates.status, "partial");
  assert.equal(duplicates.reason, "INSUFFICIENT_DIVERSITY");
  assert.equal(duplicates.diagnostics[0]?.candidateCount, 3);

  const complete = selectDiverseTriplet([layout, other!, generated.layouts[2]!], project, { threshold: 0 });
  assert.equal(complete.status, "complete");
  assert.equal(complete.complete, true);
  assert.equal(complete.selected.length, 3);
});

test("preflight contradictions surface as infeasible generation results", () => {
  const result = generateLayouts(IMPOSSIBLE_FIXTURES.roomCannotFitEnvelope);
  assert.equal(result.ok, false);
  assert.equal(result.selection.status, "infeasible");
  assert.equal(result.selection.partial, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "INFEASIBLE"));
});

test("bounded search with no found layouts remains a non-infeasible no-candidate result", () => {
  const result = generateLayouts(project, {
    seed: "bucket-3.3-zero-result-search",
    budget: { maxExpansionsPerTopology: 1, maxCandidatesPerTopology: 1, maxTotalCandidates: 1 },
  });
  assert.equal(result.layouts.length, 0);
  assert.equal(result.selection.status, "partial");
  assert.equal(result.selection.partial, true);
  assert.equal(result.selection.reason, "NO_VALID_CANDIDATES");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "NO_VALID_LAYOUT"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "INFEASIBLE"));
});

test("reported selection distances agree with a direct pairwise comparison", () => {
  // Joint selection memoises pair comparisons instead of recomputing them for
  // every candidate ordering.  The memoised verdict must be the verdict the
  // public comparison produces for the same pair, or selection could accept a
  // triplet that is not actually diverse.
  const byId = new Map(generated.layouts.map((candidate) => [candidate.id, candidate]));
  const selection = selectDiverseTriplet(generated.layouts, project);
  assert.equal(selection.status, "complete");
  assert.equal(selection.pairwiseDistances.length, 3);
  for (const pair of selection.pairwiseDistances) {
    const first = byId.get(pair.a);
    const second = byId.get(pair.b);
    assert.ok(first && second, `selection referenced an unknown layout: ${pair.a} / ${pair.b}`);
    const direct = compareLayoutDiversity(first!, second!, project, selection.threshold);
    assert.equal(pair.distance, direct.distance);
    assert.equal(pair.diverse, direct.diverse);
    assert.equal(pair.diverse, direct.distance >= selection.threshold);
    assert.ok(pair.diverse, `selected pair ${pair.a} / ${pair.b} is below the diversity threshold`);
  }
});

test("selection agrees with an independent brute-force triplet search", () => {
  const bonus = CALIBRATION_SURFACE.diversity.selectionDiversityBonus;
  const threshold = CALIBRATION_SURFACE.diversity.threshold;
  // Selection keeps one deterministic representative per canonical design, so
  // mirror/relabel duplicates in the fixture are collapsed the same way here
  // before the exhaustive enumeration.
  const representatives = new Map<string, ReturnType<typeof scoreCandidates>[number]>();
  for (const candidate of scoreCandidates(generated.layouts, project)
    .slice()
    .sort((a, b) => a.layout.id < b.layout.id ? -1 : a.layout.id > b.layout.id ? 1 : 0)) {
    const key = canonicalLayoutKey(candidate.layout, project);
    if (!representatives.has(key)) representatives.set(key, candidate);
  }
  const candidates = [...representatives.values()];
  // A shortlist that covers the whole pool makes the bounded pools equal to
  // the candidate set, so the production search is directly comparable with an
  // exhaustive enumeration of the same ordered triples.
  assert.ok(candidates.length >= 3);
  assert.equal(new Set(candidates.map((candidate) => canonicalLayoutKey(candidate.layout, project))).size, candidates.length);
  const selection = selectDiverseTriplet(candidates, project, { threshold, shortlistSize: candidates.length });

  const strategies = ["compactEfficiency", "bestFlow", "balanced"] as const;
  let best: { objective: number; ids: string[] } | undefined;
  for (const first of candidates) {
    for (const second of candidates) {
      for (const third of candidates) {
        const triple = [first, second, third];
        const ids = triple.map((candidate) => candidate.layout.id);
        if (new Set(ids).size !== 3) continue;
        const distances: number[] = [];
        let diverse = true;
        for (const [left, right] of [[0, 1], [0, 2], [1, 2]] as const) {
          const comparison = compareLayoutDiversity(triple[left]!.layout, triple[right]!.layout, project, threshold);
          if (!comparison.diverse) {
            diverse = false;
            break;
          }
          distances.push(comparison.distance);
        }
        if (!diverse) continue;
        const score = triple.reduce(
          (total, candidate, index) => total + candidate.scorecards[strategies[index]!].overallUtility,
          0,
        );
        const objective = score + bonus * (distances.reduce((total, value) => total + value, 0) / distances.length);
        if (!best || objective > best.objective || objective === best.objective && ids.join("|") < best.ids.join("|")) {
          best = { objective, ids };
        }
      }
    }
  }

  assert.ok(best, "fixture should contain at least one diverse triplet");
  assert.equal(selection.status, "complete");
  assert.deepEqual(
    selection.selected.map((item) => item.layout.id),
    best!.ids,
  );
  assert.ok(Math.abs(selection.selected.reduce(
    (total, item) => total + item.scorecard.overallUtility,
    0,
  ) + bonus * (selection.pairwiseDistances.reduce((total, pair) => total + pair.distance, 0) / 3) - best!.objective) < 1e-12);
});
