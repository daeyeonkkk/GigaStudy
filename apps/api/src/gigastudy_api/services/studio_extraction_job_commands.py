from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.studios import SourceKind, Studio
from gigastudy_api.config import get_settings
from gigastudy_api.services.engine_queue import EngineQueueStore
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import track_has_content
from gigastudy_api.services.studio_jobs import (
    create_document_extraction_job,
    create_voice_extraction_job,
    engine_queue_job_from_extraction,
    document_queue_payload,
    voice_queue_payload,
)
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs
from gigastudy_api.services.upload_policy import guess_audio_mime_type


class StudioExtractionJobCommands:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        engine_queue: EngineQueueStore,
        now: Callable[[], str],
        repository: Any,
        schedule_processing: Callable[[BackgroundTasks | None], None],
    ) -> None:
        self._assets = assets
        self._engine_queue = engine_queue
        self._now = now
        self._repository = repository
        self._schedule_processing = schedule_processing

    def enqueue_document(
        self,
        studio_id: str,
        slot_id: int,
        *,
        source_kind: SourceKind,
        source_label: str,
        source_path: Path,
        background_tasks: BackgroundTasks | None = None,
        parse_all_parts: bool = False,
    ) -> Studio:
        timestamp = self._now()
        settings = get_settings()
        job = create_document_extraction_job(
            input_path=self._assets.relative_data_asset_path(source_path),
            max_attempts=settings.engine_job_max_attempts,
            parse_all_parts=parse_all_parts,
            slot_id=slot_id,
            source_kind=source_kind,
            source_label=source_label,
            timestamp=timestamp,
        )

        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            placeholder_tracks = (
                [track for track in studio.tracks if track.slot_id <= 5]
                if parse_all_parts
                else [self._repository._find_track(studio, slot_id)]
            )
            ensure_no_active_extraction_jobs(
                studio,
                (track.slot_id for track in placeholder_tracks),
                action_label="Document extraction",
            )
            for track in placeholder_tracks:
                if track_has_content(track):
                    continue
                track.status = "extracting"
                track.source_kind = source_kind
                track.source_label = source_label
                track.updated_at = timestamp
            studio.jobs.append(job)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)

        self._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=document_queue_payload(job),
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
        self._schedule_processing(background_tasks)
        return studio

    def enqueue_voice(
        self,
        studio_id: str,
        slot_id: int,
        *,
        source_kind: SourceKind,
        source_label: str,
        source_path: Path,
        background_tasks: BackgroundTasks | None,
        review_before_register: bool,
        allow_overwrite: bool,
    ) -> Studio:
        settings = get_settings()
        timestamp = self._now()
        input_path = self._assets.relative_data_asset_path(source_path)
        audio_mime_type = guess_audio_mime_type(source_label)
        job = create_voice_extraction_job(
            allow_overwrite=allow_overwrite,
            audio_mime_type=audio_mime_type,
            input_path=input_path,
            max_attempts=settings.engine_job_max_attempts,
            review_before_register=review_before_register,
            slot_id=slot_id,
            source_kind=source_kind,
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
                {slot_id},
                action_label="Voice extraction",
            )
            if not track_has_content(track) or not review_before_register:
                track.status = "extracting"
                track.source_kind = source_kind
                track.source_label = source_label
                track.updated_at = timestamp
            studio.jobs.append(job)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)

        self._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=voice_queue_payload(job),
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
        self._schedule_processing(background_tasks)
        return studio
