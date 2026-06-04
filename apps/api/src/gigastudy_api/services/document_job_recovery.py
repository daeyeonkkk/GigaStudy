from __future__ import annotations

from datetime import UTC, datetime, timedelta

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.studio_jobs import mark_extraction_job_failed


STALE_DOCUMENT_JOB_MESSAGE = (
    "작업이 오래 멈춰 실패 처리했습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
)
DOCUMENT_TIMEOUT_MESSAGE = (
    "문서 분석 시간이 제한 시간을 넘었습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
)
DOCUMENT_COMPLEXITY_MESSAGE = (
    "문서가 너무 크거나 복잡해서 처리하지 못했습니다. MIDI/MusicXML 파일을 사용해 주세요."
)
DOCUMENT_NOT_SCORE_MESSAGE = (
    "악보로 읽을 수 있는 오선이나 음표를 찾지 못했습니다. "
    "가사/일반 문서 PDF 대신 악보 PDF, MIDI, MusicXML을 사용해 주세요."
)
DOCUMENT_GENERIC_FAILURE_MESSAGE = (
    "PDF 악보를 인식하지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요."
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


def sanitize_failed_document_job_messages(studio: Studio, *, timestamp: str) -> list[str]:
    sanitized_job_ids: list[str] = []
    for job in list(studio.jobs):
        if job.job_type != "document" or job.status != "failed":
            continue
        public_message = public_document_failure_message(job.message)
        if public_message is None or public_message == job.message:
            continue
        mark_extraction_job_failed(
            studio,
            job.job_id,
            message=public_message,
            timestamp=timestamp,
        )
        job.diagnostics = {
            **job.diagnostics,
            "message_sanitized": True,
            "message_sanitized_at": timestamp,
        }
        sanitized_job_ids.append(job.job_id)
    return sanitized_job_ids


def public_document_failure_message(message: str | None) -> str | None:
    if not message:
        return None
    normalized = message.lower()
    if "악보로 읽을 수 있는 오선이나 음표" in message:
        return DOCUMENT_NOT_SCORE_MESSAGE
    if "제한 시간을 넘었습니다" in message:
        return DOCUMENT_TIMEOUT_MESSAGE
    if "너무 크거나 복잡" in message:
        return DOCUMENT_COMPLEXITY_MESSAGE
    if "pdf 악보를 인식하지 못했습니다" in message:
        return DOCUMENT_GENERIC_FAILURE_MESSAGE
    if any(term in normalized for term in ("timed out", "timeout")):
        return DOCUMENT_TIMEOUT_MESSAGE
    if any(term in normalized for term in ("memory", "outofmemory", "java heap", "killed", "oom", "137")):
        return DOCUMENT_COMPLEXITY_MESSAGE
    if any(term in normalized for term in ("no labelled", "no pitch", "no score", "staff", "note")):
        return DOCUMENT_NOT_SCORE_MESSAGE
    if any(
        term in normalized
        for term in (
            "audiveris",
            "pdf vector fallback",
            "preprocessed document extraction",
            "stderr",
            "stdout",
            "traceback",
        )
    ):
        return DOCUMENT_GENERIC_FAILURE_MESSAGE
    return None


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
