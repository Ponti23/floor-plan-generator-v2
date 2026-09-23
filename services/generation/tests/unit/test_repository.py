"""S04 tests: durable records, state predicates and restart recovery."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO_ROOT = UNIT.parents[3]
for candidate in (SERVICE, REPO_ROOT / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service import repository as repo  # noqa: E402
from planlab_service.contracts import BriefV1, brief_sha256  # noqa: E402
from planlab_service.database import connect, migrate  # noqa: E402

FIXTURES = REPO_ROOT / "test" / "integration" / "fixtures"


def brief():
    payload = json.loads((FIXTURES / "brief-B.json").read_text(encoding="utf-8"))["payload"]
    return BriefV1.model_validate(payload)


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s04-repo-"))
        self.db = self.tmp / "planlab.sqlite3"
        migrate(self.db)
        self.conn = connect(self.db)
        self.project = repo.create_project(self.conn, "Test project")
        self.brief = brief()
        saved = repo.save_brief_version(
            self.conn,
            self.project["id"],
            expected_project_revision=1,
            brief_json=self.brief.model_dump(mode="json"),
            editor_document_json={"schemaVersion": "planlab.editor/2", "name": "x", "roomGroups": [], "legacyImport": None},
            brief_hash=brief_sha256(self.brief),
        )
        self.brief_version_id = saved["briefVersionId"]
        self.project = repo.get_project(self.conn, self.project["id"])

    def tearDown(self):
        self.conn.close()

    def test_saving_the_same_brief_reuses_the_version(self):
        again = repo.save_brief_version(
            self.conn, self.project["id"], expected_project_revision=self.project["revision"],
            brief_json=self.brief.model_dump(mode="json"),
            editor_document_json={"schemaVersion": "planlab.editor/2", "name": "x",
                                  "roomGroups": [], "legacyImport": None},
            brief_hash=brief_sha256(self.brief),
        )
        self.assertTrue(again["reused"])
        self.assertEqual(again["briefVersionId"], self.brief_version_id)

    def test_stale_revision_is_a_conflict(self):
        with self.assertRaises(repo.Conflict):
            repo.save_brief_version(
                self.conn, self.project["id"], expected_project_revision=99,
                brief_json={"a": 1}, editor_document_json={}, brief_hash="f" * 64,
            )

    def test_job_lifecycle_is_state_predicated(self):
        job, created = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-1", request_hash="h1", settings={"topK": 3},
        )
        self.assertTrue(created)
        self.assertEqual(job["status"], "QUEUED")
        moved = repo.transition(self.conn, job["id"], status="SOLVING",
                                expect_statuses=("QUEUED",))
        self.assertEqual(moved["status"], "SOLVING")
        self.assertEqual(moved["state_version"], job["state_version"] + 1)
        with self.assertRaises(repo.Conflict):
            repo.transition(self.conn, job["id"], status="VALIDATING",
                            expect_statuses=("QUEUED",))
        with self.assertRaises(repo.Conflict):
            repo.transition(self.conn, job["id"], status="COMPLETED",
                            expect_state_version=job["state_version"])

    def test_one_active_job_per_project_and_idempotent_submit(self):
        first, _ = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-2", request_hash="h2", settings={},
        )
        same, created = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-2", request_hash="h2", settings={},
        )
        self.assertFalse(created)
        self.assertEqual(same["id"], first["id"])
        with self.assertRaises(repo.Conflict):
            repo.create_generation(
                self.conn, self.project["id"], self.brief_version_id,
                idempotency_key="key-3", request_hash="h3", settings={},
            )
        with self.assertRaises(repo.Conflict):
            repo.create_generation(
                self.conn, self.project["id"], self.brief_version_id,
                idempotency_key="key-2", request_hash="different", settings={},
            )

    def test_cancel_is_recorded_and_terminal_states_are_immutable(self):
        job, _ = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-4", request_hash="h4", settings={},
        )
        cancelled = repo.request_cancel(self.conn, job["id"])
        self.assertTrue(cancelled["cancel_requested"])
        repo.transition(self.conn, job["id"], status="CANCELLED",
                        finished_at=repo.now_iso())
        again = repo.request_cancel(self.conn, job["id"])
        self.assertEqual(again["status"], "CANCELLED")
        self.assertTrue(again["cancel_requested"])

    def test_restart_recovery_marks_active_jobs_failed(self):
        job, _ = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-5", request_hash="h5", settings={},
        )
        repo.transition(self.conn, job["id"], status="SOLVING")
        recovered = repo.recover_interrupted(self.conn)
        self.assertIn(job["id"], recovered)
        after = repo.get_generation(self.conn, job["id"])
        self.assertEqual(after["status"], "FAILED")
        self.assertTrue(after["error"]["interruptedByRestart"])
        self.assertEqual(after["error"]["code"], "ENGINE_UNAVAILABLE")
        self.assertEqual(repo.queue_depth(self.conn), 0)

    def test_selection_requires_a_completed_generation_of_the_current_brief(self):
        job, _ = repo.create_generation(
            self.conn, self.project["id"], self.brief_version_id,
            idempotency_key="key-6", request_hash="h6", settings={},
        )
        with self.assertRaises(repo.NotFound):
            repo.select_layout(self.conn, self.project["id"], "missing",
                               expected_project_revision=self.project["revision"])
        repo.transition(self.conn, job["id"], status="INFEASIBLE",
                        finished_at=repo.now_iso(),
                        error_json={"code": "NO_VALID_LAYOUT"})

    def test_event_payload_is_bounded(self):
        repo.record_event(self.conn, self.project["id"], "LAYOUT_VIEWED", {"layoutId": "l"})
        with self.assertRaises(ValueError):
            repo.record_event(self.conn, self.project["id"], "LAYOUT_VIEWED",
                              {"blob": "x" * 5000})


if __name__ == "__main__":
    unittest.main()
