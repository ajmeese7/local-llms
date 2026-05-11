"""SQLite-backed state for endpoint revisions and the per-hardware active pointer.

Single-writer assumption (one local user). No connection pool, no abstraction
layer; if we ever need Postgres we'll port the four DAO methods then.
"""

from __future__ import annotations

import getpass
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from platformdirs import user_state_path

SCHEMA_VERSION = 2


@dataclass(frozen=True, slots=True)
class Revision:
    """One historical activate/rollback event."""

    id: int
    hardware: str
    endpoint_name: str
    reason: str
    actor: str
    created_at: datetime
    provider_override: str | None = None


def _default_db_path() -> Path:
    return Path(user_state_path("llms", appauthor=False)) / "state.db"


def _utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def _row_to_revision(row: sqlite3.Row) -> Revision:
    keys = row.keys() if hasattr(row, "keys") else []
    provider_override = row["provider_override"] if "provider_override" in keys else None
    return Revision(
        id=row["id"],
        hardware=row["hardware"],
        endpoint_name=row["endpoint_name"],
        reason=row["reason"],
        actor=row["actor"],
        created_at=_parse_iso(row["created_at"]),
        provider_override=provider_override,
    )


class StateStore:
    """Owns the SQLite file. Construct once per CLI invocation."""

    def __init__(self, *, path: Path | None = None) -> None:
        self.path = (path or _default_db_path()).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    # ── connection ──────────────────────────────────────────────────────────

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS endpoint_revisions (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    hardware          TEXT NOT NULL,
                    endpoint_name     TEXT NOT NULL,
                    reason            TEXT NOT NULL DEFAULT '',
                    actor             TEXT NOT NULL,
                    created_at        TEXT NOT NULL,
                    provider_override TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_endpoint_revisions_hardware
                    ON endpoint_revisions(hardware);
                CREATE INDEX IF NOT EXISTS idx_endpoint_revisions_endpoint
                    ON endpoint_revisions(endpoint_name);
                CREATE TABLE IF NOT EXISTS active_endpoint (
                    hardware    TEXT PRIMARY KEY,
                    revision_id INTEGER NOT NULL,
                    FOREIGN KEY (revision_id) REFERENCES endpoint_revisions(id)
                );
                """
            )
            # v1 → v2: add provider_override column to existing tables. SQLite
            # has no IF NOT EXISTS for columns; introspect first.
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(endpoint_revisions)")}
            if "provider_override" not in cols:
                conn.execute("ALTER TABLE endpoint_revisions ADD COLUMN provider_override TEXT")
            current = conn.execute(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if current is None:
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (SCHEMA_VERSION,),
                )
            elif current["version"] < SCHEMA_VERSION:
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,)
                )

    # ── revisions ───────────────────────────────────────────────────────────

    def append_revision(
        self,
        *,
        hardware: str,
        endpoint_name: str,
        reason: str = "",
        actor: str | None = None,
        provider_override: str | None = None,
    ) -> Revision:
        """Append a revision row and atomically point `active_endpoint` at it.

        `provider_override` pins a non-default inference backend for this
        endpoint without requiring a separate endpoint YAML file. The launcher
        reads this on the next exec to pick the right server binary.
        """
        actor_name = actor or _current_actor()
        created = _utc_now_iso()
        with self._conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO endpoint_revisions
                    (hardware, endpoint_name, reason, actor, created_at, provider_override)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (hardware, endpoint_name, reason, actor_name, created, provider_override),
            )
            new_id = cursor.lastrowid
            assert new_id is not None
            conn.execute(
                """
                INSERT INTO active_endpoint (hardware, revision_id)
                VALUES (?, ?)
                ON CONFLICT(hardware) DO UPDATE SET revision_id = excluded.revision_id
                """,
                (hardware, new_id),
            )
            row = conn.execute(
                "SELECT * FROM endpoint_revisions WHERE id = ?", (new_id,)
            ).fetchone()
            return _row_to_revision(row)

    def list_revisions(
        self,
        *,
        hardware: str | None = None,
        endpoint_name: str | None = None,
        limit: int = 50,
    ) -> list[Revision]:
        clauses: list[str] = []
        params: list[object] = []
        if hardware is not None:
            clauses.append("hardware = ?")
            params.append(hardware)
        if endpoint_name is not None:
            clauses.append("endpoint_name = ?")
            params.append(endpoint_name)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM endpoint_revisions{where} ORDER BY id DESC LIMIT ?",
                params,
            ).fetchall()
        return [_row_to_revision(r) for r in rows]

    def get_revision(self, revision_id: int) -> Revision | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM endpoint_revisions WHERE id = ?", (revision_id,)
            ).fetchone()
        return _row_to_revision(row) if row else None

    # ── active pointer ──────────────────────────────────────────────────────

    def get_active(self, hardware: str) -> Revision | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT r.* FROM endpoint_revisions r
                JOIN active_endpoint a ON a.revision_id = r.id
                WHERE a.hardware = ?
                """,
                (hardware,),
            ).fetchone()
        return _row_to_revision(row) if row else None

    def all_active(self) -> dict[str, Revision]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT r.* FROM endpoint_revisions r
                JOIN active_endpoint a ON a.revision_id = r.id
                """
            ).fetchall()
        return {row["hardware"]: _row_to_revision(row) for row in rows}

    def all_active_endpoints(self) -> dict[str, str]:
        """Cheap view used by the launcher to pick which endpoint to load."""
        return {hw: rev.endpoint_name for hw, rev in self.all_active().items()}


def _current_actor() -> str:
    try:
        return getpass.getuser()
    except Exception:
        return "unknown"


__all__ = ["Revision", "StateStore"]
