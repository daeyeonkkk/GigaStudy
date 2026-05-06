from __future__ import annotations

from typing import Any
from uuid import uuid4

from gigastudy_api.api.schemas.studios import ExtractionJobStatus, SourceKind, Studio, TrackExtractionJob, TrackSlot
from gigastudy_api.services.engine_queue import EngineQueueJob
from gigastudy_api.services.studio_documents import studio_has_active_track_material


def create_document_extraction_job(
    *,
    input_path: str,
    max_attempts: int,
    parse_all_parts: bool,
    slot_id: int,
    source_kind: SourceKind,
    source_label: str,
    timestamp: str,
    diagnostics: dict[str, Any] | None = None,
    message: str | None = None,
    status: ExtractionJobStatus = "queued",
    use_source_tempo: bool = False,
) -> TrackExtractionJob:
    return TrackExtractionJob(
        job_id=uuid4().hex,
        job_type="document",
        slot_id=slot_id,
        source_kind=source_kind,
        source_label=source_label,
        status=status,
        method="audiveris_cli",
        message=message,
        input_path=input_path,
        max_attempts=max_attempts,
        parse_all_parts=parse_all_parts,
        use_source_tempo=use_source_tempo,
        diagnostics=diagnostics or {},
        created_at=timestamp,
        updated_at=timestamp,
    )


def create_voice_extraction_job(
    *,
    allow_overwrite: bool,
    audio_mime_type: str,
    input_path: str,
    max_attempts: int,
    review_before_register: bool,
    slot_id: int,
    source_kind: SourceKind,
    source_label: str,
    timestamp: str,
) -> TrackExtractionJob:
    return TrackExtractionJob(
        job_id=uuid4().hex,
        job_type="voice",
        slot_id=slot_id,
        source_kind=source_kind,
        source_label=source_label,
        status="queued",
        method="voice_transcription",
        message="Voice extraction queued.",
        input_path=input_path,
        max_attempts=max_attempts,
        review_before_register=review_before_register,
        allow_overwrite=allow_overwrite,
        audio_mime_type=audio_mime_type,
        created_at=timestamp,
        updated_at=timestamp,
    )


def create_generation_job(
    *,
    input_request: dict[str, Any],
    max_attempts: int,
    slot_id: int,
    source_label: str,
    timestamp: str,
) -> TrackExtractionJob:
    return TrackExtractionJob(
        job_id=uuid4().hex,
        job_type="generation",
        slot_id=slot_id,
        source_kind="ai",
        source_label=source_label,
        status="queued",
        method="ai_generation",
        message="AI generation queued.",
        input_path=None,
        max_attempts=max_attempts,
        diagnostics={"request": input_request},
        created_at=timestamp,
        updated_at=timestamp,
    )


def create_scoring_job(
    *,
    input_request: dict[str, Any],
    max_attempts: int,
    slot_id: int,
    source_label: str,
    timestamp: str,
) -> TrackExtractionJob:
    return TrackExtractionJob(
        job_id=uuid4().hex,
        job_type="scoring",
        slot_id=slot_id,
        source_kind="recording",
        source_label=source_label,
        status="queued",
        method="practice_scoring",
        message="Scoring queued.",
        input_path=input_request.get("performance_asset_path"),
        max_attempts=max_attempts,
        diagnostics={
            "request": input_request,
            "score_mode": input_request.get("score_mode", "answer"),
        },
        created_at=timestamp,
        updated_at=timestamp,
    )


def document_queue_payload(job: TrackExtractionJob) -> dict[str, Any]:
    return {
        "input_path": job.input_path,
        "source_kind": job.source_kind,
        "source_label": job.source_label,
        "parse_all_parts": job.parse_all_parts,
        "use_source_tempo": job.use_source_tempo,
    }


def voice_queue_payload(job: TrackExtractionJob) -> dict[str, Any]:
    return {
        "input_path": job.input_path,
        "source_kind": job.source_kind,
        "source_label": job.source_label,
        "review_before_register": job.review_before_register,
        "allow_overwrite": job.allow_overwrite,
        "audio_mime_type": job.audio_mime_type,
    }


def generation_queue_payload(job: TrackExtractionJob) -> dict[str, Any]:
    return {
        "request": dict(job.diagnostics.get("request") or {}),
        "source_label": job.source_label,
    }


def scoring_queue_payload(job: TrackExtractionJob, request_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "request": request_payload,
        "source_label": job.source_label,
    }


def engine_queue_job_from_extraction(
    job: TrackExtractionJob,
    *,
    payload: dict[str, Any],
    studio_id: str,
    timestamp: str,
) -> EngineQueueJob:
    return EngineQueueJob(
        job_id=job.job_id,
        studio_id=studio_id,
        slot_id=job.slot_id,
        job_type=job.job_type,
        status="queued",
        payload=payload,
        attempt_count=0,
        max_attempts=job.max_attempts,
        locked_until=None,
        message=None,
        created_at=job.created_at,
        updated_at=timestamp,
    )


