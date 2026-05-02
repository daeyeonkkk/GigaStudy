from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import GenerateTrackRequest, Studio
from gigastudy_api.config import get_settings
from gigastudy_api.services.studio_documents import track_has_content
from gigastudy_api.services.studio_generation import (
    GenerationRequestError,
    generate_track_material,
)


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
        owner_token: str | None = None,
    ) -> Studio:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._repository._find_track(studio, slot_id)
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
            raise HTTPException(status_code=409, detail="No harmony notes could be generated.")
        if request.review_before_register:
            return self._repository._add_generation_candidates(
                studio_id,
                slot_id,
                generated.candidate_events,
                source_label=generated.source_label,
                method=generated.method,
                message=generated.message,
                llm_plan=generated.llm_plan,
            )

        target_track = self._repository._find_track(studio, slot_id)
        if track_has_content(target_track) and not request.allow_overwrite:
            raise HTTPException(
                status_code=409,
                detail="AI generation would overwrite an existing registered track.",
            )
        return self._repository._update_track(
            studio_id,
            slot_id,
            source_kind="ai",
            source_label=generated.source_label,
            notes=generated.candidate_events[0],
        )
