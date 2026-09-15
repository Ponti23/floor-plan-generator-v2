import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_PROJECT } from "../src/domain/fixtures.ts";
import type { Layout } from "../src/domain/layout.ts";
import { tryNormalizeProject } from "../src/domain/normalization.ts";
import { resolvePresentationCopy } from "../src/app/presentation-copy.ts";
import {
  projectEvidenceGeometry,
  projectPlanSvg,
  projectPortalLine,
  svgLayerOrder,
} from "../src/app/svg-projection.ts";

const normalized = tryNormalizeProject(CANONICAL_PROJECT);
if (!normalized.ok) throw new Error("canonical fixture should normalize");

const layout: Layout = {
  id: "layout-projection-a",
  footprint: { x: 8, y: 10, width: 52, depth: 72 },
  spaces: [
    { instanceId: "bedroom-1", role: "room", rect: { x: 10, y: 12, width: 16, depth: 16 } },
    { instanceId: "hallway-1", role: "circulation", rect: { x: 26, y: 28, width: 6, depth: 30 } },
    { instanceId: "entry-1", role: "entry", rect: { x: 30, y: 76, width: 8, depth: 6 } },
  ],
  portals: [
    { id: "portal-entry", a: "exterior", b: "entry-1", wall: "south", start: 31, length: 4, kind: "pedestrian" },
  ],
  entrancePortalId: "portal-entry",
  metadata: {
    engineVersion: "test",
    ruleVersion: "test",
    seed: "test",
    topology: "straight",
    footprintVariant: "test",
    expandedStates: 0,
    candidateOrdinal: 0,
  },
};

const copy = resolvePresentationCopy().ui;

test("SVG projection emits deterministic layers under one viewport transform", () => {
  const options = { project: normalized.value, layout, copy };
  const first = projectPlanSvg(options);
  const second = projectPlanSvg(options);

  assert.equal(first, second);
  assert.deepEqual(
    [...first.matchAll(/data-layer="([^"]+)"/g)].map((match) => match[1]),
    svgLayerOrder(),
  );
  assert.equal((first.match(/data-viewport-transform/g) ?? []).length, 1);
  assert.match(first, /viewBox="-4 -4 88 128"/);
  assert.match(first, /data-space-id="bedroom-1"/);
  assert.match(first, /data-portal-id="portal-entry"/);
});

test("evidence projection resolves only authoritative room, footprint, circulation and portal geometry", () => {
  const projected = projectEvidenceGeometry(layout, [
    "room:bedroom-1:area",
    "room:bedroom-1:aspect",
    "footprint:targetGfa",
    "access:reachability",
    "portal:portal-entry",
    "relationship:adjacency",
    "not-geometry:invented",
  ]);

  assert.deepEqual(projected.rects, [
    { x: 10, y: 12, width: 16, depth: 16 },
    { x: 8, y: 10, width: 52, depth: 72 },
    { x: 26, y: 28, width: 6, depth: 30 },
    { x: 30, y: 76, width: 8, depth: 6 },
  ]);
  assert.equal(projected.portals.length, 1);
  assert.deepEqual(projected.portals[0], {
    portal: layout.portals[0],
    x1: 31,
    y1: 82,
    x2: 35,
    y2: 82,
  });
});

test("focused evidence appears above labels without changing layout coordinates", () => {
  const svg = projectPlanSvg({
    project: normalized.value,
    layout,
    copy,
    focusedEvidenceRefs: ["room:bedroom-1:area", "portal:portal-entry"],
  });
  assert.match(svg, /data-layer="evidence"[^>]*>[\s\S]*evidence-highlight/);
  assert.match(svg, /evidence-portal-highlight/);
  assert.ok(svg.indexOf('data-layer="labels"') < svg.indexOf('data-layer="evidence"'));
  assert.equal(projectPortalLine(layout, layout.portals[0])?.x1, 31);
  assert.equal(layout.spaces[0]?.rect.x, 10);
});

