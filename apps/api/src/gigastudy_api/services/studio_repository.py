from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from threading import Lock, RLock
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.admin import (
    AdminDeleteResult,
    AdminEngineDrainResult,
    AdminStorageSummary,
)
from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    CopyRegionRequest,
    DirectUploadRequest,
    DirectUploadTarget,
    ExtractionCandidate,
    GenerateTrackRequest,
    ScoreTrackRequest,
    SeedSourceKind,
    ShiftTrackSyncRequest,
    SourceKind,
    SplitRegionRequest,
    Studio,
    StudioListItem,
    StudioSeedUploadRequest,
    SyncTrackRequest,
    TrackExtractionJob,
    TrackSlot,
    UpdatePitchEventRequest,
    UpdateRegionRequest,
    UploadTrackRequest,
    VolumeTrackRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.asset_storage import (
    AssetStorageError,
    build_asset_storage,
)
from gigastudy_api.services.asset_registry import build_asset_registry
from gigastudy_api.services.alpha_limits import (
    ensure_studio_capacity,
)
from gigastudy_api.services.direct_upload_tokens import DirectUploadTokenCodec
from gigastudy_api.services.studio_admin_commands import StudioAdminCommands
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_jobs import (
    mark_extraction_job_completed,
    mark_extraction_job_failed,
    mark_extraction_job_running,
)
from gigastudy_api.services.engine.candidate_diagnostics import (
    track_duration_seconds as _track_duration_seconds,
)
from gigastudy_api.services.engine.music_theory import (
    track_name,
)
from gigastudy_api.services.engine.audiveris_document import run_audiveris_document_extraction
from gigastudy_api.services.engine.event_quality import RegistrationQualityResult
from gigastudy_api.services.engine.pdf_vector_document import parse_born_digital_pdf_document
from gigastudy_api.services.engine.voice import (
    NO_METRONOME_ALIGNMENT,
    VoiceTranscriptionResult,
    transcribe_voice_file,
    transcribe_voice_file_with_alignment,
)

