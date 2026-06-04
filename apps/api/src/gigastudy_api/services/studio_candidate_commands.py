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
from gigastudy_api.services.engine.event_quality import RegistrationQualityResult
from gigastudy_api.services.llm.provider import DeepSeekHarmonyPlan
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
from gigastudy_api.services.studio_documents import register_track_material, studio_has_active_track_material
from gigastudy_api.services.studio_generation import generation_candidate_review_metadata
from gigastudy_api.services.studio_jobs import clear_unmapped_document_placeholders
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs
from gigastudy_api.services.engine.timeline import registered_region_events_by_slot

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
                ignore_job_id=candidate.job_id,
            )
            if studio_has_active_track_material(studio, target_slot_id) and not request.allow_overwrite:
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
                ignore_job_id=job_id,
            )

            occupied_slots = {
                slot_id
                for slot_id in unique_candidates_by_slot
                if studio_has_active_track_material(studio, slot_id)
            }
            blocked_slots = occupied_slots if not request.allow_overwrite else set()
            candidates_to_register = {
                slot_id: candidate
                for slot_id, candidate in unique_candidates_by_slot.items()
                if slot_id not in blocked_slots
            }

            timestamp = self._now()
            registrations, failed_registrations = self._prepare_job_candidate_registrations(
                studio,
                candidates_to_register,
            )
            approved_slot_ids: set[int] = set()

            for slot_id, candidate in candidates_to_register.items():
                if slot_id not in registrations:
                    failure_message = failed_registrations.get(slot_id, "등록 가능한 음표로 정리하지 못했습니다.")
                    candidate.message = f"등록하지 못했습니다: {failure_message}"
                    candidate.diagnostics = {
                        **candidate.diagnostics,
                        "registration_failure": failure_message,
                    }
                    mark_candidate_rejected(candidate, timestamp=timestamp)
                    release_review_track_if_no_pending_candidates(
                        studio,
                        slot_id=slot_id,
                        resolved_candidate_id=candidate.candidate_id,
                        timestamp=timestamp,
                    )
                    continue
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
                approved_slot_ids.add(slot_id)

            for candidate in duplicate_candidates:
                if candidate.suggested_slot_id in approved_slot_ids:
                    mark_candidate_rejected(candidate, timestamp=timestamp)

            remaining_pending_candidates = pending_candidates_for_job(studio.candidates, job_id)
            if remaining_pending_candidates:
                job.status = "needs_review"
            else:
                job.status = "completed" if approved_slot_ids else "failed"
            job.message = self._job_candidate_approval_message(
                studio,
                approved_slot_ids=approved_slot_ids,
                blocked_slot_ids=blocked_slots,
                failed_registrations=failed_registrations,
                remaining_pending_count=len(remaining_pending_candidates),
            )
            job.updated_at = timestamp
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def _prepare_job_candidate_registrations(
        self,
        studio: Studio,
        candidates_by_slot: dict[int, Any],
    ) -> tuple[dict[int, RegistrationQualityResult], dict[int, str]]:
        if not candidates_by_slot:
            return {}, {}

        source_kinds = {candidate.source_kind for candidate in candidates_by_slot.values()}
        if len(source_kinds) == 1:
            shared_source_kind = next(iter(source_kinds))
            try:
                return (
                    self._repository._prepare_registration_batch(
                        studio,
                        {
                            slot_id: candidate.events
                            for slot_id, candidate in candidates_by_slot.items()
                        },
                        source_kind=shared_source_kind,
                    ),
                    {},
                )
            except Exception:
                # Fall through to per-track preparation so one problematic part
                # does not block the other extracted parts.
                pass

        registrations: dict[int, RegistrationQualityResult] = {}
        failures: dict[int, str] = {}
        for slot_id, candidate in candidates_by_slot.items():
            try:
                registrations[slot_id] = self._repository._prepare_registration_events(
                    studio,
                    slot_id,
                    source_kind=candidate.source_kind,
                    events=candidate.events,
                )
            except Exception as error:
                failures[slot_id] = str(error) or error.__class__.__name__
        return registrations, failures

    def _job_candidate_approval_message(
        self,
        studio: Studio,
        *,
        approved_slot_ids: set[int],
        blocked_slot_ids: set[int],
        failed_registrations: dict[int, str],
        remaining_pending_count: int,
    ) -> str:
        message_parts: list[str] = []
        if approved_slot_ids:
            message_parts.append(
                f"{self._format_slot_names(studio, approved_slot_ids)} 등록 완료"
            )
        if blocked_slot_ids:
            message_parts.append(
                f"{self._format_slot_names(studio, blocked_slot_ids)} 기존 등록 유지"
            )
        if failed_registrations:
            message_parts.append(
                f"{self._format_slot_names(studio, set(failed_registrations))} 등록 실패"
            )
        if remaining_pending_count > 0:
            message_parts.append(f"남은 후보 {remaining_pending_count}개")
        if not message_parts:
            return "등록할 수 있는 후보가 없습니다."
        return " · ".join(message_parts)

    def _format_slot_names(self, studio: Studio, slot_ids: set[int]) -> str:
        if not slot_ids:
            return ""
        names: list[str] = []
        for slot_id in sorted(slot_ids):
            try:
                names.append(self._repository._find_track(studio, slot_id).name)
            except Exception:
                names.append(f"Track {slot_id}")
        return ", ".join(names)

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
                    has_active_material=studio_has_active_track_material(studio, slot_id),
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
        context_events_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
        job_id: str | None = None,
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
                ignore_job_id=job_id,
            )
            self._discard_superseded_ai_generation_candidates(
                studio,
                slot_id,
                current_job_id=job_id,
            )
            candidate_group_id = uuid4().hex
            context_events_by_slot = context_events_by_slot or registered_region_events_by_slot(
                studio,
                exclude_slot_id=slot_id,
            )
            prepared_candidates: list[tuple[list[TrackPitchEvent], Any]] = []
            for candidate_track_events in candidate_events:
                registration = self._repository._prepare_registration_events(
                    studio,
                    slot_id,
                    source_kind="ai",
                    events=candidate_track_events,
                )
                prepared_candidates.append((registration.events, registration))
            prepared_event_sets = [prepared_events for prepared_events, _registration in prepared_candidates]
            for index, (prepared_events, registration) in enumerate(prepared_candidates, start=1):
                confidence = min((event.confidence for event in prepared_events), default=0.65)
                diagnostics, variant_label = generation_candidate_review_metadata(
                    slot_id=slot_id,
                    events=prepared_events,
                    method=method,
                    confidence=confidence,
                    candidate_index=index,
                    llm_plan=llm_plan,
                    context_events_by_slot=context_events_by_slot,
                    sibling_candidates=[
                        sibling
                        for sibling_index, sibling in enumerate(prepared_event_sets, start=1)
                        if sibling_index != index
                    ],
                )
                candidate = build_pending_candidate(
                    candidate_group_id=candidate_group_id,
                    confidence=confidence,
                    created_at=timestamp,
                    diagnostics=diagnostics_with_registration_quality(
                        diagnostics,
                        registration.diagnostics,
                    ),
                    job_id=job_id,
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
                has_active_material=studio_has_active_track_material(studio, slot_id),
                source_kind="ai",
                source_label=source_label,
                timestamp=timestamp,
            )
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "needs_review"
                    job.message = message
                    job.updated_at = timestamp
                    break
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def _discard_superseded_ai_generation_candidates(
        self,
        studio: Studio,
        slot_id: int,
        *,
        current_job_id: str | None = None,
    ) -> None:
        studio.candidates = [
            candidate
            for candidate in studio.candidates
            if not (
                candidate.source_kind == "ai"
                and candidate.suggested_slot_id == slot_id
                and candidate.job_id != current_job_id
                and (
                    candidate.status == "pending"
                    or (
                        candidate.status == "rejected"
                        and candidate.message == SUPERSEDED_AI_CANDIDATE_MESSAGE
                    )
                )
            )
        ]
