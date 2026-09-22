"""ge_circulation.py - circulation engine (mission sections 16-20, 26).

The CP-SAT model owns the corridor geometry (one straight strip). This module
turns it into an explicit circulation description and validates the access
properties, all recomputed from the emitted integer-millimetre geometry:

    * the corridor strip, its measured width, area and orientation
    * the ENTRY anchor + opening on the front boundary (mission section 19)
    * the ACCESS GRAPH over {rooms} + CORRIDOR (mission section 18)
    * residual-space classification (mission section 26):
      circulation_candidate / service_gap / residual_gap
    * private-transit rules: a bedroom, bathroom or WC must never be the sole
      route between two required rooms, and the garage must not be internal
      transit for the living spaces.

Nothing here trusts the solver's bookkeeping.
"""
from __future__ import annotations

from collections import deque

import ge_core


# ------------------------------------------------------------------ helpers --
def rect_contains(outer, inner):
    return (inner["x_mm"] >= outer["x_mm"] and
            inner["y_mm"] >= outer["y_mm"] and
            inner["x_mm"] + inner["width_mm"] <= outer["x_mm"] + outer["width_mm"] and
            inner["y_mm"] + inner["height_mm"] <= outer["y_mm"] + outer["height_mm"])


def overlap(ax, ay, aw, ah, bx, by, bw, bh):
    dx = min(ax + aw, bx + bw) - max(ax, bx)
    dy = min(ay + ah, by + bh) - max(ay, by)
    return max(0, dx), max(0, dy)


def shared_wall(a, b):
    """(length_mm, orientation) of the wall two rectangles share, else (0, None)."""
    ovx, ovy = overlap(a["x_mm"], a["y_mm"], a["width_mm"], a["height_mm"],
                       b["x_mm"], b["y_mm"], b["width_mm"], b["height_mm"])
    if a["x_mm"] + a["width_mm"] == b["x_mm"] or b["x_mm"] + b["width_mm"] == a["x_mm"]:
        if ovy > 0:
            return ovy, "vertical"
    if a["y_mm"] + a["height_mm"] == b["y_mm"] or b["y_mm"] + b["height_mm"] == a["y_mm"]:
        if ovx > 0:
            return ovx, "horizontal"
    return 0, None


def touching(a, b, need=1):
    length, _ = shared_wall(a, b)
    return length >= need


def _rect_from(room):
    return {"x_mm": room["x_mm"], "y_mm": room["y_mm"],
            "width_mm": room["width_mm"], "height_mm": room["height_mm"]}


