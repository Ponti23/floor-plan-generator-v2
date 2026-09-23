"""S05 integration test: service lock ownership, readiness and release-mode assets."""
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

from planlab_service.app import create_app  # noqa: E402
from planlab_service.config import Settings  # noqa: E402

BASE = "http://127.0.0.1:8010"


class ReadySupervisor:
    def __init__(self, settings):
        self.settings = settings
        self.ready = True
        self.versions = {"engineVersion": "geometry_engine_v1"}
        self.load_failure = None
        self.stopped = False

    def start(self):
        return True

    def stop(self):
        self.stopped = True

    def submit(self, *args, **kwargs):  # pragma: no cover - not exercised here
        raise AssertionError("not used")

    def cancel(self, generation_id):  # pragma: no cover
        return None


class ServiceLifecycleTests(unittest.TestCase):
    def test_second_service_on_the_same_data_dir_is_refused(self):
        tmp = Path(tempfile.mkdtemp(prefix="s05-life-"))
        settings = Settings(data_dir=tmp, static_dir=None)
        first = create_app(settings, supervisor_factory=ReadySupervisor)
        with TestClient(first, base_url=BASE) as client:
            self.assertEqual(client.get("/api/v1/health/ready").status_code, 200)
            second = create_app(settings, supervisor_factory=ReadySupervisor)
            with TestClient(second, base_url=BASE) as other:
                response = other.get("/api/v1/health/ready")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["reason"], "service_lock_held")
            # the first service keeps working after the refused one exits
            self.assertEqual(client.get("/api/v1/health/ready").status_code, 200)
        # once the owner exits, a new service can take the lock
        third = create_app(settings, supervisor_factory=ReadySupervisor)
        with TestClient(third, base_url=BASE) as client:
            self.assertEqual(client.get("/api/v1/health/ready").status_code, 200)

    def test_release_mode_serves_the_built_app_and_keeps_api_404s_json(self):
        tmp = Path(tempfile.mkdtemp(prefix="s05-static-"))
        dist = tmp / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text(
            "<!doctype html><html><body>PlanLab shell</body></html>", encoding="utf-8"
        )
        (dist / "assets" / "app.js").write_text("console.log('planlab');", encoding="utf-8")
        settings = Settings(data_dir=tmp / "data", static_dir=dist)
        app = create_app(settings, supervisor_factory=ReadySupervisor)
        with TestClient(app, base_url=BASE) as client:
            index = client.get("/")
            self.assertEqual(index.status_code, 200)
            self.assertIn("PlanLab shell", index.text)
            asset = client.get("/assets/app.js")
            self.assertEqual(asset.status_code, 200)
            missing = client.get("/api/v1/nope")
            self.assertEqual(missing.status_code, 404)
            self.assertEqual(missing.json()["error"]["code"], "NOT_FOUND")
            self.assertNotIn("<html", missing.text.lower())
            # a deep link still serves the shell, an unknown api path never does
            self.assertIn("PlanLab shell", client.get("/editor/deep-link").text)

    def test_saved_projects_stay_readable_when_the_model_is_unavailable(self):
        tmp = Path(tempfile.mkdtemp(prefix="s05-offline-"))
        settings = Settings(data_dir=tmp, static_dir=None)
        good = create_app(settings, supervisor_factory=ReadySupervisor)
        with TestClient(good, base_url=BASE) as client:
            created = client.post(
                "/api/v1/projects", json={"name": "Saved project"},
                headers={"X-PlanLab-Client": "1"},
            ).json()

        class Unready(ReadySupervisor):
            def __init__(self, cfg):
                super().__init__(cfg)
                self.ready = False
                self.versions = None
                self.load_failure = "checkpoint missing"

        offline = create_app(settings, supervisor_factory=Unready)
        with TestClient(offline, base_url=BASE) as client:
            self.assertEqual(client.get("/api/v1/health/ready").status_code, 503)
            listed = client.get("/api/v1/projects").json()
            self.assertEqual(listed["items"][0]["projectId"], created["projectId"])
            detail = client.get(f"/api/v1/projects/{created['projectId']}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["name"], "Saved project")


if __name__ == "__main__":
    unittest.main()
