/**
 * Exact-millimetre SVG projection for a `LayoutV1` (plan section 7).
 *
 * World geometry is south-west origin integer millimetres with y increasing
 * north. Screen SVG has y increasing downwards, so the Y axis is flipped exactly
 * once here and shared by every layer — rooms, walls, openings and the entry.
 * North is up regardless of the frontage.
 */
import type { LayoutV1, RectMm } from "../integration/contracts.ts";

export interface ProjectionOptions {
  showGrid?: boolean;
  gridMm?: number;
  showDimensions?: boolean;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A world rectangle as a screen rectangle: one flip, shared by all layers. */
export function toScreenRect(rect: RectMm, siteHeightMm: number): ScreenRect {
  return {
    x: rect.xMm,
    y: siteHeightMm - rect.yMm - rect.heightMm,
    width: rect.widthMm,
    height: rect.heightMm,
  };
}

export function toScreenPoint(point: { xMm: number; yMm: number }, siteHeightMm: number) {
  return { x: point.xMm, y: siteHeightMm - point.yMm };
}

function rectAttributes(rect: ScreenRect, decimals = 0): string {
  const round = (value: number) => Number(value.toFixed(decimals));
  return `x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}"`;
}

const ROOM_LABELS: Record<string, string> = {
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  wc: "WC",
  kitchen: "Kitchen",
  living: "Living",
  dining: "Dining",
  garage: "Garage",
  laundry: "Laundry",
  study: "Study",
  store: "Store",
};

export function projectionViewBox(layout: LayoutV1): ScreenRect {
  return { x: 0, y: 0, width: layout.site.widthMm, height: layout.site.heightMm };
}

/** Render the whole drawing. Every layer consumes the same flipped rectangles. */
export function renderLayoutSvg(layout: LayoutV1, options: ProjectionOptions = {}): string {
  const height = layout.site.heightMm;
  const view = projectionViewBox(layout);
  const gridMm = options.gridMm ?? 1_000;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="Generated floor plan, north up, millimetres">`,
  );
  parts.push(
    `<style>` +
    `.site{fill:#f7f5f0;stroke:#8a8378;stroke-width:40}` +
    `.setback{fill:none;stroke:#b9b1a4;stroke-width:30;stroke-dasharray:240 160}` +
    `.buildable{fill:none;stroke:#6b7a5a;stroke-width:30;stroke-dasharray:120 120}` +
    `.room{fill:#ffffff;stroke:#3d3a35;stroke-width:24}` +
    `.corridor{fill:url(#hatch);stroke:#3d3a35;stroke-width:24}` +
    `.wall-external{fill:#3d3a35}` +
    `.wall-internal{fill:#8d867c}` +
    `.opening{fill:#f7f5f0;stroke:#3d3a35;stroke-width:16}` +
    `.label{font:600 280px system-ui,sans-serif;fill:#26241f}` +
    `.sublabel{font:400 200px system-ui,sans-serif;fill:#6a6459}` +
    `.north{font:600 320px system-ui,sans-serif;fill:#26241f}` +
    `</style>`,
  );
  parts.push(
    `<defs><pattern id="hatch" width="200" height="200" patternUnits="userSpaceOnUse" ` +
    `patternTransform="rotate(45)"><rect width="200" height="200" fill="#f0ede6"/>` +
    `<line x1="0" y1="0" x2="0" y2="200" stroke="#b7b0a2" stroke-width="28"/></pattern></defs>`,
  );

  if (options.showGrid) {
    const lines: string[] = [];
    for (let x = 0; x <= layout.site.widthMm; x += gridMm) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#e6e1d8" stroke-width="8"/>`);
    }
    for (let y = 0; y <= height; y += gridMm) {
      lines.push(`<line x1="0" y1="${y}" x2="${layout.site.widthMm}" y2="${y}" stroke="#e6e1d8" stroke-width="8"/>`);
    }
    parts.push(`<g aria-hidden="true">${lines.join("")}</g>`);
  }