def existing_extraction_queue_payload(
    job: TrackExtractionJob,
    *,
    existing_payload: dict[str, Any] | None = None,
    fallback_audio_mime_type: str | None = None,
) -> dict[str, Any]:
    if job.job_type in {"generation", "scoring"}:
        if existing_payload is not None:
            return dict(existing_payload)
        request = job.diagnostics.get("request") if isinstance(job.diagnostics, dict) else None
        return {
            "request": dict(request or {}),
            "source_label": job.source_label,
        }
    if not job.input_path:
        raise ValueError("Extraction job has no stored input file.")
    payload: dict[str, Any] = {
        "input_path": job.input_path,
        "source_kind": job.source_kind,
        "source_label": job.source_label,
    }
    if job.job_type == "document":
        payload["parse_all_parts"] = job.parse_all_parts
        payload["use_source_tempo"] = job.use_source_tempo
        if existing_payload is not None and "use_source_tempo" in existing_payload:
            payload["use_source_tempo"] = bool(existing_payload["use_source_tempo"])
        return payload
    if job.job_type == "voice":
        if existing_payload is not None:
            payload.update(existing_payload)
        payload.setdefault("review_before_register", job.review_before_register)
        payload.setdefault("allow_overwrite", job.allow_overwrite)
        payload.setdefault("audio_mime_type", job.audio_mime_type or fallback_audio_mime_type)
        return payload
    raise ValueError("Unsupported extraction job type.")


def reset_extraction_job_for_enqueue(
    job: TrackExtractionJob,
    *,
    max_attempts: int,
    timestamp: str,
) -> None:
    job.attempt_count = 0
    job.max_attempts = max_attempts
    job.updated_at = timestamp


def mark_extraction_job_running(
    studio: Studio,
    job_id: str,
    *,
    attempt_count: int | None,
    max_attempts: int | None,
    timestamp: str,
) -> None:
    for job in studio.jobs:
        if job.job_id != job_id:
            continue
        job.status = "running"
        if job.job_type == "generation":
            job.message = "AI generation running."
        elif job.job_type == "scoring":
            job.message = "Scoring running."
        else:
            job.message = "Full-score extraction running." if job.parse_all_parts else "Extraction running."
        if attempt_count is not None:
            job.attempt_count = attempt_count
        if max_attempts is not None:
            job.max_attempts = max_attempts
        job.updated_at = timestamp
        break
    studio.updated_at = timestamp


def mark_extraction_job_failed(
    studio: Studio,
    job_id: str,
    *,
    message: str,
    timestamp: str,
) -> None:
    for job in studio.jobs:
        if job.job_id != job_id:
            continue
        job.status = "failed"
        job.message = message
        job.updated_at = timestamp
        if job.job_type == "scoring":
            break
        failed_tracks = (
            [track for track in studio.tracks if track.slot_id <= 5]
            if job.parse_all_parts
            else [_find_track(studio.tracks, job.slot_id)]
        )
        for track in failed_tracks:
            if studio_has_active_track_material(studio, track.slot_id):
                continue
            if track.source_kind not in {None, job.source_kind}:
                continue
            if track.source_label not in {None, job.source_label}:
                continue
            track.status = "failed"
            track.source_kind = job.source_kind
            track.source_label = job.source_label
            track.updated_at = timestamp
        break
    studio.updated_at = timestamp


def mark_extraction_job_completed(
    studio: Studio,
    job_id: str,
    *,
    method: str | None,
    output_path: str,
    timestamp: str,
) -> None:
    for job in studio.jobs:
        if job.job_id != job_id:
            continue
        job.status = "completed"
        job.output_path = output_path
        if method is not None:
            job.method = method
        job.updated_at = timestamp
        break
    studio.updated_at = timestamp


def clear_unmapped_document_placeholders(
    studio: Studio,
    job: TrackExtractionJob,
    *,
    mapped_slot_ids: set[int],
    timestamp: str,
) -> None:
    for track in studio.tracks:
        if track.slot_id > 5 or track.slot_id in mapped_slot_ids:
            continue
        if studio_has_active_track_material(studio, track.slot_id):
            continue
        if track.source_kind != job.source_kind or track.source_label != job.source_label:
            continue
        if track.status not in {"extracting", "failed", "needs_review"}:
            continue
        track.status = "empty"
        track.source_kind = None
        track.source_label = None
        track.diagnostics = {}
        track.updated_at = timestamp


def _find_track(tracks: list[TrackSlot], slot_id: int) -> TrackSlot:
    for track in tracks:
        if track.slot_id == slot_id:
            return track
    raise ValueError(f"Track slot not found: {slot_id}")