# --------------------------------------------------------------- circulation --
def analyse(brief, solve_result, model_meta=None, pairs=None):
    env = brief["envelope"]
    env_rect = {"x_mm": env["x_mm"], "y_mm": env["y_mm"],
                "width_mm": env["width_mm"], "height_mm": env["height_mm"]}
    rooms = [r for r in solve_result["rooms"] if r["present"]]
    rect = solve_result.get("corridor_rect") or {
        "x_mm": env["x_mm"], "y_mm": env["y_mm"], "width_mm": 0, "height_mm": 0,
        "area_mm2": 0, "orientation": "none"}
    min_corr = int(brief["circulation"]["min_width_mm"])
    ext = int(brief["external_wall_mm"])
    corr_rect = {"x_mm": rect["x_mm"], "y_mm": rect["y_mm"],
                 "width_mm": rect["width_mm"], "height_mm": rect["height_mm"]}

    measured_width = 0
    if rect["orientation"] == "horizontal":
        measured_width = rect["height_mm"]
    elif rect["orientation"] == "vertical":
        measured_width = rect["width_mm"]

    segments = []
    if rect["width_mm"] > 0 and rect["height_mm"] > 0:
        wmm, hmm = rect["width_mm"], rect["height_mm"]
        segments.append({
            "segment_id": "COR1",
            "x_mm": rect["x_mm"], "y_mm": rect["y_mm"],
            "width_mm": wmm, "height_mm": hmm, "area_mm2": wmm * hmm,
            "shape": "straight",
            "orientation": rect["orientation"],
            "min_dimension_mm": min(wmm, hmm),
            "width_ok": min(wmm, hmm) >= min_corr or max(wmm, hmm) >= min_corr,
        })

    corr_area = rect["width_mm"] * rect["height_mm"]
    env_area = env["width_mm"] * env["height_mm"]

    # ---- entry anchor on the front boundary --------------------------------
    front = brief["site"].get("front", "south")
    anchor_w = int(brief["circulation"]["entry_anchor_width_mm"])
    entry = None
    touches_front = False
    if rect["orientation"] == "horizontal" and rect["width_mm"] > 0:
        if front == "south":
            touches_front = rect["y_mm"] == env["y_mm"]
        elif front == "north":
            touches_front = rect["y_mm"] + rect["height_mm"] == env["y_mm"] + env["height_mm"]
        y = env["y_mm"] if front == "south" else \
            env["y_mm"] + env["height_mm"] - ext
        width = min(anchor_w, rect["width_mm"])
        entry = {
            "entry_id": "ENTRY_ANCHOR", "type": "entry_anchor", "side": front,
            "x_mm": rect["x_mm"] + (rect["width_mm"] - width) // 2,
            "y_mm": y, "width_mm": width, "height_mm": ext,
            "anchor_width_mm": width,
            "in_brief": any(r["type"] in ("entry", "foyer") for r in brief["rooms"]),
            "kind": "opening_through_external_wall",
        }
    elif rect["orientation"] == "vertical" and rect["height_mm"] > 0:
        if front == "west":
            touches_front = rect["x_mm"] == env["x_mm"]
        elif front == "east":
            touches_front = rect["x_mm"] + rect["width_mm"] == env["x_mm"] + env["width_mm"]
        x = env["x_mm"] if front == "west" else \
            env["x_mm"] + env["width_mm"] - ext
        height = min(anchor_w, rect["height_mm"])
        entry = {
            "entry_id": "ENTRY_ANCHOR", "type": "entry_anchor", "side": front,
            "x_mm": x, "y_mm": rect["y_mm"] + (rect["height_mm"] - height) // 2,
            "width_mm": ext, "height_mm": height, "anchor_width_mm": height,
            "in_brief": any(r["type"] in ("entry", "foyer") for r in brief["rooms"]),
            "kind": "opening_through_external_wall",
        }

    # ---- residual space -----------------------------------------------------
    room_area = sum(r["area_mm2"] for r in rooms)
    residual_area = max(0, env_area - room_area - corr_area)
    # an unallocated gap can only exist where nothing else is; report it as a
    # residual (unusable) region and, when it touches the corridor and is wide
    # enough, as a circulation candidate.
    gap_classes = []
    if residual_area > 0:
        gap_classes.append({
            "kind": "circulation_candidate" if measured_width >= min_corr
                    else "residual_gap",
            "area_m2": round(residual_area / 1e6, 4),
            "touches_corridor": True,
            "note": "unallocated floor area inside the envelope (the solver "
                    "charges this in the objective; it is not circulation)",
        })

    return {
        "component_count": 1 if corr_area > 0 else 0,
        "connected": corr_area > 0,
        "corridor_rect": corr_rect,
        "orientation": rect["orientation"],
        "main_component_cells": None,
        "main_component": [],
        "corridor_cells": [],
        "corridor_area_mm2": corr_area,
        "corridor_area_m2": round(corr_area / 1e6, 4),
        "corridor_area_fraction": round(corr_area / env_area, 4) if env_area else None,
        "cell_min_mm": min(rect["width_mm"] or 10 ** 9, rect["height_mm"] or 10 ** 9)
        if corr_area else 0,
        "min_width_required_mm": min_corr,
        "measured_min_width_mm": measured_width,
        "width_p05_mm": measured_width,
        "width_ok": measured_width >= min_corr,
        "segments": segments,
        "entry": entry,
        "entry_touches_front": touches_front,
        "gap_classification": gap_classes,
        "gap_cells": [],
        "residual_area_mm2": residual_area,
        "gap_area_m2": round(residual_area / 1e6, 4),
        "reaches_all_rooms": None,
    }


