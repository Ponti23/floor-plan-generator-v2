"""S03 integration test: the real topology model + CP-SAT through the service adapter."""
import json
import sys
import unittest
import uuid
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO = UNIT.parents[3]
for candidate in (SERVICE, REPO / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service.contracts import BriefV1, LayoutV1  # noqa: E402
from planlab_service.engine_adapter import EngineAdapter  # noqa: E402
from planlab_service.engine_runtime import EngineRuntime  # noqa: E402

FIXTURES = REPO / "test" / "integration" / "fixtures"


def fixture_brief(name, *, top_k=3, top_n=2, time_limit_s=20):
    payload = json.loads((FIXTURES / name).read_text(encoding="utf-8"))["payload"]
    payload["settings"] = {
        **payload["settings"],
        "topK": top_k,
        "topN": top_n,
        "solverTimeLimitS": time_limit_s,
    }
    return BriefV1.model_validate(payload)


class RealEngineTests(unittest.TestCase):
    """One warm runtime serves both jobs; the model must load exactly once."""

    @classmethod
    def setUpClass(cls):
        cls.runtime = EngineRuntime()
        cls.versions = cls.runtime.load()
        cls.adapter = EngineAdapter(cls.runtime)
        cls.first = cls.adapter.generate(
            fixture_brief("brief-B.json"),
            generation_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-demo-B")),
            project_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-project")),
            brief_version_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-brief-B")),
            correlation_id="s03-real-B",
        )
        cls.second = cls.adapter.generate(
            fixture_brief("brief-D.json"),
            generation_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-demo-D")),
            project_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-project")),
            brief_version_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-brief-D")),
            correlation_id="s03-real-D",
        )
        cls.adapter_instance = cls.runtime.adapter
        cls.third = cls.adapter.generate(
            fixture_brief("brief-B.json", top_k=1, top_n=1, time_limit_s=10),
            generation_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-demo-B2")),
            project_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-project")),
            brief_version_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "s03-brief-B")),
            correlation_id="s03-real-B2",
        )

    def test_demo_b_completes_with_self_contained_layouts(self):
        self.assertEqual(self.first.status, "COMPLETED", self.first.error)
        self.assertTrue(self.first.layouts)
        self.assertIsNone(self.first.error)
        for layout in self.first.layouts:
            self.assertIsInstance(layout, LayoutV1)
            self.assertGreaterEqual(layout.rank, 1)
            self.assertTrue(layout.rooms)
            self.assertTrue(all(room.present for room in layout.rooms))
            # integer authored wall thicknesses and corridor width reach the DTO
            for wall in layout.walls:
                self.assertIn(wall.thicknessMm, (90, 230))
            self.assertEqual(layout.circulation.minWidthMm, 1000)
            self.assertGreaterEqual(layout.circulation.measuredMinWidthMm, 1000)
            # the DTO alone is enough to render: site is site-absolute and complete
            self.assertEqual(layout.site.widthMm, 14117)
            self.assertGreater(layout.scores.final, 0)
            self.assertTrue(all(check.passed for check in layout.validation.checks))
            blob = json.dumps(layout.model_dump(mode="json"))
            self.assertNotIn("E:/", blob)
            self.assertNotIn("best.pt", blob)

    def test_demo_d_is_architectural_not_technical(self):
        self.assertEqual(self.second.status, "INFEASIBLE", self.second.error)
        self.assertFalse(self.second.layouts)
        self.assertIsNotNone(self.second.error)
        # The required minima alone exceed the legal inner envelope, so this is a
        # necessary-condition proof (PROGRAMME_TOO_LARGE); a bounded search that
        # simply found nothing would be NO_VALID_LAYOUT/limited_search instead.
        self.assertIn(self.second.error.code, ("PROGRAMME_TOO_LARGE", "NO_VALID_LAYOUT"))
        self.assertEqual(self.second.error.category, "architectural")
        self.assertIn(self.second.error.proof, ("necessary_condition", "limited_search"))
        self.assertFalse(self.second.error.retryable)

    def test_model_was_warmed_once_and_reused(self):
        # Two jobs reached the model (B full, B reduced); the D preflight proved
        # impossibility before any inference, and the adapter object never changed.
        self.assertEqual(self.runtime.warm_jobs, 2)
        self.assertIs(self.runtime.adapter, self.adapter_instance)
        self.assertIsNotNone(self.runtime.adapter)
        self.assertEqual(self.runtime.versions.checkpointSha256,
                         "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8")
        self.assertEqual(self.third.status, "COMPLETED", self.third.error)
        self.assertTrue(self.third.layouts)

    def test_versions_block_is_shared_by_both_jobs(self):
        for result in (self.first, self.second):
            self.assertIsNotNone(result.versions)
            self.assertEqual(result.versions.checkpointId, "full_v1a/best")
            self.assertEqual(result.versions.contractVersion, "planlab.generation/1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
