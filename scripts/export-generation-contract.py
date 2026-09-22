"""Export the canonical contract schema and the room policy table."""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVICE_ROOT = REPO_ROOT / "services" / "generation"
CONTRACTS_DIR = REPO_ROOT / "contracts"
DEFAULT_ENGINE_ROOT = Path("E:/Projects/floor-plan-model")

for candidate in (SERVICE_ROOT, REPO_ROOT / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from pydantic import BaseModel  # noqa: E402

from planlab_service import contracts as C  # noqa: E402

ID_PREFIXES = {
    "bedroom": "B",
    "bathroom": "Bath",
    "wc": "WC",
    "kitchen": "K",
    "living": "L",
    "dining": "D",
    "garage": "G",
    "laundry": "La",
    "study": "S",
    "store": "Store",
}

TYPE_LABELS = {
    "bedroom": "Bedroom",
    "bathroom": "Bathroom",
    "wc": "WC",
    "kitchen": "Kitchen",
    "living": "Living Room",
    "dining": "Dining",
    "garage": "Garage",
    "laundry": "Laundry",
    "study": "Study",
    "store": "Store",
}

ENGINE_TYPE = {
    "wc": "wc",
    "store": "store",
}


class ContractBundle(BaseModel):
    """Every public payload in one document, so one schema file covers the API."""

    brief: C.BriefV1
    request: C.GenerationRequestV1
    job: C.JobV1
    layout: C.LayoutV1
    problem: C.ProblemV1
    remediation: C.RemediationV1
    validationCheck: C.ValidationCheckV1
    engineVersions: C.EngineVersionsV1
    project: C.ProjectV1
    projectDetail: C.ProjectDetailV1
    editorDocument: C.EditorDocumentV2


def dump(payload) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def normalise(text: str) -> str:
    return text.replace("\r\n", "\n")


def engine_root() -> Path:
    return Path(
        os.environ.get("PLANLAB_ENGINE_ROOT") or DEFAULT_ENGINE_ROOT
    ).resolve()


def load_ge_core(root: Path):
    package = root / "geometry_engine_v1"
    if not package.is_dir():
        raise SystemExit(f"engine package not found under {root}")
    if str(package) not in sys.path:
        sys.path.insert(0, str(package))
    import ge_core  # noqa: PLC0415

    return ge_core


def round_area(value: float) -> float:
    return round(value + 0.0, 3)


def ceil_area(value: float) -> float:
    return math.ceil(value * 1000 - 1e-9) / 1000


def build_policy(root: Path) -> dict:
    ge_core = load_ge_core(root)
    fallback = ge_core.TYPE_FALLBACK
    factors = ge_core.ROOM_CLASS_FACTORS
    ge_path = root / "geometry_engine_v1" / "ge_core.py"

    types = {}
    for room_type, prefix in ID_PREFIXES.items():
        key = ENGINE_TYPE.get(room_type, room_type)
        if key not in fallback:
            raise SystemExit(f"engine TYPE_FALLBACK has no entry for {room_type!r} ({key!r})")
        base = fallback[key]
        classes = {}
        for class_name, factor in factors.items():
            target = base["target_area_m2"] * factor["area"]
            minimum = base["min_area_m2"] * factor["area"]
            classes[class_name] = {
                "targetAreaM2": round_area(target),
                "minAreaM2": round_area(minimum),
                "maxAreaM2": ceil_area(target * 1.15),
                "minShortSideMm": int(round(base["min_short_side_mm"] * factor["short_side"])),
                "maxAspectRatio": round_area(base["max_aspect_ratio"] * factor["aspect"]),
            }
        types[room_type] = {
            "label": TYPE_LABELS[room_type],
            "idPrefix": prefix,
            "engineType": key,
            "classes": classes,
        }

    return {
        "policyVersion": 1,
        "contractVersion": C.CONTRACT_VERSION,
        "source": {
            "engineFile": "geometry_engine_v1/ge_core.py",
            "sha256": hashlib.sha256(ge_path.read_bytes()).hexdigest(),
            "typeFallback": ge_core.TYPE_FALLBACK,
            "roomClassFactors": ge_core.ROOM_CLASS_FACTORS,
        },
        "rules": {
            "applyOnce": (
                "Multiply the base target and base minimum once by the class area factor, the "
                "short side by its factor and the aspect ratio by its factor, then round lengths "
                "to the nearest integer and areas to 0.001 m2. Editable numeric overrides become "
                "final values; the class stays descriptive metadata and is never multiplied again."
            ),
            "defaultMaxAreaFactor": 1.15,
            "defaultWalls": {"externalMm": 230, "internalMm": 90},
            "defaultCirculationMinWidthMm": 1000,
            "defaultDoorMinWidthMm": 820,
            "reservedIds": sorted(C.RESERVED_IDS),
        },
        "limits": {
            "siteAxisMm": [C.SITE_AXIS_MIN_MM, C.SITE_AXIS_MAX_MM],
            "rooms": [C.ROOM_COUNT_MIN, C.ROOM_COUNT_MAX],
            "fineTypeRooms": C.FINE_TYPE_MAX,
            "setbackMm": [C.SETBACK_MIN_MM, C.SETBACK_MAX_MM],
            "externalWallMm": [C.EXTERNAL_WALL_MIN_MM, C.EXTERNAL_WALL_MAX_MM],
            "internalWallMm": [C.INTERNAL_WALL_MIN_MM, C.INTERNAL_WALL_MAX_MM],
            "circulationMm": [C.CORRIDOR_MIN_MM, C.CORRIDOR_MAX_MM],
            "doorMm": [C.OPENING_MIN_MM, C.OPENING_MAX_MM],
            "roomAreaM2": [C.ROOM_AREA_MIN_M2, C.ROOM_AREA_MAX_M2],
            "roomLengthMm": [C.LENGTH_MIN_MM, C.LENGTH_MAX_MM],
            "aspectRatio": [C.ASPECT_MIN, C.ASPECT_MAX],
            "relationships": C.RELATIONSHIP_MAX,
            "relationshipMm": [C.RELATIONSHIP_THRESHOLD_MIN_MM, C.RELATIONSHIP_THRESHOLD_MAX_MM],
            "seed": [0, C.SEED_MAX],
            "buildingGfaM2": [C.GFA_MIN_M2, C.GFA_MAX_M2],
            "topK": [C.TOP_K_MIN, C.TOP_K_MAX],
            "topN": [C.TOP_N_MIN, C.TOP_N_MAX],
            "solverTimeLimitS": [C.SOLVER_TIME_LIMIT_MIN_S, C.SOLVER_TIME_LIMIT_MAX_S],
            "labelCharacters": [C.LABEL_MIN, C.LABEL_MAX],
            "editorDocumentBytes": C.EDITOR_DOCUMENT_MAX_BYTES,
        },
        "types": types,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the checked-in files differ")
    parser.add_argument("--engine-root", default=None)
    args = parser.parse_args(argv)

    schema_text = dump(ContractBundle.model_json_schema(ref_template="#/$defs/{model}"))
    policy_text = dump(build_policy(Path(args.engine_root).resolve() if args.engine_root else engine_root()))

    artifacts = [
        (CONTRACTS_DIR / "generation-v1.schema.json", schema_text),
        (CONTRACTS_DIR / "room-policy-v1.json", policy_text),
    ]

    drifted = False
    for path, text in artifacts:
        relative = path.relative_to(REPO_ROOT).as_posix()
        if args.check:
            try:
                existing = path.read_text(encoding="utf-8")
            except FileNotFoundError:
                print(f"missing artifact: {relative} (run scripts/export-generation-contract.py)")
                drifted = True
                continue
            if normalise(existing) != normalise(text):
                print(f"stale artifact: {relative} (run scripts/export-generation-contract.py)")
                drifted = True
                continue
            print(f"up to date: {relative}")
        else:
            CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            print(f"wrote {relative}")

    if args.check and drifted:
        return 1
    if args.check:
        print("generation contract artifacts match the implementation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
