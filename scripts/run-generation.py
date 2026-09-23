"""S03 harness: run one canonical brief through the real engine adapter.

    <engine python> scripts/run-generation.py --fixture test/integration/fixtures/brief-B.json
    <engine python> scripts/run-generation.py --demo B --json out.json

This is a developer/evidence harness, not the service API (S05 owns that).
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
for candidate in (
    REPO_ROOT / "services" / "generation",
    REPO_ROOT / ".runtime" / "generation" / "site-packages",
):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service.contracts import BriefV1  # noqa: E402
from planlab_service.engine_adapter import EngineAdapter  # noqa: E402
from planlab_service.engine_runtime import EngineRuntime  # noqa: E402


def load_brief(args) -> tuple[str, dict]:
    if args.demo:
        path = Path(args.engine_root or "E:/Projects/floor-plan-model") / "geometry_engine_v1" / "demos" / f"demo_{args.demo}_brief.json"
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
        # demo briefs are already integer millimetres; wrap them in the v1 contract
        rooms = []
        counts: dict[str, int] = {}
        for room in raw["rooms"]:
            ordinal = counts.get(room["type"], 0)
            counts[room["type"]] = ordinal + 1
            short = int(room["min_short_side_mm"])
            target = float(room["target_area_m2"])
            rooms.append({
                "id": room["id"],
                "label": f"{room['type'].title()} {ordinal + 1}",
                "type": room["type"],
                "roomClass": room.get("class", "standard"),
                "sourceRequirementId": room["type"],
                "ordinal": ordinal,
                "required": bool(room.get("required", True)),
                "targetAreaM2": target,
                "minAreaM2": float(room["min_area_m2"]),
                "maxAreaM2": round(max(float(room.get("max_area_m2") or 0), target * 1.15), 3),
                "minShortSideMm": short,
                "minWidthMm": int(room.get("min_width_mm") or short),
                "minHeightMm": int(room.get("min_height_mm") or short),
                "maxAspectRatio": float(room["max_aspect_ratio"]),
            })
        relationships = [
            {"id": f"REL-{rel['a']}-{rel['b']}-share", "a": rel["a"], "b": rel["b"],
             "kind": "mustShareWall", "minSharedWallMm": int(rel["min_shared_wall_mm"]),
             "minOpeningWidthMm": 820}
            for rel in raw.get("adjacency", [])
        ] + [
            {"id": f"REL-{rel['a']}-{rel['b']}-access", "a": rel["a"], "b": rel["b"],
             "kind": "directAccess", "minSharedWallMm": 900,
             "minOpeningWidthMm": int(rel["min_width_mm"])}
            for rel in raw.get("doors_required", [])
        ]
        payload = {
            "schemaVersion": "planlab.brief/1", "units": "mm",
            "site": {"widthMm": int(raw["site"]["width_mm"]),
                     "heightMm": int(raw["site"]["height_mm"]),
                     "front": raw["site"]["front"]},
            "setbacks": {f"{side}Mm": int(raw["setbacks"][f"{side}_mm"])
                         for side in ("north", "east", "south", "west")},
            "walls": {"externalMm": 230, "internalMm": 90},
            "circulation": {"minWidthMm": 1000}, "doors": {"minWidthMm": 820},
            "rooms": rooms, "relationships": relationships,
            "building": {"targetGfaM2": None, "maxGfaM2": None},
            "settings": {"topK": args.top_k, "topN": args.top_n,
                         "solverTimeLimitS": args.time_limit, "seed": args.seed},
        }
        return raw["brief_id"], payload
    fixture = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    return fixture.get("origin", {}).get("engineBriefId", "fixture"), fixture["payload"]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture")
    parser.add_argument("--demo")
    parser.add_argument("--engine-root", default=None)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--top-n", type=int, default=3)
    parser.add_argument("--time-limit", type=int, default=30)
    parser.add_argument("--seed", type=int, default=20260923)
    parser.add_argument("--json", dest="json_path")
    args = parser.parse_args(argv)
    if not args.fixture and not args.demo:
        parser.error("pass --fixture or --demo")

    name, payload = load_brief(args)
    brief = BriefV1.model_validate(payload)
    runtime = EngineRuntime(engine_root=args.engine_root)
    runtime.load()
    adapter = EngineAdapter(runtime)
    stages: list[str] = []
    started = time.time()
    result = adapter.generate(
        brief,
        generation_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"harness-{name}")),
        project_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"project-{name}")),
        brief_version_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"brief-{name}")),
        correlation_id=f"harness-{int(time.time())}",
        on_stage=stages.append,
    )
    summary = {
        "brief": name,
        "status": result.status,
        "layouts": [
            {"rank": layout.rank, "layoutId": layout.layoutId,
             "finalScore": layout.scores.final,
             "rooms": len(layout.rooms), "omitted": layout.omittedRoomIds,
             "checks": len(layout.validation.checks)}
            for layout in result.layouts
        ],
        "error": result.error.model_dump(mode="json") if result.error else None,
        "warnings": result.warnings,
        "stages": stages,
        "diagnostics": {key: value for key, value in result.diagnostics.items()
                        if key in ("candidateCount", "attemptStatuses", "footprint", "elapsedMs")},
        "elapsedS": round(time.time() - started, 2),
        "warmJobs": runtime.warm_jobs,
    }
    print(json.dumps(summary, indent=2)[:4000])
    if args.json_path:
        Path(args.json_path).write_text(
            json.dumps({"summary": summary,
                        "layouts": [layout.model_dump(mode="json") for layout in result.layouts]},
                       indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.json_path}")
    return 0 if result.status == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
