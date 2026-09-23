"""S05 tests: HTTP contract, error envelope and the security boundary."""
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

from fastapi.testclient import TestClient  # noqa: E402

from planlab_service import repository as repo  # noqa: E402
from planlab_service.app import create_app  # noqa: E402
from planlab_service.config import Settings  # noqa: E402
from planlab_service.contracts import BriefV1, brief_sha256  # noqa: E402
from planlab_service.database import session as connect  # noqa: E402

FIXTURES = REPO_ROOT / "test" / "integration" / "fixtures"
BASE = "http://127.0.0.1:8010"
HEADERS = {"X-PlanLab-Client": "1"}
VERSIONS = {
    "engineVersion": "geometry_engine_v1", "engineSourceSha256": "a" * 64,
    "modelVersion": "topology_v1", "checkpointId": "full_v1a/best",
    "checkpointSha256": "b" * 64, "vocabularySha256": "c" * 64,
    "serviceVersion": "0.1.0", "contractVersion": "planlab.generation/1",
    "pythonVersion": "3.14.7", "torchVersion": "2.9.0+cu129", "ortoolsVersion": "9.15.6755",
}


def fixture_brief():
    payload = json.loads((FIXTURES / "brief-B.json").read_text(encoding="utf-8"))["payload"]
    return BriefV1.model_validate(payload)


