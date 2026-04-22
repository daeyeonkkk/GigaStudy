from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from typing import Any, Literal, Protocol

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


EngineJobType = Literal["omr", "voice"]
EngineQueueStatus = Literal["queued", "running", "completed", "failed"]


def _now() -> datetime:
    return datetime.now(UTC)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


@dataclass(frozen=True)
class EngineQueueJob:
    job_id: str
    studio_id: str
    slot_id: int
    job_type: EngineJobType
    status: EngineQueueStatus
    payload: dict[str, Any]
    attempt_count: int
    max_attempts: int
    locked_until: str | None
    message: str | None
    created_at: str
    updated_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "studio_id": self.studio_id,
            "slot_id": self.slot_id,
            "job_type": self.job_type,
            "status": self.status,
            "payload": self.payload,
            "attempt_count": self.attempt_count,
            "max_attempts": self.max_attempts,
            "locked_until": self.locked_until,
            "message": self.message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> EngineQueueJob:
        return cls(
            job_id=str(data["job_id"]),
            studio_id=str(data["studio_id"]),
            slot_id=int(data["slot_id"]),
            job_type=_job_type(str(data["job_type"])),
            status=_queue_status(str(data["status"])),
            payload=dict(data.get("payload") or {}),
            attempt_count=int(data.get("attempt_count") or 0),
            max_attempts=max(1, int(data.get("max_attempts") or 3)),
            locked_until=data.get("locked_until"),
            message=data.get("message"),
            created_at=str(data.get("created_at") or _now_iso()),
            updated_at=str(data.get("updated_at") or _now_iso()),
        )


class EngineQueueStore(Protocol):
    def enqueue(self, job: EngineQueueJob) -> None:
        ...

    def claim_next(self, *, max_active: int, lease_seconds: int) -> EngineQueueJob | None:
        ...

    def complete(self, job_id: str, *, message: str | None = None) -> None:
        ...

    def fail(self, job_id: str, *, message: str) -> None:
        ...

    def get(self, job_id: str) -> EngineQueueJob | None:
        ...

    def has_runnable(self, *, studio_id: str | None = None) -> bool:
        ...

    def delete_studio_jobs(self, studio_id: str) -> int:
        ...


class FileEngineQueueStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = RLock()

    def enqueue(self, job: EngineQueueJob) -> None:
        with self._lock:
            payload = self._read()
            payload[job.job_id] = job.to_json()
            self._write(payload)

    def claim_next(self, *, max_active: int, lease_seconds: int) -> EngineQueueJob | None:
        with self._lock:
            payload = self._read()
            now = _now()
            if _active_count(payload, now) >= max(1, max_active):
                return None

            eligible = [
                EngineQueueJob.from_json(row)
                for row in payload.values()
                if _is_claimable(row, now)
            ]
            if not eligible:
                return None

            claimed = sorted(eligible, key=lambda job: (job.created_at, job.job_id))[0]
            next_job = _replace_job(
                claimed,
                status="running",
                attempt_count=claimed.attempt_count + 1,
                locked_until=(now + timedelta(seconds=lease_seconds)).isoformat(),
                message=None,
            )
            payload[next_job.job_id] = next_job.to_json()
            self._write(payload)
            return next_job

    def complete(self, job_id: str, *, message: str | None = None) -> None:
        self._set_terminal_status(job_id, status="completed", message=message)

    def fail(self, job_id: str, *, message: str) -> None:
        self._set_terminal_status(job_id, status="failed", message=message)

    def get(self, job_id: str) -> EngineQueueJob | None:
        with self._lock:
            row = self._read().get(job_id)
        return EngineQueueJob.from_json(row) if row else None

    def has_runnable(self, *, studio_id: str | None = None) -> bool:
        with self._lock:
            payload = self._read()
        now = _now()
        return any(
            _is_claimable(row, now) and (studio_id is None or str(row.get("studio_id")) == studio_id)
            for row in payload.values()
        )

    def delete_studio_jobs(self, studio_id: str) -> int:
        with self._lock:
            payload = self._read()
            before = len(payload)
            payload = {
                job_id: row
                for job_id, row in payload.items()
                if str(row.get("studio_id")) != studio_id
            }
            if len(payload) != before:
                self._write(payload)
        return before - len(payload)

    def _set_terminal_status(self, job_id: str, *, status: EngineQueueStatus, message: str | None) -> None:
        with self._lock:
            payload = self._read()
            row = payload.get(job_id)
            if row is None:
                return
            job = EngineQueueJob.from_json(row)
            payload[job_id] = _replace_job(
                job,
                status=status,
                locked_until=None,
                message=message,
            ).to_json()
            self._write(payload)

    def _read(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        with self._path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return {}
        return {str(key): value for key, value in payload.items() if isinstance(value, dict)}

    def _write(self, payload: dict[str, dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        tmp_path.replace(self._path)


class PostgresEngineQueueStore:
    def __init__(self, database_url: str) -> None:
        self._database_url = _normalize_database_url(database_url)
        self._ensure_schema()

    def enqueue(self, job: EngineQueueJob) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO engine_jobs (
                    job_id, studio_id, slot_id, job_type, status, payload,
                    attempt_count, max_attempts, locked_until, message, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (job_id) DO UPDATE SET
                    studio_id = EXCLUDED.studio_id,
                    slot_id = EXCLUDED.slot_id,
                    job_type = EXCLUDED.job_type,
                    status = EXCLUDED.status,
                    payload = EXCLUDED.payload,
                    attempt_count = EXCLUDED.attempt_count,
                    max_attempts = EXCLUDED.max_attempts,
                    locked_until = EXCLUDED.locked_until,
                    message = EXCLUDED.message,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    job.job_id,
                    job.studio_id,
                    job.slot_id,
                    job.job_type,
                    job.status,
                    Jsonb(job.payload),
                    job.attempt_count,
                    job.max_attempts,
                    _parse_iso(job.locked_until),
                    job.message,
                    _parse_iso(job.created_at),
                    _parse_iso(job.updated_at),
                ),
            )
            conn.commit()

    def claim_next(self, *, max_active: int, lease_seconds: int) -> EngineQueueJob | None:
        with self._connect() as conn:
            with conn.transaction():
                active = conn.execute(
                    """
                    SELECT count(*) AS count
                    FROM engine_jobs
                    WHERE status = 'running'
                      AND locked_until IS NOT NULL
                      AND locked_until > now()
                    """
                ).fetchone()
                if int(active["count"] if active else 0) >= max(1, max_active):
                    return None

                row = conn.execute(
                    """
                    SELECT *
                    FROM engine_jobs
                    WHERE
                        status = 'queued'
                        OR (
                            status = 'running'
                            AND (locked_until IS NULL OR locked_until <= now())
                            AND attempt_count < max_attempts
                        )
                    ORDER BY created_at ASC, job_id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """
                ).fetchone()
                if row is None:
                    return None

                updated = conn.execute(
                    """
                    UPDATE engine_jobs
                    SET status = 'running',
                        attempt_count = attempt_count + 1,
                        locked_until = now() + (%s * interval '1 second'),
                        message = NULL,
                        updated_at = now()
                    WHERE job_id = %s
                    RETURNING *
                    """,
                    (lease_seconds, row["job_id"]),
                ).fetchone()
        return self._record_from_row(updated) if updated else None

    def complete(self, job_id: str, *, message: str | None = None) -> None:
        self._set_terminal_status(job_id, status="completed", message=message)

    def fail(self, job_id: str, *, message: str) -> None:
        self._set_terminal_status(job_id, status="failed", message=message)

    def get(self, job_id: str) -> EngineQueueJob | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM engine_jobs WHERE job_id = %s", (job_id,)).fetchone()
        return self._record_from_row(row) if row else None

    def has_runnable(self, *, studio_id: str | None = None) -> bool:
        query = """
            SELECT 1
            FROM engine_jobs
            WHERE
                (%s::text IS NULL OR studio_id = %s)
                AND (
                    status = 'queued'
                    OR (
                        status = 'running'
                        AND (locked_until IS NULL OR locked_until <= now())
                        AND attempt_count < max_attempts
                    )
                )
            LIMIT 1
        """
        with self._connect() as conn:
            row = conn.execute(query, (studio_id, studio_id)).fetchone()
        return row is not None

    def delete_studio_jobs(self, studio_id: str) -> int:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM engine_jobs WHERE studio_id = %s", (studio_id,))
            conn.commit()
        return int(cursor.rowcount or 0)

    def _set_terminal_status(self, job_id: str, *, status: EngineQueueStatus, message: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE engine_jobs
                SET status = %s,
                    locked_until = NULL,
                    message = %s,
                    updated_at = now()
                WHERE job_id = %s
                """,
                (status, message, job_id),
            )
            conn.commit()

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS engine_jobs (
                    job_id TEXT PRIMARY KEY,
                    studio_id TEXT NOT NULL,
                    slot_id INTEGER NOT NULL,
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 3,
                    locked_until TIMESTAMPTZ,
                    message TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_engine_jobs_claim
                ON engine_jobs (status, locked_until, created_at)
                WHERE status IN ('queued', 'running')
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_engine_jobs_studio
                ON engine_jobs (studio_id, updated_at DESC)
                """
            )
            conn.commit()

    def _connect(self):
        import psycopg

        return psycopg.connect(self._database_url, row_factory=dict_row)

    def _record_from_row(self, row: dict[str, Any]) -> EngineQueueJob:
        return EngineQueueJob(
            job_id=str(row["job_id"]),
            studio_id=str(row["studio_id"]),
            slot_id=int(row["slot_id"]),
            job_type=_job_type(str(row["job_type"])),
            status=_queue_status(str(row["status"])),
            payload=dict(row.get("payload") or {}),
            attempt_count=int(row.get("attempt_count") or 0),
            max_attempts=max(1, int(row.get("max_attempts") or 3)),
            locked_until=_iso(row.get("locked_until")) if row.get("locked_until") else None,
            message=row.get("message"),
            created_at=_iso(row.get("created_at")),
            updated_at=_iso(row.get("updated_at")),
        )


def build_engine_queue_store(*, storage_root: Path, database_url: str | None) -> EngineQueueStore:
    if database_url is not None and database_url.strip():
        return PostgresEngineQueueStore(database_url)
    return FileEngineQueueStore(storage_root / "engine_queue.json")


def _replace_job(
    job: EngineQueueJob,
    *,
    status: EngineQueueStatus,
    attempt_count: int | None = None,
    locked_until: str | None,
    message: str | None,
) -> EngineQueueJob:
    return EngineQueueJob(
        job_id=job.job_id,
        studio_id=job.studio_id,
        slot_id=job.slot_id,
        job_type=job.job_type,
        status=status,
        payload=job.payload,
        attempt_count=job.attempt_count if attempt_count is None else attempt_count,
        max_attempts=job.max_attempts,
        locked_until=locked_until,
        message=message,
        created_at=job.created_at,
        updated_at=_now_iso(),
    )


def _active_count(payload: dict[str, dict[str, Any]], now: datetime) -> int:
    count = 0
    for row in payload.values():
        locked_until = _parse_iso(row.get("locked_until"))
        if row.get("status") == "running" and locked_until is not None and locked_until > now:
            count += 1
    return count


def _is_claimable(row: dict[str, Any], now: datetime) -> bool:
    status = row.get("status")
    if status == "queued":
        return True
    if status != "running":
        return False
    if int(row.get("attempt_count") or 0) >= int(row.get("max_attempts") or 3):
        return False
    locked_until = _parse_iso(row.get("locked_until"))
    return locked_until is None or locked_until <= now


def _job_type(value: str) -> EngineJobType:
    if value in {"omr", "voice"}:
        return value  # type: ignore[return-value]
    raise ValueError(f"Unsupported engine job type: {value}")


def _queue_status(value: str) -> EngineQueueStatus:
    if value in {"queued", "running", "completed", "failed"}:
        return value  # type: ignore[return-value]
    raise ValueError(f"Unsupported engine queue status: {value}")


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(value or _now_iso())


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+psycopg://"):
        return database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    return database_url
