import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VIEWPORT_TRANSFORM,
  fitViewport,
  panViewport,
  pointerToViewBox,
  viewportTransformAttribute,
  zoomViewport,
} from "../src/app/viewport.ts";

test("zoom keeps its SVG-grid anchor stationary and clamps the scale", () => {
  const before = { scale: 1, translateX: 3, translateY: -2 };
  const anchor = { x: 20, y: 30 };
  const after = zoomViewport(before, 2, anchor);

  assert.equal(after.scale, 2);
  assert.equal(after.scale * anchor.x + after.translateX, before.scale * anchor.x + before.translateX);
  assert.equal(after.scale * anchor.y + after.translateY, before.scale * anchor.y + before.translateY);
  assert.equal(zoomViewport(after, 100, anchor).scale, 4);
  assert.equal(zoomViewport(after, 0.001, anchor).scale, 0.65);
});

test("pan changes only the transient translation", () => {
  const source = { scale: 1.5, translateX: 2, translateY: 4 };
  assert.deepEqual(panViewport(source, 3, -5), {
    scale: 1.5,
    translateX: 5,
    translateY: -1,
  });
  assert.deepEqual(source, { scale: 1.5, translateX: 2, translateY: 4 });
});

test("fit centres authoritative bounds using one deterministic transform", () => {
  const root = { x: -4, y: -4, width: 88, depth: 128 };
  const content = { x: 6, y: 8, width: 68, depth: 88 };
  const viewport = { width: 840, height: 920 };
  const first = fitViewport(content, root, viewport, 28);
  const second = fitViewport(content, root, viewport, 28);

  assert.deepEqual(first, second);
  assert.ok(first.scale >= 0.65 && first.scale <= 4);
  const contentCentre = {
    x: content.x + content.width / 2,
    y: content.y + content.depth / 2,
  };
  const rootCentre = {
    x: root.x + root.width / 2,
    y: root.y + root.depth / 2,
  };
  assert.equal(first.scale * contentCentre.x + first.translateX, rootCentre.x);
  assert.equal(first.scale * contentCentre.y + first.translateY, rootCentre.y);
});

test("pointer conversion accounts for preserveAspectRatio letterboxing", () => {
  const root = { x: -4, y: -4, width: 88, depth: 128 };
  // 800 × 800 renders a 550 × 800 meet viewport, leaving 125 px on each side.
  const point = pointerToViewBox(400, 400, { left: 0, top: 0, width: 800, height: 800 }, root);
  assert.equal(point.x, 40);
  assert.equal(point.y, 60);
});

test("viewport transform markup is stable and finite", () => {
  assert.equal(viewportTransformAttribute(DEFAULT_VIEWPORT_TRANSFORM), "translate(0 0) scale(1)");
  assert.equal(viewportTransformAttribute({ scale: Number.NaN, translateX: 1.234567, translateY: -2.34567 }), "translate(1.2346 -2.3457) scale(1)");
});

