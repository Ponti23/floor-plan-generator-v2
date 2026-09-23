"""Structured JSONL logging for the generation service (S10, plan sections 9-10)."""
from __future__ import annotations

import json
import logging
import logging.handlers
import re
import time
from pathlib import Path

LOG_FILENAME = "generation.jsonl"
MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5

STRUCTURED_FIELDS = (
    "timestamp",
    "level",
    "event",
    "correlation_id",
    "generation_id",
    "project_id",
    "brief_version_id",
    "stage",
    "candidate_id",
    "status",
    "duration_ms",
    "solver_status",
    "validation_passed",
    "worker_pid",
    "run_token",
    "engine_version",
    "checkpoint_sha256",
)

SECRET_KEY_HINTS = ("secret", "token", "password", "api_key", "apikey", "authorization")
STANDARD_RECORD_KEYS = frozenset({
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module",
    "exc_info", "exc_text", "stack_info", "lineno", "funcName", "created", "msecs",
    "relativeCreated", "thread", "threadName", "processName", "process", "taskName",
    "message", "asctime",
})
ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\)[^\s\"']+")
SECRET_VALUE = re.compile(r"\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b")


def redact(value):
    """Remove filesystem paths and secret-looking values from anything logged."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if any(hint in str(key).lower() for hint in SECRET_KEY_HINTS):
                out[key] = "[redacted]"
            else:
                out[key] = redact(item)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str):
        cleaned = SECRET_VALUE.sub("[redacted]", value)
        cleaned = ABSOLUTE_PATH.sub("[path]", cleaned)
        return cleaned
    return value


class JsonlFormatter(logging.Formatter):
    """One JSON object per line, with the plan's structured field names."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "event": getattr(record, "event", record.getMessage()),
        }
        for field in STRUCTURED_FIELDS:
            if field in ("timestamp", "level", "event"):
                continue
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = redact(value)
        # any other caller-supplied extra is kept too, so evidence is never dropped
        for key, value in record.__dict__.items():
            if key in STANDARD_RECORD_KEYS or key in payload or key.startswith("_"):
                continue
            payload[key] = redact(value)
        message = record.getMessage()
        if message and message != payload["event"]:
            payload["message"] = redact(message)
        if record.exc_info and record.levelno >= logging.ERROR:
            payload["exception"] = redact(self.formatException(record.exc_info))[-2000:]
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def configure(log_dir, *, debug: bool = False, to_stdout: bool = True) -> logging.Logger:
    """Attach the rotating JSONL handler and optionally stdout; idempotent."""
    logger = logging.getLogger("planlab.generation")
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    logger.propagate = False
    if getattr(logger, "_planlab_configured", False):
        return logger

    directory = Path(log_dir)
    directory.mkdir(parents=True, exist_ok=True)
    formatter = JsonlFormatter()
    file_handler = logging.handlers.RotatingFileHandler(
        directory / LOG_FILENAME,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    if to_stdout:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    logger._planlab_configured = True  # type: ignore[attr-defined]
    return logger


def log_event(logger: logging.Logger, event: str, *, level: int = logging.INFO, **fields) -> dict:
    """Emit one structured event and return the payload that was written."""
    payload = {key: redact(value) for key, value in fields.items() if value is not None}
    logger.log(level, event, extra={"event": event, **payload})
    return {"event": event, **payload}


def job_event(logger: logging.Logger, event: str, *, correlation_id: str,
              generation_id: str, stage: str, **fields) -> dict:
    return log_event(
        logger,
        event,
        correlation_id=correlation_id,
        generation_id=generation_id,
        stage=stage,
        **fields,
    )
