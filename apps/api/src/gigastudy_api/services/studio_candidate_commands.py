from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    SourceKind,
    Studio,
)
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics,
    candidate_review_message,
    estimate_candidate_confidence,
    track_duration_seconds,
)
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan
from gigastudy_api.services.studio_access import require_studio_access
from gigastudy_api.services.studio_candidates import (
    build_pending_candidate,
    diagnostics_with_registration_quality,
    mark_candidate_approved,
    mark_candidate_rejected,
    mark_track_needs_review,
    mark_track_needs_review_if_empty,
    pending_candidates_for_job,
    release_review_track_if_no_pending_candidates,
    reject_candidate_group_siblings,
    unique_candidates_by_suggested_slot,
)
from gigastudy_api.services.studio_documents import register_track_material, track_has_content
from gigastudy_api.services.studio_generation import generation_candidate_review_metadata
from gigastudy_api.services.studio_jobs import clear_unmapped_document_placeholders
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs

SUPERSEDED_AI_CANDIDATE_MESSAGE = "Superseded by newer AI generation candidates."


class StudioCandidateCommands:
    def __init__(
        self,
        *,
        now: Any,
        repository: Any,
    ) -> None:
        self._now = now
        self._repository = repository

    def approve_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        request: ApproveCandidateRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = self._now()
            candidate = self._repository._find_candidate(studio, candidate_id)
            if candidate.status != "pending":
                raise HTTPException(status_code=409, detail="Only pending candidates can be approved.")
            target_slot_id = request.target_slot_id or candidate.suggested_slot_id
            track = self._repository._find_track(studio, target_slot_id)
            ensure_no_active_extraction_jobs(
                studio,
                {target_slot_id},
                action_label="Candidate approval",
            )
            if track_has_content(track) and not request.allow_overwrite:
                raise HTTPException(
                    status_code=409,
                    detail="Approving this candidate would overwrite an existing registered track.",
                )
            registration = self._repository._prepare_registration_events(
                studio,
                target_slot_id,
                source_kind=candidate.source_kind,
                events=candidate.events,
            )
            mark_candidate_approved(
                candidate,
                events=registration.events,
                registration_diagnostics=registration.diagnostics,
                timestamp=timestamp,
            )
            register_track_material(
                studio,
                track,
                timestamp=timestamp,
                source_kind=candidate.source_kind,
                source_label=candidate.source_label,
                events=registration.events,
                duration_seconds=track_duration_seconds(registration.events),
                registration_diagnostics=registration.diagnostics,
                audio_source_path=candidate.audio_source_path,
                audio_source_label=candidate.audio_source_label,
                audio_mime_type=candidate.audio_mime_type,
            )
            if target_slot_id != candidate.suggested_slot_id:
                release_review_track_if_no_pending_candidates(
                    studio,
                    slot_id=candidate.suggested_slot_id,
                    resolved_candidate_id=candidate.candidate_id,
                    timestamp=timestamp,
                )
            reject_candidate_group_siblings(
                studio.candidates,
                approved_candidate=candidate,
                timestamp=timestamp,
            )
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def reject_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = self._now()
            candidate = self._repository._find_candidate(studio, candidate_id)
            if candidate.status != "pending":
                raise HTTPException(status_code=409, detail="Only pending candidates can be rejected.")
            mark_candidate_rejected(candidate, timestamp=timestamp)
            release_review_track_if_no_pending_candidates(
                studio,
                slot_id=candidate.suggested_slot_id,
                resolved_candidate_id=candidate.candidate_id,
                timestamp=timestamp,
            )
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def approve_job_candidates(
        self,
        studio_id: str,
        job_id: str,
        request: ApproveJobCandidatesRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)

            job = next((candidate_job for candidate_job in studio.jobs if candidate_job.job_id == job_id), None)
            if job is None:
                raise HTTPException(status_code=404, detail="Extraction job not found.")

            pending_candidates = pending_candidates_for_job(studio.candidates, job_id)
            if not pending_candidates:
                raise HTTPException(status_code=409, detail="No pending candidates are waiting for this job.")

            unique_candidates_by_slot, duplicate_candidates = unique_candidates_by_suggested_slot(
                pending_candidates
            )
            ensure_no_active_extraction_jobs(
                studio,
                unique_candidates_by_slot.keys(),
                action_label="Job candidate approval",
            )

            occupied_slots = [
                slot_id
                for slot_id in unique_candidates_by_slot
                if track_has_content(self._repository._find_track(studio, slot_id))
            ]
            if occupied_slots and not request.allow_overwrite:
                raise HTTPException(
                    status_code=409,
                    detail="Approving this document extraction job would overwrite existing registered tracks.",
                )

            timestamp = self._now()
            source_kinds = {candidate.source_kind for candidate in unique_candidates_by_slot.values()}
            if len(source_kinds) == 1:
                shared_source_kind = next(iter(source_kinds))
                registrations = self._repository._prepare_registration_batch(
                    studio,
                    {
                        slot_id: candidate.events
                        for slot_id, candidate in unique_candidates_by_slot.items()
                    },
                    source_kind=shared_source_kind,
                )
            else:
                registrations = {
                    slot_id: self._repository._prepare_registration_events(
                        studio,
                        slot_id,
                        source_kind=candidate.source_kind,
                        events=candidate.events,
                    )
                    for slot_id, candidate in unique_candidates_by_slot.items()
                }
            for slot_id, candidate in unique_candidates_by_slot.items():
                track = self._repository._find_track(studio, slot_id)
                registration = registrations[slot_id]
                mark_candidate_approved(
                    candidate,
                    events=registration.events,
                    registration_diagnostics=registration.diagnostics,
                    timestamp=timestamp,
                )
                register_track_material(
                    studio,
                    track,
                    timestamp=timestamp,
                    source_kind=candidate.source_kind,
                    source_label=candidate.source_label,
                    events=registration.events,
                    duration_seconds=track_duration_seconds(registration.events),
                    registration_diagnostics=registration.diagnostics,
                    audio_source_path=candidate.audio_source_path,
                    audio_source_label=candidate.audio_source_label,
                    audio_mime_type=candidate.audio_mime_type,
                )

            for candidate in duplicate_candidates:
                mark_candidate_rejected(candidate, timestamp=timestamp)

            job.status = "completed"
            job.message = "Document extraction candidates registered into their suggested tracks."
            job.updated_at = timestamp
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def append_initial_candidate(
        self,
        studio: Studio,
        *,
        suggested_slot_id: int,
        source_kind: SourceKind,
        source_label: str,
        method: str,
        confidence: float,
        events: list[TrackPitchEvent],
        message: str,
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
        source_diagnostics: dict[str, Any] | None = None,
    ) -> None:
        timestamp = self._now()
        registration = self._repository._prepare_registration_events(
            studio,
            suggested_slot_id,
            source_kind=source_kind,
            events=events,
        )
        prepared_events = registration.events
        diagnostics = candidate_diagnostics(
            suggested_slot_id,
            prepared_events,
            method=method,
            confidence=confidence,
            source_diagnostics=source_diagnostics,
        )
        candidate = build_pending_candidate(
            audio_mime_type=audio_mime_type,
            audio_source_label=audio_source_label,
            audio_source_path=audio_source_path,
            confidence=confidence,
            created_at=timestamp,
            diagnostics=diagnostics_with_registration_quality(
                diagnostics,
                registration.diagnostics,
            ),
            message=message,
            method=method,
            events=prepared_events,
            source_kind=source_kind,
            source_label=source_label,
            suggested_slot_id=suggested_slot_id,
            updated_at=timestamp,
        )
        studio.candidates.append(candidate)
        track = self._repository._find_track(studio, suggested_slot_id)
        mark_track_needs_review(
            track,
            source_kind=source_kind,
            source_label=source_label,
            timestamp=timestamp,
        )
        studio.updated_at = timestamp

    def add_extraction_candidates(
        self,
        studio_id: str,
        mapped_events: dict[int, list[TrackPitchEvent]],
        *,
        source_kind: SourceKind,
        source_label: str,
        method: str,
        confidence: float,
        confidence_by_slot: dict[int, float] | None = None,
        diagnostics_by_slot: dict[int, dict[str, Any]] | None = None,
        message_by_slot: dict[int, str] | None = None,
        job_id: str | None = None,
        message: str | None = None,
        candidate_group_id: str | None = None,
        variant_label: str | None = None,
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = self._now()
            for slot_id, source_events in mapped_events.items():
                registration = self._repository._prepare_registration_events(
                    studio,
                    slot_id,
                    source_kind=source_kind,
                    events=source_events,
                )
                prepared_events = registration.events
                source_diagnostics = (diagnostics_by_slot or {}).get(slot_id)
                slot_confidence = (
                    confidence_by_slot.get(slot_id)
                    if confidence_by_slot and slot_id in confidence_by_slot
                    else estimate_candidate_confidence(
                        slot_id,
                        prepared_events,
                        method=method,
                        fallback_confidence=confidence,
                        diagnostics=source_diagnostics,
                    )
                )
                slot_diagnostics = candidate_diagnostics(
                    slot_id,
                    prepared_events,
                    method=method,
                    confidence=slot_confidence,
                    source_diagnostics=source_diagnostics,
                )
                candidate = build_pending_candidate(
                    candidate_group_id=candidate_group_id,
                    confidence=slot_confidence,
                    created_at=timestamp,
                    diagnostics=diagnostics_with_registration_quality(
                        slot_diagnostics,
                        registration.diagnostics,
                    ),
                    job_id=job_id,
                    message=(message_by_slot or {}).get(
                        slot_id,
                        candidate_review_message(
                            slot_id,
                            prepared_events,
                            method=method,
                            diagnostics=slot_diagnostics,
                            default_message=message,
                        ),
                    ),
                    method=method,
                    events=prepared_events,
                    source_kind=source_kind,
                    source_label=source_label,
                    suggested_slot_id=slot_id,
                    updated_at=timestamp,
                    variant_label=variant_label,
                    audio_source_path=audio_source_path,
                    audio_source_label=audio_source_label,
                    audio_mime_type=audio_mime_type,
                )
                studio.candidates.append(candidate)
                track = self._repository._find_track(studio, slot_id)
                mark_track_needs_review_if_empty(
                    track,
                    source_kind=source_kind,
                    source_label=source_label,
                    timestamp=timestamp,
                )
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "needs_review"
                    job.message = message
                    job.updated_at = timestamp
                    if job.parse_all_parts:
                        clear_unmapped_document_placeholders(
                            studio,
                            job,
                            mapped_slot_ids=set(mapped_events),
                            timestamp=timestamp,
                        )
                    break
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def add_generation_candidates(
        self,
        studio_id: str,
        slot_id: int,
        candidate_events: list[list[TrackPitchEvent]],
        *,
        source_label: str,
        method: str,
        message: str,
        llm_plan: DeepSeekHarmonyPlan | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = self._now()
            ensure_no_active_extraction_jobs(
                studio,
                {slot_id},
                action_label="AI generation",
            )
            self._discard_superseded_ai_generation_candidates(
                studio,
                slot_id,
            )
            candidate_group_id = uuid4().hex
            for index, candidate_track_events in enumerate(candidate_events, start=1):
                registration = self._repository._prepare_registration_events(
                    studio,
                    slot_id,
                    source_kind="ai",
                    events=candidate_track_events,
                )
                prepared_events = registration.events
                confidence = min((event.confidence for event in prepared_events), default=0.65)
                diagnostics, variant_label = generation_candidate_review_metadata(
                    slot_id=slot_id,
                    events=prepared_events,
                    method=method,
                    confidence=confidence,
                    candidate_index=index,
                    llm_plan=llm_plan,
                )
                candidate = build_pending_candidate(
                    candidate_group_id=candidate_group_id,
                    confidence=confidence,
                    created_at=timestamp,
                    diagnostics=diagnostics_with_registration_quality(
                        diagnostics,
                        registration.diagnostics,
                    ),
                    message=message,
                    method=method,
                    events=prepared_events,
                    source_kind="ai",
                    source_label=source_label,
                    suggested_slot_id=slot_id,
                    updated_at=timestamp,
                    variant_label=variant_label,
                )
                studio.candidates.append(candidate)

            track = self._repository._find_track(studio, slot_id)
            mark_track_needs_review_if_empty(
                track,
                source_kind="ai",
                source_label=source_label,
                timestamp=timestamp,
            )
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def _discard_superseded_ai_generation_candidates(
        self,
        studio: Studio,
        slot_id: int,
    ) -> None:
        studio.candidates = [
            candidate
            for candidate in studio.candidates
            if not (
                candidate.source_kind == "ai"
                and candidate.suggested_slot_id == slot_id
                and candidate.job_id is None
                and (
                    candidate.status == "pending"
                    or (
                        candidate.status == "rejected"
                        and candidate.message == SUPERSEDED_AI_CANDIDATE_MESSAGE
                    )
                )
            )
        ]
