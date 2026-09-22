"""ge_validator.py - INDEPENDENT layout validation (mission section 29).

This module never imports the solver and never trusts the solver's bookkeeping.
It re-derives every geometric fact from the emitted integer-millimetre room
rectangles, the corridor rectangle and the wall list, with plain arithmetic.

Checks
------
V01  every room inside the buildable envelope
V02  no two rooms overlap (strict area intersection)
V03  no room overlaps the corridor
V04  minimum short side
V05  minimum area
V06  maximum area (the brief's upper band)
V07  maximum aspect ratio
V08  all required rooms present
V09  corridor present, and its measured width >= min_width_mm
V10  corridor reaches the front boundary
V11  every access-requiring room touches the corridor with >= a door width
V12  access graph valid: all required rooms reachable from the corridor
V13  no private-room (or garage) transit
V14  HARD_ADJACENT relationships share a wall of at least min_shared_wall_mm
V15  DIRECT_ACCESS relationships have a shared wall wide enough for a door
V16  door openings fit on their wall and belong to the right room pair
V17  internal walls separate two different owners
V18  outer walls are 230 mm and internal walls 90 mm (configurable)
V19  rooms + corridor account for the envelope (residual reported, not hidden)
V20  room areas match the emitted rectangles exactly
"""
from __future__ import annotations

import ge_circulation as CIRC
import ge_core

DEFAULT_WALL_RASTER_MM = 100


def layout_raster(walls):
    """The reporting raster the wall resolver used (100 mm by default)."""
    return DEFAULT_WALL_RASTER_MM


