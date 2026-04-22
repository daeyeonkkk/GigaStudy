from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class StudioStore(Protocol):
    @property
    def metadata_label(self) -> str:
        ...

    def load_raw(self) -> dict[str, Any]:
        ...

    def save_raw(self, payload: dict[str, Any]) -> None:
        ...

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        ...


class FileStudioStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    @property
    def metadata_label(self) -> str:
        return str(self._path.resolve())

    def load_raw(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        return json.loads(self._path.read_text(encoding="utf-8"))

    def save_raw(self, payload: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        if self._path.exists():
            return self._path.stat().st_size
        return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


class PostgresStudioStore:
    def __init__(self, database_url: str) -> None:
        self._database_url = _normalize_database_url(database_url)
        self._initialized = False

    @property
    def metadata_label(self) -> str:
        return "postgres://studio_documents"

    def load_raw(self) -> dict[str, Any]:
        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = connection.execute(
                "SELECT studio_id, payload FROM studio_documents ORDER BY updated_at DESC"
            ).fetchall()
        return {str(row["studio_id"]): row["payload"] for row in rows}

    def save_raw(self, payload: dict[str, Any]) -> None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            existing_rows = connection.execute("SELECT studio_id FROM studio_documents").fetchall()
            existing_ids = {str(row["studio_id"]) for row in existing_rows}
            next_ids = set(payload)
            stale_ids = existing_ids - next_ids
            if stale_ids:
                connection.execute(
                    "DELETE FROM studio_documents WHERE studio_id = ANY(%s)",
                    (list(stale_ids),),
                )
            for studio_id, studio_payload in payload.items():
                connection.execute(
                    """
                    INSERT INTO studio_documents (studio_id, payload, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (studio_id)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
                    """,
                    (studio_id, Jsonb(studio_payload)),
                )
            connection.commit()

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _connect(self):
        import psycopg

        return psycopg.connect(self._database_url, row_factory=dict_row)

    def _ensure_schema(self, connection) -> None:
        if self._initialized:
            return
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_documents (
                studio_id text PRIMARY KEY,
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        connection.commit()
        self._initialized = True


def build_studio_store(*, storage_root: Path, database_url: str | None) -> StudioStore:
    if database_url is not None and database_url.strip():
        return PostgresStudioStore(database_url)
    return FileStudioStore(storage_root / "six_track_studios.json")


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+psycopg://"):
        return database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    return database_url