  parts.push(`<rect class="site" ${rectAttributes({ x: 0, y: 0, width: layout.site.widthMm, height })}/>`);
  parts.push(
    `<rect class="setback" ${rectAttributes(toScreenRect(layout.setbackEnvelope, height))}/>` +
    `<rect class="buildable" ${rectAttributes(toScreenRect(layout.buildingEnvelope, height))}/>` +
    `<rect class="buildable" ${rectAttributes(toScreenRect(layout.buildableEnvelope, height))}/>`,
  );

  // circulation first so room fills sit above it where they share an edge
  const corridor = toScreenRect(layout.circulation.rect, height);
  parts.push(
    `<rect class="corridor" ${rectAttributes(corridor)}/>` +
    `<text class="sublabel" x="${corridor.x + 60}" y="${corridor.y + corridor.height / 2 + 70}">` +
    `CORRIDOR ${layout.circulation.measuredMinWidthMm} mm</text>`,
  );

  for (const room of layout.rooms) {
    const rect = toScreenRect(room.rect, height);
    const label = ROOM_LABELS[room.type] ?? room.type;
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    parts.push(
      `<g data-room-id="${escapeSvgText(room.id)}">` +
      `<rect class="room" ${rectAttributes(rect)}/>` +
      `<text class="label" text-anchor="middle" x="${centreX}" y="${centreY - 20}">` +
      `${escapeSvgText(room.id)}</text>` +
      `<text class="sublabel" text-anchor="middle" x="${centreX}" y="${centreY + 240}">` +
      `${escapeSvgText(label)} · ${room.areaM2.toFixed(2)} m²</text>` +
      `</g>`,
    );
  }

  for (const wall of layout.walls) {
    const rect = toScreenRect(wall.rect, height);
    const cssClass = wall.type === "external" ? "wall-external" : "wall-internal";
    parts.push(`<rect class="${cssClass}" data-wall-id="${escapeSvgText(wall.id)}" ${rectAttributes(rect)}/>`);
  }

  for (const opening of layout.openings) {
    const rect = toScreenRect(opening.rect, height);
    parts.push(
      `<rect class="opening" data-opening-id="${escapeSvgText(opening.id)}" ` +
      `data-kind="${escapeSvgText(opening.kind)}" ${rectAttributes(rect)}/>`,
    );
  }

  // entry marker, drawn from the same flipped point
  const entry = toScreenPoint(
    { xMm: layout.circulation.entry.xMm, yMm: layout.circulation.entry.yMm },
    height,
  );
  parts.push(
    `<g data-entry-side="${escapeSvgText(layout.circulation.entry.side)}">` +
    `<circle cx="${entry.x}" cy="${entry.y}" r="120" fill="#c8552b"/>` +
    `<text class="sublabel" x="${entry.x + 160}" y="${entry.y - 120}">entry ${layout.circulation.entry.widthMm} mm</text>` +
    `</g>`,
  );

  if (options.showDimensions !== false) {
    parts.push(
      `<text class="sublabel" x="60" y="${height - 60}">` +
      `site ${layout.site.widthMm} × ${layout.site.heightMm} mm · ` +
      `setbacks N${layout.setbacks.northMm} E${layout.setbacks.eastMm} ` +
      `S${layout.setbacks.southMm} W${layout.setbacks.westMm}</text>`,
    );
  }
  parts.push(
    `<g><text class="north" x="${layout.site.widthMm - 380}" y="360">N ↑</text>` +
    `<line x1="${layout.site.widthMm - 300}" y1="380" x2="${layout.site.widthMm - 300}" y2="120" ` +
    `stroke="#26241f" stroke-width="24"/></g>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}

/** Omitted optional rooms are listed beside the plan, never drawn. */
export function omittedRoomSummary(layout: LayoutV1): string[] {
  return layout.omittedRoomIds.map(
    (id) => `${id} was not included in this option`,
  );
}

export function optionCaption(layout: LayoutV1): string {
  return (
    `Option ${layout.rank} · generated and validated · ` +
    `engine ordering score ${layout.scores.final.toFixed(2)}`
  );
}