class FakeSupervisor:
    """Stands in for the real supervisor: same surface, no engine."""

    def __init__(self, settings, ready=True):
        self.settings = settings
        self.versions = VERSIONS if ready else None
        self.ready = ready
        self.load_failure = None if ready else "model unavailable"
        self.started = False
        self.cancelled = []

    def start(self):
        self.started = True
        return self.ready

    def stop(self):
        self.started = False

    def submit(self, project_id, brief_version_id, brief, *, idempotency_key,
               settings=None, correlation_id=None):
        with connect(self.settings.db_path) as conn:
            conn.execute("BEGIN")
            try:
                job, created = repo.create_generation(
                    conn, project_id, brief_version_id,
                    idempotency_key=idempotency_key,
                    request_hash=brief_sha256(brief),
                    settings=settings or {"topK": brief.settings.topK},
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return job, created

    def cancel(self, generation_id):
        self.cancelled.append(generation_id)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s05-api-"))
        self.settings = Settings(
            data_dir=self.tmp,
            static_dir=None,
            debug=False,
            engine_root=Path("E:/Projects/floor-plan-model"),
        )
        self.app = create_app(
            self.settings,
            supervisor_factory=lambda cfg: FakeSupervisor(cfg),
        )
        self.client = TestClient(self.app, base_url=BASE)
        self.client.__enter__()
        self.brief = fixture_brief()
        project = self.client.post(
            "/api/v1/projects", json={"name": "API test"}, headers=HEADERS
        ).json()
        self.project_id = project["projectId"]
        saved = self.client.post(
            f"/api/v1/projects/{self.project_id}/brief-versions",
            json={
                "expectedProjectRevision": project["revision"],
                "brief": self.brief.model_dump(mode="json"),
                "editorDocument": {
                    "schemaVersion": "planlab.editor/2", "name": "API test",
                    "roomGroups": [{"requirementId": "living", "label": "Living Room 1",
                                    "type": "living", "roomClass": "standard",
                                    "quantity": 1, "required": True,
                                    "instanceIds": ["L1"], "retiredInstanceIds": []}],
                    "legacyImport": None,
                },
            },
            headers=HEADERS,
        ).json()
        self.brief_version_id = saved["briefVersionId"]
        self.project_revision = saved["projectRevision"]

    def tearDown(self):
        self.client.__exit__(None, None, None)

    # ------------------------------------------------------------ health ----
    def test_health_endpoints(self):
        live = self.client.get("/api/v1/health/live")
        self.assertEqual(live.status_code, 200)
        self.assertEqual(live.headers["cache-control"], "no-store")
        ready = self.client.get("/api/v1/health/ready")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["status"], "ready")

    def test_readiness_is_503_when_the_model_is_unavailable(self):
        # its own data directory: this test is about the model, not the service lock
        offline_settings = Settings(data_dir=Path(tempfile.mkdtemp(prefix="s05-ready-")),
                                    static_dir=None)
        app = create_app(offline_settings,
                         supervisor_factory=lambda cfg: FakeSupervisor(cfg, ready=False))
        with TestClient(app, base_url=BASE) as client:
            response = client.get("/api/v1/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["reason"], "model_unavailable")
        self.assertNotIn("E:/", json.dumps(response.json()))

    # ---------------------------------------------------------- projects ----
    def test_project_creation_and_listing(self):
        self.assertEqual(self.project_revision, 2)
        listing = self.client.get("/api/v1/projects").json()
        self.assertEqual(listing["items"][0]["projectId"], self.project_id)
        detail = self.client.get(f"/api/v1/projects/{self.project_id}").json()
        self.assertEqual(detail["brief"]["site"]["widthMm"], 14117)
        self.assertEqual(detail["activeGenerationId"], None)

    def test_invalid_project_name_uses_the_error_envelope(self):
        response = self.client.post("/api/v1/projects", json={"name": ""}, headers=HEADERS)
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["schemaVersion"], "planlab.generation/1")
        self.assertEqual(body["error"]["code"], "INVALID_BRIEF")
        self.assertEqual(body["error"]["category"], "input")
        self.assertTrue(body["error"]["correlationId"])

    def test_stale_revision_conflicts(self):
        changed = self.brief.model_dump(mode="json")
        changed["rooms"][0]["targetAreaM2"] = 15.5
        response = self.client.post(
            f"/api/v1/projects/{self.project_id}/brief-versions",
            json={"expectedProjectRevision": 99,
                  "brief": changed,
                  "editorDocument": {"schemaVersion": "planlab.editor/2", "name": "x",
                                     "roomGroups": [{"requirementId": "living",
                                                     "label": "Living Room 1",
                                                     "type": "living",
                                                     "roomClass": "standard",
                                                     "quantity": 1, "required": True,
                                                     "instanceIds": ["L1"],
                                                     "retiredInstanceIds": []}],
                                     "legacyImport": None}},
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "CONFLICT")

    def test_invalid_brief_reports_field_errors_and_never_calls_the_engine(self):
        broken = self.brief.model_dump(mode="json")
        broken["site"]["widthMm"] = "14117"
        response = self.client.post(
            f"/api/v1/projects/{self.project_id}/brief-versions",
            json={"expectedProjectRevision": self.project_revision, "brief": broken,
                  "editorDocument": {"schemaVersion": "planlab.editor/2", "name": "x",
                                     "roomGroups": [{"requirementId": "living",
                                                     "label": "Living Room 1",
                                                     "type": "living",
                                                     "roomClass": "standard",
                                                     "quantity": 1, "required": True,
                                                     "instanceIds": ["L1"],
                                                     "retiredInstanceIds": []}],
                                     "legacyImport": None}},
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 422)
        self.assertTrue(response.json()["error"]["fieldErrors"])
        self.assertEqual(self.app.state.supervisor.__dict__.get("submissions", 0), 0)

    # ------------------------------------------------------- generations ----
    def test_generation_returns_202_with_location_and_is_idempotent(self):
        body = {
            "schemaVersion": "planlab.generation/1",
            "projectId": self.project_id,
            "briefVersionId": self.brief_version_id,
            "idempotencyKey": "api-key-1",
        }
        first = self.client.post("/api/v1/generations", json=body, headers=HEADERS)
        self.assertEqual(first.status_code, 202)
        self.assertTrue(first.headers["location"].endswith(first.json()["generationId"]))
        self.assertEqual(first.json()["status"], "QUEUED")
        second = self.client.post("/api/v1/generations", json=body, headers=HEADERS)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(second.json()["generationId"], first.json()["generationId"])

    def test_generation_conflict_and_unknown_brief(self):
        body = {
            "schemaVersion": "planlab.generation/1", "projectId": self.project_id,
            "briefVersionId": self.brief_version_id, "idempotencyKey": "api-key-2",
        }
        self.client.post("/api/v1/generations", json=body, headers=HEADERS)
        conflict = self.client.post(
            "/api/v1/generations",
            json={**body, "idempotencyKey": "api-key-3"}, headers=HEADERS,
        )
        self.assertEqual(conflict.status_code, 409)
        missing = self.client.post(
            "/api/v1/generations",
            json={"schemaVersion": "planlab.generation/1", "projectId": self.project_id,
                  "briefVersionId": "00000000-0000-4000-8000-000000000000",
                  "idempotencyKey": "api-key-4"},
            headers=HEADERS,
        )
        self.assertEqual(missing.status_code, 404)

    def test_generation_status_layouts_cancel_and_selection(self):
        body = {
            "schemaVersion": "planlab.generation/1", "projectId": self.project_id,
            "briefVersionId": self.brief_version_id, "idempotencyKey": "api-key-5",
        }
        job = self.client.post("/api/v1/generations", json=body, headers=HEADERS).json()
        status = self.client.get(f"/api/v1/generations/{job['generationId']}")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "QUEUED")
        layouts = self.client.get(f"/api/v1/generations/{job['generationId']}/layouts").json()
        self.assertEqual(layouts["layouts"], [])
        cancel = self.client.post(
            f"/api/v1/generations/{job['generationId']}/cancel", json={}, headers=HEADERS
        )
        self.assertEqual(cancel.status_code, 202)
        self.assertTrue(cancel.json()["cancelRequested"])
        selection = self.client.put(
            f"/api/v1/projects/{self.project_id}/selection",
            json={"layoutId": "11111111-1111-4111-8111-111111111111",
                  "expectedProjectRevision": self.project_revision},
            headers=HEADERS,
        )
        self.assertEqual(selection.status_code, 404)

    def test_debug_route_is_hidden_unless_enabled(self):
        body = {
            "schemaVersion": "planlab.generation/1", "projectId": self.project_id,
            "briefVersionId": self.brief_version_id, "idempotencyKey": "api-key-6",
        }
        job = self.client.post("/api/v1/generations", json=body, headers=HEADERS).json()
        response = self.client.get(f"/api/v1/generations/{job['generationId']}/debug")
        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------- security boundary ----
    def test_unknown_api_path_is_json_404(self):
        response = self.client.get("/api/v1/does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "NOT_FOUND")
        self.assertNotIn("<html", response.text.lower())

    def test_missing_client_header_is_refused(self):
        response = self.client.post("/api/v1/projects", json={"name": "nope"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("X-PlanLab-Client", response.json()["error"]["message"])

    def test_foreign_origin_is_refused(self):
        response = self.client.post(
            "/api/v1/projects", json={"name": "nope"},
            headers={**HEADERS, "Origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)

    def test_host_header_must_be_loopback(self):
        response = self.client.get("/api/v1/health/live", headers={"Host": "example.com"})
        self.assertEqual(response.status_code, 421)

    def test_oversized_body_is_refused(self):
        response = self.client.post(
            "/api/v1/projects",
            json={"name": "x" * (129 * 1024)},
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 413)

    def test_wrong_content_type_is_refused(self):
        response = self.client.post(
            "/api/v1/projects", content="name=x",
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        )
        self.assertEqual(response.status_code, 415)

    def test_loopback_only_configuration_is_enforced(self):
        with self.assertRaises(ValueError):
            Settings(host="0.0.0.0").validate()
        with self.assertRaises(ValueError):
            Settings(max_active_jobs=4).validate()
        with self.assertRaises(ValueError):
            Settings(solver_workers=32).validate()


if __name__ == "__main__":
    unittest.main()
