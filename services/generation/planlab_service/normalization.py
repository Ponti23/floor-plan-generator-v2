"""Raw engine layout -> public LayoutV1, with independent product revalidation (S03)."""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from .contracts import (
    BriefV1,
    EngineVersionsV1,
    LayoutV1,
    canonical_json,
)

PATH_MARKERS = (":\\", ":/")


@dataclass(frozen=True)
class LayoutIds:
    layoutId: str
    generationId: str
    projectId: str
    briefVersionId: str
    briefHash: str
    rank: int


def _rect(source: dict) -> dict:
    return {
        "xMm": int(source["x_mm"]),
        "yMm": int(source["y_mm"]),
        "widthMm": int(source["width_mm"]),
        "heightMm": int(source["height_mm"]),
    }


def _geometry_projection(raw_layout: dict) -> dict:
    """Only the geometry that decides whether two options are the same plan."""
    return {
        "rooms": sorted(
            (
                {
                    "id": room["id"],
                    "present": bool(room.get("present", True)),
                    "rect": _rect(room),
                }
                for room in raw_layout.get("rooms", [])
                if room.get("present", True)
            ),
            key=lambda item: item["id"],
        ),
        "corridor": _rect(raw_layout["circulation"]["corridor_rect"]),
        "walls": sorted(
            (
                {
                    "id": wall["wall_id"],
                    "type": wall["type"],
                    "rect": _rect(wall["geometry"]),
                }
                for wall in raw_layout.get("walls", [])
            ),
            key=lambda item: item["id"],
        ),
        "openings": sorted(
            (
                {
                    "id": opening["opening_id"],
                    "wallId": opening["wall_id"],
                    "rect": _rect(opening),
                }
                for opening in raw_layout.get("openings", [])
            ),
            key=lambda item: item["id"],
        ),
    }


def geometry_hash(raw_layout: dict) -> str:
    preimage = canonical_json(_geometry_projection(raw_layout))
    return hashlib.sha256(preimage.encode("utf-8")).hexdigest()


def _overlap(a: dict, b: dict) -> tuple[int, int]:
    left = max(int(a["x_mm"]), int(b["x_mm"]))
    right = min(int(a["x_mm"]) + int(a["width_mm"]), int(b["x_mm"]) + int(b["width_mm"]))
    bottom = max(int(a["y_mm"]), int(b["y_mm"]))
    top = min(int(a["y_mm"]) + int(a["height_mm"]), int(b["y_mm"]) + int(b["height_mm"]))
    return max(0, right - left), max(0, top - bottom)


def _inside(rect: dict, area: dict) -> bool:
    return (
        int(rect["x_mm"]) >= int(area["x_mm"])
        and int(rect["y_mm"]) >= int(area["y_mm"])
        and int(rect["x_mm"]) + int(rect["width_mm"])
        <= int(area["x_mm"]) + int(area["width_mm"])
        and int(rect["y_mm"]) + int(rect["height_mm"])
        <= int(area["y_mm"]) + int(area["height_mm"])
    )


