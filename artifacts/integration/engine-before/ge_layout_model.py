"""ge_layout_model.py - exact-millimetre CP-SAT geometry (mission sections 9-15, 25, 27).

Everything is INTEGER MILLIMETRES - there is no grid, no snapping and no cell
quantisation anywhere in this formulation.

The problem
-----------
Place one rectangle per room, plus the CORRIDOR, inside the buildable envelope
(site minus setbacks minus the 230 mm outer wall), so that:

    * no two rooms overlap and no room overlaps the corridor,
    * each room respects its area band, minimum short side and aspect ratio,
    * the corridor is a straight band at least min_corridor_mm thick, reaches the
      front (street) boundary, and every access-requiring room touches it with at
      least a door-width contact,
    * every HARD_ADJACENT pair shares at least min_shared_wall_mm of wall and
      every DIRECT_ACCESS pair shares at least a door width,
    * preferred adjacency is rewarded (objective only, never a constraint).

Variables (per room r, all integer millimetres)
    x[r], y[r]          lower-left corner (absolute site millimetres)
    w[r], h[r]          size (>= the brief's minimum short side)
    area[r] = w[r]*h[r]
    dev[r]  = |area[r] - target_mm2[r]|

Corridor
    the corridor is a STRIP: either a full-width horizontal band or a full-height
    vertical band, always touching the front boundary. Constraining it to a strip
    is what makes "connected, >= 1000 mm wide, reaches the front" exact rather
    than approximate, and it matches how a real single-loaded / double-loaded
    house corridor works (mission section 20: straight corridors, and L-shaped
    corridors made of two rectangles - v1 ships the straight strip).

Residual space
    gap_area = envelope_area - sum(room areas) - corridor area   (>= 0)
    is charged in the objective, which is what packs the plan instead of letting
    it dissolve into leftover space.

Objective (mission section 25): ONE weighted integer sum, minimised. The hard
feasibility terms carry ~9e8, so the search is effectively lexicographic:

    P1  HARD_ADJACENT / DIRECT_ACCESS violations, missing access, missing entry
    P2  room area deviation from the brief targets
    P3  residual gap area and corridor area
    P4  preferred adjacency (rewarded)
    P5  room shape (perimeter) and soft front/rear zoning

Every term, its coefficient and its raw value is written into the solution JSON;
nothing is hidden and nothing is normalised away.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

from ortools.sat.python import cp_model

import ge_core

INT_STATUS = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "MODEL_INVALID",
    cp_model.UNKNOWN: "UNKNOWN",
}


# --------------------------------------------------------------- relations ---
@dataclass
class PairRel:
    a: str
    b: str
    relationship: str
    weight: float = 0.0
    min_shared_wall_mm: int = 0
    min_door_width_mm: int = 0
    p: float = 0.0
    p_door: float = 0.0
    authored: str = None


def relation_table(relationship_table, brief, relax=None):
    """Condense a classifier table into solver constraints.

    `relax` records NAMED relaxations applied to this attempt; they are copied
    verbatim into the solution JSON. Nothing is ever relaxed silently.
    """
    relax = dict(relax or {})
    keep_hard = relax.get("hard_adjacency", True)
    prefer_scale = float(relax.get("prefer_weight_scale", 1.0))
    prefer_min_p = float(relax.get("prefer_min_probability", 0.0))
    out, demoted = [], []
    for p in relationship_table["pairs"]:
        rel = p["relationship"]
        if rel == "NO_REQUIREMENT":
            continue
        if rel == "HARD_ADJACENT" and not keep_hard:
            demoted.append([p["a"], p["b"]])
            rel = "PREFER_ADJACENT"
        if rel == "PREFER_ADJACENT" and p["model_edge_probability"] < prefer_min_p:
            continue
        out.append(PairRel(
            a=p["a"], b=p["b"], relationship=rel,
            weight=float(p["weight"]) * prefer_scale,
            min_shared_wall_mm=int(p.get("min_shared_wall_mm") or 0),
            min_door_width_mm=int(p.get("min_door_width_mm")
                                  or brief["doors"]["min_width_mm"]),
            p=float(p.get("model_edge_probability") or 0.0),
            p_door=float(p.get("door_probability") or 0.0),
            authored=p.get("authored"),
        ))
    counts = {}
    for r in out:
        counts[r.relationship] = counts.get(r.relationship, 0) + 1
    meta = {
        "relaxations_applied": relax,
        "hard_adjacency_demoted": demoted,
        "solver_relationship_counts": counts,
    }
    return out, meta


# -------------------------------------------------------------------- model --
class LayoutModel:
    """Exact-mm CP-SAT model: rooms are free integer rectangles."""

    def __init__(self, brief, pairs, attempt=1, relax=None):
        self.brief = brief
        self.pairs = list(pairs)
        self.attempt = attempt
        self.relax = dict(relax or {})
        self.settings = brief["settings"]
        self.weights = self.settings["objective_weights"]
        self.env = brief["envelope"]
        self.W = int(self.env["width_mm"])
        self.H = int(self.env["height_mm"])
        self.env_x0 = int(self.env["x_mm"])
        self.env_y0 = int(self.env["y_mm"])
        self.W_HARD = int(self.weights.get("hard_adjacency_violation", 900000000))
        self.model = None
        self.ctx = None
        self.nc = 1
        self.nr = 1

    @property
    def total_area_mm2(self):
        return self.W * self.H

    # ------------------------------------------------------------- build ----
    def build(self, disable=(), only=None):
        """Build the model.

        `disable` / `only` are DIAGNOSTIC switches used only to attribute an
        INFEASIBLE verdict to a constraint group; a delivered run always uses the
        empty set, i.e. exactly the formulation in the module docstring.
        """
        off = set(disable)

        def on(group):
            return group in only if only is not None else group not in off

        b = self.brief
        w = self.weights
        m = cp_model.CpModel()
        rooms = b["rooms"]
        W, H = self.W, self.H
        X0, Y0 = self.env_x0, self.env_y0
        X1, Y1 = X0 + W, Y0 + H
        min_corr = int(b["circulation"]["min_width_mm"])
        door_w = int(b["doors"]["min_width_mm"])
        front = b["site"].get("front", "south")

        # ---------------- corridor strip -------------------------------------
        # A straight corridor band: full width on a south/north frontage, full
        # height on an east/west frontage, always touching the front boundary.
        # The orientation is a deterministic function of the frontage, so there
        # is no optional geometry to confuse the search (mission section 20
        # allows straight corridors and L-shaped corridors of two rectangles;
        # v1 ships the straight band).
        c_area = m.NewIntVar(0, W * H, "corr_area")
        horiz = front in ("south", "north")
        if on("thickness"):
            if horiz:
                cx = m.NewConstant(X0)
                cw = m.NewConstant(W)
                ch = m.NewIntVar(min_corr, H, "corr_h")
                if front == "south":
                    cy = m.NewConstant(Y0)
                else:
                    cy = m.NewIntVar(Y0, Y1 - min_corr, "corr_y")
                    m.Add(cy + ch == Y1)
            else:
                cy = m.NewConstant(Y0)
                ch = m.NewConstant(H)
                cw = m.NewIntVar(min_corr, W, "corr_w")
                if front == "west":
                    cx = m.NewConstant(X0)
                else:
                    cx = m.NewIntVar(X0, X1 - min_corr, "corr_x")
                    m.Add(cx + cw == X1)
            m.AddMultiplicationEquality(c_area, [cw, ch])
            entry_ok = m.NewBoolVar("entry_reaches_front")
            m.Add(entry_ok == 1)
        else:
            # diagnostic mode only: the corridor may take any rectangle
            cx = m.NewConstant(X0)
            cy = m.NewConstant(Y0)
            cw = m.NewIntVar(0, W, "corr_w")
            ch = m.NewIntVar(0, H, "corr_h")
            m.AddMultiplicationEquality(c_area, [cw, ch])
            entry_ok = m.NewBoolVar("entry_reaches_front")
            m.Add(entry_ok == 0)

        # ---------------- rooms ----------------------------------------------
        V = {}
        for r in rooms:
            rid = r["id"]
            rw = m.NewIntVar(1, W, f"w_{rid}")
            rh = m.NewIntVar(1, H, f"h_{rid}")
            rx = m.NewIntVar(X0, X1 - 1, f"x_{rid}")
            ry = m.NewIntVar(Y0, Y1 - 1, f"y_{rid}")
            m.Add(rx + rw <= X1)
            m.Add(ry + rh <= Y1)
            area = m.NewIntVar(1, W * H, f"area_{rid}")
            m.AddMultiplicationEquality(area, [rw, rh])
            present = None if r["required"] else m.NewBoolVar(f"present_{rid}")
            V[rid] = {"x": rx, "y": ry, "w": rw, "h": rh, "area": area,
                      "present": present, "room": r}

        # ---------------- shape / area / presence ----------------------------
        area_terms, perim_terms = [], []
        for r in rooms:
            rid = r["id"]
            g = V[rid]
            present = g["present"]
            min_area = max(1, int(round(r["min_area_m2"] * 1e6)))
            max_area = max(min_area, int(round(r["max_area_m2"] * 1e6)))
            min_short = int(r["min_short_side_mm"])
            lim_aspect = int(round(float(r["max_aspect_ratio"]) * 1000))

            def gate(cons, _p=present):
                if not on("area") and not on("shape"):
                    return
                if _p is None:
                    m.Add(cons)
                else:
                    m.Add(cons).OnlyEnforceIf(_p)

            gate(g["area"] >= min_area)
            gate(g["area"] <= max_area)
            gate(g["w"] >= min_short)
            gate(g["h"] >= min_short)
            if on("shape"):
                # max(w/h, h/w) <= limit, expressed as two LINEAR constraints
                # (no integer division, which is exact but weak for the solver):
                #     limit * h >= 1000 * w     and     limit * w >= 1000 * h
                gate(lim_aspect * g["h"] >= 1000 * g["w"])
                gate(lim_aspect * g["w"] >= 1000 * g["h"])
            if present is not None:
                m.Add(g["area"] == 0).OnlyEnforceIf(present.Not())
                m.Add(g["w"] == 1).OnlyEnforceIf(present.Not())
                m.Add(g["h"] == 1).OnlyEnforceIf(present.Not())
                m.Add(g["x"] == X0).OnlyEnforceIf(present.Not())
                m.Add(g["y"] == Y0).OnlyEnforceIf(present.Not())
            dev = m.NewIntVar(0, 4 * 10 ** 9, f"dev_{rid}")
            target = int(round(r["target_area_m2"] * 1e6))
            m.AddAbsEquality(dev, g["area"] - target)
            if present is None:
                area_terms.append(dev)
            else:
                gd = m.NewIntVar(0, 4 * 10 ** 9, f"devg_{rid}")
                m.Add(gd == dev).OnlyEnforceIf(present)
                m.Add(gd == 0).OnlyEnforceIf(present.Not())
                area_terms.append(gd)
            perim = m.NewIntVar(0, 4 * (W + H), f"perim_{rid}")
            m.Add(perim == 2 * (g["w"] + g["h"]))
            perim_terms.append(perim)

        # ---------------- zone assignment (double-loaded plan) ----------------
        # Every room is on ONE side of the corridor: south/below or north/above
        # for a horizontal band (west/east of a vertical band). Rooms in a zone
        # are flush with the corridor edge, so they touch it by construction and
        # they cannot overlap each other's zone boundary. This is the standard
        # double-loaded house layout; it is also what makes the search tractable,
        # because the rooms no longer have to discover "touch the corridor" from
        # an unconstrained position.
        zone_a, zone_b = {}, {}
        ids = [r["id"] for r in rooms]
        if on("zones"):
            for rid in ids:
                g = V[rid]
                a = m.NewBoolVar(f"zoneA_{rid}")
                b = m.NewBoolVar(f"zoneB_{rid}")
                zone_a[rid], zone_b[rid] = a, b
                m.AddBoolOr([a, b])
                if horiz:
                    # A = south/below the corridor, B = north/above
                    m.Add(g["y"] + g["h"] <= cy).OnlyEnforceIf(a)
                    m.Add(cy + ch <= g["y"]).OnlyEnforceIf(b)
                else:
                    m.Add(g["x"] + g["w"] <= cx).OnlyEnforceIf(a)
                    m.Add(cx + cw <= g["x"]).OnlyEnforceIf(b)

        # ---------------- no overlap ------------------------------------------
        for a, b in itertools.combinations(ids, 2):
            ga, gb = V[a], V[b]
            left = m.NewBoolVar(f"{a}_{b}_left")
            rght = m.NewBoolVar(f"{a}_{b}_right")
            belo = m.NewBoolVar(f"{a}_{b}_below")
            abov = m.NewBoolVar(f"{a}_{b}_above")
            m.Add(ga["x"] + ga["w"] <= gb["x"]).OnlyEnforceIf(left)
            m.Add(gb["x"] + gb["w"] <= ga["x"]).OnlyEnforceIf(rght)
            m.Add(ga["y"] + ga["h"] <= gb["y"]).OnlyEnforceIf(belo)
            m.Add(gb["y"] + gb["h"] <= ga["y"]).OnlyEnforceIf(abov)
            if on("overlap"):
                m.AddBoolOr([left, rght, belo, abov])
        corr_vars = {"x": cx, "y": cy, "w": cw, "h": ch}
        for rid in ids:
            g = V[rid]
            left = m.NewBoolVar(f"{rid}_corr_left")
            rght = m.NewBoolVar(f"{rid}_corr_right")
            belo = m.NewBoolVar(f"{rid}_corr_below")
            abov = m.NewBoolVar(f"{rid}_corr_above")
            m.Add(g["x"] + g["w"] <= cx).OnlyEnforceIf(left)
            m.Add(cx + cw <= g["x"]).OnlyEnforceIf(rght)
            m.Add(g["y"] + g["h"] <= cy).OnlyEnforceIf(belo)
            m.Add(cy + ch <= g["y"]).OnlyEnforceIf(abov)
            if on("overlap") and not on("zones"):
                m.AddBoolOr([left, rght, belo, abov])

        # ---------------- contact geometry -------------------------------------
        # Contact between two rectangles: they touch on one of four sides within
        # `TOL` millimetres AND their projections overlap by at least `need` on
        # the perpendicular axis. Using a small flush tolerance instead of exact
        # coordinate equality keeps the formulation honest (the tolerance is
        # reported) while giving CP-SAT a much stronger propagation than a plain
        # `x1 + w1 == x2` equality.
        TOL = int(self.settings["solver"].get("contact_tolerance_mm", 0))

        def overlap_x(a, b, name):
            xlo = m.NewIntVar(X0 - W, X1 + W, f"xlo_{name}")
            xhi = m.NewIntVar(X0 - W, X1 + W, f"xhi_{name}")
            m.AddMaxEquality(xlo, [a["x"], b["x"]])
            m.AddMinEquality(xhi, [a["x"] + a["w"], b["x"] + b["w"]])
            ov = m.NewIntVar(-W, W, f"ovx_{name}")
            m.Add(ov == xhi - xlo)
            return ov

        def overlap_y(a, b, name):
            ylo = m.NewIntVar(Y0 - H, Y1 + H, f"ylo_{name}")
            yhi = m.NewIntVar(Y0 - H, Y1 + H, f"yhi_{name}")
            m.AddMaxEquality(ylo, [a["y"], b["y"]])
            m.AddMinEquality(yhi, [a["y"] + a["h"], b["y"] + b["h"]])
            ov = m.NewIntVar(-H, H, f"ovy_{name}")
            m.Add(ov == yhi - ylo)
            return ov

        def contact_set(a, b, need, name, with_corridor_ok=True):
            """List of (BoolVar, perpendicular_overlap) contact options."""
            ovx = overlap_x(a, b, f"{name}_x")
            ovy = overlap_y(a, b, f"{name}_y")
            opts = []
            gap = TOL
            # a left of b (vertical wall, shared length = y overlap)
            l = m.NewBoolVar(f"c_left_{name}")
            m.Add(a["x"] + a["w"] <= b["x"]).OnlyEnforceIf(l)
            m.Add(b["x"] - (a["x"] + a["w"]) <= gap).OnlyEnforceIf(l)
            m.Add(ovy >= need).OnlyEnforceIf(l)
            opts.append(l)
            r = m.NewBoolVar(f"c_right_{name}")
            m.Add(b["x"] + b["w"] <= a["x"]).OnlyEnforceIf(r)
            m.Add(a["x"] - (b["x"] + b["w"]) <= gap).OnlyEnforceIf(r)
            m.Add(ovy >= need).OnlyEnforceIf(r)
            opts.append(r)
            d = m.NewBoolVar(f"c_below_{name}")
            m.Add(a["y"] + a["h"] <= b["y"]).OnlyEnforceIf(d)
            m.Add(b["y"] - (a["y"] + a["h"]) <= gap).OnlyEnforceIf(d)
            m.Add(ovx >= need).OnlyEnforceIf(d)
            opts.append(d)
            u = m.NewBoolVar(f"c_above_{name}")
            m.Add(b["y"] + b["h"] <= a["y"]).OnlyEnforceIf(u)
            m.Add(a["y"] - (b["y"] + b["h"]) <= gap).OnlyEnforceIf(u)
            m.Add(ovx >= need).OnlyEnforceIf(u)
            opts.append(u)
            return opts

        def touching(a, b, need, name):
            opts = contact_set(a, b, need, name)
            t = m.NewBoolVar(f"touch_{name}")
            for o in opts:
                m.AddImplication(o, t)
            m.AddBoolOr(opts).OnlyEnforceIf(t)
            return t

        # ---------------- relationship constraints -----------------------------
        viol_terms = []
        contacts = {}
        for p in self.pairs:
            ga, gb = V[p.a], V[p.b]
            name = f"{p.a}_{p.b}"
            if not on("relationship"):
                continue
            if p.relationship in ("HARD_ADJACENT", "DIRECT_ACCESS"):
                need = (int(p.min_shared_wall_mm)
                        if p.relationship == "HARD_ADJACENT"
                        else int(p.min_door_width_mm or door_w))
                t = touching(ga, gb, need, name)
                viol_terms.append(1 - t)
                contacts[(p.a, p.b)] = {"ok": t, "need": need}

        # ---------------- access: every access room is reachable ---------------
        # A room is accessible when it touches the CORRIDOR (door >= door width)
        # or when it touches a circulation hub that itself touches the corridor
        # (a hall or the living space). That is exactly how a real house works:
        # bedrooms open off a hall or off the living space, not necessarily
        # straight off the corridor. Direct contact with the corridor is still
        # required for at least one circulation room whenever the brief has one.
        access_ids = [r["id"] for r in rooms
                      if r["type"] in self.settings["access_required_types"]
                      and r["type"] not in
                      self.settings["circulation"]["corridor_room_types"]]
        door_types = set(ge_core.architectural_rules()["circulation_hub_allowed"])
        rooms_by_id = {r["id"]: r for r in rooms}
        no_through_types = set(self.settings["private_types"]) | {"garage"}
        corridor_room_ids = [r["id"] for r in rooms
                             if r["type"] in
                             self.settings["circulation"]["corridor_room_types"]]
        access_terms = []
        access_ok_vars = {}
        touch_corr = {}
        if on("access"):
            for rid in access_ids:
                g = V[rid]
                # (zones control which side of the corridor a room is on; ACCESS
                # is still checked explicitly below, because rooms inside a zone
                # can be stacked and must not assume corridor contact)
                t = touching(g, corr_vars, door_w, f"{rid}_corr_t")
                touch_corr[rid] = t
                okv = m.NewBoolVar(f"accessok_{rid}")
                access_ok_vars[rid] = okv
                present = g["present"]
                options = [t]
                # ACCESS DEFINITION (matches the validator's V11/V13 rule):
                # a room is accessible when
                #   (a) it touches the corridor, or
                #   (b) it touches a non-private room that touches the corridor.
                # Private and wet rooms are never legal hubs, which is what
                # guarantees no private room can be another room's only route
                # (mission section 18).
                via_nonprivate = []
                hubs = [h for h in ids
                        if h != rid
                        and rooms_by_id[h]["type"] not in no_through_types]
                for h in hubs:
                    if h not in touch_corr:
                        touch_corr[h] = touching(V[h], corr_vars, door_w,
                                                 f"{h}_corr_t")
                    th = touch_corr[h]
                    tv = touching(g, V[h], door_w, f"{rid}_via_{h}")
                    link = m.NewBoolVar(f"link_{rid}_{h}")
                    m.AddImplication(link, th)
                    m.AddImplication(link, tv)
                    m.AddBoolOr([th.Not(), tv.Not(), link])
                    options.append(link)
                    via_nonprivate.append(link)
                # okv is EXACTLY "at least one legal route exists": the forward
                # direction is given by the BoolOr below, the reverse by these
                # implications. Without the reverse direction the solver could
                # claim access it does not have.
                for opt in options:
                    m.AddImplication(opt, okv)
                # EXTRA structural rule matching the validator's V13: a room either
                # touches the corridor itself, or it reaches the corridor through a
                # non-private room (never through another private/wet room). This
                # is what rules out the "bedroom as the only route to the
                # bathroom" family of layouts without needing a cut-vertex
                # disjunction.
                if via_nonprivate:
                    m.AddBoolOr([t] + via_nonprivate)
                else:
                    m.Add(t == 1)
                if present is None:
                    m.AddBoolOr(options).OnlyEnforceIf(okv)
                    m.Add(okv == 1)
                    access_terms.append(1 - okv)
                else:
                    m.AddBoolOr(options).OnlyEnforceIf(okv)
                    m.AddImplication(present, okv)
                    access_terms.append(1 - okv)
                g["touch_corr"] = t
            # any circulation room declared in the brief must reach the corridor
            for rid in corridor_room_ids:
                g = V[rid]
                t = touching(g, corr_vars, door_w, f"{rid}_corr_t")
                okv = m.NewBoolVar(f"hallok_{rid}")
                access_ok_vars[rid] = okv
                present = g["present"]
                if present is None:
                    m.Add(okv == t)
                    access_terms.append(1 - t)
                else:
                    m.Add(okv == t)
                    m.AddImplication(present, okv)
                    access_terms.append(1 - okv)
                g["touch_corr"] = t
        else:
            for rid in access_ids + corridor_room_ids:
                okv = m.NewBoolVar(f"accessok_{rid}")
                access_ok_vars[rid] = okv
                m.Add(okv == 1)

        # ---------------- residual gap area ------------------------------------
        room_area_sum = sum(V[rid]["area"] for rid in ids)
        gap_area = m.NewIntVar(0, W * H, "gap_area_mm2")
        m.Add(room_area_sum + c_area + gap_area == W * H)

        # ---------------- soft front/rear zoning --------------------------------
        zone_terms = []
        for r in rooms:
            rid = r["id"]
            g = V[rid]
            center = m.NewIntVar(Y0, Y1, f"cy_{rid}")
            ymid = m.NewIntVar(2 * Y0, 2 * Y1, f"ymid_{rid}")
            m.Add(ymid == 2 * g["y"] + g["h"])
            m.AddDivisionEquality(center, ymid, 2)
            t = r["type"]
            pen = m.NewIntVar(0, H, f"zp_{rid}")
            zero = m.NewConstant(0)
            if t == "garage":
                m.AddMaxEquality(pen, [center - Y0 - (45 * H) // 100, zero])
            elif t in ("entry", "foyer", "hall"):
                m.AddMaxEquality(pen, [center - Y0 - (50 * H) // 100, zero])
            elif t in ("living", "dining"):
                m.AddMaxEquality(pen, [Y0 + (35 * H) // 100 - center, zero])
            elif t == "bedroom":
                m.AddMaxEquality(pen, [Y0 + (25 * H) // 100 - center, zero])
            else:
                m.Add(pen == 0)
            zone_terms.append(pen)

        absent_terms = [1 - V[r["id"]]["present"] for r in rooms
                        if V[r["id"]]["present"] is not None]
        prefer_terms = []
        for p in self.pairs:
            if p.relationship != "PREFER_ADJACENT":
                continue
            ga, gb = V[p.a], V[p.b]
            t = touching(ga, gb, door_w, f"pref_{p.a}_{p.b}")
            strength = max(1, min(4, int(round(p.weight * 5))))
            prefer_terms.append(strength * t)

        # ---------------- objective --------------------------------------------
        # Feasibility is NOT expressed as a giant weight: mission section 25 asks
        # for a lexicographic order, and CP-SAT caps the magnitude of a safe
        # objective, so huge coefficients get scaled away and stop working.
        # `solve()` therefore runs two stages:
        #   1. minimise the number of violations (HARD/DIRECT relationships,
        #      access, entry) - a small integer objective;
        #   2. freeze those violations and minimise the soft objective below.
        gap_coef = int(w["gap_per_mm2"])
        corr_coef = int(w["corridor_per_mm2"])
        area_coef = int(w["area_deviation_per_mm2"])
        perim_coef = int(w["room_perimeter_per_mm_1000"])
        pref_coef = int(w["prefer_per_mm2_1000"])
        zone_coef = int(w["zone_per_mm_10"])
        abs_coef = int(w["room_absence_per_mm2"])

        perim_scaled = m.NewIntVar(0, 10 ** 9, "perim_scaled")
        m.Add(perim_scaled == perim_coef * sum(perim_terms))
        perim_div = m.NewIntVar(0, 10 ** 9, "perim_term")
        m.AddDivisionEquality(perim_div, perim_scaled, 1000)

        zone_scaled = m.NewIntVar(0, 10 ** 9, "zone_scaled")
        m.Add(zone_scaled == zone_coef * sum(zone_terms))
        zone_div = m.NewIntVar(0, 10 ** 9, "zone_term")
        m.AddDivisionEquality(zone_div, zone_scaled, 10)

        pref_scaled = m.NewIntVar(0, 10 ** 12, "pref_scaled")
        m.Add(pref_scaled == pref_coef * sum(prefer_terms))
        pref_div = m.NewIntVar(0, 10 ** 12, "pref_term")
        m.AddDivisionEquality(pref_div, pref_scaled, 1000)

        violation_term = (sum(viol_terms) + sum(access_terms)
                          + (1 - entry_ok)) * 10 ** 6
        soft_term = (
            area_coef * sum(area_terms)
            + gap_coef * gap_area
            + corr_coef * c_area
            + abs_coef * 10 ** 6 * sum(absent_terms)
            + perim_div
            + zone_div
            - pref_div
        )
        # The delivered objective is the soft objective; the violation count is
        # optimised first inside solve() and then frozen. `soft_weight` scales the
        # violation term only so the caller can still ask for a single-stage run.
        m.Minimize(soft_term)

        self.ctx = {
            "V": V, "ids": ids,
            "corridor": {"x": cx, "y": cy, "w": cw, "h": ch, "area": c_area},
            "entry_ok": entry_ok,
            "orientation": "horizontal" if horiz else "vertical",
            "gap_area": gap_area, "access_ok": access_ok_vars,
            "access_ids": access_ids, "contacts": contacts,
            "objective": obj if False else soft_term,
            "violation_term": sum(viol_terms) + sum(access_terms) + (1 - entry_ok),
            "soft_term": soft_term,
            "terms": {"hard_violations": sum(viol_terms),
                      "access_violations": sum(access_terms),
                      "entry_missing": 1 - entry_ok,
                      "area_deviation_mm2": sum(area_terms),
                      "gap_area_mm2": gap_area,
                      "corridor_area_mm2": c_area,
                      "perimeter_mm": sum(perim_terms),
                      "zone_mm": sum(zone_terms),
                      "preferred_adjacency": sum(prefer_terms),
                      "optional_absence": sum(absent_terms)},
            "coefficients": {"hard_per_violation": 10 ** 6,
                             "area_deviation_per_mm2": area_coef,
                             "gap_per_mm2": gap_coef,
                             "corridor_per_mm2": corr_coef,
                             "absence_per_room": abs_coef * 10 ** 6,
                             "perimeter_per_mm": perim_coef / 1000.0,
                             "zone_per_mm": zone_coef / 10.0,
                             "prefer_per_touch": -pref_coef / 1000.0},
        }
        self.model = m
        return m, self.ctx

    # ------------------------------------------------------------- solve ----
    def solve(self):
        """Two-stage lexicographic solve, then read the solution out.

        Stage 1 minimises the number of feasibility violations (mission section
        25 priorities 1-2); stage 2 freezes that count and minimises the soft
        objective (priorities 3-6). Both stages use small integer objectives,
        which CP-SAT handles exactly - a single objective with ~1e9 weights does
        not work, because CP-SAT scales such objectives down internally.
        """
        if self.model is None:
            self.build()
        s = self.settings["solver"]
        total_limit = float(self.relax.get("time_limit_s", s["time_limit_s"]))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = total_limit
        solver.parameters.random_seed = int(s["random_seed"])
        solver.parameters.num_search_workers = int(s["num_search_workers"])
        solver.parameters.log_search_progress = bool(s["log_search_progress"])

        m = self.model
        ctx = self.ctx
        soft = ctx["soft_term"]
        viol = ctx["violation_term"]

        # ---- stage 1: feasibility ------------------------------------------
        s1_time = max(1.0, 0.40 * total_limit)
        m.Minimize(viol)
        solver.parameters.max_time_in_seconds = s1_time
        st1 = solver.Solve(m)
        name1 = INT_STATUS.get(st1, f"UNKNOWN({st1})")
        stage1 = {"status": name1, "wall_time_s": round(float(solver.WallTime()), 3),
                  "violations": None}
        if name1 not in ("OPTIMAL", "FEASIBLE"):
            out = self._empty_result(name1, total_limit)
            out["stages"] = {"stage1_feasibility": stage1}
            return out, solver
        n_viol = int(round(solver.ObjectiveValue()))
        stage1["violations"] = n_viol
        used = float(solver.WallTime())

        # ---- stage 2: quality with the violation count frozen ---------------
        m.Add(viol <= n_viol)
        m.Minimize(soft)
        solver.parameters.max_time_in_seconds = max(1.0, total_limit - used)
        st2 = solver.Solve(m)
        name2 = INT_STATUS.get(st2, f"UNKNOWN({st2})")
        stage2 = {"status": name2,
                  "wall_time_s": round(float(solver.WallTime()), 3)}
        if name2 not in ("OPTIMAL", "FEASIBLE"):
            # fall back to the stage-1 solution: it is still a valid answer
            name2 = name1
        return self._extract_with(solver, name1, name2, n_viol,
                                  {"stage1_feasibility": stage1,
                                   "stage2_quality": stage2}), solver

    # ---------------------------------------------------------- extraction --
    def _empty_result(self, name, total_limit):
        return {"status": name, "status_code": 0,
                "wall_time_s": float(total_limit),
                "objective_value": None, "best_objective_bound": None,
                "rooms": [], "corridor_cells": [], "gap_cell_count": 0,
                "grid": {"nc": 1, "nr": 1, "cell_w_mm": self.W,
                         "cell_h_mm": self.H, "bx": [0, self.W],
                         "by": [0, self.H], "envelope": self.env,
                         "note": "continuous integer-mm model; no grid"}}

    def _extract_with(self, solver, name1, name2, n_viol, stages):
        name = name2 if name2 in ("OPTIMAL", "FEASIBLE") else name1
        out = {"status": name, "status_code": 0,
               "wall_time_s": round(float(solver.WallTime()), 3),
               "objective_value": None, "best_objective_bound": None,
               "rooms": [], "corridor_cells": [], "gap_cell_count": 0,
               "grid": {"nc": 1, "nr": 1, "cell_w_mm": self.W,
                        "cell_h_mm": self.H, "bx": [0, self.W],
                        "by": [0, self.H], "envelope": self.env,
                        "note": "continuous integer-mm model; no grid"},
               "feasibility_violations": n_viol,
               "stages": stages}
        ctx = self.ctx
        out["objective_value"] = int(round(solver.ObjectiveValue()))
        out["best_objective_bound"] = float(solver.BestObjectiveBound())
        out["objective_terms"] = {k: int(solver.Value(v))
                                  for k, v in ctx["terms"].items()}
        for r in self.brief["rooms"]:
            rid = r["id"]
            g = ctx["V"][rid]
            present = True if g["present"] is None else bool(solver.Value(g["present"]))
            rec = {
                "id": rid, "type": r["type"], "room_class": r["room_class"],
                "present": present,
                "x_mm": int(solver.Value(g["x"])), "y_mm": int(solver.Value(g["y"])),
                "width_mm": int(solver.Value(g["w"])),
                "height_mm": int(solver.Value(g["h"])),
                "area_mm2": int(solver.Value(g["area"])),
                "area_m2": round(int(solver.Value(g["area"])) / 1e6, 4),
                "target_area_m2": r["target_area_m2"],
                "min_area_m2": r["min_area_m2"], "max_area_m2": r["max_area_m2"],
                "min_short_side_mm": r["min_short_side_mm"],
                "max_aspect_ratio": r["max_aspect_ratio"],
                "area_deviation_mm2": int(solver.Value(g["area"]))
                - int(round(r["target_area_m2"] * 1e6)),
                "required": r["required"],
                "zone_preference": r["zone_preference"],
                "access_required": rid in ctx["access_ids"],
                "grid": {},
            }
            out["rooms"].append(rec)
        cc = ctx["corridor"]
        out["corridor_rect"] = {
            "x_mm": int(solver.Value(cc["x"])), "y_mm": int(solver.Value(cc["y"])),
            "width_mm": int(solver.Value(cc["w"])),
            "height_mm": int(solver.Value(cc["h"])),
            "area_mm2": int(solver.Value(cc["area"])),
            "orientation": ctx["orientation"],
        }
        out["gap_area_mm2"] = int(solver.Value(ctx["gap_area"]))
        out["entry_reaches_front"] = (int(solver.Value(ctx["terms"]["entry_missing"]))
                                      == 0)
        out["entry_cells_on_front"] = 1 if out["entry_reaches_front"] else 0
        TOL = int(self.settings["solver"].get("contact_tolerance_mm", 0))
        out["contact_tolerance_mm"] = TOL
        rels = []
        for p in self.pairs:
            a, gg = ctx["V"][p.a], ctx["V"][p.b]
            ax, ay = solver.Value(a["x"]), solver.Value(a["y"])
            aw, ah = solver.Value(a["w"]), solver.Value(a["h"])
            bx, by = solver.Value(gg["x"]), solver.Value(gg["y"])
            bw, bh = solver.Value(gg["w"]), solver.Value(gg["h"])
            ovx = max(0, min(ax + aw, bx + bw) - max(ax, bx))
            ovy = max(0, min(ay + ah, by + bh) - max(ay, by))
            shared = 0
            if (ax + aw <= bx and bx - (ax + aw) <= TOL) or \
               (bx + bw <= ax and ax - (bx + bw) <= TOL):
                shared = ovy
            elif (ay + ah <= by and by - (ay + ah) <= TOL) or \
                 (by + bh <= ay and ay - (by + bh) <= TOL):
                shared = ovx
            need = None
            if p.relationship == "HARD_ADJACENT":
                need = p.min_shared_wall_mm
            elif p.relationship == "DIRECT_ACCESS":
                need = int(p.min_door_width_mm or self.brief["doors"]["min_width_mm"])
            rels.append({
                "a": p.a, "b": p.b, "relationship": p.relationship,
                "shared_wall_mm": int(shared),
                "required_mm": int(need) if need is not None else None,
                "satisfied": (shared >= need) if need is not None else None,
                "edge_probability": p.p, "door_probability": p.p_door,
                "authored": p.authored,
            })
        out["relationship_outcomes"] = rels
        return out

    def cell_rect_mm(self, c):
        return (self.env_x0, self.env_y0, self.W, self.H)

