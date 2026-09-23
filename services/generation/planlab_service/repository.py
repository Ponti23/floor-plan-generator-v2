"""Durable project/brief/generation/layout/selection records (S04, plan section 6)."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid

ACTIVE_STATUSES = (
    "QUEUED",
    "LOADING_MODEL",
    "GENERATING_TOPOLOGIES",
    "SOLVING",
    "VALIDATING",
    "RANKING",
)
TERMINAL_STATUSES = ("COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED")
QUEUE_CAP = 8


class NotFound(LookupError):
    """Requested record does not exist."""


class Conflict(RuntimeError):
    """The request conflicts with the current durable state."""


class QueueFull(RuntimeError):
    """The global queue is saturated."""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id() -> str:
    return str(uuid.uuid4())


def _row(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def _loads(value, default):
    if value is None:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


# ----------------------------------------------------------------- projects --


def create_project(conn, name, *, client_import_id=None, project_id=None) -> dict:
    identifier = project_id or new_id()
    stamp = now_iso()
    try:
        conn.execute(
            "INSERT INTO projects(id, name, revision, current_brief_version_id,"
            " client_import_id, created_at, updated_at) VALUES (?, ?, 1, NULL, ?, ?, ?)",
            (identifier, name, client_import_id, stamp, stamp),
        )
    except sqlite3.IntegrityError as exc:
        if client_import_id:
            existing = conn.execute(
                "SELECT * FROM projects WHERE client_import_id = ?", (client_import_id,)
            ).fetchone()
            if existing is not None:
                return _row(existing)
        raise Conflict(str(exc)) from exc
    return get_project(conn, identifier)


def get_project(conn, project_id) -> dict | None:
    return _row(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())


def list_projects(conn, limit=20, cursor=None) -> tuple[list[dict], str | None]:
    rows = conn.execute(
        "SELECT * FROM projects ORDER BY updated_at DESC, id DESC LIMIT ?",
        (int(limit) + 1,),
    ).fetchall()
    items = [_row(row) for row in rows[: int(limit)]]
    next_cursor = items[-1]["id"] if len(rows) > int(limit) and items else None
    return items, next_cursor


def bump_revision(conn, project_id, **fields) -> dict:
    assignments = ["revision = revision + 1", "updated_at = ?"]
    values: list = [now_iso()]
    for key, value in fields.items():
        assignments.append(f"{key} = ?")
        values.append(value)
    updated = conn.execute(
        f"UPDATE projects SET {', '.join(assignments)} WHERE id = ?",
        [*values, project_id],
    ).rowcount
    if not updated:
        raise NotFound(f"project {project_id} not found")
    return get_project(conn, project_id)


# --------------------------------------------------------------- briefs -----


def save_brief_version(
    conn, project_id, *, expected_project_revision, brief_json, editor_document_json, brief_hash
) -> dict:
    project = get_project(conn, project_id)
    if project is None:
        raise NotFound(f"project {project_id} not found")
    existing = conn.execute(
        "SELECT * FROM brief_versions WHERE project_id = ? AND brief_hash = ?",
        (project_id, brief_hash),
    ).fetchone()
    if existing is not None:
        return {
            "briefVersionId": existing["id"],
            "briefHash": existing["brief_hash"],
            "projectRevision": project["revision"],
            "reused": True,
        }
    if int(expected_project_revision) != int(project["revision"]):
        raise Conflict(
            f"project revision {project['revision']} does not match "
            f"expected {expected_project_revision}"
        )
    sequence = conn.execute(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM brief_versions WHERE project_id = ?",
        (project_id,),
    ).fetchone()[0]
    identifier = new_id()
    conn.execute(
        "INSERT INTO brief_versions(id, project_id, sequence, contract_version, brief_hash,"
        " brief_json, editor_document_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            identifier,
            project_id,
            sequence,
            "planlab.generation/1",
            brief_hash,
            json.dumps(brief_json),
            json.dumps(editor_document_json),
            now_iso(),
        ),
    )
    project = bump_revision(conn, project_id, current_brief_version_id=identifier)
    return {
        "briefVersionId": identifier,
        "briefHash": brief_hash,
        "projectRevision": project["revision"],
        "reused": False,
    }


def get_brief_version(conn, brief_version_id) -> dict | None:
    record = _row(conn.execute(
        "SELECT * FROM brief_versions WHERE id = ?", (brief_version_id,)
    ).fetchone())
    if record is None:
        return None
    record["brief"] = _loads(record.pop("brief_json"), None)
    record["editorDocument"] = _loads(record.pop("editor_document_json"), None)
    return record


# ------------------------------------------------------------ generations ---


def active_generation_for_project(conn, project_id) -> dict | None:
    placeholders = ",".join("?" for _ in ACTIVE_STATUSES)
    return _row(conn.execute(
        f"SELECT * FROM generations WHERE project_id = ? AND status IN ({placeholders})"
        " ORDER BY created_at DESC LIMIT 1",
        (project_id, *ACTIVE_STATUSES),
    ).fetchone())


def queue_depth(conn) -> int:
    return int(conn.execute(
        "SELECT COUNT(*) FROM generations WHERE status = 'QUEUED'"
    ).fetchone()[0])


def create_generation(
    conn, project_id, brief_version_id, *, idempotency_key, request_hash, settings
) -> tuple[dict, bool]:
    existing = _row(conn.execute(
        "SELECT * FROM generations WHERE project_id = ? AND idempotency_key = ?",
        (project_id, idempotency_key),
    ).fetchone())
    if existing is not None:
        if existing["request_hash"] != request_hash:
            raise Conflict("idempotency key reused with a different request")
        return existing, False
    brief = conn.execute(
        "SELECT id FROM brief_versions WHERE id = ? AND project_id = ?",
        (brief_version_id, project_id),
    ).fetchone()
    if brief is None:
        raise NotFound(f"brief version {brief_version_id} not found for project")
    if active_generation_for_project(conn, project_id) is not None:
        raise Conflict("this project already has an active generation")
    if queue_depth(conn) >= QUEUE_CAP:
        raise QueueFull("generation queue is full")
    identifier = new_id()
    conn.execute(
        "INSERT INTO generations(id, project_id, brief_version_id, idempotency_key,"
        " request_hash, status, state_version, cancel_requested, created_at, progress_json,"
        " settings_json, warnings_json) VALUES (?, ?, ?, ?, ?, 'QUEUED', 0, 0, ?, ?, ?, '[]')",
        (
            identifier,
            project_id,
            brief_version_id,
            idempotency_key,
            request_hash,
            now_iso(),
            json.dumps({"stage": "QUEUED", "candidateId": None,
                        "candidatesCompleted": None, "candidatesTotal": None}),
            json.dumps(settings),
        ),
    )
    return get_generation(conn, identifier), True


def get_generation(conn, generation_id) -> dict | None:
    record = _row(conn.execute(
        "SELECT * FROM generations WHERE id = ?", (generation_id,)
    ).fetchone())
    if record is None:
        return None
    record["progress"] = _loads(record.pop("progress_json"), {})
    record["settings"] = _loads(record.pop("settings_json"), {})
    record["versions"] = _loads(record.pop("versions_json"), None)
    record["error"] = _loads(record.pop("error_json"), None)
    record["warnings"] = _loads(record.pop("warnings_json"), [])
    record["diagnostics"] = _loads(record.pop("diagnostics_json"), None)
    record["cancel_requested"] = bool(record["cancel_requested"])
    return record


def generation_by_idempotency(conn, project_id, idempotency_key) -> dict | None:
    row = conn.execute(
        "SELECT id FROM generations WHERE project_id = ? AND idempotency_key = ?",
        (project_id, idempotency_key),
    ).fetchone()
    return get_generation(conn, row["id"]) if row is not None else None


def transition(
    conn, generation_id, *, status, expect_statuses=None, expect_state_version=None, **fields
) -> dict:
    """State-predicated transition; raises Conflict when the predicate fails."""
    current = get_generation(conn, generation_id)
    if current is None:
        raise NotFound(f"generation {generation_id} not found")
    if expect_statuses and current["status"] not in expect_statuses:
        raise Conflict(f"status {current['status']} not in {expect_statuses}")
    if expect_state_version is not None and int(current["state_version"]) != int(
        expect_state_version
    ):
        raise Conflict(
            f"state version {current['state_version']} != {expect_state_version}"
        )
    columns = ["status = ?", "state_version = state_version + 1"]
    values: list = [status]
    for key, value in fields.items():
        columns.append(f"{key} = ?")
        values.append(json.dumps(value) if key.endswith("_json") else value)
    where = "id = ? AND state_version = ?"
    values.extend([generation_id, int(current["state_version"])])
    updated = conn.execute(
        f"UPDATE generations SET {', '.join(columns)} WHERE {where}", values
    ).rowcount
    if not updated:
        raise Conflict("state changed under us")
    return get_generation(conn, generation_id)


def set_progress(conn, generation_id, stage, *, candidate_id=None,
                 completed=None, total=None) -> None:
    conn.execute(
        "UPDATE generations SET progress_json = ?, last_heartbeat_at = ? WHERE id = ?",
        (
            json.dumps({
                "stage": stage,
                "candidateId": candidate_id,
                "candidatesCompleted": completed,
                "candidatesTotal": total,
            }),
            now_iso(),
            generation_id,
        ),
    )


def request_cancel(conn, generation_id) -> dict:
    current = get_generation(conn, generation_id)
    if current is None:
        raise NotFound(f"generation {generation_id} not found")
    if current["status"] in TERMINAL_STATUSES:
        return current
    conn.execute(
        "UPDATE generations SET cancel_requested = 1, state_version = state_version + 1"
        " WHERE id = ?",
        (generation_id,),
    )
    return get_generation(conn, generation_id)


def recover_interrupted(conn) -> list[str]:
    """Startup recovery: active rows from a previous process become FAILED."""
    placeholders = ",".join("?" for _ in ACTIVE_STATUSES)
    rows = conn.execute(
        f"SELECT id FROM generations WHERE status IN ({placeholders})", ACTIVE_STATUSES
    ).fetchall()
    stamp = now_iso()
    for row in rows:
        error = {
            "code": "ENGINE_UNAVAILABLE",
            "category": "technical",
            "message": "The service restarted while this job was running.",
            "retryable": True,
            "proof": None,
            "fieldErrors": [],
            "remediation": [],
            "correlationId": f"restart-{row['id']}",
            "interruptedByRestart": True,
        }
        conn.execute(
            "UPDATE generations SET status = 'FAILED', finished_at = ?, error_json = ?,"
            " state_version = state_version + 1, run_token = NULL WHERE id = ?",
            (stamp, json.dumps(error), row["id"]),
        )
    return [row["id"] for row in rows]


def persist_completed(conn, generation_id, *, versions, diagnostics, warnings,
                      layouts, raw_records) -> list[str]:
    """One transaction: the completed job and all of its geometry become visible together."""
    if len(layouts) != len(raw_records):
        raise ValueError("layouts and raw_records must be the same length")
    layout_ids: list[str] = []
    conn.execute("BEGIN")
    try:
        for layout, raw in zip(layouts, raw_records):
            payload = layout.model_dump(mode="json")
            conn.execute(
                "INSERT INTO layout_variants(id, project_id, generation_id, brief_version_id,"
                " rank, geometry_hash, dto_json, raw_engine_json, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    payload["layoutId"],
                    payload["projectId"],
                    payload["generationId"],
                    payload["briefVersionId"],
                    payload["rank"],
                    _geometry_hash(payload),
                    json.dumps(payload),
                    json.dumps(raw) if not isinstance(raw, str) else raw,
                    payload["createdAt"],
                ),
            )
            layout_ids.append(payload["layoutId"])
        conn.execute(
            "UPDATE generations SET status = 'COMPLETED', finished_at = ?, versions_json = ?,"
            " diagnostics_json = ?, warnings_json = ?, error_json = NULL,"
            " state_version = state_version + 1, progress_json = ? WHERE id = ?",
            (
                now_iso(),
                json.dumps(versions.model_dump(mode="json")),
                json.dumps(diagnostics or {}),
                json.dumps(list(warnings or [])),
                json.dumps({"stage": "COMPLETED", "candidateId": None,
                            "candidatesCompleted": len(layout_ids),
                            "candidatesTotal": len(layout_ids)}),
                generation_id,
            ),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return layout_ids


def _geometry_hash(payload: dict) -> str:
    import hashlib

    from .contracts import canonical_json

    projection = {
        "rooms": sorted(
            ({"id": room["id"], "rect": room["rect"]} for room in payload["rooms"]),
            key=lambda item: item["id"],
        ),
        "corridor": payload["circulation"]["rect"],
        "walls": sorted(
            ({"id": wall["id"], "rect": wall["rect"]} for wall in payload["walls"]),
            key=lambda item: item["id"],
        ),
        "openings": sorted(
            ({"id": opening["id"], "rect": opening["rect"]} for opening in payload["openings"]),
            key=lambda item: item["id"],
        ),
    }
    return hashlib.sha256(canonical_json(projection).encode("utf-8")).hexdigest()


def list_layouts(conn, generation_id) -> list[dict]:
    rows = conn.execute(
        "SELECT dto_json FROM layout_variants WHERE generation_id = ? ORDER BY rank",
        (generation_id,),
    ).fetchall()
    return [json.loads(row["dto_json"]) for row in rows]


def get_layout(conn, layout_id) -> dict | None:
    row = conn.execute(
        "SELECT dto_json FROM layout_variants WHERE id = ?", (layout_id,)
    ).fetchone()
    return json.loads(row["dto_json"]) if row else None


# -------------------------------------------------------------- selection ---


def select_layout(conn, project_id, layout_id, *, expected_project_revision) -> dict:
    project = get_project(conn, project_id)
    if project is None:
        raise NotFound(f"project {project_id} not found")
    if int(project["revision"]) != int(expected_project_revision):
        raise Conflict("project revision changed")
    layout = conn.execute(
        "SELECT lv.*, g.status AS generation_status, g.brief_version_id AS generation_brief"
        " FROM layout_variants lv JOIN generations g ON g.id = lv.generation_id"
        " WHERE lv.id = ? AND lv.project_id = ?",
        (layout_id, project_id),
    ).fetchone()
    if layout is None:
        raise NotFound(f"layout {layout_id} not found in project {project_id}")
    if layout["generation_status"] != "COMPLETED":
        raise Conflict("layout belongs to an incomplete generation")
    if layout["generation_brief"] != project["current_brief_version_id"]:
        raise Conflict("layout belongs to an older brief")
    stamp = now_iso()
    conn.execute(
        "INSERT INTO selected_layouts(project_id, layout_id, selected_at) VALUES (?, ?, ?)"
        " ON CONFLICT(project_id) DO UPDATE SET layout_id = excluded.layout_id,"
        " selected_at = excluded.selected_at",
        (project_id, layout_id, stamp),
    )
    record_event(
        conn, project_id, "LAYOUT_SELECTED",
        {"layoutId": layout_id, "generationId": layout["generation_id"]},
        generation_id=layout["generation_id"], layout_id=layout_id,
    )
    # the selection itself lives in selected_layouts; the project row only bumps
    # its revision so clients can detect the change
    project = bump_revision(conn, project_id)
    return {
        "projectId": project_id,
        "layoutId": layout_id,
        "generationId": layout["generation_id"],
        "briefVersionId": layout["generation_brief"],
        "projectRevision": project["revision"],
        "selectedAt": stamp,
    }


def get_selection(conn, project_id) -> dict | None:
    return _row(conn.execute(
        "SELECT * FROM selected_layouts WHERE project_id = ?", (project_id,)
    ).fetchone())


def record_event(conn, project_id, event_type, payload, *, generation_id=None,
                 layout_id=None, brief_version_id=None) -> str:
    identifier = new_id()
    encoded = json.dumps(payload or {})
    if len(encoded.encode("utf-8")) > 4096:
        raise ValueError("interaction event payload exceeds 4 KiB")
    conn.execute(
        "INSERT INTO interaction_events(id, project_id, generation_id, layout_id,"
        " brief_version_id, event_type, created_at, payload_json)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (identifier, project_id, generation_id, layout_id, brief_version_id,
         event_type, now_iso(), encoded),
    )
    return identifier
