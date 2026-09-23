"""S03 tests: raw engine layout -> public LayoutV1 with independent revalidation."""
import copy
import json
import sys
import unittest
import uuid
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO = UNIT.parents[3]
ENGINE = Path("E:/Projects/floor-plan-model")
for candidate in (SERVICE, REPO / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service import provenance  # noqa: E402
from planlab_service.contracts import BriefV1, LayoutV1  # noqa: E402
from planlab_service.footprint import choose_footprint  # noqa: E402
from planlab_service.normalization import (  # noqa: E402
    LayoutIds,
    geometry_hash,
    normalize_layout,
    revalidate,
)

RAW = REPO / "artifacts" / "integration" / "engine-runs" / "s01-demo-B" / "raw-layout-1.json"
FIXTURES = REPO / "test" / "integration" / "fixtures"
CHECKPOINT = ENGINE / "topology_v1" / "checkpoints" / "full_v1a" / "best.pt"
STORE = ENGINE / "topology_v1" / "data" / "store" / "store_manifest.json"
DATA = ENGINE / "overnight_topology_v0" / "data" / "data_manifest.json"


def load_raw():
    return json.loads(RAW.read_text(encoding="utf-8"))


def load_brief():
    payload = json.loads((FIXTURES / "brief-B.json").read_text(encoding="utf-8"))["payload"]
    return BriefV1.model_validate(payload)


def versions():
    return provenance.build_versions(
        engine_root=ENGINE,
        checkpoint_path=CHECKPOINT,
        checkpoint_sha256=provenance.file_sha256(CHECKPOINT),
        store_manifest=STORE,
        data_manifest=DATA,
        service_version="0.1.0",
        python_version="3.14.7",
        torch_version="2.9.0+cu129",
        ortools_version="9.15.6755",
    )


def ids(rank=1):
    suffix = uuid.uuid5(uuid.NAMESPACE_URL, f"normalization-test-{rank}")
    return LayoutIds(
        layoutId=str(suffix),
        generationId=str(uuid.uuid5(uuid.NAMESPACE_URL, "generation")),
        projectId=str(uuid.uuid5(uuid.NAMESPACE_URL, "project")),
        briefVersionId=str(uuid.uuid5(uuid.NAMESPACE_URL, "brief-version")),
        briefHash="0" * 64,
        rank=rank,
    )


def normalize(raw, brief, foot):
    return normalize_layout(
        raw,
        brief=brief,
        footprint=foot,
        ids=ids(),
        versions=versions(),
        created_at="2026-09-23T00:00:00Z",
        solver_time_limit_s=30,
        solver_workers=8,
        seed=20260923,
    )


class NormalizationTests(unittest.TestCase):
    def test_real_engine_layout_becomes_a_valid_public_dto(self):
        brief = load_brief()
        layout = normalize(load_raw(), brief, choose_footprint(brief))
        self.assertIsInstance(layout, LayoutV1)
        self.assertEqual(len(layout.rooms), 9)
        self.assertEqual(layout.omittedRoomIds, [])
        self.assertEqual(layout.provenance.topologySource, "topology_model_v1")
        self.assertTrue(layout.validation.allPassed)
        self.assertGreaterEqual(len(layout.validation.checks), 20)
        self.assertEqual(layout.versions.checkpointId, "full_v1a/best")
        blob = json.dumps(layout.model_dump(mode="json"))
        self.assertNotIn("E:/", blob)
        self.assertNotIn("E:\\", blob)
        self.assertNotIn("best.pt", blob)

    def test_absent_optional_room_is_reported_not_invented(self):
        raw = load_raw()
        payload = json.loads((FIXTURES / "brief-B.json").read_text(encoding="utf-8"))["payload"]
        payload["rooms"][-1]["required"] = False  # LA1 becomes optional
        brief = BriefV1.model_validate(payload)
        target = payload["rooms"][-1]["id"]
        for room in raw["rooms"]:
            if room["id"] == target:
                room.update(
                    {"present": False, "width_mm": 0, "height_mm": 0, "area_mm2": 0,
                     "area_m2": 0.0}
                )
        layout = normalize(raw, brief, choose_footprint(brief))
        self.assertEqual(layout.omittedRoomIds, [target])
        self.assertNotIn(target, [room.id for room in layout.rooms])
        self.assertEqual(len(layout.rooms), 8)

    def test_revalidate_catches_a_shrunk_room(self):
        brief = load_brief()
        foot = choose_footprint(brief)
        raw = load_raw()
        self.assertTrue(all(check["passed"] for check in revalidate(raw, brief, foot)))
        broken = copy.deepcopy(raw)
        broken["rooms"][0]["width_mm"] = 1000
        failed = [check for check in revalidate(broken, brief, foot) if not check["passed"]]
        self.assertTrue(failed)
        self.assertTrue(
            {"P07", "P08"} & {check["id"] for check in failed},
            [check["id"] for check in failed],
        )

    def test_geometry_hash_is_stable_and_geometry_sensitive(self):
        raw = load_raw()
        self.assertEqual(geometry_hash(raw), geometry_hash(copy.deepcopy(raw)))
        moved = copy.deepcopy(raw)
        moved["rooms"][0]["x_mm"] += 10
        self.assertNotEqual(geometry_hash(raw), geometry_hash(moved))

    def test_unknown_room_is_refused(self):
        brief = load_brief()
        raw = load_raw()
        raw["rooms"][0]["id"] = "ZZ9"
        with self.assertRaises(ValueError):
            normalize(raw, brief, choose_footprint(brief))


if __name__ == "__main__":
    unittest.main()
