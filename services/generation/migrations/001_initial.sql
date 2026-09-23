-- PlanLab generation service, migration 001 (plan section 6.1).
-- Additive only; applied in one transaction by planlab_service.database.migrate().

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    revision                 INTEGER NOT NULL DEFAULT 1,
    current_brief_version_id TEXT NULL,
    client_import_id         TEXT UNIQUE NULL,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brief_versions (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    sequence             INTEGER NOT NULL,
    contract_version     TEXT NOT NULL,
    brief_hash           TEXT NOT NULL,
    brief_json           TEXT NOT NULL,
    editor_document_json TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    UNIQUE (project_id, sequence),
    UNIQUE (project_id, brief_hash),
    UNIQUE (project_id, id)
);

CREATE TABLE IF NOT EXISTS generations (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL,
    brief_version_id TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL,
    request_hash     TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN (
                         'QUEUED','LOADING_MODEL','GENERATING_TOPOLOGIES','SOLVING',
                         'VALIDATING','RANKING','COMPLETED','INFEASIBLE','FAILED','CANCELLED')),
    state_version    INTEGER NOT NULL DEFAULT 0,
    run_token        TEXT NULL,
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    created_at       TEXT NOT NULL,
    started_at       TEXT NULL,
    finished_at      TEXT NULL,
    last_heartbeat_at TEXT NULL,
    progress_json    TEXT NOT NULL DEFAULT '{}',
    settings_json    TEXT NOT NULL,
    versions_json    TEXT NULL,
    error_json       TEXT NULL,
    warnings_json    TEXT NOT NULL DEFAULT '[]',
    diagnostics_json TEXT NULL,
    FOREIGN KEY (project_id, brief_version_id)
        REFERENCES brief_versions(project_id, id),
    UNIQUE (project_id, idempotency_key),
    UNIQUE (project_id, id),
    UNIQUE (id, brief_version_id)
);

CREATE TABLE IF NOT EXISTS layout_variants (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL,
    generation_id    TEXT NOT NULL,
    brief_version_id TEXT NOT NULL,
    rank             INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
    geometry_hash    TEXT NOT NULL,
    dto_json         TEXT NOT NULL,
    raw_engine_json  TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    FOREIGN KEY (project_id, generation_id) REFERENCES generations(project_id, id),
    FOREIGN KEY (generation_id, brief_version_id) REFERENCES generations(id, brief_version_id),
    UNIQUE (generation_id, rank),
    UNIQUE (generation_id, geometry_hash),
    UNIQUE (project_id, id)
);

CREATE TABLE IF NOT EXISTS selected_layouts (
    project_id  TEXT PRIMARY KEY REFERENCES projects(id),
    layout_id   TEXT NOT NULL,
    selected_at TEXT NOT NULL,
    FOREIGN KEY (project_id, layout_id) REFERENCES layout_variants(project_id, id)
);

CREATE TABLE IF NOT EXISTS interaction_events (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id),
    generation_id    TEXT NULL REFERENCES generations(id),
    layout_id        TEXT NULL REFERENCES layout_variants(id),
    brief_version_id TEXT NULL REFERENCES brief_versions(id),
    event_type       TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    payload_json     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_status_created
    ON generations(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_generations_project_created
    ON generations(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_layout_variants_generation_rank
    ON layout_variants(generation_id, rank);
CREATE INDEX IF NOT EXISTS idx_interaction_events_project_created
    ON interaction_events(project_id, created_at);

-- At most one active generation per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_one_active_per_project
    ON generations(project_id)
    WHERE status IN ('QUEUED','LOADING_MODEL','GENERATING_TOPOLOGIES','SOLVING',
                     'VALIDATING','RANKING');