_ORIGINAL_TRANSCRIBE_VOICE_FILE = transcribe_voice_file
from gigastudy_api.services.engine_queue import EngineQueueJob, EngineQueueStore, build_engine_queue_store
from gigastudy_api.services.studio_engine_job_handlers import StudioEngineJobHandlers
from gigastudy_api.services.studio_engine_queue_commands import StudioEngineQueueCommands
from gigastudy_api.services.studio_extraction_job_commands import StudioExtractionJobCommands
from gigastudy_api.services.studio_candidate_commands import StudioCandidateCommands
from gigastudy_api.services.studio_generation_commands import StudioGenerationCommands
from gigastudy_api.services.studio_region_commands import StudioRegionCommands
from gigastudy_api.services.studio_scoring_commands import StudioScoringCommands
from gigastudy_api.services.studio_upload_commands import StudioUploadCommands
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan
from gigastudy_api.services.studio_store import StudioStore, build_studio_store
from gigastudy_api.services.studio_resource_commands import StudioResourceCommands
from gigastudy_api.services.studio_track_settings import (
    TrackSettingsError,
    set_studio_time_signature,
    set_track_sync_offset,
    set_track_volume,
    shift_registered_track_sync_offsets,
)
from gigastudy_api.services.track_registration import TrackRegistrationPreparer
from gigastudy_api.services.studio_documents import (
    empty_tracks as _empty_tracks,
    encode_studio_payload,
    register_track_material as _register_track_material,
    studio_list_item_from_payload as _studio_list_item_from_payload,
    track_has_content as _track_has_content,
)
from gigastudy_api.services.studio_access import (
    owner_hash_for_request,
    owner_policy_enabled,
    require_studio_access,
)
from gigastudy_api.services.upload_policy import (
    DEFAULT_UPLOAD_BPM,
    should_route_seed_upload_to_document_extraction,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


SYNC_OFFSET_PRECISION = 3
_engine_execution_lock = Lock()


def _shift_explicit_regions_for_slot(
    regions: list[ArrangementRegion],
    *,
    slot_id: int,
    delta_seconds: float,
) -> None:
    if abs(delta_seconds) < 0.0005:
        return
    for region in regions:
        if region.track_slot_id != slot_id:
            continue
        region.start_seconds = round(region.start_seconds + delta_seconds, 4)
        region.sync_offset_seconds = round(region.start_seconds, 4)
        for event in region.pitch_events:
            event.start_seconds = round(event.start_seconds + delta_seconds, 4)


class StudioRepository:
    def __init__(self, storage_root: str) -> None:
        settings = get_settings()
        self._root = Path(storage_root)
        self._store: StudioStore = build_studio_store(
            storage_root=self._root,
            database_url=settings.database_url,
        )
        try:
            asset_storage = build_asset_storage(
                storage_root=self._root,
                settings=settings,
            )
        except AssetStorageError as error:
            raise RuntimeError(str(error)) from error
        direct_upload_tokens = DirectUploadTokenCodec(
            storage_root=self._root,
            normalize_reference=asset_storage.normalize_reference,
        )
        asset_registry = build_asset_registry(
            storage_root=self._root,
            database_url=settings.database_url,
        )
        self._assets = StudioAssetService(
            root=self._root,
            asset_storage=asset_storage,
            asset_registry=asset_registry,
            direct_upload_tokens=direct_upload_tokens,
        )
        self._engine_queue: EngineQueueStore = build_engine_queue_store(
            storage_root=self._root,
            database_url=settings.database_url,
        )
        self._engine_job_handlers = StudioEngineJobHandlers(
            assets=self._assets,
            repository=self,
            root=self._root,
            vector_parser=parse_born_digital_pdf_document,
        )
        self._engine_commands = StudioEngineQueueCommands(
            engine_queue=self._engine_queue,
            job_handlers=self._engine_job_handlers,
            now=_now,
            repository=self,
        )
        self._extraction_jobs = StudioExtractionJobCommands(
            assets=self._assets,
            engine_queue=self._engine_queue,
            now=_now,
            repository=self,
            schedule_processing=self._schedule_engine_queue_processing,
        )
        self._candidates = StudioCandidateCommands(
            now=_now,
            repository=self,
        )
        self._uploads = StudioUploadCommands(
            assets=self._assets,
            now=_now,
            repository=self,
        )
        self._generation = StudioGenerationCommands(repository=self)
        self._regions = StudioRegionCommands(now=_now, repository=self)
        self._scoring = StudioScoringCommands(
            assets=self._assets,
            now=_now,
            repository=self,
        )
        self._registration_preparer = TrackRegistrationPreparer()
        self._lock = RLock()
        self._admin = StudioAdminCommands(
            assets=self._assets,
            engine_queue=self._engine_queue,
            lock=self._lock,
            now=_now,
            store=self._store,
        )
        self._resources = StudioResourceCommands(
            assets=self._assets,
            repository=self,
        )

    def list_accessible_studios(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        owner_token: str | None = None,
    ) -> list[StudioListItem]:
        owner_hash = owner_hash_for_request(owner_token, allow_missing=True)
        if owner_policy_enabled() and owner_hash is None:
            return []
        with self._lock:
            rows = self._store.list_summary_raw(
                limit=limit,
                offset=offset,
                owner_token_hash=owner_hash,
            )
        return [_studio_list_item_from_payload(studio_id, studio_payload) for studio_id, studio_payload in rows]

    def create_studio(
        self,
        *,
        title: str,
        bpm: int | None,
        start_mode: str,
        time_signature_numerator: int = 4,
        time_signature_denominator: int = 4,
        source_kind: SeedSourceKind | None = None,
        source_filename: str | None = None,
        source_content_base64: str | None = None,
        source_asset_path: str | None = None,
        owner_token: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        timestamp = _now()
        with self._lock:
            ensure_studio_capacity(self._count_studios())
        owner_hash = owner_hash_for_request(owner_token)
        resolved_bpm = bpm if bpm is not None else DEFAULT_UPLOAD_BPM
        studio = Studio(
            studio_id=uuid4().hex,
            owner_token_hash=owner_hash,
            title=title.strip(),
            bpm=resolved_bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            tracks=_empty_tracks(timestamp),
            reports=[],
            jobs=[],
            candidates=[],
            created_at=timestamp,
            updated_at=timestamp,
        )

        if start_mode == "upload":
            if source_kind is None:
                raise HTTPException(status_code=422, detail="Upload start requires a source kind.")
            source_label = source_filename or f"uploaded-{source_kind}"
            if should_route_seed_upload_to_document_extraction(source_kind, source_label):
                source_path = self._prepare_studio_seed_upload(
                    studio,
                    source_kind=source_kind,
                    source_filename=source_label,
                    source_content_base64=source_content_base64,
                    source_asset_path=source_asset_path,
                )
                with self._lock:
                    self._save_studio(studio)
                return self._enqueue_document_job(
                    studio.studio_id,
                    1,
                    source_kind="document",
                    source_label=source_label,
                    source_path=source_path,
                    background_tasks=background_tasks,
                    parse_all_parts=True,
                )
            studio = self._seed_from_upload(
                studio,
                source_kind=source_kind,
                source_filename=source_label,
                source_content_base64=source_content_base64,
                source_asset_path=source_asset_path,
            )

        with self._lock:
            self._save_studio(studio)
        return studio

    def get_studio(
        self,
        studio_id: str,
        *,
        background_tasks: BackgroundTasks | None = None,
        owner_token: str | None = None,
        enforce_owner: bool = False,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
        if studio is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        if enforce_owner:
            require_studio_access(studio, owner_token)
        return studio

    def get_track_audio(
        self,
        studio_id: str,
        slot_id: int,
        *,
        owner_token: str | None = None,
    ) -> tuple[Path, str, str]:
        return self._resources.get_track_audio(studio_id, slot_id, owner_token=owner_token)

    def get_document_source_preview(
        self,
        studio_id: str,
        job_id: str,
        *,
        page_index: int = 0,
        owner_token: str | None = None,
    ) -> tuple[bytes, str]:
        return self._resources.get_document_source_preview(
            studio_id,
            job_id,
            page_index=page_index,
            owner_token=owner_token,
        )

    def get_admin_storage_summary(
        self,
        *,
        studio_limit: int = 50,
        studio_offset: int = 0,
        asset_limit: int = 25,
        asset_offset: int = 0,
        sync_missing_assets: bool = False,
    ) -> AdminStorageSummary:
        return self._admin.storage_summary(
            studio_limit=studio_limit,
            studio_offset=studio_offset,
            asset_limit=asset_limit,
            asset_offset=asset_offset,
            sync_missing_assets=sync_missing_assets,
        )

    def delete_admin_studio(
        self,
        studio_id: str,
        *,
        background_tasks: BackgroundTasks | None = None,
    ) -> AdminDeleteResult:
        return self._admin.delete_studio(studio_id, background_tasks=background_tasks)

    def delete_admin_studio_assets(
        self,
        studio_id: str,
        *,
        background_tasks: BackgroundTasks | None = None,
    ) -> AdminDeleteResult:
        return self._admin.delete_studio_assets(studio_id, background_tasks=background_tasks)

    def delete_admin_staged_assets(self) -> AdminDeleteResult:
        return self._admin.delete_staged_assets()

    def delete_admin_expired_staged_assets(self) -> AdminDeleteResult:
        return self._admin.delete_expired_staged_assets()

    def delete_admin_asset(self, asset_id: str) -> AdminDeleteResult:
        return self._admin.delete_asset(asset_id)

    def create_studio_upload_target(
        self,
        request: StudioSeedUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        return self._uploads.create_studio_upload_target(request, owner_token=owner_token)

    def create_track_upload_target(
        self,
        studio_id: str,
        slot_id: int,
        request: DirectUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        return self._uploads.create_track_upload_target(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
        )

    def write_direct_upload_content(
        self,
        asset_id: str,
        content: bytes,
        *,
        owner_token: str | None = None,
    ) -> dict[str, int | str]:
        return self._uploads.write_direct_upload_content(
            asset_id,
            content,
            owner_token=owner_token,
        )

    def _validate_track_upload_owner(self, studio_id: str, slot_id: int) -> None:
        self._uploads.validate_track_upload_owner(studio_id, slot_id)

    def upload_track(
        self,
        studio_id: str,
        slot_id: int,
        request: UploadTrackRequest,
        *,
        owner_token: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        return self._uploads.upload_track(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
            background_tasks=background_tasks,
        )

    def generate_track(
        self,
        studio_id: str,
        slot_id: int,
        request: GenerateTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._generation.generate_track(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
        )

    def update_sync(
        self,
        studio_id: str,
        slot_id: int,
        request: SyncTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            ensure_no_active_extraction_jobs(
                studio,
                {slot_id},
                action_label="Track sync editing",
            )
            previous_offset = track.sync_offset_seconds
            set_track_sync_offset(
                track,
                sync_offset_seconds=request.sync_offset_seconds,
                precision=SYNC_OFFSET_PRECISION,
                timestamp=timestamp,
            )
            _shift_explicit_regions_for_slot(
                studio.regions,
                slot_id=slot_id,
                delta_seconds=track.sync_offset_seconds - previous_offset,
            )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def shift_registered_syncs(
        self,
        studio_id: str,
        request: ShiftTrackSyncRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = _now()
            ensure_no_active_extraction_jobs(
                studio,
                (track.slot_id for track in studio.tracks if track.status == "registered"),
                action_label="Global sync editing",
            )
            previous_offsets = {track.slot_id: track.sync_offset_seconds for track in studio.tracks}
            try:
                shift_registered_track_sync_offsets(
                    studio,
                    delta_seconds=request.delta_seconds,
                    precision=SYNC_OFFSET_PRECISION,
                    minimum_seconds=-30,
                    maximum_seconds=30,
                    timestamp=timestamp,
                )
            except TrackSettingsError as error:
                raise HTTPException(status_code=error.status_code, detail=error.detail) from error
            for track in studio.tracks:
                _shift_explicit_regions_for_slot(
                    studio.regions,
                    slot_id=track.slot_id,
                    delta_seconds=track.sync_offset_seconds - previous_offsets.get(track.slot_id, 0),
                )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def update_volume(
        self,
        studio_id: str,
        slot_id: int,
        request: VolumeTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            set_track_volume(
                track,
                volume_percent=request.volume_percent,
                timestamp=timestamp,
            )
            for region in studio.regions:
                if region.track_slot_id == slot_id:
                    region.volume_percent = request.volume_percent
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def update_region(
        self,
        studio_id: str,
        region_id: str,
        request: UpdateRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._regions.update_region(
            studio_id,
            region_id,
            request,
            owner_token=owner_token,
        )

    def copy_region(
        self,
        studio_id: str,
        region_id: str,
        request: CopyRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._regions.copy_region(
            studio_id,
            region_id,
            request,
            owner_token=owner_token,
        )

    def split_region(
        self,
        studio_id: str,
        region_id: str,
        request: SplitRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._regions.split_region(
            studio_id,
            region_id,
            request,
            owner_token=owner_token,
        )

    def delete_region(
        self,
        studio_id: str,
        region_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._regions.delete_region(
            studio_id,
            region_id,
            owner_token=owner_token,
        )

    def update_pitch_event(
        self,
        studio_id: str,
        region_id: str,
        event_id: str,
        request: UpdatePitchEventRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._regions.update_pitch_event(
            studio_id,
            region_id,
            event_id,
            request,
            owner_token=owner_token,
        )

    def _update_time_signature(
        self,
        studio_id: str,
        numerator: int,
        denominator: int,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            set_studio_time_signature(
                studio,
                numerator=numerator,
                denominator=denominator,
                timestamp=timestamp,
            )
            self._save_studio(studio)
        return studio

    def approve_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        request: ApproveCandidateRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._candidates.approve_candidate(
            studio_id,
            candidate_id,
            request,
            owner_token=owner_token,
        )

    def reject_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._candidates.reject_candidate(
            studio_id,
            candidate_id,
            owner_token=owner_token,
        )

    def approve_job_candidates(
        self,
        studio_id: str,
        job_id: str,
        request: ApproveJobCandidatesRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._candidates.approve_job_candidates(
            studio_id,
            job_id,
            request,
            owner_token=owner_token,
        )

    def retry_extraction_job(
        self,
        studio_id: str,
        job_id: str,
        *,
        owner_token: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            job = next((candidate_job for candidate_job in studio.jobs if candidate_job.job_id == job_id), None)
            if job is None:
                raise HTTPException(status_code=404, detail="Extraction job not found.")
            if job.status not in {"queued", "running", "failed"}:
                raise HTTPException(status_code=409, detail="Only queued, running, or failed jobs can be retried.")
            if not job.input_path:
                raise HTTPException(status_code=409, detail="Extraction job has no stored input file.")

            timestamp = _now()
            job.status = "queued"
            job.message = "Extraction retry queued."
            job.output_path = None
            job.updated_at = timestamp
            track = self._find_track(studio, job.slot_id)
            if not _track_has_content(track):
                track.status = "extracting"
                track.source_kind = job.source_kind
                track.source_label = job.source_label
                track.updated_at = timestamp
            studio.updated_at = timestamp
            self._save_studio(studio)

        self._engine_commands.enqueue_existing_extraction_job(studio_id, job_id)
        self._schedule_engine_queue_processing(background_tasks)
        return self.get_studio(studio_id)

    def score_track(
        self,
        studio_id: str,
        slot_id: int,
        request: ScoreTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        return self._scoring.score_track(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
        )

    def drain_engine_queue(self, *, max_jobs: int | None = None) -> AdminEngineDrainResult:
        return self._engine_commands.drain(max_jobs=max_jobs)

    def _extract_scoring_audio(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
        bpm: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
    ) -> list[TrackPitchEvent]:
        studio = self.get_studio(studio_id)
        target_track = self._find_track(studio, slot_id)
        return self._scoring.extract_scoring_audio(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=content_base64,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            studio=studio,
            target_track=target_track,
        )

    def _update_track(
        self,
        studio_id: str,
        slot_id: int,
        *,
        source_kind: SourceKind,
        source_label: str,
        events: list[TrackPitchEvent],
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
        source_diagnostics: dict[str, Any] | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            registration = self._prepare_registration_events(
                studio,
                slot_id,
                source_kind=source_kind,
                events=events,
            )
            registration_diagnostics = dict(registration.diagnostics)
            if source_diagnostics:
                registration_diagnostics["source_extraction"] = source_diagnostics
            _register_track_material(
                studio,
                track,
                timestamp=timestamp,
                source_kind=source_kind,
                source_label=source_label,
                events=registration.events,
                duration_seconds=_track_duration_seconds(registration.events),
                registration_diagnostics=registration_diagnostics,
                audio_source_path=audio_source_path,
                audio_source_label=audio_source_label,
                audio_mime_type=audio_mime_type,
            )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _apply_extracted_tracks(
        self,
        studio_id: str,
        mapped_events: dict[int, list[TrackPitchEvent]],
        *,
        source_kind: SourceKind,
        source_label: str,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            registrations = self._prepare_registration_batch(
                studio,
                mapped_events,
                source_kind=source_kind,
            )
            for slot_id in mapped_events:
                track = self._find_track(studio, slot_id)
                registration = registrations[slot_id]
                _register_track_material(
                    studio,
                    track,
                    timestamp=timestamp,
                    source_kind=source_kind,
                    source_label=source_label,
                    events=registration.events,
                    duration_seconds=_track_duration_seconds(registration.events),
                    registration_diagnostics=registration.diagnostics,
                )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _prepare_registration_events(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        events: list[TrackPitchEvent],
    ) -> RegistrationQualityResult:
        return self._registration_preparer.prepare_events(
            studio,
            slot_id,
            source_kind=source_kind,
            events=events,
        )

    def _prepare_registration_batch(
        self,
        studio: Studio,
        mapped_events: dict[int, list[TrackPitchEvent]],
        *,
        source_kind: SourceKind,
    ) -> dict[int, RegistrationQualityResult]:
        return self._registration_preparer.prepare_batch(
            studio,
            mapped_events,
            source_kind=source_kind,
        )

    def _seed_from_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
        source_asset_path: str | None,
    ) -> Studio:
        return self._uploads.seed_from_upload(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=source_content_base64,
            source_asset_path=source_asset_path,
        )

    def _prepare_studio_seed_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
        source_asset_path: str | None,
    ) -> Path:
        return self._uploads.prepare_studio_seed_upload(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=source_content_base64,
            source_asset_path=source_asset_path,
        )

    def _append_initial_candidate(
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
        self._candidates.append_initial_candidate(
            studio,
            suggested_slot_id=suggested_slot_id,
            source_kind=source_kind,
            source_label=source_label,
            method=method,
            confidence=confidence,
            events=events,
            message=message,
            audio_source_path=audio_source_path,
            audio_source_label=audio_source_label,
            audio_mime_type=audio_mime_type,
            source_diagnostics=source_diagnostics,
        )

    def _enqueue_document_job(
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
        return self._extraction_jobs.enqueue_document(
            studio_id,
            slot_id,
            source_kind=source_kind,
            source_label=source_label,
            source_path=source_path,
            background_tasks=background_tasks,
            parse_all_parts=parse_all_parts,
        )

    def _enqueue_voice_job(
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
        return self._extraction_jobs.enqueue_voice(
            studio_id,
            slot_id,
            source_kind=source_kind,
            source_label=source_label,
            source_path=source_path,
            background_tasks=background_tasks,
            review_before_register=review_before_register,
            allow_overwrite=allow_overwrite,
        )

    def process_engine_queue_once(self) -> EngineQueueJob | None:
        return self._engine_commands.process_once()

    def _ensure_extraction_job_for_queue_record(self, record: EngineQueueJob) -> None:
        with self._lock:
            studio = self._load_studio(record.studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            if any(job.job_id == record.job_id for job in studio.jobs):
                return

            timestamp = _now()
            source_kind: SourceKind = "audio" if record.job_type == "voice" else "document"
            payload_source_kind = record.payload.get("source_kind")
            if payload_source_kind in {"recording", "audio", "midi", "document", "music", "ai"}:
                source_kind = payload_source_kind
            source_label = str(record.payload.get("source_label") or "recovered-upload")
            audio_mime_type_value = record.payload.get("audio_mime_type")
            job = TrackExtractionJob(
                job_id=record.job_id,
                job_type=record.job_type,
                slot_id=record.slot_id,
                source_kind=source_kind,
                source_label=source_label,
                status="queued",
                method="voice_transcription" if record.job_type == "voice" else "audiveris_cli",
                message="Recovered from durable engine queue.",
                input_path=str(record.payload.get("input_path") or "") or None,
                attempt_count=max(0, record.attempt_count),
                max_attempts=record.max_attempts,
                parse_all_parts=bool(record.payload.get("parse_all_parts")),
                review_before_register=bool(record.payload.get("review_before_register")),
                allow_overwrite=bool(record.payload.get("allow_overwrite")),
                audio_mime_type=str(audio_mime_type_value) if audio_mime_type_value else None,
                created_at=record.created_at,
                updated_at=timestamp,
            )
            studio.jobs.append(job)
            placeholder_tracks = (
                [track for track in studio.tracks if track.slot_id <= 5]
                if job.parse_all_parts
                else [self._find_track(studio, job.slot_id)]
            )
            for track in placeholder_tracks:
                if _track_has_content(track):
                    continue
                track.status = "extracting"
                track.source_kind = job.source_kind
                track.source_label = job.source_label
                track.updated_at = timestamp
            studio.updated_at = timestamp
            self._save_studio(studio)

    def _add_extraction_candidates(
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
        source_diagnostics: dict[str, Any] | None = None,
    ) -> Studio:
        return self._candidates.add_extraction_candidates(
            studio_id,
            mapped_events,
            source_kind=source_kind,
            source_label=source_label,
            method=method,
            confidence=confidence,
            confidence_by_slot=confidence_by_slot,
            diagnostics_by_slot=diagnostics_by_slot,
            message_by_slot=message_by_slot,
            job_id=job_id,
            message=message,
            candidate_group_id=candidate_group_id,
            variant_label=variant_label,
            audio_source_path=audio_source_path,
            audio_source_label=audio_source_label,
            audio_mime_type=audio_mime_type,
        )

    def _add_generation_candidates(
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
        return self._candidates.add_generation_candidates(
            studio_id,
            slot_id,
            candidate_events,
            source_label=source_label,
            method=method,
            message=message,
            llm_plan=llm_plan,
        )

    def _schedule_engine_queue_processing(self, background_tasks: BackgroundTasks | None) -> None:
        self._engine_commands.schedule_processing(background_tasks)

    def _mark_job_running(
        self,
        studio_id: str,
        job_id: str,
        *,
        attempt_count: int | None = None,
        max_attempts: int | None = None,
    ) -> None:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            mark_extraction_job_running(
                studio,
                job_id,
                attempt_count=attempt_count,
                max_attempts=max_attempts,
                timestamp=timestamp,
            )
            self._save_studio(studio)

    def _mark_job_failed(self, studio_id: str, job_id: str, *, message: str) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            try:
                mark_extraction_job_failed(studio, job_id, message=message, timestamp=timestamp)
            except ValueError as error:
                raise HTTPException(status_code=404, detail="Track slot not found.") from error
            self._save_studio(studio)
        return studio

    def _mark_job_completed(
        self,
        studio_id: str,
        job_id: str,
        *,
        output_path: str,
        method: str | None = None,
    ) -> None:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            mark_extraction_job_completed(
                studio,
                job_id,
                method=method,
                output_path=output_path,
                timestamp=timestamp,
            )
            self._save_studio(studio)

    def _find_track(self, studio: Studio, slot_id: int) -> TrackSlot:
        track_name(slot_id)
        for track in studio.tracks:
            if track.slot_id == slot_id:
                return track
        raise HTTPException(status_code=404, detail="Track slot not found.")

    def _find_candidate(self, studio: Studio, candidate_id: str) -> ExtractionCandidate:
        for candidate in studio.candidates:
            if candidate.candidate_id == candidate_id:
                return candidate
        raise HTTPException(status_code=404, detail="Extraction candidate not found.")

    def _mapped_events_would_overwrite(
        self,
        studio: Studio,
        mapped_events: dict[int, list[TrackPitchEvent]],
    ) -> bool:
        return any(_track_has_content(self._find_track(studio, slot_id)) for slot_id in mapped_events)

    def _transcribe_voice_file(
        self,
        source_path: Path,
        *,
        bpm: int,
        slot_id: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
        extraction_plan: Any | None = None,
    ) -> list[TrackPitchEvent]:
        with _engine_execution_lock:
            return transcribe_voice_file(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                extraction_plan=extraction_plan,
            )

    def _transcribe_voice_file_with_alignment(
        self,
        source_path: Path,
        *,
        bpm: int,
        slot_id: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
        extraction_plan: Any | None = None,
    ) -> VoiceTranscriptionResult:
        with _engine_execution_lock:
            if transcribe_voice_file is not _ORIGINAL_TRANSCRIBE_VOICE_FILE:
                return VoiceTranscriptionResult(
                    events=transcribe_voice_file(
                        source_path,
                        bpm=bpm,
                        slot_id=slot_id,
                        time_signature_numerator=time_signature_numerator,
                        time_signature_denominator=time_signature_denominator,
                        extraction_plan=extraction_plan,
                    ),
                    alignment=NO_METRONOME_ALIGNMENT,
                    diagnostics={
                        "engine": "monkeypatched_voice_transcriber",
                        "voice_extraction_plan": extraction_plan.diagnostics()
                        if hasattr(extraction_plan, "diagnostics")
                        else None,
                    },
                )
            return transcribe_voice_file_with_alignment(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                extraction_plan=extraction_plan,
            )

    def _run_audiveris_document_extraction(
        self,
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        with _engine_execution_lock:
            return run_audiveris_document_extraction(
                input_path=input_path,
                output_dir=output_dir,
                audiveris_bin=audiveris_bin,
                timeout_seconds=timeout_seconds,
            )

    def _list_studios(self, *, limit: int, offset: int) -> list[Studio]:
        raw_rows = self._store.list_raw(limit=limit, offset=offset)
        return [Studio.model_validate(studio_payload) for _studio_id, studio_payload in raw_rows]

    def _count_studios(self) -> int:
        return self._store.count()

    def _load_studio(self, studio_id: str) -> Studio | None:
        raw_payload = self._store.load_one_raw(studio_id)
        if raw_payload is None:
            return None
        return Studio.model_validate(raw_payload)

    def _save_studio(self, studio: Studio) -> None:
        self._store.save_one_raw(studio.studio_id, encode_studio_payload(studio))

    def _delete_studio(self, studio_id: str) -> bool:
        return self._store.delete_one_raw(studio_id)

_repository: StudioRepository | None = None


def get_studio_repository() -> StudioRepository:
    global _repository
    if _repository is None:
        _repository = StudioRepository(get_settings().storage_root)
    return _repository
