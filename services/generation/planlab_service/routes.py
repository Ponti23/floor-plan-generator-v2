"""HTTP routes for the generation service (plan section 4.3)."""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from . import errors as E
from . import repository as repo
from .contracts import (
    CONTRACT_VERSION,
    BriefV1,
    EditorDocumentV2,
    GenerationRequestV1,
    brief_sha256,
)
from .database import session as connect

router = APIRouter(prefix="/api/v1")


def problem_response(request: Request, code: str, message: str, status_code: int,
                     **kwargs) -> JSONResponse:
    correlation = getattr(request.state, "correlation_id", "") or ""
    payload = E.problem(code, message, correlation, **kwargs)
    return JSONResponse(
        status_code=status_code,
        content={"schemaVersion": CONTRACT_VERSION, "error": payload.model_dump(mode="json")},
        headers={"Cache-Control": "no-store"},
    )


def job_dto(conn, row: dict) -> dict:
    layouts = conn.execute(
        "SELECT id FROM layout_variants WHERE generation_id = ? ORDER BY rank",
        (row["id"],),
    ).fetchall()
    progress = row.get("progress") or {}
    return {
        "schemaVersion": CONTRACT_VERSION,
        "generationId": row["id"],
        "projectId": row["project_id"],
        "briefVersionId": row["brief_version_id"],
        "briefHash": row["request_hash"],
        "status": row["status"],
        "stateVersion": int(row["state_version"]),
        "progress": {
            "stage": progress.get("stage", row["status"]),
            "candidateId": progress.get("candidateId"),
            "candidatesCompleted": progress.get("candidatesCompleted"),
            "candidatesTotal": progress.get("candidatesTotal"),
        },
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "elapsedMs": _elapsed_ms(row),
        "cancelRequested": bool(row["cancel_requested"]),
        "layoutIds": [record["id"] for record in layouts],
        "versions": row.get("versions"),
        "error": row.get("error"),
        "warnings": row.get("warnings") or [],
    }


def _elapsed_ms(row: dict) -> int:
    from datetime import datetime, timezone

    def parse(value):
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return None

    start = parse(row.get("started_at")) or parse(row.get("created_at"))
    end = parse(row.get("finished_at")) or datetime.now(timezone.utc)
    if start is None:
        return 0
    return max(0, int((end - start).total_seconds() * 1000))


def project_dto(row: dict) -> dict:
    return {
        "projectId": row["id"],
        "name": row["name"],
        "revision": int(row["revision"]),
        "currentBriefVersionId": row["current_brief_version_id"],
        "selectedLayoutId": row.get("selected_layout_id"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _project_row(conn, project_id) -> dict | None:
    project = repo.get_project(conn, project_id)
    if project is None:
        return None
    selection = repo.get_selection(conn, project_id)
    project["selected_layout_id"] = selection["layout_id"] if selection else None
    return project


@router.get("/health/live")
def health_live() -> dict:
    return {"status": "live", "contractVersion": CONTRACT_VERSION}


@router.get("/health/ready")
def health_ready(request: Request) -> Response:
    supervisor = request.app.state.supervisor
    lock_error = getattr(request.app.state, "lock_error", None)
    if lock_error:
        return JSONResponse(
            status_code=503,
            content={"status": "unready", "reason": "service_lock_held",
                     "contractVersion": CONTRACT_VERSION},
            headers={"Cache-Control": "no-store"},
        )
    ready = bool(getattr(supervisor, "ready", False))
    if not ready:
        reason = "model_unavailable" if not getattr(supervisor, "versions", None) else "worker_starting"
        return JSONResponse(
            status_code=503,
            content={"status": "unready", "reason": reason,
                     "contractVersion": CONTRACT_VERSION},
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        content={"status": "ready", "contractVersion": CONTRACT_VERSION,
                 "versions": supervisor.versions},
        headers={"Cache-Control": "no-store"},
    )


@router.post("/projects", status_code=201)
def create_project(request: Request, body: dict) -> Response:
    name = str(body.get("name") or "").strip()
    if not 1 <= len(name) <= 120:
        return problem_response(request, "INVALID_BRIEF", "project name must be 1-120 characters", 422)
    import_id = body.get("clientImportId")
    if import_id is not None and len(str(import_id)) > 80:
        return problem_response(request, "INVALID_BRIEF", "clientImportId must be <= 80 characters", 422)
    with connect(request.app.state.settings.db_path) as conn:
        conn.execute("BEGIN")
        try:
            project = repo.create_project(conn, name, client_import_id=import_id)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        row = _project_row(conn, project["id"])
    return JSONResponse(status_code=201, content=project_dto(row),
                        headers={"Cache-Control": "no-store"})


@router.get("/projects")
def list_projects(request: Request, limit: int = 20, cursor: str | None = None) -> dict:
    limit = max(1, min(100, int(limit)))
    with connect(request.app.state.settings.db_path) as conn:
        rows, next_cursor = repo.list_projects(conn, limit=limit, cursor=cursor)
        items = [project_dto(_project_row(conn, row["id"])) for row in rows]
    return {"items": items, "nextCursor": next_cursor}


@router.get("/projects/{project_id}")
def get_project(request: Request, project_id: str) -> Response:
    with connect(request.app.state.settings.db_path) as conn:
        row = _project_row(conn, project_id)
        if row is None:
            return problem_response(request, "NOT_FOUND", "project not found", 404)
        payload = project_dto(row)
        brief_record = (
            repo.get_brief_version(conn, row["current_brief_version_id"])
            if row["current_brief_version_id"] else None
        )
        selection = repo.get_selection(conn, project_id)
        active = repo.active_generation_for_project(conn, project_id)
        selected_layout = (
            repo.get_layout(conn, selection["layout_id"]) if selection else None
        )
    payload.update({
        "brief": brief_record["brief"] if brief_record else None,
        "editorDocument": brief_record["editorDocument"] if brief_record else None,
        "selectedLayout": selected_layout,
        "activeGenerationId": active["id"] if active else None,
    })
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})


