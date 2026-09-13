# Coordinate and Geometry System

## Canonical coordinates

Use a north-west (top-left) origin with integer axes matching SVG:

- `x` increases east/right;
- `y` increases south/down;
- north is the top edge, south/front is the bottom edge;
- rectangle coordinates are half-open: `[x, x + width) × [y, y + depth)`.

Matching SVG avoids repeated Y inversion, reduces rendering mistakes, and makes cardinal direction explicit. Architectural orientation is semantic metadata, not inferred from axis labels.

## Units

Persist committed dimensions as integer millimetres, display them in metres, and normalize solver geometry to integer grid units. For V1:

```text
GRID_MM = 250
1 grid unit = 250 mm = 0.25 m
areaM2 = widthUnits × depthUnits × 0.0625
```

Do not use floating-point metres for collision or boundary decisions. Convert decimal input to integer millimetres. Derive the exact millimetre envelope, then snap its minimum edges inward with `ceil` and maximum edges inward with `floor` to form the feasible solver-grid envelope. Room minimum lengths round upward. Report discretization loss; never expand beyond the authored envelope.

The 250 mm quantum is appropriate for conceptual residential layouts: it captures common half- and quarter-metre planning changes while keeping a 20 m × 30 m site at 80 × 120 units. It is too coarse for construction documentation and door-clearance claims, which are outside scope. Do not make it configurable in V1. A future finer grid can be a schema/solver version, not a casual preference toggle.

Rectangles, interval arithmetic, and adjacency calculations should operate analytically on integer edges. Do not scan every grid cell except for small occupancy/connectivity masks where it materially simplifies a bounded operation.

## Core primitives

- `GridPoint { x, y }`
- `GridSize { width, depth }`, both positive integers
- `GridRect { x, y, width, depth }`
- `GridInterval { start, end }`, half-open
- `CardinalSide = north | east | south | west`
- `EdgeSegment { side, fixed, interval }`

Required geometry operations include intersection area, containment, edge intervals, shared-wall segments, centre as rational/integer pair, Manhattan/Euclidean squared distance, union area for circulation rectangles, and exposed footprint edge.

## Site and envelope

The exact site rectangle is always `{ x: 0, y: 0, width: siteWidthMm, depth: siteDepthMm }` in authored space. The same formula applies in grid units after conservative snapping.

```text
envelope.x      = westOffset
envelope.y      = northOffset
envelope.width  = siteWidth - westOffset - eastOffset
envelope.depth  = siteDepth - northOffset - southOffset
```

For the canonical fixture:

```text
site     = (0, 0, 80, 120)
envelope = (6, 8, 68, 88)
```

That is 17 m × 22 m = 374 m². The footprint must be contained in the envelope. Offsets retain their source in the brief, but source does not change geometry.

## Overlap and adjacency

Two half-open rectangles overlap only when their intersection has positive area. Edge or corner contact is not overlap.

Two spaces are geometrically adjacent when they lie on opposite sides of the same axis and their projected intervals overlap by a positive length. Corner contact yields zero. A relationship counts as **meaningful shared-wall adjacency** only if:

```text
sharedWallLength >= max(rule threshold, global minimum)
```

Recommended initial global threshold is 1.0 m (4 units), subject to architect approval. A traversable pedestrian portal additionally needs an approved portal width and end-clearance policy; shared wall alone does not create graph access.

Distance is separate from adjacency. Use boundary-to-boundary Manhattan distance for `preferNear` because it is stable and interpretable on orthogonal plans; report centre distance only as a secondary diagnostic.

## Exterior-wall contact

Exterior contact is the length of a room edge coincident with the actual building footprint boundary, excluding intervals obscured by another enclosed space. With the recommended rectangular V1 footprint this is an interval intersection against its four edges. A corner touch is zero.

Score exterior opportunity by useful length, capped by room-type target, rather than a boolean. It indicates possible façade access only—not a window, daylight, ventilation, or view.

## Footprint and wasted space

Recommended V1 footprint: one grid-aligned rectangle inside the envelope. Every placed enclosed space is inside it. Spaces may not overlap. Any uncovered footprint area is `unallocatedInteriorArea` and is penalized; the prototype should set an approved maximum percentage rather than pretending a fully tiled slicing layout has no waste by definition.

The actual footprint must never be inferred as the bounding box of scattered rooms after generation. It is an explicit solver decision.

## Precision and rendering

SVG uses a viewBox based on grid units. Scaling to pixels is a view transform only. Labels and dimensions convert units back to metres with at most two decimals. Geometry remains unchanged by zoom, device pixel ratio, or formatting.
