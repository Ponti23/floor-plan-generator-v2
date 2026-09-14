import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  GRID_UNIT_METRES,
  ROOM_SHAPE_POLICY,
  createCanonicalProject,
  generateLayouts,
  normalizeProject,
  validateLayout,
  type Layout,
  type NormalizedProject,
} from "../src/domain/index.ts";

/**
 * The Stage 3 usefulness gate found that minimum area alone admits unusable
 * rooms: a 7.00 x 0.75 m bathroom satisfies a 5 m2 minimum exactly, which is how
 * the canonical brief passed hard validity while producing a bathroom nobody
 * could enter.  These tests pin the approved room-shape policy: it must reach
 * every habitable room instance, and a room that is too thin or too corridor-like
 * must be a hard finding rather than a score deduction.
 */

/**
 * One generated layout to re-shape.  This seed needs roughly 5,000 expansions
 * per topology before its first complete layout appears, so a mid-sized budget
 * that lowers both the candidate target and the expansion cap finds nothing at
 * all: one candidate per topology against the default expansion cap is the
 * smallest configuration that reliably yields a layout here.  Resolved once and
 * shared by the shape tests.
 */
const SHAPE_FIXTURE = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
  seed: "room-shape-policy",
  budget: { maxCandidatesPerTopology: 1, maxTotalCandidates: 3 },
});
const SHAPE_FIXTURE_LAYOUT: Layout = (() => {
  const layout = SHAPE_FIXTURE.layouts[0];
  assert.ok(layout, "the canonical generator must produce a layout for this fixture");
  return layout;
})();

/** Re-shape one room and report the violation codes the validator returns. */
function codesForShape(
  layout: Layout,
  project: NormalizedProject,
  instanceId: string,
  width: number,
  depth: number,
): string[] {
  const mutated: Layout = {
    ...layout,
    spaces: layout.spaces.map((space) =>
      space.instanceId === instanceId
        ? { ...space, rect: { ...space.rect, width, depth } }
        : space,
    ),
  };
  return validateLayout(mutated, project).violations.map((violation) => violation.code);
}

test("the approved room-shape policy reaches every habitable room instance", () => {
  const project = normalizeProject(createCanonicalProject());
  for (const [kind, policy] of Object.entries(ROOM_SHAPE_POLICY)) {
    const room = project.rooms.find((candidate) => candidate.kind === kind);
    assert.ok(room, `${kind} must exist in the canonical program`);
    assert.equal(room.dimensions.minShortSideMm, policy.minShortSideM * 1_000);
    assert.equal(room.dimensions.minShortSideUnits, (policy.minShortSideM * 1_000) / 250);
    assert.equal(room.dimensions.preferredAreaMm2, policy.preferredAreaM2 * 1_000_000);
    assert.equal(room.dimensions.maxAspectRatio, policy.maxAspectRatio);
  }

  // The garage keeps its approved 6 x 6 preset instead of a policy aspect cap;
  // two explicit minima already make a corridor-shaped garage impossible.
  const garage = project.rooms.find((candidate) => candidate.id === "garage-1");
  assert.equal(garage?.dimensions.minWidthMm, 6_000);
  assert.equal(garage?.dimensions.minDepthMm, 6_000);
  assert.equal(garage?.dimensions.maxAspectRatio, undefined);
});

test("a sliver that satisfies its area minimum is a hard finding", () => {
  const layout = SHAPE_FIXTURE_LAYOUT;
  const project = CANONICAL_NORMALIZED_PROJECT;

  // The recorded defect: 0.75 m x 6.75 m is 5.06 m2, which satisfies the
  // bathroom's approved 5 m2 minimum.
  const sliver = codesForShape(layout, project, "bathroom-1", 3, 27);
  assert.ok(
    sliver.includes("ROOM_DIMENSIONS_INVALID"),
    `a 0.75 m wide bathroom must be rejected, got ${sliver.join(", ")}`,
  );

  // 2.00 m x 2.50 m is exactly the approved 5 m2 minimum with a 1.25 aspect
  // ratio, so the rule is rejecting the shape and not the room type.
  const acceptable = codesForShape(layout, project, "bathroom-1", 8, 10);
  assert.ok(!acceptable.includes("ROOM_DIMENSIONS_INVALID"));
});

test("the aspect cap rejects a corridor-shaped room that passes area and short side", () => {
  const layout = SHAPE_FIXTURE_LAYOUT;
  const project = CANONICAL_NORMALIZED_PROJECT;

  // 3.00 m x 7.00 m clears the bedroom's 10 m2 minimum and its 3 m short side,
  // but its 2.33 aspect ratio exceeds the approved 2.0 cap.
  const corridor = codesForShape(layout, project, "bedroom-1", 12, 28);
  assert.ok(
    corridor.includes("ROOM_DIMENSIONS_INVALID"),
    `a 2.33 aspect bedroom must be rejected, got ${corridor.join(", ")}`,
  );

  // 3.00 m x 6.00 m sits exactly on the cap and must still be accepted, so the
  // boundary is inclusive rather than off by one rectangle.
  const boundary = codesForShape(layout, project, "bedroom-1", 12, 24);
  assert.ok(!boundary.includes("ROOM_DIMENSIONS_INVALID"));
});

test("every selected option honours the declared shape policy", () => {
  // Two seeds keep the suite quick; the shape invariant is a property of the
  // policy rather than of one seed's search.
  for (const seed of ["planlab-canonical-01", "planlab-canonical-02"]) {
    const brief = createCanonicalProject(seed);
    const project = normalizeProject(brief);
    const byId = new Map(project.rooms.map((room) => [room.id, room]));
    const result = generateLayouts(brief, { seed });

    assert.equal(
      result.selection.layouts.length,
      3,
      `${seed} must still select three diverse options`,
    );

    for (const layout of result.selection.layouts) {
      for (const space of layout.spaces) {
        const room = byId.get(space.instanceId);
        if (!room) continue;
        const shortSide = Math.min(space.rect.width, space.rect.depth);
        const aspect = Math.max(
          space.rect.width / space.rect.depth,
          space.rect.depth / space.rect.width,
        );
        const label = `${seed} ${layout.id} ${room.displayName}`;
        if (room.dimensions.minShortSideUnits !== undefined) {
          assert.ok(
            shortSide >= room.dimensions.minShortSideUnits,
            `${label}: ${(shortSide * GRID_UNIT_METRES).toFixed(2)} m short side is below the approved minimum`,
          );
        }
        if (room.dimensions.maxAspectRatio !== undefined) {
          assert.ok(
            aspect <= room.dimensions.maxAspectRatio + 1e-9,
            `${label}: aspect ${aspect.toFixed(2)} exceeds the approved cap`,
          );
        }
      }
    }
  }
});
