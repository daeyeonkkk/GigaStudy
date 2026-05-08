from __future__ import annotations

from datetime import UTC, datetime, timedelta

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.studio_jobs import mark_extraction_job_failed


STALE_DOCUMENT_JOB_MESSAGE = (
    "작업이 오래 멈춰 실패 처리했습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
)


def recover_stale_running_document_jobs(
    studio: Studio,
    *,
    now: datetime,
    stale_seconds: int,
    timestamp: str,
) -> list[str]:
    cutoff = now.astimezone(UTC) - timedelta(seconds=max(60, stale_seconds))
    recovered_job_ids: list[str] = []
    for job in list(studio.jobs):
        if job.job_type != "document" or job.status != "running":
            continue
        updated_at = _parse_iso(job.updated_at)
        if updated_at is None or updated_at > cutoff:
            continue
        mark_extraction_job_failed(
            studio,
            job.job_id,
            message=STALE_DOCUMENT_JOB_MESSAGE,
            timestamp=timestamp,
        )
        job.diagnostics = {
            **job.diagnostics,
            "stale_recovered": True,
            "stale_recovered_at": timestamp,
        }
        recovered_job_ids.append(job.job_id)
    return recovered_job_ids


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
