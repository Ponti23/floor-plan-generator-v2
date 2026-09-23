"""S03 tests: engine/model provenance hashing."""
import json
import sys
import unittest
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO = UNIT.parents[3]
ENGINE = Path("E:/Projects/floor-plan-model")
for candidate in (SERVICE, REPO / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service import provenance  # noqa: E402
from planlab_service.contracts import EngineVersionsV1  # noqa: E402

CHECKPOINT = ENGINE / "topology_v1" / "checkpoints" / "full_v1a" / "best.pt"
STORE = ENGINE / "topology_v1" / "data" / "store" / "store_manifest.json"
DATA = ENGINE / "overnight_topology_v0" / "data" / "data_manifest.json"
PINNED = "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8"


class ProvenanceTests(unittest.TestCase):
    def test_checkpoint_hash_matches_the_pinned_value(self):
        self.assertEqual(provenance.file_sha256(CHECKPOINT), PINNED)

    def test_vocabulary_hash_is_deterministic_and_content_bound(self):
        first = provenance.vocabulary_sha256(STORE, DATA)
        self.assertEqual(first, provenance.vocabulary_sha256(STORE, DATA))
        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, provenance.vocabulary_sha256(STORE, STORE))

    def test_engine_source_hash_covers_every_module(self):
        digest = provenance.engine_source_sha256(ENGINE)
        self.assertEqual(len(digest), 64)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_build_versions_produces_a_valid_public_block(self):
        versions = provenance.build_versions(
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
        self.assertIsInstance(versions, EngineVersionsV1)
        self.assertEqual(versions.checkpointId, "full_v1a/best")
        self.assertEqual(versions.checkpointSha256, PINNED)
        self.assertEqual(versions.contractVersion, "planlab.generation/1")
        self.assertEqual(versions.modelVersion, "topology_v1")
        json.dumps(versions.model_dump(mode="json"))


if __name__ == "__main__":
    unittest.main()