@router.post("/projects/{project_id}/brief-versions", status_code=201)
def save_brief_version(request: Request, project_id: str, body: dict) -> Response:
    try:
        brief = BriefV1.model_validate(body.get("brief"))
    except Exception as exc:  # noqa: BLE001
        return problem_response(
            request, "INVALID_BRIEF", "the brief is not valid", 422,
            field_errors=E.field_errors_from_validation_error(exc),
        )
    try:
        editor = EditorDocumentV2.model_validate(body.get("editorDocument"))
    except Exception as exc:  # noqa: BLE001
        return problem_response(
            request, "INVALID_BRIEF", "the editor document is not valid", 422,
            field_errors=E.field_errors_from_validation_error(exc),
        )
    revision = body.get("expectedProjectRevision")
    if not isinstance(revision, int) or isinstance(revision, bool):
        return problem_response(request, "INVALID_BRIEF",
                                "expectedProjectRevision must be an integer", 422)
    try:
        with connect(request.app.state.settings.db_path) as conn:
            conn.execute("BEGIN")
            try:
                saved = repo.save_brief_version(
                    conn, project_id,
                    expected_project_revision=revision,
                    brief_json=brief.model_dump(mode="json"),
                    editor_document_json=editor.model_dump(mode="json"),
                    brief_hash=brief_sha256(brief),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
    except repo.NotFound as exc:
        return problem_response(request, "NOT_FOUND", str(exc), 404)
    except repo.Conflict as exc:
        return problem_response(request, "CONFLICT", str(exc), 409)
    return JSONResponse(
        status_code=201,
        content={
            "briefVersionId": saved["briefVersionId"],
            "briefHash": saved["briefHash"],
            "projectRevision": saved["projectRevision"],
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("/generations", status_code=202)
def create_generation(request: Request, body: dict) -> Response:
    try:
        payload = GenerationRequestV1.model_validate(body)
    except Exception as exc:  # noqa: BLE001
        return problem_response(
            request, "INVALID_BRIEF", "the generation request is not valid", 422,
            field_errors=E.field_errors_from_validation_error(exc),
        )
    db_path = request.app.state.settings.db_path
    with connect(db_path) as conn:
        record = repo.get_brief_version(conn, payload.briefVersionId)
        if record is None or record["project_id"] != payload.projectId:
            return problem_response(request, "NOT_FOUND", "brief version not found", 404)
        project = repo.get_project(conn, payload.projectId)
        if project is None:
            return problem_response(request, "NOT_FOUND", "project not found", 404)
        if project["current_brief_version_id"] != payload.briefVersionId:
            return problem_response(request, "CONFLICT", "brief version is not current", 409)
        existing = repo.generation_by_idempotency(conn, payload.projectId, payload.idempotencyKey)
        if existing is not None:
            # an idempotent retry returns the same job rather than a conflict
            return JSONResponse(
                status_code=202,
                content=job_dto(conn, existing),
                headers={"Cache-Control": "no-store",
                         "Location": f"/api/v1/generations/{existing['id']}"},
            )
        active = repo.active_generation_for_project(conn, payload.projectId)
        if active is not None:
            return problem_response(
                request, "CONFLICT",
                f"this project already has an active generation ({active['id']})", 409,
            )
    try:
        brief = BriefV1.model_validate(record["brief"])
    except Exception as exc:  # noqa: BLE001
        return problem_response(request, "INVALID_BRIEF", "stored brief is invalid", 422,
                                field_errors=E.field_errors_from_validation_error(exc))
    supervisor = request.app.state.supervisor
    if not getattr(supervisor, "ready", False):
        return problem_response(
            request, "ENGINE_UNAVAILABLE",
            "the generation engine is not ready", 503,
            remediations=E.default_remediation("ENGINE_UNAVAILABLE"),
        )
    try:
        job, _created = supervisor.submit(
            payload.projectId, payload.briefVersionId, brief,
            idempotency_key=payload.idempotencyKey,
            correlation_id=getattr(request.state, "correlation_id", ""),
        )
    except repo.QueueFull as exc:
        response = problem_response(request, "QUEUE_FULL", str(exc), 429)
        response.headers["Retry-After"] = "5"
        return response
    except repo.Conflict as exc:
        return problem_response(request, "CONFLICT", str(exc), 409)
    with connect(db_path) as conn:
        dto = job_dto(conn, repo.get_generation(conn, job["id"]))
    return JSONResponse(
        status_code=202, content=dto,
        headers={"Cache-Control": "no-store",
                 "Location": f"/api/v1/generations/{job['id']}"},
    )


@router.get("/generations/{generation_id}")
def get_generation(request: Request, generation_id: str) -> Response:
    with connect(request.app.state.settings.db_path) as conn:
        row = repo.get_generation(conn, generation_id)
        if row is None:
            return problem_response(request, "NOT_FOUND", "generation not found", 404)
        dto = job_dto(conn, row)
    return JSONResponse(content=dto, headers={"Cache-Control": "no-store"})


@router.post("/generations/{generation_id}/cancel")
def cancel_generation(request: Request, generation_id: str) -> Response:
    with connect(request.app.state.settings.db_path) as conn:
        row = repo.get_generation(conn, generation_id)
        if row is None:
            return problem_response(request, "NOT_FOUND", "generation not found", 404)
        if row["status"] in repo.TERMINAL_STATUSES:
            return JSONResponse(status_code=200, content=job_dto(conn, row),
                                headers={"Cache-Control": "no-store"})
        updated = repo.request_cancel(conn, generation_id)
        dto = job_dto(conn, updated)
    request.app.state.supervisor.cancel(generation_id)
    return JSONResponse(status_code=202, content=dto,
                        headers={"Cache-Control": "no-store"})


@router.get("/generations/{generation_id}/layouts")
def generation_layouts(request: Request, generation_id: str) -> Response:
    with connect(request.app.state.settings.db_path) as conn:
        row = repo.get_generation(conn, generation_id)
        if row is None:
            return problem_response(request, "NOT_FOUND", "generation not found", 404)
        layouts = repo.list_layouts(conn, generation_id)
    return JSONResponse(
        content={"generationId": generation_id, "status": row["status"], "layouts": layouts},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/layouts/{layout_id}")
def get_layout(request: Request, layout_id: str) -> Response:
    with connect(request.app.state.settings.db_path) as conn:
        layout = repo.get_layout(conn, layout_id)
    if layout is None:
        return problem_response(request, "NOT_FOUND", "layout not found", 404)
    return JSONResponse(content=layout, headers={"Cache-Control": "no-store"})


@router.put("/projects/{project_id}/selection")
def put_selection(request: Request, project_id: str, body: dict) -> Response:
    layout_id = body.get("layoutId")
    revision = body.get("expectedProjectRevision")
    if not layout_id or not isinstance(revision, int) or isinstance(revision, bool):
        return problem_response(request, "INVALID_BRIEF",
                                "layoutId and expectedProjectRevision are required", 422)
    try:
        with connect(request.app.state.settings.db_path) as conn:
            conn.execute("BEGIN")
            try:
                selection = repo.select_layout(
                    conn, project_id, layout_id, expected_project_revision=revision
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
    except repo.NotFound as exc:
        return problem_response(request, "NOT_FOUND", str(exc), 404)
    except repo.Conflict as exc:
        return problem_response(request, "CONFLICT", str(exc), 409)
    return JSONResponse(content=selection, headers={"Cache-Control": "no-store"})


@router.get("/generations/{generation_id}/debug")
def generation_debug(request: Request, generation_id: str) -> Response:
    if not request.app.state.settings.debug:
        return problem_response(request, "NOT_FOUND", "debug is disabled", 404)
    with connect(request.app.state.settings.db_path) as conn:
        row = repo.get_generation(conn, generation_id)
        if row is None:
            return problem_response(request, "NOT_FOUND", "generation not found", 404)
        payload = {
            "generationId": generation_id,
            "diagnostics": row.get("diagnostics") or {},
            "warnings": row.get("warnings") or [],
            "settings": row.get("settings") or {},
        }
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})