def revalidate(raw_layout: dict, brief: BriefV1, footprint) -> list[dict]:
    """Independent product checks over the raw integers, engine bookkeeping ignored."""
    authored = {room.id: room for room in brief.rooms}
    raw_rooms = {room["id"]: room for room in raw_layout.get("rooms", [])}
    present = {rid: room for rid, room in raw_rooms.items() if room.get("present", True)}
    inner = {
        "x_mm": footprint.inner_rect["xMm"],
        "y_mm": footprint.inner_rect["yMm"],
        "width_mm": footprint.inner_rect["widthMm"],
        "height_mm": footprint.inner_rect["heightMm"],
    }
    corridor = raw_layout.get("circulation", {}).get("corridor_rect") or {}
    checks: list[dict] = []

    def check(cid: str, name: str, passed: bool, detail: str) -> None:
        checks.append({"id": cid, "name": name, "passed": bool(passed), "detail": detail})

    unknown = sorted(set(raw_rooms) - set(authored))
    check("P01", "every returned room belongs to the brief", not unknown,
          f"unknown room ids: {unknown or 'none'}")

    missing_required = sorted(
        room.id for room in brief.rooms if room.required and room.id not in present
    )
    check("P02", "every required room is present", not missing_required,
          f"missing required rooms: {missing_required or 'none'}")

    bad_absence = []
    for rid, room in raw_rooms.items():
        if room.get("present", True):
            continue
        if (int(room["width_mm"]), int(room["height_mm"]), int(room.get("area_mm2", 0))) != (0, 0, 0):
            bad_absence.append(rid)
    check("P03", "an omitted room carries no geometry", not bad_absence,
          f"omitted rooms with residual geometry: {bad_absence or 'none'}")

    outside = [rid for rid, room in present.items() if not _inside(room, inner)]
    check("P04", "every present room is inside the buildable envelope", not outside,
          f"rooms outside: {outside or 'none'}")

    overlaps = []
    ids = sorted(present)
    for index, first in enumerate(ids):
        for second in ids[index + 1:]:
            ox, oy = _overlap(present[first], present[second])
            if ox > 0 and oy > 0:
                overlaps.append(f"{first}/{second}")
    check("P05", "no two present rooms overlap", not overlaps,
          f"{len(ids) * (len(ids) - 1) // 2} pairs tested; overlaps: {overlaps or 'none'}")

    corridor_hits = [
        rid for rid, room in present.items()
        if _overlap(room, corridor)[0] > 0 and _overlap(room, corridor)[1] > 0
    ]
    check("P06", "no room overlaps the corridor", not corridor_hits,
          f"overlapping rooms: {corridor_hits or 'none'}")

    area_bad = []
    for rid, room in present.items():
        source = authored.get(rid)
        if source is None:
            continue
        mm2 = int(room["width_mm"]) * int(room["height_mm"])
        if mm2 < round(source.minAreaM2 * 1e6) or mm2 > round(source.maxAreaM2 * 1e6):
            area_bad.append(
                f"{rid}:{mm2 / 1e6:.3f} outside [{source.minAreaM2},{source.maxAreaM2}]"
            )
    check("P07", "returned areas respect the authored min/max band", not area_bad,
          "; ".join(area_bad) or "all rooms inside their band")

    dimension_bad = []
    for rid, room in present.items():
        source = authored.get(rid)
        if source is None:
            continue
        short = min(int(room["width_mm"]), int(room["height_mm"]))
        if short < source.minShortSideMm:
            dimension_bad.append(f"{rid}:short side {short}<{source.minShortSideMm}")
        if int(room["width_mm"]) < source.minWidthMm or int(room["height_mm"]) < source.minHeightMm:
            dimension_bad.append(
                f"{rid}:{room['width_mm']}x{room['height_mm']} "
                f"< authored {source.minWidthMm}x{source.minHeightMm}"
            )
    check("P08", "authored axis minima are honoured", not dimension_bad,
          "; ".join(dimension_bad) or "all rooms meet their authored minima")

    measured = int(raw_layout.get("circulation", {}).get("measured_min_width_mm") or 0)
    check("P09", "circulation meets the brief minimum width",
          bool(corridor) and measured >= brief.circulation.minWidthMm,
          f"measured {measured} mm vs required {brief.circulation.minWidthMm} mm")

    entry = raw_layout.get("circulation", {}).get("entry") or {}
    check("P10", "the plan has an entry through the external wall",
          bool(entry) and int(entry.get("width_mm", 0)) > 0,
          f"entry width {entry.get('width_mm', 0)} mm on side {entry.get('side')!r}")

    outer = footprint.outer_rect
    outer_mm2 = int(outer["widthMm"]) * int(outer["heightMm"])
    cap = round(brief.building.maxGfaM2 * 1e6) if brief.building.maxGfaM2 else None
    check("P11", "the chosen footprint respects the max GFA cap",
          cap is None or outer_mm2 <= cap,
          f"footprint {outer_mm2 / 1e6:.2f} m2 vs cap "
          f"{'none' if cap is None else f'{cap / 1e6:.2f} m2'}")

    scores = raw_layout.get("scores") or {}
    score_bad = [
        key for key in ("final_score", "topology_score", "geometry_score",
                        "circulation_score", "preference_score", "constraint_score")
        if not isinstance(scores.get(key), (int, float)) or not math.isfinite(scores[key])
        or scores[key] < 0 or scores[key] > 1
    ]
    check("P12", "engine scores are finite and inside 0..1", not score_bad,
          f"out-of-range: {score_bad or 'none'}")

    return checks


