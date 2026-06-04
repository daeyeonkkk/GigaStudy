from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.studios import GenerateTrackRequest, Studio
from gigastudy_api.config import get_settings
from gigastudy_api.services.studio_documents import studio_has_active_track_material
from gigastudy_api.services.studio_generation import (
    GenerationRequestError,
    build_generation_context_events_by_slot,
    generate_track_material,
)
from gigastudy_api.services.studio_jobs import (
    create_generation_job,
    engine_queue_job_from_extraction,
    generation_queue_payload,
)
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs


def _now() -> str:
    return datetime.now(UTC).isoformat()


class StudioGenerationCommands:
    def __init__(
        self,
        *,
        repository: Any,
    ) -> None:
        self._repository = repository

    def generate_track(
        self,
        studio_id: str,
        slot_id: int,
        request: GenerateTrackRequest,
        *,
        background_tasks: BackgroundTasks | None = None,
        owner_token: str | None = None,
    ) -> Studio:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        track = self._repository._find_track(studio, slot_id)
        ensure_no_active_extraction_jobs(
            studio,
            {slot_id, *request.context_slot_ids},
            action_label="AI generation",
        )
        if studio_has_active_track_material(studio, slot_id) and not request.allow_overwrite and not request.review_before_register:
            raise HTTPException(
                status_code=409,
                detail="AI generation would overwrite an existing registered track.",
            )
        if not build_generation_context_events_by_slot(
            studio,
            target_slot_id=slot_id,
            requested_context_slot_ids=request.context_slot_ids,
        ):
            raise HTTPException(
                status_code=409,
                detail="AI generation requires at least one registered context track.",
            )

        timestamp = _now()
        source_label = "AI generation"
        request_payload = request.model_dump(mode="json")
        job = create_generation_job(
            input_request=request_payload,
            max_attempts=get_settings().engine_job_max_attempts,
            slot_id=slot_id,
            source_label=source_label,
            timestamp=timestamp,
        )
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            track = self._repository._find_track(studio, slot_id)
            ensure_no_active_extraction_jobs(
                studio,
                {slot_id, *request.context_slot_ids},
                action_label="AI generation",
            )
            if (
                studio_has_active_track_material(studio, slot_id)
                and not request.allow_overwrite
                and not request.review_before_register
            ):
                raise HTTPException(
                    status_code=409,
                    detail="AI generation would overwrite an existing registered track.",
                )
            studio.jobs.append(job)
            if not studio_has_active_track_material(studio, slot_id):
                track.status = "extracting"
                track.source_kind = "ai"
                track.source_label = source_label
                track.updated_at = timestamp
            studio.updated_at = timestamp
            self._repository._save_studio(studio)

        self._repository._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=generation_queue_payload(job),
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
        self._repository._schedule_engine_queue_processing(background_tasks)
        return self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)

    def generate_track_now(
        self,
        studio_id: str,
        slot_id: int,
        request: GenerateTrackRequest,
        *,
        owner_token: str | None = None,
        job_id: str | None = None,
    ) -> Studio:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=owner_token is not None)
        self._repository._find_track(studio, slot_id)
        ensure_no_active_extraction_jobs(
            studio,
            {slot_id, *request.context_slot_ids},
            action_label="AI generation",
            ignore_job_id=job_id,
        )
        try:
            generated = generate_track_material(
                settings=get_settings(),
                studio=studio,
                target_slot_id=slot_id,
                request=request,
            )
        except GenerationRequestError as error:
            raise HTTPException(status_code=error.status_code, detail=error.detail) from error

        if not generated.candidate_events:
            raise HTTPException(status_code=409, detail="No harmony events could be generated.")
        if request.review_before_register:
            return self._repository._add_generation_candidates(
                studio_id,
                slot_id,
                generated.candidate_events,
                source_label=generated.source_label,
                method=generated.method,
                message=generated.message,
                llm_plan=generated.llm_plan,
                context_events_by_slot=generated.context_events_by_slot,
                job_id=job_id,
            )

        if studio_has_active_track_material(studio, slot_id) and not request.allow_overwrite:
            raise HTTPException(
                status_code=409,
                detail="AI generation would overwrite an existing registered track.",
            )
        return self._repository._update_track(
            studio_id,
            slot_id,
            source_kind="ai",
            source_label=generated.source_label,
            events=generated.candidate_events[0],
        )
