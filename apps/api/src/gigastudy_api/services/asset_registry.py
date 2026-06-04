from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from gigastudy_api.config import Settings
from gigastudy_api.services.asset_paths import (
    clean_relative_path,
    encode_asset_id,
    studio_id_from_asset_path,
)
from gigastudy_api.services.metadata_object_store import S3JsonObjectStore


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class AssetRecord:
    relative_path: str
    studio_id: str | None
    kind: str
    filename: str
    size_bytes: int
    updated_at: str
    content_type: str | None = None
    deleted_at: str | None = None

    @property
    def asset_id(self) -> str:
        return encode_asset_id(self.relative_path)

    @classmethod
    def from_storage_info(cls, info: Any) -> AssetRecord:
        relative_path = clean_relative_path(str(info.relative_path))
        return cls(
            relative_path=relative_path,
            studio_id=studio_id_from_asset_path(relative_path),
            kind=str(getattr(info, "kind", "unknown") or "unknown"),
            filename=str(getattr(info, "filename", Path(relative_path).name) or Path(relative_path).name),
            size_bytes=int(getattr(info, "size_bytes", 0) or 0),
            updated_at=str(getattr(info, "updated_at", "") or _now_iso()),
            content_type=None,
            deleted_at=None,
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "relative_path": self.relative_path,
            "studio_id": self.studio_id,
            "kind": self.kind,
            "filename": self.filename,
            "size_bytes": self.size_bytes,
            "updated_at": self.updated_at,
            "content_type": self.content_type,
            "deleted_at": self.deleted_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> AssetRecord:
        relative_path = clean_relative_path(str(data["relative_path"]))
        return cls(
            relative_path=relative_path,
            studio_id=data.get("studio_id") or studio_id_from_asset_path(relative_path),
            kind=str(data.get("kind") or "unknown"),
            filename=str(data.get("filename") or Path(relative_path).name),
            size_bytes=int(data.get("size_bytes") or 0),
            updated_at=str(data.get("updated_at") or _now_iso()),
            content_type=data.get("content_type"),
            deleted_at=data.get("deleted_at"),
        )


class AssetRegistry(Protocol):
    def upsert(self, record: AssetRecord) -> None: ...

    def mark_deleted(self, relative_path: str, deleted_at: str | None = None) -> AssetRecord | None: ...

    def mark_prefix_deleted(self, relative_prefix: str, deleted_at: str | None = None) -> tuple[int, int]: ...

    def list_studio_assets(self, studio_id: str, *, limit: int, offset: int) -> list[AssetRecord]: ...

    def summarize_studio(self, studio_id: str) -> tuple[int, int]: ...

    def summarize_all(self) -> tuple[int, int]: ...

    def sync_studio_assets(self, studio_id: str, assets: list[Any]) -> None: ...


class FileAssetRegistry:
    def __init__(self, storage_root: Path) -> None:
        self._path = storage_root / "asset_registry.json"
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def upsert(self, record: AssetRecord) -> None:
        data = self._read()
        data[record.relative_path] = record.to_json() | {"deleted_at": None}
        self._write(data)

    def mark_deleted(self, relative_path: str, deleted_at: str | None = None) -> AssetRecord | None:
        clean = clean_relative_path(relative_path)
        data = self._read()
        existing = data.get(clean)
        if existing is None:
            return None
        deleted_at = deleted_at or _now_iso()
        existing["deleted_at"] = deleted_at
        existing["updated_at"] = deleted_at
        data[clean] = existing
        self._write(data)
        return AssetRecord.from_json(existing)

    def mark_prefix_deleted(self, relative_prefix: str, deleted_at: str | None = None) -> tuple[int, int]:
        prefix = clean_relative_path(relative_prefix).rstrip("/") + "/"
        deleted_at = deleted_at or _now_iso()
        data = self._read()
        count = 0
        size = 0
        for path, existing in list(data.items()):
            if not path.startswith(prefix) or existing.get("deleted_at"):
                continue
            existing["deleted_at"] = deleted_at
            existing["updated_at"] = deleted_at
            data[path] = existing
            count += 1
            size += int(existing.get("size_bytes") or 0)
        if count:
            self._write(data)
        return count, size

    def list_studio_assets(self, studio_id: str, *, limit: int, offset: int) -> list[AssetRecord]:
        records = [
            AssetRecord.from_json(value)
            for value in self._read().values()
            if value.get("studio_id") == studio_id and not value.get("deleted_at")
        ]
        records.sort(key=lambda record: record.updated_at, reverse=True)
        return records[offset : offset + limit]

    def summarize_studio(self, studio_id: str) -> tuple[int, int]:
        records = [
            value
            for value in self._read().values()
            if value.get("studio_id") == studio_id and not value.get("deleted_at")
        ]
        return len(records), sum(int(record.get("size_bytes") or 0) for record in records)

    def summarize_all(self) -> tuple[int, int]:
        records = [value for value in self._read().values() if not value.get("deleted_at")]
        return len(records), sum(int(record.get("size_bytes") or 0) for record in records)

    def sync_studio_assets(self, studio_id: str, assets: list[Any]) -> None:
        data = self._read()
        changed = False
        for info in assets:
            record = AssetRecord.from_storage_info(info)
            if record.studio_id != studio_id:
                continue
            data[record.relative_path] = record.to_json() | {"deleted_at": None}
            changed = True
        if changed:
            self._write(data)

    def _read(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        with self._path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return {}
        return {str(key): value for key, value in payload.items() if isinstance(value, dict)}

    def _write(self, data: dict[str, dict[str, Any]]) -> None:
        tmp_path = self._path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        tmp_path.replace(self._path)


class S3AssetRegistry:
    def __init__(self, object_store: S3JsonObjectStore) -> None:
        self._objects = object_store

    def upsert(self, record: AssetRecord) -> None:
        data = self._read()
        data[record.relative_path] = record.to_json() | {"deleted_at": None}
        self._write(data)

    def mark_deleted(self, relative_path: str, deleted_at: str | None = None) -> AssetRecord | None:
        clean = clean_relative_path(relative_path)
        data = self._read()
        existing = data.get(clean)
        if existing is None:
            return None
        deleted_at = deleted_at or _now_iso()
        existing["deleted_at"] = deleted_at
        existing["updated_at"] = deleted_at
        data[clean] = existing
        self._write(data)
        return AssetRecord.from_json(existing)

    def mark_prefix_deleted(self, relative_prefix: str, deleted_at: str | None = None) -> tuple[int, int]:
        prefix = clean_relative_path(relative_prefix).rstrip("/") + "/"
        deleted_at = deleted_at or _now_iso()
        data = self._read()
        count = 0
        size = 0
        for path, existing in list(data.items()):
            if not path.startswith(prefix) or existing.get("deleted_at"):
                continue
            existing["deleted_at"] = deleted_at
            existing["updated_at"] = deleted_at
            data[path] = existing
            count += 1
            size += int(existing.get("size_bytes") or 0)
        if count:
            self._write(data)
        return count, size

    def list_studio_assets(self, studio_id: str, *, limit: int, offset: int) -> list[AssetRecord]:
        records = [
            AssetRecord.from_json(value)
            for value in self._read().values()
            if value.get("studio_id") == studio_id and not value.get("deleted_at")
        ]
        records.sort(key=lambda record: record.updated_at, reverse=True)
        return records[offset : offset + limit]

    def summarize_studio(self, studio_id: str) -> tuple[int, int]:
        records = [
            value
            for value in self._read().values()
            if value.get("studio_id") == studio_id and not value.get("deleted_at")
        ]
        return len(records), sum(int(record.get("size_bytes") or 0) for record in records)

    def summarize_all(self) -> tuple[int, int]:
        records = [value for value in self._read().values() if not value.get("deleted_at")]
        return len(records), sum(int(record.get("size_bytes") or 0) for record in records)

    def sync_studio_assets(self, studio_id: str, assets: list[Any]) -> None:
        data = self._read()
        changed = False
        for info in assets:
            record = AssetRecord.from_storage_info(info)
            if record.studio_id != studio_id:
                continue
            data[record.relative_path] = record.to_json() | {"deleted_at": None}
            changed = True
        if changed:
            self._write(data)

    def _read(self) -> dict[str, dict[str, Any]]:
        payload = self._objects.read_json("asset_registry.json", {})
        if not isinstance(payload, dict):
            return {}
        return {str(key): value for key, value in payload.items() if isinstance(value, dict)}

    def _write(self, data: dict[str, dict[str, Any]]) -> None:
        self._objects.write_json("asset_registry.json", data)


class PostgresAssetRegistry:
    def __init__(self, database_url: str) -> None:
        self._database_url = _normalize_database_url(database_url)
        self._ensure_schema()

    def upsert(self, record: AssetRecord) -> None:
        clean = clean_relative_path(record.relative_path)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO asset_objects (
                    relative_path, studio_id, kind, filename, size_bytes,
                    content_type, updated_at, deleted_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL)
                ON CONFLICT (relative_path) DO UPDATE SET
                    studio_id = EXCLUDED.studio_id,
                    kind = EXCLUDED.kind,
                    filename = EXCLUDED.filename,
                    size_bytes = EXCLUDED.size_bytes,
                    content_type = EXCLUDED.content_type,
                    updated_at = EXCLUDED.updated_at,
                    deleted_at = NULL
                """,
                (
                    clean,
                    record.studio_id or studio_id_from_asset_path(clean),
                    record.kind,
                    record.filename,
                    record.size_bytes,
                    record.content_type,
                    record.updated_at,
                ),
            )
            conn.commit()

    def mark_deleted(self, relative_path: str, deleted_at: str | None = None) -> AssetRecord | None:
        clean = clean_relative_path(relative_path)
        deleted_at = deleted_at or _now_iso()
        with self._connect() as conn:
            row = conn.execute(
                """
                UPDATE asset_objects
                SET deleted_at = %s, updated_at = %s
                WHERE relative_path = %s AND deleted_at IS NULL
                RETURNING relative_path, studio_id, kind, filename, size_bytes, content_type, updated_at, deleted_at
                """,
                (deleted_at, deleted_at, clean),
            ).fetchone()
            conn.commit()
        return self._record_from_row(row) if row else None

    def mark_prefix_deleted(self, relative_prefix: str, deleted_at: str | None = None) -> tuple[int, int]:
        prefix = clean_relative_path(relative_prefix).rstrip("/") + "/"
        deleted_at = deleted_at or _now_iso()
        with self._connect() as conn:
            rows = conn.execute(
                """
                UPDATE asset_objects
                SET deleted_at = %s, updated_at = %s
                WHERE relative_path LIKE %s AND deleted_at IS NULL
                RETURNING size_bytes
                """,
                (deleted_at, deleted_at, f"{prefix}%"),
            ).fetchall()
            conn.commit()
        return len(rows), sum(int(row["size_bytes"] or 0) for row in rows)

    def list_studio_assets(self, studio_id: str, *, limit: int, offset: int) -> list[AssetRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT relative_path, studio_id, kind, filename, size_bytes, content_type, updated_at, deleted_at
                FROM asset_objects
                WHERE studio_id = %s AND deleted_at IS NULL
                ORDER BY updated_at DESC, relative_path ASC
                LIMIT %s OFFSET %s
                """,
                (studio_id, limit, offset),
            ).fetchall()
        return [self._record_from_row(row) for row in rows]

    def summarize_studio(self, studio_id: str) -> tuple[int, int]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS asset_count, COALESCE(SUM(size_bytes), 0) AS asset_bytes
                FROM asset_objects
                WHERE studio_id = %s AND deleted_at IS NULL
                """,
                (studio_id,),
            ).fetchone()
        return int(row["asset_count"] or 0), int(row["asset_bytes"] or 0)

    def summarize_all(self) -> tuple[int, int]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS asset_count, COALESCE(SUM(size_bytes), 0) AS asset_bytes
                FROM asset_objects
                WHERE deleted_at IS NULL
                """,
            ).fetchone()
        return int(row["asset_count"] or 0), int(row["asset_bytes"] or 0)

    def sync_studio_assets(self, studio_id: str, assets: list[Any]) -> None:
        for info in assets:
            record = AssetRecord.from_storage_info(info)
            if record.studio_id == studio_id:
                self.upsert(record)

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS asset_objects (
                    relative_path TEXT PRIMARY KEY,
                    studio_id TEXT,
                    kind TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    size_bytes BIGINT NOT NULL DEFAULT 0,
                    content_type TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_asset_objects_studio_active
                ON asset_objects (studio_id, updated_at DESC)
                WHERE deleted_at IS NULL
                """
            )
            conn.commit()

    def _connect(self) -> psycopg.Connection[dict[str, Any]]:
        return psycopg.connect(self._database_url, row_factory=dict_row)

    def _record_from_row(self, row: dict[str, Any]) -> AssetRecord:
        relative_path = clean_relative_path(str(row["relative_path"]))
        return AssetRecord(
            relative_path=relative_path,
            studio_id=row.get("studio_id") or studio_id_from_asset_path(relative_path),
            kind=str(row.get("kind") or "unknown"),
            filename=str(row.get("filename") or Path(relative_path).name),
            size_bytes=int(row.get("size_bytes") or 0),
            updated_at=self._iso(row.get("updated_at")),
            content_type=row.get("content_type"),
            deleted_at=self._iso(row.get("deleted_at")) if row.get("deleted_at") else None,
        )

    @staticmethod
    def _iso(value: Any) -> str:
        if isinstance(value, datetime):
            return value.astimezone(UTC).isoformat()
        return str(value or _now_iso())


def build_asset_registry(
    *,
    storage_root: Path,
    database_url: str | None,
    settings: Settings | None = None,
) -> AssetRegistry:
    if database_url:
        return PostgresAssetRegistry(database_url)
    metadata_backend = (settings.metadata_backend if settings is not None else "local").strip().lower()
    if metadata_backend in {"s3", "r2"} and settings is not None:
        return S3AssetRegistry(S3JsonObjectStore(settings=settings, prefix=settings.metadata_prefix))
    return FileAssetRegistry(storage_root)


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+psycopg://"):
        return database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    return database_url
