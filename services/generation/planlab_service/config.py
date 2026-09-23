"""Service configuration from the environment (plan section 9)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
MAX_SOLVER_WORKERS = 8
MAX_ACTIVE_JOBS = 1


@dataclass
class Settings:
    engine_root: Path = field(default_factory=lambda: Path("E:/Projects/floor-plan-model"))
    overlay: Path | None = None
    checkpoint: Path | None = None
    data_dir: Path = field(default_factory=lambda: Path(".local/planlab"))
    log_dir: Path | None = None
    static_dir: Path | None = None
    host: str = "127.0.0.1"
    port: int = 8010
    dev_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )
    solver_workers: int = MAX_SOLVER_WORKERS
    max_active_jobs: int = MAX_ACTIVE_JOBS
    job_deadline_s: int = 360
    debug: bool = False
    service_version: str = "0.1.0"

    @property
    def db_path(self) -> Path:
        return Path(self.data_dir) / "planlab.sqlite3"

    @property
    def effective_log_dir(self) -> Path:
        return Path(self.log_dir or (Path(self.data_dir) / "logs"))

    def validate(self) -> None:
        if self.host not in LOOPBACK_HOSTS:
            raise ValueError(
                f"PLANLAB_HOST must be a loopback address for this MVP, got {self.host!r}"
            )
        if not 1 <= int(self.solver_workers) <= MAX_SOLVER_WORKERS:
            raise ValueError(f"PLANLAB_SOLVER_WORKERS must be 1..{MAX_SOLVER_WORKERS}")
        if int(self.max_active_jobs) != MAX_ACTIVE_JOBS:
            raise ValueError("PLANLAB_MAX_ACTIVE_JOBS must be 1 for this MVP")
        if not 1 <= int(self.port) <= 65535:
            raise ValueError("PLANLAB_PORT must be a valid TCP port")

    @classmethod
    def from_env(cls, env=None, repo_root: Path | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        root = Path(repo_root or Path(__file__).resolve().parents[3])

        def path(name, default=None):
            raw = env.get(name)
            if raw:
                return Path(raw)
            return Path(default) if default is not None else None

        settings = cls(
            engine_root=path("PLANLAB_ENGINE_ROOT", "E:/Projects/floor-plan-model"),
            overlay=path("PLANLAB_SERVICE_SITE_PACKAGES", root / ".runtime" / "generation" / "site-packages"),
            checkpoint=path("PLANLAB_CHECKPOINT"),
            data_dir=path("PLANLAB_DATA_DIR", root / ".local" / "planlab"),
            log_dir=path("PLANLAB_LOG_DIR"),
            static_dir=path("PLANLAB_STATIC_DIR", root / "dist"),
            host=env.get("PLANLAB_HOST", "127.0.0.1"),
            port=int(env.get("PLANLAB_PORT", "8010")),
            solver_workers=int(env.get("PLANLAB_SOLVER_WORKERS", str(MAX_SOLVER_WORKERS))),
            max_active_jobs=int(env.get("PLANLAB_MAX_ACTIVE_JOBS", "1")),
            job_deadline_s=int(env.get("PLANLAB_JOB_DEADLINE_S", "360")),
            debug=env.get("PLANLAB_DEBUG", "0") not in ("0", "", "false", "False"),
            service_version=env.get("PLANLAB_SERVICE_VERSION", "0.1.0"),
        )
        origins = env.get("PLANLAB_DEV_ORIGINS")
        if origins:
            settings.dev_origins = tuple(
                origin.strip() for origin in origins.split(",") if origin.strip()
            )
        settings.validate()
        return settings

    def allowed_origins(self) -> set[str]:
        return {
            f"http://{self.host}:{self.port}",
            f"http://127.0.0.1:{self.port}",
            f"http://localhost:{self.port}",
            *self.dev_origins,
        }
