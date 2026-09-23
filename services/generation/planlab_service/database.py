"""SQLite ownership for the generation service: connection, migrations, backups (S04)."""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
BUSY_TIMEOUT_MS = 5_000


def connect(db_path, *, read_only: bool = False) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if read_only:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5.0)
    else:
        connection = sqlite3.connect(str(path), timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    if not read_only:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
    return connection


def applied_versions(connection: sqlite3.Connection) -> set[int]:
    """(helper) which migrations this database already has."""
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).fetchone()
    if row is None:
        return set()
    return {int(record["version"]) for record in connection.execute(
        "SELECT version FROM schema_migrations"
    )}


def migrate(db_path, migrations_dir=None) -> list[int]:
    """Apply every pending additive migration in one transaction each."""
    directory = Path(migrations_dir or MIGRATIONS_DIR)
    connection = connect(db_path)
    applied: list[int] = []
    try:
        done = applied_versions(connection)
        for script in sorted(directory.glob("*.sql")):
            version = int(script.name.split("_", 1)[0])
            if version in done:
                continue
            sql = script.read_text(encoding="utf-8")
            # executescript() commits any pending transaction, so the migration
            # text and its bookkeeping row share one explicit transaction here.
            stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            connection.executescript(
                "BEGIN;\n"
                f"{sql}\n"
                "INSERT OR REPLACE INTO schema_migrations(version, applied_at) "
                f"VALUES ({int(version)}, '{stamp}');\n"
                "COMMIT;"
            )
            applied.append(version)
    finally:
        connection.close()
    return applied


def backup(db_path, data_dir, *, label: str | None = None) -> Path:
    """Online backup through SQLite's backup API; never copy a live WAL file alone."""
    source = connect(db_path)
    stamp = label or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    target_path = Path(data_dir) / "backups" / f"planlab-{stamp}.sqlite3"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(target_path)) as target:
        source.backup(target)
    source.close()
    return target_path


@contextmanager
def session(db_path, *, read_only: bool = False):
    """Connection that is always closed, unlike sqlite3's commit-only context manager."""
    connection = connect(db_path, read_only=read_only)
    try:
        yield connection
    finally:
        connection.close()
