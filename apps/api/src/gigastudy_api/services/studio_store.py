from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
from threading import RLock
from typing import Any, Literal, Protocol

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


SIDECAR_KEYS = ("reports", "candidates", "track_material_archives")
ActiveStatus = Literal["active", "inactive", "all"]


class StudioStore(Protocol):
    @property
    def metadata_label(self) -> str:
        ...

    def load_raw(self) -> dict[str, Any]:
        ...

    def list_raw(
        self,
        *,
        limit: int,
        offset: int,
        active_status: ActiveStatus = "all",
    ) -> list[tuple[str, Any]]:
        ...

    def list_summary_raw(
        self,
        *,
        limit: int,
        offset: int,
        owner_token_hash: str | None = None,
        active_status: ActiveStatus = "active",
    ) -> list[tuple[str, Any]]:
        ...

    def count(self, *, active_status: ActiveStatus = "all") -> int:
        ...

    def load_one_raw(self, studio_id: str) -> Any | None:
        ...

    def save_raw(self, payload: dict[str, Any]) -> None:
        ...

    def save_one_raw(self, studio_id: str, payload: Any) -> None:
        ...

    def delete_one_raw(self, studio_id: str) -> bool:
        ...

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        ...

    def estimate_total_bytes(self) -> int:
        ...


class FileStudioStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._sidecar_root = path.parent / "studio_sidecars"

    @property
    def metadata_label(self) -> str:
        return str(self._path.resolve())

    def load_raw(self) -> dict[str, Any]:
        return {
            studio_id: self._merge_file_sidecars(studio_id, studio_payload)
            for studio_id, studio_payload in self._read_base_raw().items()
        }

    def list_raw(
        self,
        *,
        limit: int,
        offset: int,
        active_status: ActiveStatus = "all",
    ) -> list[tuple[str, Any]]:
        payload = self._read_base_raw()
        rows = sorted(
            [
                (studio_id, studio_payload)
                for studio_id, studio_payload in payload.items()
                if _active_matches(studio_payload, active_status)
            ],
            key=lambda item: str(item[1].get("updated_at", "")) if isinstance(item[1], dict) else "",
            reverse=True,
        )
        return [
            (studio_id, self._merge_file_sidecars(studio_id, studio_payload))
            for studio_id, studio_payload in rows[offset : offset + limit]
        ]

    def list_summary_raw(
        self,
        *,
        limit: int,
        offset: int,
        owner_token_hash: str | None = None,
        active_status: ActiveStatus = "active",
    ) -> list[tuple[str, Any]]:
        payload = {
            studio_id: studio_payload
            for studio_id, studio_payload in self._read_base_raw().items()
            if _owner_matches(studio_payload, owner_token_hash)
            and _active_matches(studio_payload, active_status)
        }
        rows = sorted(
            payload.items(),
            key=lambda item: str(item[1].get("updated_at", "")) if isinstance(item[1], dict) else "",
            reverse=True,
        )
        return rows[offset : offset + limit]

    def count(self, *, active_status: ActiveStatus = "all") -> int:
        return sum(
            1
            for studio_payload in self._read_base_raw().values()
            if _active_matches(studio_payload, active_status)
        )

    def load_one_raw(self, studio_id: str) -> Any | None:
        studio_payload = self._read_base_raw().get(studio_id)
        if studio_payload is None:
            return None
        return self._merge_file_sidecars(studio_id, studio_payload)

    def save_raw(self, payload: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        existing_ids = set(self._read_base_raw())
        next_ids = set(payload)
        base_payload: dict[str, Any] = {}
        for studio_id, studio_payload in payload.items():
            base_studio, reports, candidates, track_material_archives = _split_sidecars(studio_payload)
            base_payload[studio_id] = base_studio
            self._write_file_sidecar(studio_id, "reports", reports)
            self._write_file_sidecar(studio_id, "candidates", candidates)
            self._write_file_sidecar(studio_id, "track_material_archives", track_material_archives)
        for stale_id in existing_ids - next_ids:
            self._delete_file_sidecars(stale_id)
        self._write_base_raw(base_payload)

    def save_one_raw(self, studio_id: str, payload: Any) -> None:
        raw_payload = self._read_base_raw()
        base_studio, reports, candidates, track_material_archives = _split_sidecars(payload)
        raw_payload[studio_id] = base_studio
        self._write_file_sidecar(studio_id, "reports", reports)
        self._write_file_sidecar(studio_id, "candidates", candidates)
        self._write_file_sidecar(studio_id, "track_material_archives", track_material_archives)
        self._write_base_raw(raw_payload)

    def delete_one_raw(self, studio_id: str) -> bool:
        raw_payload = self._read_base_raw()
        existed = studio_id in raw_payload
        if existed:
            raw_payload.pop(studio_id, None)
            self._write_base_raw(raw_payload)
            self._delete_file_sidecars(studio_id)
        return existed

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def estimate_total_bytes(self) -> int:
        total = self._path.stat().st_size if self._path.exists() else 0
        if self._sidecar_root.exists():
            total += sum(path.stat().st_size for path in self._sidecar_root.rglob("*.json") if path.is_file())
        return total

    def _read_base_raw(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        return json.loads(self._path.read_text(encoding="utf-8"))

    def _write_base_raw(self, payload: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _merge_file_sidecars(self, studio_id: str, studio_payload: Any) -> Any:
        reports = self._read_file_sidecar(studio_id, "reports")
        candidates = self._read_file_sidecar(studio_id, "candidates")
        track_material_archives = self._read_file_sidecar(studio_id, "track_material_archives")
        return _merge_sidecars(
            studio_payload,
            reports=reports,
            candidates=candidates,
            track_material_archives=track_material_archives,
        )

    def _read_file_sidecar(self, studio_id: str, key: str) -> list[Any] | None:
        sidecar_path = self._sidecar_path(studio_id, key)
        if not sidecar_path.exists():
            return None
        return json.loads(sidecar_path.read_text(encoding="utf-8"))

    def _write_file_sidecar(self, studio_id: str, key: str, items: list[Any]) -> None:
        sidecar_path = self._sidecar_path(studio_id, key)
        sidecar_path.parent.mkdir(parents=True, exist_ok=True)
        sidecar_path.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _delete_file_sidecars(self, studio_id: str) -> None:
        sidecar_dir = self._sidecar_root / studio_id
        if not sidecar_dir.exists():
            return
        for sidecar_path in sidecar_dir.glob("*.json"):
            sidecar_path.unlink(missing_ok=True)
        try:
            sidecar_dir.rmdir()
        except OSError:
            pass

    def _sidecar_path(self, studio_id: str, key: str) -> Path:
        return self._sidecar_root / studio_id / f"{key}.json"


class PostgresStudioStore:
    def __init__(self, database_url: str) -> None:
        self._database_url = _normalize_database_url(database_url)
        self._initialized = False
        self._connection = None
        self._connection_lock = RLock()

    @property
    def metadata_label(self) -> str:
        return "postgres://studio_documents"

    def load_raw(self) -> dict[str, Any]:
        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = connection.execute(
                "SELECT studio_id, payload FROM studio_documents ORDER BY updated_at DESC"
            ).fetchall()
            sidecars = self._fetch_sidecars(connection, [str(row["studio_id"]) for row in rows])
        return {
            str(row["studio_id"]): _merge_sidecars(
                row["payload"],
                reports=sidecars["reports"].get(str(row["studio_id"])),
                candidates=sidecars["candidates"].get(str(row["studio_id"])),
                track_material_archives=sidecars["track_material_archives"].get(str(row["studio_id"])),
            )
            for row in rows
        }

    def list_raw(
        self,
        *,
        limit: int,
        offset: int,
        active_status: ActiveStatus = "all",
    ) -> list[tuple[str, Any]]:
        active_clause, params = _active_sql_clause(active_status)
        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = connection.execute(
                f"""
                SELECT studio_id, payload
                FROM studio_documents
                {active_clause}
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (*params, limit, offset),
            ).fetchall()
            studio_ids = [str(row["studio_id"]) for row in rows]
            sidecars = self._fetch_sidecars(connection, studio_ids)
        return [
            (
                str(row["studio_id"]),
                _merge_sidecars(
                    row["payload"],
                    reports=sidecars["reports"].get(str(row["studio_id"])),
                    candidates=sidecars["candidates"].get(str(row["studio_id"])),
                    track_material_archives=sidecars["track_material_archives"].get(str(row["studio_id"])),
                ),
            )
            for row in rows
        ]

    def list_summary_raw(
        self,
        *,
        limit: int,
        offset: int,
        owner_token_hash: str | None = None,
        active_status: ActiveStatus = "active",
    ) -> list[tuple[str, Any]]:
        where_clauses: list[str] = []
        params_list: list[Any] = []
        active_clause, active_params = _active_sql_clause(active_status, include_where=False)
        if active_clause:
            where_clauses.append(active_clause)
            params_list.extend(active_params)
        if owner_token_hash is not None:
            where_clauses.append("payload ->> 'owner_token_hash' = %s")
            params_list.append(owner_token_hash)
        where_clause = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        params = (*params_list, limit, offset)
        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = connection.execute(
                f"""
                SELECT studio_id, payload
                FROM studio_documents
                {where_clause}
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                params,
            ).fetchall()
        return [(str(row["studio_id"]), row["payload"]) for row in rows]

    def count(self, *, active_status: ActiveStatus = "all") -> int:
        active_clause, params = _active_sql_clause(active_status)
        with self._connect() as connection:
            self._ensure_schema(connection)
            row = connection.execute(
                f"SELECT count(*) AS count FROM studio_documents {active_clause}",
                params,
            ).fetchone()
        return int(row["count"] if row is not None else 0)

    def load_one_raw(self, studio_id: str) -> Any | None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            row = connection.execute(
                "SELECT payload FROM studio_documents WHERE studio_id = %s",
                (studio_id,),
            ).fetchone()
            if row is None:
                return None
            sidecars = self._fetch_sidecars(connection, [studio_id])
        return _merge_sidecars(
            row["payload"],
            reports=sidecars["reports"].get(studio_id),
            candidates=sidecars["candidates"].get(studio_id),
            track_material_archives=sidecars["track_material_archives"].get(studio_id),
        )

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
                self._save_one_raw(connection, studio_id, studio_payload)
            connection.commit()

    def save_one_raw(self, studio_id: str, payload: Any) -> None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            self._save_one_raw(connection, studio_id, payload)
            connection.commit()

    def delete_one_raw(self, studio_id: str) -> bool:
        with self._connect() as connection:
            self._ensure_schema(connection)
            cursor = connection.execute(
                "DELETE FROM studio_documents WHERE studio_id = %s",
                (studio_id,),
            )
            connection.commit()
        return int(cursor.rowcount or 0) > 0

    def estimate_bytes(self, payload: dict[str, Any]) -> int:
        return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def estimate_total_bytes(self) -> int:
        with self._connect() as connection:
            self._ensure_schema(connection)
            row = connection.execute(
                """
                SELECT
                    (SELECT coalesce(sum(pg_column_size(payload)), 0) FROM studio_documents)
                  + (SELECT coalesce(sum(pg_column_size(payload)), 0) FROM studio_reports)
                  + (SELECT coalesce(sum(pg_column_size(payload)), 0) FROM studio_candidates)
                  + (SELECT coalesce(sum(pg_column_size(payload)), 0) FROM studio_track_material_archives)
                    AS bytes
                """
            ).fetchone()
        return int(row["bytes"] if row is not None else 0)

    def _save_one_raw(self, connection, studio_id: str, payload: Any) -> None:
        existing_sidecars: dict[str, list[Any]] = {
            "reports": [],
            "candidates": [],
            "track_material_archives": [],
        }
        existing_row = connection.execute(
            "SELECT payload FROM studio_documents WHERE studio_id = %s FOR UPDATE",
            (studio_id,),
        ).fetchone()
        if existing_row is not None:
            sidecars = self._fetch_sidecars(connection, [studio_id])
            existing_payload = _merge_sidecars(
                existing_row["payload"],
                reports=sidecars["reports"].get(studio_id),
                candidates=sidecars["candidates"].get(studio_id),
                track_material_archives=sidecars["track_material_archives"].get(studio_id),
            )
            payload = _merge_concurrent_studio_payload(existing_payload, payload)
            existing_sidecars = {
                "reports": sidecars["reports"].get(studio_id) or [],
                "candidates": sidecars["candidates"].get(studio_id) or [],
                "track_material_archives": sidecars["track_material_archives"].get(studio_id) or [],
            }
        base_studio, reports, candidates, track_material_archives = _split_sidecars(payload)
        connection.execute(
            """
            INSERT INTO studio_documents (studio_id, payload, updated_at)
            VALUES (%s, %s, now())
            ON CONFLICT (studio_id)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
            """,
            (studio_id, Jsonb(base_studio)),
        )
        self._sync_sidecar_rows(
            connection,
            table_name="studio_reports",
            id_column="report_id",
            id_key="report_id",
            studio_id=studio_id,
            items=reports,
            existing_items=existing_sidecars["reports"],
        )
        self._sync_sidecar_rows(
            connection,
            table_name="studio_candidates",
            id_column="candidate_id",
            id_key="candidate_id",
            studio_id=studio_id,
            items=candidates,
            existing_items=existing_sidecars["candidates"],
        )
        self._sync_sidecar_rows(
            connection,
            table_name="studio_track_material_archives",
            id_column="archive_id",
            id_key="archive_id",
            studio_id=studio_id,
            items=track_material_archives,
            existing_items=existing_sidecars["track_material_archives"],
        )

    def _sync_sidecar_rows(
        self,
        connection,
        *,
        table_name: str,
        id_column: str,
        id_key: str,
        studio_id: str,
        items: list[Any],
        existing_items: list[Any] | None = None,
    ) -> None:
        next_ids: list[str] = []
        existing_by_id = {
            _sidecar_item_id(existing_item, id_key=id_key, index=index): (index, existing_item)
            for index, existing_item in enumerate(existing_items or [])
        }
        for index, item in enumerate(items):
            item_id = _sidecar_item_id(item, id_key=id_key, index=index)
            next_ids.append(item_id)
            existing = existing_by_id.get(item_id)
            if existing is not None and existing[0] == index and existing[1] == item:
                continue
            connection.execute(
                f"""
                INSERT INTO {table_name} (studio_id, {id_column}, ordinal, payload, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (studio_id, {id_column})
                DO UPDATE SET
                    ordinal = EXCLUDED.ordinal,
                    payload = EXCLUDED.payload,
                    updated_at = CASE
                        WHEN {table_name}.ordinal IS DISTINCT FROM EXCLUDED.ordinal
                          OR {table_name}.payload IS DISTINCT FROM EXCLUDED.payload
                        THEN now()
                        ELSE {table_name}.updated_at
                    END
                """,
                (studio_id, item_id, index, Jsonb(item)),
            )
        if next_ids:
            connection.execute(
                f"DELETE FROM {table_name} WHERE studio_id = %s AND NOT ({id_column} = ANY(%s))",
                (studio_id, next_ids),
            )
        else:
            connection.execute(f"DELETE FROM {table_name} WHERE studio_id = %s", (studio_id,))

    def _fetch_sidecars(self, connection, studio_ids: list[str]) -> dict[str, dict[str, list[Any]]]:
        sidecars: dict[str, dict[str, list[Any]]] = {
            "reports": {},
            "candidates": {},
            "track_material_archives": {},
        }
        if not studio_ids:
            return sidecars
        for key, table_name in (
            ("reports", "studio_reports"),
            ("candidates", "studio_candidates"),
            ("track_material_archives", "studio_track_material_archives"),
        ):
            rows = connection.execute(
                f"""
                SELECT studio_id, payload
                FROM {table_name}
                WHERE studio_id = ANY(%s)
                ORDER BY studio_id, ordinal ASC, updated_at ASC
                """,
                (studio_ids,),
            ).fetchall()
            for row in rows:
                sidecars[key].setdefault(str(row["studio_id"]), []).append(row["payload"])
        return sidecars

    @contextmanager
    def _connect(self):
        import psycopg

        with self._connection_lock:
            if self._connection is None or self._connection.closed:
                self._connection = psycopg.connect(self._database_url, row_factory=dict_row)
            try:
                yield self._connection
                if not self._connection.closed:
                    self._connection.commit()
            except Exception:
                if not self._connection.closed:
                    self._connection.rollback()
                raise

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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_reports (
                studio_id text NOT NULL REFERENCES studio_documents(studio_id) ON DELETE CASCADE,
                report_id text NOT NULL,
                ordinal integer NOT NULL DEFAULT 0,
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (studio_id, report_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_candidates (
                studio_id text NOT NULL REFERENCES studio_documents(studio_id) ON DELETE CASCADE,
                candidate_id text NOT NULL,
                ordinal integer NOT NULL DEFAULT 0,
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (studio_id, candidate_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_track_material_archives (
                studio_id text NOT NULL REFERENCES studio_documents(studio_id) ON DELETE CASCADE,
                archive_id text NOT NULL,
                ordinal integer NOT NULL DEFAULT 0,
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (studio_id, archive_id)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_studio_reports_studio_order ON studio_reports (studio_id, ordinal)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_studio_candidates_studio_order ON studio_candidates (studio_id, ordinal)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_studio_track_archives_studio_order ON studio_track_material_archives (studio_id, ordinal)"
        )
        connection.commit()
        self._initialized = True


def build_studio_store(*, storage_root: Path, database_url: str | None) -> StudioStore:
    if database_url is not None and database_url.strip():
        return PostgresStudioStore(database_url)
    return FileStudioStore(storage_root / "six_track_studios.json")


def _split_sidecars(payload: Any) -> tuple[Any, list[Any], list[Any], list[Any]]:
    if not isinstance(payload, dict):
        return payload, [], [], []

    base_payload = dict(payload)
    reports = list(base_payload.pop("reports", []) or [])
    candidates = list(base_payload.pop("candidates", []) or [])
    track_material_archives = list(base_payload.pop("track_material_archives", []) or [])
    base_payload["reports"] = []
    base_payload["candidates"] = []
    base_payload["track_material_archives"] = []
    base_payload["_sidecar_counts"] = {
        "reports": len(reports),
        "candidates": len(candidates),
        "track_material_archives": len(track_material_archives),
    }
    return base_payload, reports, candidates, track_material_archives


def _merge_concurrent_studio_payload(existing: Any, incoming: Any) -> Any:
    if not isinstance(existing, dict) or not isinstance(incoming, dict):
        return incoming

    merged = dict(existing)
    merged.update(incoming)
    for key, id_key in (
        ("tracks", "slot_id"),
        ("regions", "region_id"),
        ("jobs", "job_id"),
        ("reports", "report_id"),
        ("candidates", "candidate_id"),
        ("track_material_archives", "archive_id"),
    ):
        merged[key] = _merge_timestamped_items(
            existing.get(key),
            incoming.get(key),
            id_key=id_key,
        )
    if _timestamp_value(existing.get("updated_at")) > _timestamp_value(incoming.get("updated_at")):
        merged["updated_at"] = existing.get("updated_at")
    return merged


def _merge_timestamped_items(existing: Any, incoming: Any, *, id_key: str) -> list[Any]:
    if not isinstance(existing, list):
        return list(incoming) if isinstance(incoming, list) else []
    if not isinstance(incoming, list):
        return list(existing)

    merged_by_id: dict[str, Any] = {}
    ordered_ids: list[str] = []

    def merge_item(item: Any) -> None:
        if not isinstance(item, dict):
            item_id = f"__index_{len(ordered_ids):08d}"
        else:
            item_id = str(item.get(id_key) or f"__index_{len(ordered_ids):08d}")
        if item_id not in merged_by_id:
            ordered_ids.append(item_id)
            merged_by_id[item_id] = item
            return
        current = merged_by_id[item_id]
        if _timestamp_value(item.get("updated_at") if isinstance(item, dict) else None) >= _timestamp_value(
            current.get("updated_at") if isinstance(current, dict) else None
        ):
            merged_by_id[item_id] = item

    for item in existing:
        merge_item(item)
    for item in incoming:
        merge_item(item)
    return [merged_by_id[item_id] for item_id in ordered_ids]


def _merge_sidecars(
    payload: Any,
    *,
    reports: list[Any] | None,
    candidates: list[Any] | None,
    track_material_archives: list[Any] | None,
) -> Any:
    if not isinstance(payload, dict):
        return payload

    merged_payload = dict(payload)
    if reports is not None:
        merged_payload["reports"] = reports
    else:
        merged_payload.setdefault("reports", [])

    if candidates is not None:
        merged_payload["candidates"] = candidates
    else:
        merged_payload.setdefault("candidates", [])

    if track_material_archives is not None:
        merged_payload["track_material_archives"] = track_material_archives
    else:
        merged_payload.setdefault("track_material_archives", [])

    return merged_payload


def _sidecar_item_id(item: Any, *, id_key: str, index: int) -> str:
    return str(item.get(id_key) or f"{index:08d}") if isinstance(item, dict) else f"{index:08d}"


def _timestamp_value(value: Any) -> str:
    return str(value or "")


def _owner_matches(studio_payload: Any, owner_token_hash: str | None) -> bool:
    if owner_token_hash is None:
        return True
    return isinstance(studio_payload, dict) and studio_payload.get("owner_token_hash") == owner_token_hash


def _active_matches(studio_payload: Any, active_status: ActiveStatus) -> bool:
    if active_status == "all":
        return True
    is_active = not isinstance(studio_payload, dict) or studio_payload.get("is_active", True) is not False
    return is_active if active_status == "active" else not is_active


def _active_sql_clause(
    active_status: ActiveStatus,
    *,
    include_where: bool = True,
) -> tuple[str, tuple[Any, ...]]:
    if active_status == "all":
        return "", ()
    comparison = "true" if active_status == "active" else "false"
    clause = f"coalesce((payload ->> 'is_active')::boolean, true) = {comparison}"
    return (f"WHERE {clause}" if include_where else clause), ()


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+psycopg://"):
        return database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    return database_url