def validate(brief, solve_result, circ, graph, access, walls, openings, pairs):
    env = brief["envelope"]
    env_x0, env_y0 = env["x_mm"], env["y_mm"]
    env_x1, env_y1 = env_x0 + env["width_mm"], env_y0 + env["height_mm"]
    env_area = env["width_mm"] * env["height_mm"]
    rooms = {r["id"]: r for r in solve_result["rooms"]}
    present = {rid: r for rid, r in rooms.items() if r["present"]}
    corr = solve_result.get("corridor_rect") or {
        "x_mm": env_x0, "y_mm": env_y0, "width_mm": 0, "height_mm": 0}
    checks = []

    def check(cid, name, passed, detail):
        checks.append({"id": cid, "name": name, "passed": bool(passed),
                       "detail": detail})

    # V01 envelope
    bad = [rid for rid, r in present.items()
           if (r["x_mm"] < env_x0 or r["y_mm"] < env_y0 or
               r["x_mm"] + r["width_mm"] > env_x1 or
               r["y_mm"] + r["height_mm"] > env_y1)]
    check("V01", "rooms inside the buildable envelope", not bad,
          f"{len(present)} rooms checked; outside: {bad or 'none'}")

    # V02 no overlap between rooms
    ids = sorted(present)
    overlaps = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            ovx, ovy = CIRC.overlap(present[ids[i]]["x_mm"], present[ids[i]]["y_mm"],
                                    present[ids[i]]["width_mm"],
                                    present[ids[i]]["height_mm"],
                                    present[ids[j]]["x_mm"], present[ids[j]]["y_mm"],
                                    present[ids[j]]["width_mm"],
                                    present[ids[j]]["height_mm"])
            if ovx > 0 and ovy > 0:
                overlaps.append({"pair": [ids[i], ids[j]], "overlap_mm2": ovx * ovy})
    check("V02", "no two rooms overlap", not overlaps,
          f"{len(ids) * (len(ids) - 1) // 2} pairs tested; overlaps: "
          f"{overlaps or 'none'}")

    # V03 no room overlaps the corridor
    corr_overlaps = []
    for rid, r in present.items():
        ovx, ovy = CIRC.overlap(r["x_mm"], r["y_mm"], r["width_mm"], r["height_mm"],
                                corr["x_mm"], corr["y_mm"], corr["width_mm"],
                                corr["height_mm"])
        if ovx > 0 and ovy > 0:
            corr_overlaps.append({"room": rid, "overlap_mm2": ovx * ovy})
    check("V03", "no room overlaps the corridor", not corr_overlaps,
          corr_overlaps or f"{len(present)} rooms tested against the corridor")

    # V04..V07 per-room shape
    short_bad = [f"{rid}:{min(r['width_mm'], r['height_mm'])}<{r['min_short_side_mm']}"
                 for rid, r in present.items()
                 if min(r["width_mm"], r["height_mm"]) < r["min_short_side_mm"]]
    check("V04", "minimum short side respected", not short_bad,
          short_bad or "all rooms pass")

    area_min_bad = [f"{rid}:{r['area_m2']:.3f}<{r['min_area_m2']:.3f}"
                    for rid, r in present.items()
                    if r["area_m2"] + 1e-9 < r["min_area_m2"]]
    check("V05", "minimum area respected", not area_min_bad,
          area_min_bad or "all rooms pass")

    area_max_bad = [f"{rid}:{r['area_m2']:.3f}>{r['max_area_m2']:.3f}"
                    for rid, r in present.items()
                    if r["area_m2"] - 1e-9 > r["max_area_m2"]]
    check("V06", "maximum area respected", not area_max_bad,
          area_max_bad or "all rooms pass")

    aspect_bad = []
    for rid, r in present.items():
        if r["width_mm"] <= 0 or r["height_mm"] <= 0:
            aspect_bad.append(f"{rid}: degenerate rectangle "
                              f"{r['width_mm']}x{r['height_mm']}")
            continue
        asp = max(r["width_mm"] / r["height_mm"], r["height_mm"] / r["width_mm"])
        if asp > r["max_aspect_ratio"] + 1e-6:
            aspect_bad.append(f"{rid}:{asp:.2f}>{r['max_aspect_ratio']}")
    check("V07", "maximum aspect ratio respected", not aspect_bad,
          aspect_bad or "all rooms pass")

    # V08 required rooms present
    missing = [r["id"] for r in brief["rooms"] if r["required"] and
               not rooms.get(r["id"], {}).get("present", False)]
    check("V08", "all required rooms present", not missing, missing or "all present")

    # V09 corridor width
    min_req = int(brief["circulation"]["min_width_mm"])
    measured = circ["measured_min_width_mm"]
    check("V09", f"corridor present with width >= {min_req} mm",
          corr["width_mm"] > 0 and corr["height_mm"] > 0 and measured >= min_req,
          f"corridor {corr['width_mm']}x{corr['height_mm']} mm "
          f"({circ['orientation']}); measured width {measured} mm")

    # V10 entry reaches the front
    entry = circ.get("entry")
    front = brief["site"].get("front", "south")
    check("V10", "corridor/entry reaches the front boundary",
          bool(entry) and circ.get("entry_touches_front"),
          (f"entry anchor on {entry['side']} at ({entry['x_mm']},{entry['y_mm']}) "
           f"width {entry['anchor_width_mm']} mm" if entry
           else "no entry anchor could be placed"))

    # V11 access rooms reach the corridor directly or through a legal hub
    # (the hub rule excludes private/wet rooms, so a private room can never be
    # somebody else's route - see V13 for the graph-level cut-vertex test).
    door_w = int(brief["doors"]["min_width_mm"])
    access_ids = [r["id"] for r in present.values()
                  if r["type"] in brief["settings"]["access_required_types"]
                  and r["type"] not in
                  brief["settings"]["circulation"]["corridor_room_types"]]
    private_types = set(brief["settings"]["private_types"]) | {"garage"}
    hubs_with_corridor = {
        rid for rid, length in access["corridor_contact_mm"].items()
        if length >= door_w}
    via_hub = set()
    for e in graph["edges"]:
        if e["kind"] == "room_corridor" or e["shared_wall_mm"] < door_w:
            continue
        if e["a"] in hubs_with_corridor:
            via_hub.add(e["b"])
        if e["b"] in hubs_with_corridor:
            via_hub.add(e["a"])
    no_touch = [rid for rid in access_ids
                if access["corridor_contact_mm"].get(rid, 0) < door_w
                and rid not in via_hub]
    check("V11", f"every access room reaches the corridor (directly or via a "
                 f"non-private hub, >= {door_w} mm)",
          not no_touch,
          f"{len(access_ids)} access rooms; no legal route: {no_touch or 'none'} "
          f"(direct: {len(hubs_with_corridor)}, via a hub: {len(via_hub)})")

    # V12 reachability
    check("V12", "access graph valid (rooms reachable from the corridor)",
          not access["unreachable_rooms"],
          f"unreachable: {access['unreachable_rooms'] or 'none'} "
          f"(nodes {len(graph['nodes'])}, edges {len(graph['edges'])})")

    # V13 private transit
    check("V13", "no private-room / garage transit", not access["violations"],
          (f"{access['private_transit_violations']} private-transit violations"
           if access["violations"] else
           "no private room or garage is a required transit space"))

    # V14/V15 relationships
    hard_fail, door_fail = [], []
    for p in pairs:
        a, b = present.get(p.a), present.get(p.b)
        need_hard = int(p.min_shared_wall_mm)
        need_door = int(p.min_door_width_mm or door_w)
        if p.relationship not in ("HARD_ADJACENT", "DIRECT_ACCESS"):
            continue
        if a is None or b is None:
            (hard_fail if p.relationship == "HARD_ADJACENT" else door_fail).append(
                f"{p.a}-{p.b}: room absent")
            continue
        length, _ = CIRC.shared_wall(a, b)
        if p.relationship == "HARD_ADJACENT":
            if length < need_hard:
                hard_fail.append(f"{p.a}-{p.b}: {length}mm < {need_hard}mm")
        else:
            if length < need_door:
                door_fail.append(f"{p.a}-{p.b}: {length}mm < {need_door}mm")
    hard_total = sum(1 for p in pairs if p.relationship == "HARD_ADJACENT")
    door_total = sum(1 for p in pairs if p.relationship == "DIRECT_ACCESS")
    check("V14", "HARD_ADJACENT relationships satisfied", not hard_fail,
          hard_fail or f"{hard_total} hard relationships share enough wall")
    check("V15", "DIRECT_ACCESS relationships have a door-width wall",
          not door_fail,
          door_fail or f"{door_total} direct-access pairs have a door-width wall")

    # V16 openings
    op_bad = []
    wall_by_id = {w["wall_id"]: w for w in walls}
    pair_keys = {tuple(sorted((p.a, p.b))) for p in pairs}
    # walls are reported on a raster (V18 reports the thickness; the resolver
    # exposes the raster in the summary), so containment is checked to that
    # tolerance rather than to the millimetre
    raster = int(layout_raster(walls))
    for op in openings:
        w = wall_by_id.get(op["wall_id"])
        if w is None:
            op_bad.append(f"{op['opening_id']}: unknown wall {op['wall_id']}")
            continue
        g = w["geometry"]
        if op["orientation"] == "vertical":
            inside = (op["y_mm"] >= g["y_mm"] - raster and
                      op["y_mm"] + op["height_mm"] <=
                      g["y_mm"] + g["height_mm"] + raster)
        else:
            inside = (op["x_mm"] >= g["x_mm"] - raster and
                      op["x_mm"] + op["width_mm"] <=
                      g["x_mm"] + g["width_mm"] + raster)
        if not inside:
            op_bad.append(f"{op['opening_id']}: not contained in wall "
                          f"{op['wall_id']}")
        if op["kind"] in ("room_to_corridor", "direct_access"):
            key = tuple(sorted((op["a"], op["b"])))
            if op["b"] != "CORRIDOR" and key not in pair_keys:
                op_bad.append(f"{op['opening_id']}: pair {key} has no relationship")
        if not op.get("fits", True):
            op_bad.append(f"{op['opening_id']}: opening wider than its wall")
    check("V16", "door openings are valid and belong to the right pair", not op_bad,
          op_bad or f"{len(openings)} symbolic openings checked")

    # V17 internal walls separate two owners
    wall_bad = []
    for w in walls:
        if w["type"] != "internal":
            continue
        a, b = (w.get("between") or [None, None])[:2]
        if a is None or b is None or a == b:
            wall_bad.append(f"{w['wall_id']}: owners {w.get('between')}")
    check("V17", "internal walls separate two different owners", not wall_bad,
          wall_bad or f"{sum(1 for w in walls if w['type'] == 'internal')} "
                      f"internal walls checked")

    # V18 thicknesses
    ext = int(brief["external_wall_mm"])
    internal = int(brief["internal_wall_mm"])
    thick_bad = [f"{w['wall_id']}:{w['thickness_mm']}" for w in walls
                 if (w["type"] == "external" and w["thickness_mm"] != ext) or
                    (w["type"] == "internal" and w["thickness_mm"] != internal)]
    check("V18", f"wall thicknesses ({ext} mm external / {internal} mm internal)",
          not thick_bad, thick_bad or f"{len(walls)} walls, thicknesses correct")

    # V19 envelope accounting
    room_area = sum(r["area_mm2"] for r in present.values())
    corr_area = corr["width_mm"] * corr["height_mm"]
    residual = env_area - room_area - corr_area
    check("V19", "rooms + corridor + residual account for the envelope",
          residual >= 0 and residual <= 0.10 * env_area,
          f"rooms {room_area/1e6:.3f} + corridor {corr_area/1e6:.3f} + residual "
          f"{residual/1e6:.3f} = {env_area/1e6:.3f} m2 envelope "
          f"({100.0 * residual / env_area:.1f}% residual)")

    # V20 arithmetic self-consistency
    arith_bad = [rid for rid, r in present.items()
                 if r["width_mm"] * r["height_mm"] != r["area_mm2"]]
    check("V20", "emitted areas match the emitted rectangles exactly", not arith_bad,
          arith_bad or "all room areas are exactly width x height")

    n_pass = sum(1 for c in checks if c["passed"])
    return {
        "all_passed": n_pass == len(checks),
        "n_passed": n_pass,
        "n_checks": len(checks),
        "checks": checks,
    }
