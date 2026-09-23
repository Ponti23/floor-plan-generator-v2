"""Job supervision: one active job at a time, owned worker, run tokens, recovery (S04)."""
from __future__ import annotations

import multiprocessing as mp
import os
import threading
import time
import uuid
from pathlib import Path

from . import repository as repo
from .contracts import BriefV1, brief_sha256
from .database import migrate
from .database import session as connect

DEFAULT_JOB_DEADLINE_S = 360
WORKER_WARMUP_DEADLINE_S = 45
POLL_SECONDS = 0.2


class Supervisor:
    """Owns one worker process and drives queued jobs to a durable terminal state."""

    def __init__(
        self,
        db_path,
        *,
        engine_root=None,
        overlay=None,
        solver_workers=8,
        job_deadline_s=DEFAULT_JOB_DEADLINE_S,
        worker_factory=None,
    ) -> None:
        self.db_path = Path(db_path)
        self.engine_root = engine_root or os.environ.get("PLANLAB_ENGINE_ROOT")
        self.overlay = overlay
        self.solver_workers = int(solver_workers)
        self.job_deadline_s = float(job_deadline_s)
        self.worker_factory = worker_factory or self._spawn_worker
        self.worker = None
        self.versions = None
        self.run_token = None
        self.started_at = None
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()
        self.load_failure: str | None = None

    # ------------------------------------------------------------- lifecycle
    def _spawn_worker(self):
        parent, child = mp.Pipe()
        process = mp.Process(
            target=_worker_entry,
            args=(child, self.engine_root, self.overlay, self.solver_workers),
            daemon=True,
        )
        process.start()
        child.close()
        return _ProcessWorker(parent, process)

    def start(self) -> bool:
        migrate(self.db_path)
        with connect(self.db_path) as conn:
            recovered = repo.recover_interrupted(conn)
        self.recovered = recovered
        self.worker = self.worker_factory()
        deadline = time.time() + WORKER_WARMUP_DEADLINE_S
        while time.time() < deadline:
            message = self.worker.poll(0.5)
            if message is None:
                continue
            if message.get("type") == "ready":
                self.versions = message["versions"]
                self.started_at = time.time()
                return True
            if message.get("type") == "load_failed":
                self.load_failure = message.get("detail", "engine load failed")
                return False
        self.load_failure = "worker warmup deadline exceeded"
        return False

    def retry_warmup(self) -> bool:
        if self.worker is not None:
            self.worker.terminate()
        self.worker = None
        self.load_failure = None
        return self.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self.worker is not None:
            self.worker.terminate()
            self.worker = None

    @property
    def ready(self) -> bool:
        return self.worker is not None and self.versions is not None

    # ---------------------------------------------------------------- submit
    def submit(
        self,
        project_id,
        brief_version_id,
        brief: BriefV1,
        *,
        idempotency_key,
        settings=None,
        correlation_id=None,
    ) -> tuple[dict, bool]:
        payload = brief.model_dump(mode="json")
        request_hash = brief_sha256(brief)
        with connect(self.db_path) as conn:
            job, created = repo.create_generation(
                conn,
                project_id,
                brief_version_id,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                settings=settings or {
                    "topK": brief.settings.topK,
                    "topN": brief.settings.topN,
                    "solverTimeLimitS": brief.settings.solverTimeLimitS,
                    "seed": brief.settings.seed,
                },
            )
            if created:
                repo.record_event(
                    conn, project_id, "REGENERATE_REQUESTED",
                    {"generationId": job["id"]},
                    generation_id=job["id"], brief_version_id=brief_version_id,
                )
            conn.execute(
                "UPDATE generations SET run_token = ? WHERE id = ?",
                (correlation_id or repo.new_id(), job["id"]),
            )
            job = repo.get_generation(conn, job["id"])
        return job, created

    # ----------------------------------------------------------------- loop
    def run_forever(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.step()
            except Exception:  # noqa: BLE001 - the loop must survive one bad job
                pass
            self._stop.wait(POLL_SECONDS)

    def step(self) -> None:
        """Drain worker messages, then dispatch the next queued job if idle."""
        with self._lock:
            self._drain()
            self._dispatch()

    def _drain(self) -> None:
        if self.worker is None:
            return
        while True:
            message = self.worker.poll(0)
            if message is None:
                return
            kind = message.get("type")
            if kind == "stage":
                with connect(self.db_path) as conn:
                    repo.set_progress(
                        conn, message["generationId"], message["stage"]
                    )
            elif kind == "result":
                self._finish(message)
            elif kind == "crashed":
                self._fail(message["generationId"], "INTERNAL_GENERATION_ERROR",
                           message.get("detail", "worker crashed"))
                self._replace_worker()
            elif kind == "load_failed":
                self.load_failure = message.get("detail")
                self.versions = None

    def _finish(self, message: dict) -> None:
        with connect(self.db_path) as conn:
            job = repo.get_generation(conn, message["generationId"])
            if job is None:
                return
            if job["run_token"] != message.get("runToken"):
                return  # obsolete token: never commit
            if message["status"] == "COMPLETED":
                versions = self._versions_model(message)
                repo.persist_completed(
                    conn,
                    job["id"],
                    versions=versions,
                    diagnostics=message.get("diagnostics") or {},
                    warnings=message.get("warnings") or [],
                    layouts=_layouts(message),
                    raw_records=message.get("rawRecords")
                    or [None for _ in _layouts(message)],
                )
            else:
                repo.transition(
                    conn,
                    job["id"],
                    status=message["status"],
                    finished_at=repo.now_iso(),
                    error_json=message.get("error"),
                    warnings_json=message.get("warnings") or [],
                    versions_json=message.get("versions"),
                    diagnostics_json=message.get("diagnostics") or {},
                )

    def _fail(self, generation_id, code, detail) -> None:
        from . import errors as E

        with connect(self.db_path) as conn:
            job = repo.get_generation(conn, generation_id)
            if job is None or job["status"] in repo.TERMINAL_STATUSES:
                return
            problem = E.problem(code, detail[:400], f"worker-{generation_id}")
            repo.transition(
                conn, generation_id, status="FAILED", finished_at=repo.now_iso(),
                error_json=problem.model_dump(mode="json"),
            )

    def _replace_worker(self) -> None:
        if self.worker is not None:
            self.worker.terminate()
        self.versions = None
        self.worker = self.worker_factory()

    def _dispatch(self) -> None:
        with connect(self.db_path) as conn:
            active = conn.execute(
                "SELECT id FROM generations WHERE status IN"
                " ('LOADING_MODEL','GENERATING_TOPOLOGIES','SOLVING','VALIDATING','RANKING')"
                " LIMIT 1"
            ).fetchone()
            if active is not None:
                return
            queued = conn.execute(
                "SELECT * FROM generations WHERE status = 'QUEUED'"
                " ORDER BY created_at LIMIT 1"
            ).fetchone()
            if queued is None:
                return
            job = dict(queued)
            brief_record = repo.get_brief_version(conn, job["brief_version_id"])
            repo.transition(conn, job["id"], status="GENERATING_TOPOLOGIES",
                            started_at=repo.now_iso())
            repo.set_progress(conn, job["id"], "GENERATING_TOPOLOGIES")
        try:
            if self.versions is None and self.worker is not None:
                self.versions = self.worker.wait_ready(WORKER_WARMUP_DEADLINE_S)
            self.worker.send({
                "type": "generate",
                "runToken": job["run_token"],
                "generationId": job["id"],
                "projectId": job["project_id"],
                "briefVersionId": job["brief_version_id"],
                "correlationId": job["run_token"],
                "brief": brief_record["brief"],
            })
        except Exception as exc:  # noqa: BLE001
            self._fail(job["id"], "ENGINE_UNAVAILABLE", f"{type(exc).__name__}: {exc}")

    def _versions_model(self, message: dict):
        from .contracts import EngineVersionsV1

        payload = message.get("versions") or self.versions
        return EngineVersionsV1.model_validate(payload)


def _layouts(message: dict):
    from .contracts import LayoutV1

    return [LayoutV1.model_validate(payload) for payload in message.get("layouts") or []]


def _worker_entry(child, engine_root, overlay, solver_workers) -> None:
    from .worker import worker_main

    try:
        worker_main(child, engine_root=engine_root, overlay=overlay,
                    solver_workers=solver_workers)
    except Exception:  # noqa: BLE001 - the parent observes EOF and replaces us
        try:
            child.close()
        except Exception:  # noqa: BLE001
            pass


class _ProcessWorker:
    """Thin adapter over a spawned process so tests can inject a fake worker."""

    def __init__(self, connection, process) -> None:
        self.connection = connection
        self.process = process

    @property
    def pid(self):
        return self.process.pid

    def send(self, message) -> None:
        self.connection.send(message)

    def poll(self, timeout: float):
        if self.connection.poll(timeout):
            try:
                return self.connection.recv()
            except EOFError:
                return {"type": "crashed", "detail": "worker exited"}
        return None

    def wait_ready(self, deadline_s: float):
        end = time.time() + float(deadline_s)
        while time.time() < end:
            message = self.poll(0.5)
            if message is None:
                continue
            if message.get("type") == "ready":
                return message["versions"]
            if message.get("type") == "load_failed":
                raise RuntimeError(message.get("detail", "engine load failed"))
        raise RuntimeError("worker warmup deadline exceeded")

    def terminate(self) -> None:
        try:
            self.connection.send({"type": "shutdown"})
        except Exception:  # noqa: BLE001
            pass
        self.process.join(timeout=5)
        if self.process.is_alive():
            self.process.kill()
            self.process.join(timeout=5)
        try:
            self.connection.close()
        except Exception:  # noqa: BLE001
            pass
