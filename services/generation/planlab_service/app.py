"""FastAPI application: same-origin API, security boundary and startup ownership (S05)."""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import errors as E
from .config import Settings
from .contracts import CONTRACT_VERSION
from .database import migrate
from .routes import problem_response, router
from .service_lock import ServiceLock, ServiceLockError
from .supervisor import Supervisor

MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_REQUEST_BYTES = 128 * 1024
CLIENT_HEADER = "x-planlab-client"
ALLOWED_HOSTS_PREFIXES = ("127.0.0.1", "localhost", "[::1]")

logger = logging.getLogger("planlab.service")


def _host_allowed(value: str | None) -> bool:
    if not value:
        return False
    host = value.strip().lower()
    if host.startswith("["):
        host = host.split("]")[0] + "]"
    else:
        host = host.split(":")[0]
    return host in {"127.0.0.1", "localhost", "::1", "[::1]"}


def create_app(settings: Settings | None = None, supervisor_factory=None) -> FastAPI:
    resolved = settings or Settings.from_env()
    resolved.validate()
    factory = supervisor_factory or (
        lambda cfg: Supervisor(cfg.db_path, engine_root=cfg.engine_root,
                               overlay=cfg.overlay, solver_workers=cfg.solver_workers,
                               job_deadline_s=cfg.job_deadline_s)
    )
    lock = ServiceLock(resolved.data_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = resolved
        app.state.lock = lock
        app.state.supervisor = factory(resolved)
        app.state.lock_error = None
        app.state.load_failure = None
        try:
            lock.acquire()
        except ServiceLockError as exc:
            app.state.lock_error = str(exc)
            logger.error("service lock refused: %s", exc)
        try:
            migrate(resolved.db_path)
        except Exception as exc:  # noqa: BLE001
            logger.error("migration failed: %s", exc)
        try:
            ready = app.state.supervisor.start()
            if not ready:
                app.state.load_failure = getattr(
                    app.state.supervisor, "load_failure", "engine not ready"
                )
                logger.error("engine not ready: %s", app.state.load_failure)
            else:
                # the dispatch loop is what moves QUEUED jobs to a terminal state
                starter = getattr(app.state.supervisor, "run_forever", None)
                if callable(starter):
                    starter()
        except Exception as exc:  # noqa: BLE001
            app.state.load_failure = f"{type(exc).__name__}: {exc}"
            logger.error("supervisor start failed: %s", exc)
        try:
            yield
        finally:
            try:
                app.state.supervisor.stop()
            finally:
                lock.release()

    app = FastAPI(title="PlanLab generation service", version=resolved.service_version,
                  lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def security_boundary(request: Request, call_next):
        request.state.correlation_id = uuid.uuid4().hex[:16]
        response_headers = {"Cache-Control": "no-store",
                            "X-PlanLab-Correlation-Id": request.state.correlation_id}
        if not _host_allowed(request.headers.get("host")):
            return JSONResponse(
                status_code=421,
                content={"schemaVersion": CONTRACT_VERSION,
                         "error": {"code": "CONFLICT", "category": "conflict",
                                   "message": "unexpected Host header", "retryable": False,
                                   "proof": None, "fieldErrors": [], "remediation": [],
                                   "correlationId": request.state.correlation_id}},
                headers=response_headers,
            )
        origin = request.headers.get("origin")
        if origin and origin not in request.app.state.settings.allowed_origins():
            return JSONResponse(
                status_code=403,
                content={"schemaVersion": CONTRACT_VERSION,
                         "error": {"code": "CONFLICT", "category": "conflict",
                                   "message": "origin not allowed", "retryable": False,
                                   "proof": None, "fieldErrors": [], "remediation": [],
                                   "correlationId": request.state.correlation_id}},
                headers=response_headers,
            )
        if request.method in MUTATION_METHODS:
            client = request.headers.get(CLIENT_HEADER)
            if client != "1":
                return JSONResponse(
                    status_code=400,
                    content={"schemaVersion": CONTRACT_VERSION,
                             "error": {"code": "CONFLICT", "category": "conflict",
                                       "message": "missing X-PlanLab-Client: 1 header",
                                       "retryable": False, "proof": None, "fieldErrors": [],
                                       "remediation": [],
                                       "correlationId": request.state.correlation_id}},
                    headers=response_headers,
                )
            content_type = (request.headers.get("content-type") or "").split(";")[0].strip()
            if content_type and content_type != "application/json":
                return JSONResponse(
                    status_code=415,
                    content={"schemaVersion": CONTRACT_VERSION,
                             "error": {"code": "INVALID_BRIEF", "category": "input",
                                       "message": "mutations must use application/json",
                                       "retryable": False, "proof": None, "fieldErrors": [],
                                       "remediation": [],
                                       "correlationId": request.state.correlation_id}},
                    headers=response_headers,
                )
            declared = request.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"schemaVersion": CONTRACT_VERSION,
                             "error": {"code": "INVALID_BRIEF", "category": "input",
                                       "message": f"request body exceeds {MAX_REQUEST_BYTES} bytes",
                                       "retryable": False, "proof": None, "fieldErrors": [],
                                       "remediation": [],
                                       "correlationId": request.state.correlation_id}},
                    headers=response_headers,
                )
            body = await request.body()
            if len(body) > MAX_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"schemaVersion": CONTRACT_VERSION,
                             "error": {"code": "INVALID_BRIEF", "category": "input",
                                       "message": f"request body exceeds {MAX_REQUEST_BYTES} bytes",
                                       "retryable": False, "proof": None, "fieldErrors": [],
                                       "remediation": [],
                                       "correlationId": request.state.correlation_id}},
                    headers=response_headers,
                )
        response = await call_next(request)
        for key, value in response_headers.items():
            response.headers.setdefault(key, value)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return problem_response(
            request, "INVALID_BRIEF", "the request body is not valid", 422,
            field_errors=E.field_errors_from_validation_error(exc),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException):
        code = "NOT_FOUND" if exc.status_code == 404 else "CONFLICT"
        return problem_response(request, code, str(exc.detail), exc.status_code)

    app.include_router(router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def unknown_api(request: Request, rest: str):
        return problem_response(request, "NOT_FOUND", f"no such endpoint: /api/{rest}", 404)

    static_dir = resolved.static_dir
    static_root = Path(static_dir).resolve() if static_dir else None
    index_file = static_root / "index.html" if static_root else None
    if static_root and static_root.is_dir():
        assets = static_root / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

        @app.get("/{full_path:path}")
        async def static_or_shell(request: Request, full_path: str):
            """Serve real files, otherwise the SPA shell; never escape the static root."""
            if full_path:
                candidate = (static_root / full_path).resolve()
                if candidate.is_file() and static_root in candidate.parents:
                    return FileResponse(candidate)
            if index_file and index_file.is_file():
                return FileResponse(index_file)
            return problem_response(
                request, "NOT_FOUND", "not found", 404
            )
    else:
        @app.get("/")
        async def root_placeholder():
            return JSONResponse(
                status_code=200,
                content={
                    "service": "planlab-generation",
                    "contractVersion": CONTRACT_VERSION,
                    "note": "no built frontend found; run npm run build for release mode",
                    "health": "/api/v1/health/live",
                },
                headers={"Cache-Control": "no-store"},
            )

    return app


app = None  # populated by uvicorn via the factory below


def main() -> int:  # pragma: no cover - process entry point
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        workers=1,
        reload=False,
        access_log=False,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
