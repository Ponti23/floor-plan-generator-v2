/**
 * S08: exact-mm projection — one Y flip, north up, every layer labelled.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeSvgText,
  omittedRoomSummary,
  optionCaption,
  projectionViewBox,
  renderLayoutSvg,
  toScreenPoint,
  toScreenRect,
} from "../../src/app/engine-svg-projection.ts";
import type { LayoutV1 } from "../../src/integration/contracts.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

function layoutFixture(): LayoutV1 {
  const fixture = JSON.parse(
    readFileSync(resolve(REPO, "test", "integration", "fixtures", "layout-B.json"), "utf8"),
  );
  return fixture.payload as LayoutV1;
}

test("the Y axis is flipped exactly once and north stays up", () => {
  const siteHeight = 16_062;
  // a room sitting on the south edge must render at the BOTTOM of the screen
  const south = toScreenRect({ xMm: 0, yMm: 0, widthMm: 1_000, heightMm: 1_000 }, siteHeight);
  assert.equal(south.y, siteHeight - 1_000);
  // a room at the north edge renders at the top
  const north = toScreenRect(
    { xMm: 0, yMm: siteHeight - 1_000, widthMm: 1_000, heightMm: 1_000 },
    siteHeight,
  );
  assert.equal(north.y, 0);
  // points use the same flip
  assert.deepEqual(toScreenPoint({ xMm: 100, yMm: 200 }, siteHeight), { x: 100, y: siteHeight - 200 });
});

test("the projected view box is the site in millimetres", () => {
  const layout = layoutFixture();
  const view = projectionViewBox(layout);
  assert.deepEqual(view, { x: 0, y: 0, width: 14_117, height: 16_062 });
});

test("every required layer, label and opening is rendered", () => {
  const layout = layoutFixture();
  const svg = renderLayoutSvg(layout, { showGrid: true, gridMm: 1_000 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 14117 16062"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /class="site"/);
  assert.match(svg, /class="setback"/);
  assert.match(svg, /class="buildable"/);
  assert.match(svg, /class="corridor"/);
  assert.match(svg, /CORRIDOR 1000 mm/);
  assert.match(svg, /N ↑/);
  assert.match(svg, /site 14117 × 16062 mm/);
  assert.match(svg, /setbacks N1500 E1000 S3000 W1000/);
  for (const room of layout.rooms) {
    assert.ok(svg.includes(`data-room-id="${room.id}"`), room.id);
  }
  for (const wall of layout.walls) {
    assert.ok(svg.includes(`data-wall-id="${wall.id}"`), wall.id);
  }
  for (const opening of layout.openings) {
    assert.ok(svg.includes(`data-opening-id="${opening.id}"`), opening.id);
  }
  assert.match(svg, /data-entry-side="south"/);
  assert.match(svg, /wall-external/);
  assert.match(svg, /wall-internal/);
  assert.equal(svg.includes("NaN"), false);
  assert.equal(svg.includes("undefined"), false);
});

test("labels identify rooms by id and type, not by colour alone", () => {
  const layout = layoutFixture();
  const svg = renderLayoutSvg(layout);
  assert.match(svg, />B1</);
  assert.match(svg, /Bedroom · 11\.41 m²/);
  assert.match(svg, />K1</);
  assert.match(svg, /Kitchen/);
});

test("omitted optional rooms are listed beside the plan, never drawn", () => {
  const layout = layoutFixture();
  const withOmission: LayoutV1 = { ...layout, omittedRoomIds: ["S1"] };
  const svg = renderLayoutSvg(withOmission);
  assert.equal(svg.includes('data-room-id="S1"'), false);
  assert.deepEqual(omittedRoomSummary(withOmission), ["S1 was not included in this option"]);
});

test("captions describe generated/validated options without claiming optimality", () => {
  const caption = optionCaption(layoutFixture());
  assert.match(caption, /^Option 1 · generated and validated · engine ordering score 0\.\d+/);
  assert.equal(/optimal/i.test(caption), false);
});

test("text is escaped so a hostile label cannot break the SVG", () => {
  assert.equal(escapeSvgText('<script>"x"&'), "&lt;script&gt;&quot;x&quot;&amp;");
  const layout = layoutFixture();
  const hostile: LayoutV1 = {
    ...layout,
    rooms: layout.rooms.map((room, index) => index === 0
      ? { ...room, label: '<image onerror="boom">' }
      : room),
  };
  const svg = renderLayoutSvg(hostile);
  assert.equal(svg.includes("<image"), false);
});
