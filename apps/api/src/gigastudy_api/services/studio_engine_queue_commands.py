from __future__ import annotations

from typing import Any

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.admin import AdminEngineDrainResult
from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.config import get_settings
from gigastudy_api.services.engine_queue import EngineQueueJob, EngineQueueStore
from gigastudy_api.services.studio_jobs import (
    engine_queue_job_from_extraction,
    existing_extraction_queue_payload,
    reset_extraction_job_for_enqueue,
)
from gigastudy_api.services.upload_policy import guess_audio_mime_type


class StudioEngineQueueCommands:
    def __init__(
        self,
        *,
        engine_queue: EngineQueueStore,
        job_handlers: Any,
        now: Any,
        repository: Any,
    ) -> None:
        self._engine_queue = engine_queue
        self._job_handlers = job_handlers
        self._now = now
        self._repository = repository

    def drain(self, *, max_jobs: int | None = None) -> AdminEngineDrainResult:
        settings = get_settings()
        job_limit = max(1, min(max_jobs or settings.engine_drain_max_jobs, 20))
        processed = 0
        messages: list[str] = []
        for _ in range(job_limit):
            record = self.process_once()
            if record is None:
                break
            processed += 1
            messages.append(f"{record.job_type}:{record.job_id}:{record.status}")
        return AdminEngineDrainResult(
            processed_jobs=processed,
            remaining_runnable=self._engine_queue.has_runnable(),
            max_jobs=job_limit,
            messages=messages,
        )

    def schedule_processing(self, background_tasks: BackgroundTasks | None) -> None:
        if background_tasks is None:
            self.process_until_idle()
            return
        background_tasks.add_task(self.process_until_idle)

    def process_until_idle(self) -> None:
        settings = get_settings()
        job_limit = max(1, min(settings.engine_drain_max_jobs, 20))
        for _ in range(job_limit):
            if self.process_once() is None:
                break

    def process_once(self) -> EngineQueueJob | None:
        settings = get_settings()
        record = self._engine_queue.claim_next(
            max_active=settings.max_active_engine_jobs,
            lease_seconds=settings.engine_job_lease_seconds,
        )
        if record is None:
            if self.repair_missing_records_for_active_jobs() == 0:
                return None
            record = self._engine_queue.claim_next(
                max_active=settings.max_active_engine_jobs,
                lease_seconds=settings.engine_job_lease_seconds,
            )
            if record is None:
                return None

        self._repository._mark_job_running(
            record.studio_id,
            record.job_id,
            attempt_count=record.attempt_count,
            max_attempts=record.max_attempts,
        )
        try:
            self._job_handlers.process(record)
        except Exception as error:
            message = str(error) or "Engine job failed."
            self._repository._mark_job_failed(record.studio_id, record.job_id, message=message)
            self._engine_queue.fail(record.job_id, message=message)
            return record

        refreshed = self._repository.get_studio(record.studio_id)
        final_status = next((job.status for job in refreshed.jobs if job.job_id == record.job_id), None)
        if final_status == "failed":
            failed_job = next((job for job in refreshed.jobs if job.job_id == record.job_id), None)
            self._engine_queue.fail(record.job_id, message=failed_job.message or "Engine job failed.")
        else:
            self._engine_queue.complete(record.job_id)
        return record

    def repair_missing_records_for_active_jobs(self) -> int:
        repaired = 0
        limit = 50
        offset = 0
        while True:
            with self._repository._lock:
                rows = self._repository._store.list_raw(limit=limit, offset=offset)
            if not rows:
                break
            for _studio_id, studio_payload in rows:
                studio = Studio.model_validate(studio_payload)
                repaired += self.ensure_queue_records_for_active_jobs(studio)
            if len(rows) < limit:
                break
            offset += limit
        return repaired

    def ensure_queue_records_for_active_jobs(self, studio: Studio) -> int:
        repaired = 0
        for job in studio.jobs:
            if job.status not in {"queued", "running"}:
                continue
            if self._engine_queue.get(job.job_id) is not None:
                continue
            try:
                self.enqueue_existing_extraction_job(studio.studio_id, job.job_id)
            except HTTPException as error:
                self._repository._mark_job_failed(studio.studio_id, job.job_id, message=str(error.detail))
                continue
            repaired += 1
        return repaired

    def enqueue_existing_extraction_job(self, studio_id: str, job_id: str) -> None:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            job = next((candidate_job for candidate_job in studio.jobs if candidate_job.job_id == job_id), None)
            if job is None:
                raise HTTPException(status_code=404, detail="Extraction job not found.")
            queue_record = self._engine_queue.get(job_id)
            try:
                payload = existing_extraction_queue_payload(
                    job,
                    existing_payload=queue_record.payload if queue_record is not None else None,
                    fallback_audio_mime_type=guess_audio_mime_type(job.source_label),
                )
            except ValueError as error:
                raise HTTPException(status_code=409, detail=str(error)) from error
            timestamp = self._now()
            reset_extraction_job_for_enqueue(
                job,
                max_attempts=get_settings().engine_job_max_attempts,
                timestamp=timestamp,
            )
            self._repository._save_studio(studio)

        self._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=payload,
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
