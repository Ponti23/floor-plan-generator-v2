import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  IMPOSSIBLE_FIXTURES,
  canonicalLayoutKey,
  compareLayoutDiversity,
  generateLayouts,
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
