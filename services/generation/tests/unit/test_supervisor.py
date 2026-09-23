"""S04 tests: supervision loop with an injected fake worker (no engine needed)."""
import json
import sys
import tempfile
import time
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
from planlab_service.database import migrate  # noqa: E402
from planlab_service.database import session as connect  # noqa: E402
from planlab_service.supervisor import Supervisor  # noqa: E402

FIXTURES = REPO_ROOT / "test" / "integration" / "fixtures"
VERSIONS = {
    "engineVersion": "geometry_engine_v1",
    "engineSourceSha256": "a" * 64,
    "modelVersion": "topology_v1",
    "checkpointId": "full_v1a/best",
    "checkpointSha256": "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8",
    "vocabularySha256": "b" * 64,
    "serviceVersion": "0.1.0",
    "contractVersion": "planlab.generation/1",
    "pythonVersion": "3.14.7",
    "torchVersion": "2.9.0+cu129",
    "ortoolsVersion": "9.15.6755",
}


def brief():
    payload = json.loads((FIXTURES / "brief-B.json").read_text(encoding="utf-8"))["payload"]
    return BriefV1.model_validate(payload)


def layout_for(job_id, project_id, brief_version_id):
    payload = json.loads((FIXTURES / "layout-B.json").read_text(encoding="utf-8"))["payload"]
    payload.update(
        {
            "generationId": job_id,
            "projectId": project_id,
            "briefVersionId": brief_version_id,
            "layoutId": "11111111-1111-4111-8111-111111111111",
        }
    )
    return payload


class FakeWorker:
    """Scripted worker: emits a ready message, then a stage + result per job."""

    def __init__(self, behaviour="completed"):
        self.behaviour = behaviour
        self.inbox = []
        self.outbox = [{"type": "ready", "versions": VERSIONS}]
        self.terminated = False

    def send(self, message):
        if message.get("type") != "generate":
            return
        token = message["runToken"]
        if self.behaviour == "crash":
            self.outbox.append({"type": "crashed", "runToken": token,
                                "generationId": message["generationId"],
                                "detail": "simulated crash"})
            return
        self.outbox.append({"type": "stage", "runToken": token,
                            "generationId": message["generationId"], "stage": "SOLVING"})
        if self.behaviour == "infeasible":
            self.outbox.append({
                "type": "result", "runToken": token, "generationId": message["generationId"],
                "status": "INFEASIBLE", "layouts": [], "warnings": [],
                "diagnostics": {"attemptStatuses": ["INFEASIBLE"]},
                "versions": VERSIONS,
                "error": {"code": "NO_VALID_LAYOUT", "category": "architectural",
                          "message": "no layout", "retryable": False,
                          "proof": "limited_search", "fieldErrors": [],
                          "remediation": [], "correlationId": "fake"},
            })
            return
        self.outbox.append({
            "type": "result", "runToken": token, "generationId": message["generationId"],
            "status": "COMPLETED",
            "layouts": [layout_for(message["generationId"], message["projectId"],
                                   message["briefVersionId"])],
            "warnings": [], "diagnostics": {"attemptStatuses": ["FEASIBLE"]},
            "versions": VERSIONS, "error": None,
        })

    def poll(self, timeout):
        if self.outbox:
            return self.outbox.pop(0)
        if timeout:
            time.sleep(min(timeout, 0.05))
        return None

    def wait_ready(self, deadline_s):
        return VERSIONS

    def terminate(self):
        self.terminated = True


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s04-sup-"))
        self.db = self.tmp / "planlab.sqlite3"
        self.workers = []

    def make_supervisor(self, behaviour="completed"):
        def factory():
            worker = FakeWorker(behaviour)
            self.workers.append(worker)
            return worker

        supervisor = Supervisor(self.db, worker_factory=factory)
        self.assertTrue(supervisor.start())
        return supervisor

    def submit(self, supervisor):
        migrate(self.db)
        with connect(self.db) as conn:
            project = repo.create_project(conn, "Supervised")
            saved = repo.save_brief_version(
                conn, project["id"], expected_project_revision=1,
                brief_json=brief().model_dump(mode="json"),
                editor_document_json={"schemaVersion": "planlab.editor/2", "name": "x",
                                      "roomGroups": [], "legacyImport": None},
                brief_hash=brief_sha256(brief()),
            )
            project = repo.get_project(conn, project["id"])
        job, created = supervisor.submit(
            project["id"], saved["briefVersionId"], brief(),
            idempotency_key="sup-1", correlation_id="token-1",
        )
        self.assertTrue(created)
        self.assertEqual(job["status"], "QUEUED")
        return project, job

    def test_dispatch_records_progress_and_completion(self):
        supervisor = self.make_supervisor("completed")
        project, job = self.submit(supervisor)
        supervisor.step()  # dispatch
        supervisor.step()  # drain stage + result
        with connect(self.db) as conn:
            finished = repo.get_generation(conn, job["id"])
            layouts = repo.list_layouts(conn, job["id"])
        self.assertEqual(finished["status"], "COMPLETED")
        self.assertIsNone(finished["error"])
        self.assertEqual(len(layouts), 1)
        self.assertEqual(layouts[0]["projectId"], project["id"])
        supervisor.stop()

    def test_infeasible_job_keeps_its_architectural_problem(self):
        supervisor = self.make_supervisor("infeasible")
        _project, job = self.submit(supervisor)
        supervisor.step()
        supervisor.step()
        with connect(self.db) as conn:
            finished = repo.get_generation(conn, job["id"])
        self.assertEqual(finished["status"], "INFEASIBLE")
        self.assertEqual(finished["error"]["category"], "architectural")
        self.assertEqual(finished["error"]["proof"], "limited_search")
        supervisor.stop()

    def test_worker_crash_fails_the_job_and_replaces_the_worker(self):
        supervisor = self.make_supervisor("crash")
        _project, job = self.submit(supervisor)
        supervisor.step()
        supervisor.step()
        with connect(self.db) as conn:
            finished = repo.get_generation(conn, job["id"])
        self.assertEqual(finished["status"], "FAILED")
        self.assertEqual(finished["error"]["code"], "INTERNAL_GENERATION_ERROR")
        self.assertTrue(self.workers[0].terminated)
        self.assertEqual(len(self.workers), 2, "a fresh worker must be spawned")
        supervisor.stop()


if __name__ == "__main__":
    unittest.main()
