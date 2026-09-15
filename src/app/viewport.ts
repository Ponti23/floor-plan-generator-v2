import type { GridRect } from "../domain/geometry.ts";

/**
 * The transient transform used by the plan viewport.
 *
 * Coordinates stay in the domain's grid units.  The SVG root keeps a
 * grid-unit viewBox and one group receives this transform, so zooming and
 * panning never mutate the authoritative layout rectangles.
 */
export interface ViewportTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface ViewportPixelSize {
  width: number;
  height: number;
}

export interface ViewportModeState {
  transform: ViewportTransform;
  mode: "select" | "pan";
}

export const MIN_VIEWPORT_SCALE = 0.65;
export const MAX_VIEWPORT_SCALE = 4;
export const VIEWPORT_ZOOM_FACTOR = 1.2;

export const DEFAULT_VIEWPORT_TRANSFORM: Readonly<ViewportTransform> = Object.freeze({
  scale: 1,
  translateX: 0,
  translateY: 0,
});

export function createViewportState(): ViewportModeState {
  return {
    transform: { ...DEFAULT_VIEWPORT_TRANSFORM },
    mode: "select",
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampViewportScale(scale: number): number {
  return Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, finite(scale, 1)));
}

/** Stable SVG transform text.  Keep this as the only viewport transform. */
export function viewportTransformAttribute(transform: ViewportTransform): string {
  const scale = clampViewportScale(transform.scale);
  const translateX = finite(transform.translateX, 0);
  const translateY = finite(transform.translateY, 0);
  // A short fixed precision keeps generated markup deterministic and avoids
  // noisy attributes after a long pointer-drag sequence.
  const format = (value: number): string => Number(value.toFixed(4)).toString();
  return `translate(${format(translateX)} ${format(translateY)}) scale(${format(scale)})`;
}

export function panViewport(
  transform: ViewportTransform,
  deltaX: number,
  deltaY: number,
): ViewportTransform {
  return {
    scale: clampViewportScale(transform.scale),
    translateX: finite(transform.translateX, 0) + finite(deltaX, 0),
    translateY: finite(transform.translateY, 0) + finite(deltaY, 0),
  };
}

/**
 * Zoom around a world (untransformed SVG-grid) anchor.  The anchor remains
 * stationary in the viewport, which makes wheel zoom predictable even when
 * the plan is panned.
 */
export function zoomViewport(
  transform: ViewportTransform,
  factor: number,
  anchor: { x: number; y: number },
): ViewportTransform {
  const currentScale = clampViewportScale(transform.scale);
  const requestedScale = clampViewportScale(currentScale * finite(factor, 1));
  const ratio = requestedScale / currentScale;
  const translateX = finite(transform.translateX, 0);
  const translateY = finite(transform.translateY, 0);
  const anchorX = finite(anchor.x, 0);
  const anchorY = finite(anchor.y, 0);
  return {
    scale: requestedScale,
    translateX: anchorX * currentScale + translateX - anchorX * requestedScale,
    translateY: anchorY * currentScale + translateY - anchorY * requestedScale,
  };
}

/**
 * Fit an authoritative plan bounds inside the SVG viewport.
 *
 * `viewport` is measured in CSS pixels while `root` and `content` are grid
 * units.  The root's `preserveAspectRatio="xMidYMid meet"` means its base
 * pixels-per-grid-unit is the smaller dimension ratio; the returned group
 * scale is relative to that base.  When no DOM size is available, the
 * identity transform is a stable, useful fallback for the first render.
 */
export function fitViewport(
  content: GridRect,
  root: GridRect,
  viewport: ViewportPixelSize,
  paddingPx = 28,
): ViewportTransform {
  const widthPx = finite(viewport.width, 0);
  const heightPx = finite(viewport.height, 0);
  if (content.width <= 0 || content.depth <= 0 || root.width <= 0 || root.depth <= 0 || widthPx <= 0 || heightPx <= 0) {
    return { ...DEFAULT_VIEWPORT_TRANSFORM };
  }

  const basePixelsPerUnit = Math.min(widthPx / root.width, heightPx / root.depth);
  if (!Number.isFinite(basePixelsPerUnit) || basePixelsPerUnit <= 0) {
    return { ...DEFAULT_VIEWPORT_TRANSFORM };
  }
  const safePadding = Math.max(0, finite(paddingPx, 28));
  const availableWidthPx = Math.max(1, widthPx - safePadding * 2);
  const availableHeightPx = Math.max(1, heightPx - safePadding * 2);
  const targetPixelsPerUnit = Math.min(
    availableWidthPx / content.width,
    availableHeightPx / content.depth,
  );
  const scale = clampViewportScale(targetPixelsPerUnit / basePixelsPerUnit);
  const rootCentreX = root.x + root.width / 2;
  const rootCentreY = root.y + root.depth / 2;
  const contentCentreX = content.x + content.width / 2;
  const contentCentreY = content.y + content.depth / 2;
  return {
    scale,
    translateX: rootCentreX - contentCentreX * scale,
    translateY: rootCentreY - contentCentreY * scale,
  };
}

/** Convert an SVG pointer location to root viewBox units. */
export function pointerToViewBox(
  clientX: number,
  clientY: number,
  elementRect: { left: number; top: number; width: number; height: number },
  root: GridRect,
): { x: number; y: number } {
  const width = finite(elementRect.width, 0);
  const height = finite(elementRect.height, 0);
  if (width <= 0 || height <= 0 || root.width <= 0 || root.depth <= 0) {
    return { x: root.x + root.width / 2, y: root.y + root.depth / 2 };
  }
  const basePixelsPerUnit = Math.min(width / root.width, height / root.depth);
  const renderedWidth = root.width * basePixelsPerUnit;
  const renderedHeight = root.depth * basePixelsPerUnit;
  const insetX = (width - renderedWidth) / 2;
  const insetY = (height - renderedHeight) / 2;
  return {
    x: root.x + (finite(clientX, elementRect.left) - elementRect.left - insetX) / basePixelsPerUnit,
    y: root.y + (finite(clientY, elementRect.top) - elementRect.top - insetY) / basePixelsPerUnit,
  };
}
