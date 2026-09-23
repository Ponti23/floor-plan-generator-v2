"""S10 tests: structured JSONL fields, rotation setup and redaction."""
import json
import logging
import sys
import tempfile
import unittest
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO = UNIT.parents[3]
for candidate in (SERVICE, REPO / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service import logging as planlab_logging  # noqa: E402
from planlab_service.logging import (  # noqa: E402
    BACKUP_COUNT,
    LOG_FILENAME,
    MAX_BYTES,
    configure,
    job_event,
    log_event,
    redact,
)


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s10-log-"))
        logger = logging.getLogger("planlab.generation")
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        if hasattr(logger, "_planlab_configured"):
            delattr(logger, "_planlab_configured")
        self.logger = configure(self.tmp, to_stdout=False)

    def read_lines(self):
        path = self.tmp / LOG_FILENAME
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    def test_events_are_one_json_object_per_line_with_structured_fields(self):
        job_event(
            self.logger, "job.stage", correlation_id="corr-1", generation_id="gen-1",
            stage="SOLVING", status="SOLVING", duration_ms=1234, solver_status="FEASIBLE",
            validation_passed=True, worker_pid=4242, run_token="token-1",
            engine_version="geometry_engine_v1",
            checkpoint_sha256="3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8",
        )
        lines = self.read_lines()
        self.assertEqual(len(lines), 1)
        record = lines[0]
        for field in ("timestamp", "level", "event", "correlation_id", "generation_id",
                      "stage", "status", "duration_ms", "solver_status",
                      "validation_passed", "worker_pid", "run_token", "engine_version",
                      "checkpoint_sha256"):
            self.assertIn(field, record, field)
        self.assertEqual(record["event"], "job.stage")
        self.assertEqual(record["stage"], "SOLVING")
        self.assertEqual(record["duration_ms"], 1234)
        self.assertEqual(record["validation_passed"], True)
        self.assertTrue(record["level"])

    def test_absolute_paths_and_secrets_never_reach_the_log(self):
        log_event(
            self.logger,
            "engine.load",
            checkpoint_path="E:/Projects/floor-plan-model/topology_v1/checkpoints/full_v1a/best.pt",
            api_key="sk-live-abcdef1234567890",
            note="see C:\\Users\\ponti\\.env for details",
        )
        raw = (self.tmp / LOG_FILENAME).read_text(encoding="utf-8")
        record = self.read_lines()[0]
        self.assertNotIn("floor-plan-model", raw)
        self.assertNotIn("sk-live", raw)
        self.assertNotIn("C:\\Users\\ponti\\.env", raw)
        self.assertEqual(record["checkpoint_path"], "[path]")
        self.assertEqual(record["api_key"], "[redacted]")
        self.assertIn("[path]", record["note"])

    def test_redaction_walks_nested_structures(self):
        cleaned = redact({
            "outer": {"token": "abc", "path": "E:/secret/model.pt"},
            "list": ["C:/tmp/file", "plain"],
        })
        self.assertEqual(cleaned["outer"]["token"], "[redacted]")
        self.assertEqual(cleaned["outer"]["path"], "[path]")
        self.assertEqual(cleaned["list"][0], "[path]")
        self.assertEqual(cleaned["list"][1], "plain")

    def test_rotation_is_bounded_and_debug_is_opt_in(self):
        handler = self.logger.handlers[0]
        self.assertEqual(handler.maxBytes, MAX_BYTES)
        self.assertEqual(handler.backupCount, BACKUP_COUNT)
        self.assertEqual(self.logger.level, logging.INFO)
        configured = configure(self.tmp, debug=True, to_stdout=False)
        self.assertEqual(configured.level, logging.DEBUG, "debug is opt-in per call")
        self.assertEqual(len(configured.handlers), 1, "handlers are never duplicated")

    def test_configuring_twice_does_not_duplicate_handlers(self):
        before = len(self.logger.handlers)
        configure(self.tmp, to_stdout=False)
        self.assertEqual(len(self.logger.handlers), before)

    def test_errors_keep_a_bounded_traceback(self):
        try:
            raise ValueError("engine exploded at E:/secret/path.py")
        except ValueError:
            self.logger.error("engine.failed", exc_info=True,
                              extra={"event": "engine.failed", "correlation_id": "corr-2"})
        record = self.read_lines()[-1]
        self.assertEqual(record["event"], "engine.failed")
        self.assertIn("exception", record)
        self.assertNotIn("E:/secret", json.dumps(record))
        self.assertLessEqual(len(record["exception"]), 2000)


if __name__ == "__main__":
    unittest.main()
