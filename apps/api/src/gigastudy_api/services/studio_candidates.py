from __future__ import annotations

from typing import Any
from uuid import uuid4

from gigastudy_api.api.schemas.studios import ExtractionCandidate, SourceKind, Studio, TrackSlot
from gigastudy_api.domain.track_events import TrackNote


def build_pending_candidate(
    *,
    audio_mime_type: str | None = None,
    audio_source_label: str | None = None,
    audio_source_path: str | None = None,
    candidate_group_id: str | None = None,
    confidence: float,
    created_at: str,
    diagnostics: dict[str, Any],
    job_id: str | None = None,
    message: str | None = None,
    method: str,
    notes: list[TrackNote],
    source_kind: SourceKind,
    source_label: str,
    suggested_slot_id: int,
    updated_at: str,
    variant_label: str | None = None,
) -> ExtractionCandidate:
    return ExtractionCandidate(
        candidate_id=uuid4().hex,
        candidate_group_id=candidate_group_id,
        suggested_slot_id=suggested_slot_id,
        source_kind=source_kind,
        source_label=source_label,
        method=method,
        variant_label=variant_label,
        confidence=confidence,
        notes=notes,
        audio_source_path=audio_source_path,
        audio_source_label=audio_source_label,
        audio_mime_type=audio_mime_type,
        job_id=job_id,
        message=message,
        diagnostics=diagnostics,
        created_at=created_at,
        updated_at=updated_at,
    )


def diagnostics_with_registration_quality(
    diagnostics: dict[str, Any],
    registration_diagnostics: dict[str, Any],
) -> dict[str, Any]:
    return {
        **diagnostics,
        "registration_quality": registration_diagnostics,
    }


def mark_candidate_approved(
    candidate: ExtractionCandidate,
    *,
    notes: list[TrackNote],
    registration_diagnostics: dict[str, Any],
    timestamp: str,
) -> None:
    candidate.status = "approved"
    candidate.notes = notes
    candidate.diagnostics = diagnostics_with_registration_quality(
        candidate.diagnostics,
        registration_diagnostics,
    )
    candidate.updated_at = timestamp


def mark_candidate_rejected(candidate: ExtractionCandidate, *, timestamp: str) -> None:
    candidate.status = "rejected"
    candidate.updated_at = timestamp


def reject_candidate_group_siblings(
    candidates: list[ExtractionCandidate],
    *,
    approved_candidate: ExtractionCandidate,
    timestamp: str,
) -> None:
    if approved_candidate.candidate_group_id is None:
        return
    for sibling in candidates:
        if (
            sibling.candidate_group_id == approved_candidate.candidate_group_id
            and sibling.candidate_id != approved_candidate.candidate_id
            and sibling.status == "pending"
        ):
            mark_candidate_rejected(sibling, timestamp=timestamp)


def pending_candidates_for_job(
    candidates: list[ExtractionCandidate],
    job_id: str,
) -> list[ExtractionCandidate]:
    return [
        candidate
        for candidate in candidates
        if candidate.job_id == job_id and candidate.status == "pending"
    ]


def unique_candidates_by_suggested_slot(
    candidates: list[ExtractionCandidate],
) -> tuple[dict[int, ExtractionCandidate], list[ExtractionCandidate]]:
    unique_candidates_by_slot: dict[int, ExtractionCandidate] = {}
    duplicate_candidates: list[ExtractionCandidate] = []
    for candidate in candidates:
        if candidate.suggested_slot_id in unique_candidates_by_slot:
            duplicate_candidates.append(candidate)
            continue
        unique_candidates_by_slot[candidate.suggested_slot_id] = candidate
    return unique_candidates_by_slot, duplicate_candidates


def mark_track_needs_review_if_empty(
    track: TrackSlot,
    *,
    source_kind: SourceKind,
    source_label: str,
    timestamp: str,
) -> None:
    if track.status == "registered" or track.notes:
        return
    track.status = "needs_review"
    track.source_kind = source_kind
    track.source_label = source_label
    track.updated_at = timestamp


def mark_track_needs_review(
    track: TrackSlot,
    *,
    source_kind: SourceKind,
    source_label: str,
    timestamp: str,
) -> None:
    track.status = "needs_review"
    track.source_kind = source_kind
    track.source_label = source_label
    track.updated_at = timestamp


def release_review_track_if_no_pending_candidates(
    studio: Studio,
    *,
    slot_id: int,
    resolved_candidate_id: str,
    timestamp: str,
) -> None:
    track = next((track for track in studio.tracks if track.slot_id == slot_id), None)
    if track is None:
        raise ValueError("Track slot not found.")
    if track.status != "needs_review":
        return
    has_other_pending_candidate = any(
        candidate.status == "pending"
        and candidate.suggested_slot_id == slot_id
        and candidate.candidate_id != resolved_candidate_id
        for candidate in studio.candidates
    )
    if has_other_pending_candidate:
        return
    track.status = "registered" if track.notes else "empty"
    if not track.notes:
        track.source_kind = None
        track.source_label = None
        track.audio_source_path = None
        track.audio_source_label = None
        track.audio_mime_type = None
        track.duration_seconds = 0
        track.diagnostics = {}
    track.updated_at = timestamp