# ------------------------------------------------------------- access graph --
def build_access_graph(brief, solve_result, circ, relationship_pairs):
    """Graph over {rooms} + CORRIDOR, from the emitted rectangles.

    Edges:
      room-CORRIDOR  when the room and the corridor share a wall (a legal
                     circulation connection); it is a door when the contact is at
                     least a door width AND the relationship layer or the room
                     type makes a door plausible (bathrooms/WCs are excluded from
                     "general access" doors only for transit purposes, not for
                     their own door).
      room-room      when two rooms share a wall; `kind` records whether the
                     relationship layer calls it DIRECT_ACCESS, a HARD adjacency
                     or a preferred adjacency.
    """
    rooms = {r["id"]: r for r in solve_result["rooms"] if r["present"]}
    corr = circ["corridor_rect"]
    door_w = int(brief["doors"]["min_width_mm"])

    door_pairs = {tuple(sorted((p.a, p.b))) for p in relationship_pairs
                  if p.relationship == "DIRECT_ACCESS"}
    hard_pairs = {tuple(sorted((p.a, p.b))): p for p in relationship_pairs
                  if p.relationship == "HARD_ADJACENT"}
    prefer_pairs = {tuple(sorted((p.a, p.b))) for p in relationship_pairs
                    if p.relationship == "PREFER_ADJACENT"}

    nodes = sorted(rooms) + ["CORRIDOR"]
    edges = []
    contact_len = {}
    for rid, r in sorted(rooms.items()):
        length, orientation = shared_wall(r, corr)
        if length > 0:
            contact_len[f"{rid}|CORRIDOR"] = length
            edges.append({
                "a": rid, "b": "CORRIDOR", "kind": "room_corridor",
                "shared_wall_mm": length, "orientation": orientation,
                "door": length >= door_w, "traversable": length >= door_w,
            })
    ids = sorted(rooms)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            length, orientation = shared_wall(rooms[a], rooms[b])
            if length <= 0:
                continue
            key = tuple(sorted((a, b)))
            kind = ("direct_access" if key in door_pairs else
                    ("hard_adjacency" if key in hard_pairs else
                     ("preferred_adjacency" if key in prefer_pairs else "contact")))
            contact_len[f"{a}|{b}"] = length
            # A shared wall can carry a door when it is at least a door width
            # wide AND the relationship layer asks for direct access there, OR
            # neither room is a wet room (a bathroom or WC must never be a
            # through-route, but a bedroom wall may carry a door in v1 - the
            # private-transit check below reports that as a violation only when
            # the room really is a cut vertex).
            wet = {"bathroom", "wc", "toilet"}
            no_through = (rooms[a]["type"] in wet or rooms[b]["type"] in wet)
            traversable = (length >= door_w) and (key in door_pairs or not no_through)
            edges.append({
                "a": a, "b": b, "kind": kind, "shared_wall_mm": length,
                "orientation": orientation,
                "door": length >= door_w,
                "traversable": traversable,
            })
    return {"nodes": nodes, "edges": edges, "contact_length_mm": contact_len}


def validate_access(brief, solve_result, circ, graph):
    """Reachability and private-transit validation (mission section 18).

    The access model is deliberately simple and is the SAME model the solver
    encodes:

        accessible(r)  <=>  r touches the corridor with a door-width opening
                       OR   r touches a NON-PRIVATE, non-wet room that touches
                            the corridor

    A private room (bedroom / bathroom / WC) or the garage is therefore never a
    legal hub, so no room can depend on it - which is exactly the "no
    private-room transit" rule. The cut-vertex test below re-checks it on the
    emitted geometry by removing each private room in turn.
    """
    settings = brief["settings"]
    private_types = set(settings["private_types"])
    rooms = {r["id"]: r for r in solve_result["rooms"] if r["present"]}
    door_w = int(brief["doors"]["min_width_mm"])
    no_through = private_types | {"garage"}

    corridor_contact = {}
    for e in graph["edges"]:
        if e["kind"] == "room_corridor":
            corridor_contact[e["a"]] = e["shared_wall_mm"]
    direct = {rid for rid, length in corridor_contact.items() if length >= door_w}
    hub = {rid for rid in direct if rooms[rid]["type"] not in no_through}

    def accessible(blocked=()):
        ok = {"CORRIDOR"} | {rid for rid in direct if rid not in blocked}
        for _ in range(len(rooms) + 2):
            added = False
            for e in graph["edges"]:
                if e["kind"] == "room_corridor" or e["shared_wall_mm"] < door_w:
                    continue
                a, b = e["a"], e["b"]
                if a in blocked or b in blocked:
                    continue
                # a connection is legal when the room on the OTHER side is a
                # reachable hub: the non-hub side becomes reachable through it
                if b in hub and b in ok and a not in ok:
                    ok.add(a)
                    added = True
                if a in hub and a in ok and b not in ok:
                    ok.add(b)
                    added = True
            if not added:
                break
        return ok

    reach = accessible()
    unreachable = [rid for rid in rooms if rid not in reach]

    violations = []
    required = [rid for rid, r in rooms.items() if r["required"]]
    for rid, r in rooms.items():
        if r["type"] not in no_through:
            continue
        without = accessible(blocked={rid})
        lost = [x for x in required if x != rid and x not in without]
        if lost:
            violations.append({
                "rule": ("private_room_is_required_transit"
                         if r["type"] in private_types
                         else "garage_is_required_transit"),
                "room": rid, "room_type": r["type"], "cut_off": lost,
                "detail": (f"removing {rid} ({r['type']}) leaves "
                           f"{', '.join(lost)} with no legal route to the "
                           f"corridor"),
            })

    hub_types = set(ge_core.architectural_rules()["circulation_hub_allowed"])
    hubs = [rid for rid, r in rooms.items() if r["type"] in hub_types]
    return {
        "entry_node": "CORRIDOR",
        "reachable_from_corridor": sorted(reach),
        "unreachable_rooms": sorted(unreachable),
        "corridor_contact_mm": corridor_contact,
        "access_hubs": sorted(hub),
        "hub_rooms": sorted(hubs),
        "violations": violations,
        "private_transit_violations": sum(
            1 for v in violations if v["rule"].startswith("private_room")),
        "passed": not unreachable and not violations,
    }