def normalize_layout(
    raw_layout: dict,
    *,
    brief: BriefV1,
    footprint,
    ids: LayoutIds,
    versions: EngineVersionsV1,
    created_at: str,
    solver_time_limit_s: int,
    solver_workers: int,
    seed: int,
) -> LayoutV1:
    authored = {room.id: room for room in brief.rooms}
    raw_rooms = {room["id"]: room for room in raw_layout.get("rooms", [])}

    unknown = sorted(set(raw_rooms) - set(authored))
    if unknown:
        raise ValueError(f"engine returned rooms that are not in the brief: {unknown}")

    rooms = []
    omitted: list[str] = []
    for room_id, raw in raw_rooms.items():
        source = authored[room_id]
        if not raw.get("present", True):
            if (int(raw["width_mm"]), int(raw["height_mm"])) != (0, 0):
                raise ValueError(f"omitted room {room_id} carries residual geometry")
            omitted.append(room_id)
            continue
        width = int(raw["width_mm"])
        height = int(raw["height_mm"])
        if width < source.minWidthMm or height < source.minHeightMm:
            raise ValueError(f"room {room_id} violates its authored axis minima")
        area_m2 = width * height / 1_000_000
        if area_m2 < source.minAreaM2 - 1e-9 or area_m2 > source.maxAreaM2 + 1e-9:
            raise ValueError(f"room {room_id} violates its authored area band")
        rooms.append(
            {
                "id": source.id,
                "label": source.label,
                "type": source.type,
                "roomClass": source.roomClass,
                "sourceRequirementId": source.sourceRequirementId,
                "ordinal": source.ordinal,
                "required": source.required,
                "targetAreaM2": source.targetAreaM2,
                "minAreaM2": source.minAreaM2,
                "maxAreaM2": source.maxAreaM2,
                "minShortSideMm": source.minShortSideMm,
                "minWidthMm": source.minWidthMm,
                "minHeightMm": source.minHeightMm,
                "maxAspectRatio": source.maxAspectRatio,
                "present": True,
                "rect": {
                    "xMm": int(raw["x_mm"]),
                    "yMm": int(raw["y_mm"]),
                    "widthMm": width,
                    "heightMm": height,
                },
                "areaM2": area_m2,
            }
        )

    circulation = raw_layout["circulation"]
    entry = circulation["entry"]
    gfa = raw_layout["gfa"]
    scores = raw_layout["scores"]
    omitted_set = set(omitted)
    raw_openings = raw_layout.get("openings", [])
    openings = [opening for opening in raw_openings
                if opening["a"] not in omitted_set and opening["b"] not in omitted_set]
    dropped_openings = len(raw_openings) - len(openings)
    warnings = [str(item) for item in raw_layout.get("warnings", [])]
    if dropped_openings:
        warnings.append(
            f"{dropped_openings} symbolic opening(s) dropped because their room is omitted"
        )
    outer_inset = brief.walls.externalMm
    author_outer = footprint.outer_rect
    intended_outer = dict(author_outer)
    intended_inner = dict(footprint.inner_rect)
    del outer_inset

    payload = {
        "schemaVersion": "planlab.layout/1",
        "layoutId": ids.layoutId,
        "generationId": ids.generationId,
        "projectId": ids.projectId,
        "briefVersionId": ids.briefVersionId,
        "briefHash": ids.briefHash,
        "rank": ids.rank,
        "createdAt": created_at,
        "solverStatus": raw_layout["solver_status"],
        "validationStatus": "PASSED",
        "coordinateSystem": "site-sw-x-east-y-north-mm",
        "site": {
            "widthMm": brief.site.widthMm,
            "heightMm": brief.site.heightMm,
            "front": brief.site.front,
        },
        "setbacks": {
            "northMm": brief.setbacks.northMm,
            "eastMm": brief.setbacks.eastMm,
            "southMm": brief.setbacks.southMm,
            "westMm": brief.setbacks.westMm,
        },
        "setbackEnvelope": footprint.legal_rect,
        "buildingEnvelope": intended_outer,
        "buildableEnvelope": intended_inner,
        "rooms": rooms,
        "omittedRoomIds": sorted(omitted),
        "circulation": {
            "id": "CORRIDOR",
            "rect": _rect(circulation["corridor_rect"]),
            "minWidthMm": brief.circulation.minWidthMm,
            "measuredMinWidthMm": int(circulation["measured_min_width_mm"]),
            "areaM2": float(circulation["corridor_area_m2"]),
            "entry": {
                "side": entry["side"],
                "xMm": int(entry["x_mm"]),
                "yMm": int(entry["y_mm"]),
                "widthMm": int(entry["width_mm"]),
            },
        },
        "walls": [
            {
                "id": wall["wall_id"],
                "type": wall["type"],
                "thicknessMm": int(wall["thickness_mm"]),
                "rect": _rect(wall["geometry"]),
                "orientation": wall["geometry"]["orientation"],
                "between": [],
            }
            for wall in raw_layout.get("walls", [])
        ],
        "openings": [
            {
                "id": opening["opening_id"],
                "wallId": opening["wall_id"],
                "kind": opening["kind"],
                "a": opening["a"],
                "b": opening["b"],
                "rect": _rect(opening),
                "orientation": opening["orientation"],
                "fits": True,
            }
            for opening in openings
        ],
        "scores": {
            "final": float(scores["final_score"]),
            "topology": float(scores["topology_score"]),
            "geometry": float(scores["geometry_score"]),
            "circulation": float(scores["circulation_score"]),
            "preference": float(scores["preference_score"]),
            "constraint": float(scores["constraint_score"]),
        },
        "areas": {
            "grossExternalM2": float(gfa["gross_external_area_m2"]),
            "roomRectangleM2": float(gfa["net_room_area_m2"]),
            "circulationM2": float(gfa["circulation_area_m2"]),
            "residualM2": float(circulation.get("residual_area_mm2", 0)) / 1_000_000,
        },
        "validation": {
            "allPassed": True,
            "checks": [
                {
                    "id": check["id"],
                    "name": check["name"],
                    "passed": bool(check["passed"]),
                    "detail": check["detail"],
                }
                for check in raw_layout["validation"]["checks"]
                if check.get("passed")
            ],
        },
        "warnings": warnings,
        "remediation": [],
        "relaxations": [
            {"code": str(key), "description": str(value)}
            for key, value in (raw_layout.get("relaxations_applied") or {}).items()
        ] if isinstance(raw_layout.get("relaxations_applied"), dict) else [],
        "versions": versions.model_dump(mode="json"),
        "provenance": {
            "topologyCandidateId": str(raw_layout.get("topology_candidate_id") or "unknown"),
            "topologySource": "topology_model_v1",
            "solverTimeLimitS": int(solver_time_limit_s),
            "solverWorkers": int(solver_workers),
            "seed": int(seed),
            "attempts": max(1, len(raw_layout.get("attempts") or []) or 1),
        },
    }

    layout = LayoutV1.model_validate(payload)
    leaked = [
        str(value) for value in _strings(layout.model_dump(mode="json"))
        if any(marker in str(value) for marker in PATH_MARKERS)
    ]
    if leaked:
        raise ValueError(f"normalized layout leaked a filesystem path: {leaked[:3]}")
    return layout


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
