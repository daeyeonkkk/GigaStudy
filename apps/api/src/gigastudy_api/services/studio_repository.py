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
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    DirectUploadRequest,
    DirectUploadTarget,
    ExtractionCandidate,
    GenerateTrackRequest,
    ScoreTrackRequest,
    SeedSourceKind,
    ShiftTrackSyncRequest,
    SourceKind,
    Studio,
    StudioListItem,
    StudioSeedUploadRequest,
    SyncTrackRequest,
    TrackExtractionJob,
    TrackNote,
    TrackSlot,
    UploadTrackRequest,
    VolumeTrackRequest,
)
from gigastudy_api.config import get_settings
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
from gigastudy_api.services.studio_jobs import (
    clear_unmapped_omr_placeholders,
    create_omr_extraction_job,
    create_voice_extraction_job,
    engine_queue_job_from_extraction,
    mark_extraction_job_completed,
    mark_extraction_job_failed,
    mark_extraction_job_running,
    omr_queue_payload,
    voice_queue_payload,
)
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics as _candidate_diagnostics,
    candidate_review_message as _candidate_review_message,
    estimate_candidate_confidence as _estimate_candidate_confidence,
    parsed_track_diagnostics_by_slot as _parsed_track_diagnostics_by_slot,
    track_duration_seconds as _track_duration_seconds,
)
from gigastudy_api.services.engine.music_theory import (
    track_name,
)
from gigastudy_api.services.engine.omr import run_audiveris_omr
from gigastudy_api.services.engine.notation_quality import RegistrationNotationResult
from gigastudy_api.services.engine.pdf_vector_omr import parse_born_digital_pdf_score
from gigastudy_api.services.engine.omr_results import mark_notes_as_omr as _mark_notes_as_omr
from gigastudy_api.services.engine.pdf_export import ScorePdfExportError, build_studio_score_pdf
from gigastudy_api.services.engine.score_preview import ScorePreviewError, render_score_source_preview
from gigastudy_api.services.engine.symbolic import (
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine.voice import (
    NO_METRONOME_ALIGNMENT,
    VoiceTranscriptionError,
    VoiceTranscriptionResult,
    transcribe_voice_file,
    transcribe_voice_file_with_alignment,
)

_ORIGINAL_TRANSCRIBE_VOICE_FILE = transcribe_voice_file
from gigastudy_api.services.engine_queue import EngineQueueJob, EngineQueueStore, build_engine_queue_store
from gigastudy_api.services.studio_engine_queue_commands import StudioEngineQueueCommands
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan
from gigastudy_api.services.omr_pipeline import OmrPipelineError, run_omr_pipeline
from gigastudy_api.services.studio_generation import (
    GenerationRequestError,
    generation_candidate_review_metadata,
    generate_track_material,
)
from gigastudy_api.services.studio_home_audio_import import extract_home_audio_candidate
from gigastudy_api.services.studio_store import StudioStore, build_studio_store
from gigastudy_api.services.studio_scoring import (
    ScoringRequestError,
    build_score_track_report,
    score_track_request_has_performance,
    selected_scoring_reference_slot_ids,
    validate_score_track_request,
)
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
from gigastudy_api.services.voice_pipeline import run_voice_pipeline
from gigastudy_api.services.upload_policy import (
    AUDIO_SOURCE_SUFFIXES,
    DEFAULT_UPLOAD_BPM,
    OMR_SOURCE_SUFFIXES,
    SYMBOLIC_SOURCE_SUFFIXES,
    guess_audio_mime_type as _guess_audio_mime_type,
    should_route_seed_upload_to_omr,
    validate_studio_seed_upload_filename as _validated_studio_seed_upload_filename,
    validate_track_upload_filename as _validated_track_upload_filename,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


SYNC_OFFSET_PRECISION = 3
_engine_execution_lock = Lock()


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
        self._engine_commands = StudioEngineQueueCommands(
            engine_queue=self._engine_queue,
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
            if should_route_seed_upload_to_omr(source_kind, source_label):
                source_path = self._prepare_studio_seed_upload(
                    studio,
                    source_kind=source_kind,
                    source_filename=source_label,
                    source_content_base64=source_content_base64,
                    source_asset_path=source_asset_path,
                )
                with self._lock:
                    self._save_studio(studio)
                return self._enqueue_omr_job(
                    studio.studio_id,
                    1,
                    source_kind="score",
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

    def export_score_pdf(self, studio_id: str, *, owner_token: str | None = None) -> tuple[str, bytes]:
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        try:
            return f"{studio.studio_id}-score.pdf", build_studio_score_pdf(studio)
        except ScorePdfExportError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    def get_track_audio(
        self,
        studio_id: str,
        slot_id: int,
        *,
        owner_token: str | None = None,
    ) -> tuple[Path, str, str]:
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        track = self._find_track(studio, slot_id)
        if track.status != "registered" or track.audio_source_path is None:
            raise HTTPException(status_code=404, detail="Track audio source not found.")

        source_path = self._assets.resolve_data_asset_path(track.audio_source_path)
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Track audio source file is missing.")

        media_type = track.audio_mime_type or _guess_audio_mime_type(source_path.name)
        filename = track.audio_source_label or track.source_label or source_path.name
        return source_path, media_type, filename

    def get_omr_source_preview(
        self,
        studio_id: str,
        job_id: str,
        *,
        page_index: int = 0,
        owner_token: str | None = None,
    ) -> tuple[bytes, str]:
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        job = next((item for item in studio.jobs if item.job_id == job_id), None)
        if job is None:
            raise HTTPException(status_code=404, detail="Extraction job not found.")
        if job.job_type != "omr":
            raise HTTPException(status_code=409, detail="Only OMR jobs have score previews.")
        if job.input_path is None:
            raise HTTPException(status_code=404, detail="OMR source file is missing.")

        source_path = self._assets.resolve_data_asset_path(job.input_path)
        try:
            content = render_score_source_preview(source_path, page_index=page_index)
        except ScorePreviewError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        filename_root = Path(job.source_label or job.job_id).stem or job.job_id
        safe_filename_root = "".join(
            char for char in filename_root if char.isalnum() or char in {"-", "_", "."}
        ) or job.job_id
        return content, f"{safe_filename_root}-page-{page_index + 1}.png"

    def get_admin_storage_summary(
        self,
        *,
        studio_limit: int = 50,
        studio_offset: int = 0,
        asset_limit: int = 25,
        asset_offset: int = 0,
    ) -> AdminStorageSummary:
        return self._admin.storage_summary(
            studio_limit=studio_limit,
            studio_offset=studio_offset,
            asset_limit=asset_limit,
            asset_offset=asset_offset,
        )

    def delete_admin_studio(self, studio_id: str) -> AdminDeleteResult:
        return self._admin.delete_studio(studio_id)

    def delete_admin_studio_assets(self, studio_id: str) -> AdminDeleteResult:
        return self._admin.delete_studio_assets(studio_id)

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
        return self._assets.create_studio_upload_target(request, owner_token=owner_token)

    def create_track_upload_target(
        self,
        studio_id: str,
        slot_id: int,
        request: DirectUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._find_track(studio, slot_id)
        return self._assets.create_track_upload_target(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
            owner_token_hash=studio.owner_token_hash,
        )

    def write_direct_upload_content(
        self,
        asset_id: str,
        content: bytes,
        *,
        owner_token: str | None = None,
    ) -> dict[str, int | str]:
        return self._assets.write_direct_upload_content(
            asset_id,
            content,
            owner_token=owner_token,
            validate_track_upload_owner=self._validate_track_upload_owner,
        )

    def _validate_track_upload_owner(self, studio_id: str, slot_id: int) -> None:
        with self._lock:
            studio = self._load_studio(studio_id)
        if studio is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        self._find_track(studio, slot_id)

    def upload_track(
        self,
        studio_id: str,
        slot_id: int,
        request: UploadTrackRequest,
        *,
        owner_token: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        filename, suffix = _validated_track_upload_filename(request.source_kind, request.filename)

        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._find_track(studio, slot_id)

        if request.asset_path is not None:
            source_path = self._assets.resolve_existing_upload_asset(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                asset_path=request.asset_path,
            )
        else:
            source_path = self._assets.save_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content_base64=request.content_base64 or "",
            )

        try:
            if request.source_kind == "midi" or suffix in SYMBOLIC_SOURCE_SUFFIXES:
                registered_source_kind: SourceKind = "midi" if suffix in {".mid", ".midi"} else "score"
                parsed_symbolic = parse_symbolic_file_with_metadata(
                    source_path,
                    bpm=studio.bpm,
                    target_slot_id=slot_id,
                )
                if parsed_symbolic.has_time_signature:
                    self._update_time_signature(
                        studio_id,
                        parsed_symbolic.time_signature_numerator,
                        parsed_symbolic.time_signature_denominator,
                    )
                mapped_notes = parsed_symbolic.mapped_notes
                if request.review_before_register:
                    return self._add_extraction_candidates(
                        studio_id,
                        mapped_notes,
                        source_kind=registered_source_kind,
                        source_label=filename,
                        method="symbolic_import_review",
                        confidence=0.92,
                        message="Symbolic import is waiting for user approval.",
                    )
                if self._mapped_notes_would_overwrite(studio, mapped_notes) and not request.allow_overwrite:
                    raise HTTPException(
                        status_code=409,
                        detail="Upload would overwrite an existing registered track.",
                    )
                return self._apply_extracted_tracks(
                    studio_id,
                    mapped_notes,
                    source_kind=registered_source_kind,
                    source_label=filename,
                )

            if request.source_kind == "audio":
                track = self._find_track(studio, slot_id)
                if _track_has_content(track) and not request.allow_overwrite and not request.review_before_register:
                    raise HTTPException(
                        status_code=409,
                        detail="Upload would overwrite an existing registered track.",
                    )
                return self._enqueue_voice_job(
                    studio_id,
                    slot_id,
                    source_kind="audio",
                    source_label=filename,
                    source_path=source_path,
                    background_tasks=background_tasks,
                    review_before_register=request.review_before_register,
                    allow_overwrite=request.allow_overwrite,
                )

            if request.source_kind == "score" and suffix in OMR_SOURCE_SUFFIXES:
                return self._enqueue_omr_job(
                    studio_id,
                    slot_id,
                    source_kind="score",
                    source_label=filename,
                    source_path=source_path,
                    background_tasks=background_tasks,
                    parse_all_parts=True,
                )
        except (SymbolicParseError, VoiceTranscriptionError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

        raise HTTPException(status_code=422, detail="Unsupported upload processing path.")

    def generate_track(
        self,
        studio_id: str,
        slot_id: int,
        request: GenerateTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._find_track(studio, slot_id)
        try:
            generated = generate_track_material(
                settings=get_settings(),
                studio=studio,
                target_slot_id=slot_id,
                request=request,
            )
        except GenerationRequestError as error:
            raise HTTPException(status_code=error.status_code, detail=error.detail) from error

        if not generated.candidate_notes:
            raise HTTPException(status_code=409, detail="No harmony notes could be generated.")
        if request.review_before_register:
            return self._add_generation_candidates(
                studio_id,
                slot_id,
                generated.candidate_notes,
                source_label=generated.source_label,
                method=generated.method,
                message=generated.message,
                llm_plan=generated.llm_plan,
            )

        target_track = self._find_track(studio, slot_id)
        if _track_has_content(target_track) and not request.allow_overwrite:
            raise HTTPException(
                status_code=409,
                detail="AI generation would overwrite an existing registered track.",
            )
        return self._update_track(
            studio_id,
            slot_id,
            source_kind="ai",
            source_label=generated.source_label,
            notes=generated.candidate_notes[0],
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
            set_track_sync_offset(
                track,
                sync_offset_seconds=request.sync_offset_seconds,
                precision=SYNC_OFFSET_PRECISION,
                timestamp=timestamp,
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
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

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
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = _now()
            candidate = self._find_candidate(studio, candidate_id)
            if candidate.status != "pending":
                raise HTTPException(status_code=409, detail="Only pending candidates can be approved.")
            target_slot_id = request.target_slot_id or candidate.suggested_slot_id
            track = self._find_track(studio, target_slot_id)
            if _track_has_content(track) and not request.allow_overwrite:
                raise HTTPException(
                    status_code=409,
                    detail="Approving this candidate would overwrite an existing registered track.",
                )
            registration = self._prepare_registration_notes(
                studio,
                target_slot_id,
                source_kind=candidate.source_kind,
                notes=candidate.notes,
            )
            mark_candidate_approved(
                candidate,
                notes=registration.notes,
                registration_diagnostics=registration.diagnostics,
                timestamp=timestamp,
            )
            _register_track_material(
                track,
                timestamp=timestamp,
                source_kind=candidate.source_kind,
                source_label=candidate.source_label,
                notes=registration.notes,
                duration_seconds=_track_duration_seconds(registration.notes),
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
            self._save_studio(studio)
        return studio

    def reject_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            require_studio_access(studio, owner_token)
            timestamp = _now()
            candidate = self._find_candidate(studio, candidate_id)
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
            self._save_studio(studio)
        return studio

    def approve_job_candidates(
        self,
        studio_id: str,
        job_id: str,
        request: ApproveJobCandidatesRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
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

            occupied_slots = [
                slot_id
                for slot_id in unique_candidates_by_slot
                if _track_has_content(self._find_track(studio, slot_id))
            ]
            if occupied_slots and not request.allow_overwrite:
                raise HTTPException(
                    status_code=409,
                    detail="Approving this OMR job would overwrite existing registered tracks.",
                )

            timestamp = _now()
            source_kinds = {candidate.source_kind for candidate in unique_candidates_by_slot.values()}
            if len(source_kinds) == 1:
                shared_source_kind = next(iter(source_kinds))
                registrations = self._prepare_registration_batch(
                    studio,
                    {
                        slot_id: candidate.notes
                        for slot_id, candidate in unique_candidates_by_slot.items()
                    },
                    source_kind=shared_source_kind,
                )
            else:
                registrations = {
                    slot_id: self._prepare_registration_notes(
                        studio,
                        slot_id,
                        source_kind=candidate.source_kind,
                        notes=candidate.notes,
                    )
                    for slot_id, candidate in unique_candidates_by_slot.items()
                }
            for slot_id, candidate in unique_candidates_by_slot.items():
                track = self._find_track(studio, slot_id)
                registration = registrations[slot_id]
                mark_candidate_approved(
                    candidate,
                    notes=registration.notes,
                    registration_diagnostics=registration.diagnostics,
                    timestamp=timestamp,
                )
                _register_track_material(
                    track,
                    timestamp=timestamp,
                    source_kind=candidate.source_kind,
                    source_label=candidate.source_label,
                    notes=registration.notes,
                    duration_seconds=_track_duration_seconds(registration.notes),
                    registration_diagnostics=registration.diagnostics,
                    audio_source_path=candidate.audio_source_path,
                    audio_source_label=candidate.audio_source_label,
                    audio_mime_type=candidate.audio_mime_type,
                )

            for candidate in duplicate_candidates:
                mark_candidate_rejected(candidate, timestamp=timestamp)

            job.status = "completed"
            job.message = "OMR candidates registered into their suggested tracks."
            job.updated_at = timestamp
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

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
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        target_track = self._find_track(studio, slot_id)
        reference_slot_ids = selected_scoring_reference_slot_ids(
            studio,
            target_slot_id=slot_id,
            requested_reference_slot_ids=request.reference_slot_ids,
        )
        try:
            validate_score_track_request(
                request,
                target_track=target_track,
                reference_slot_ids=reference_slot_ids,
            )
        except ScoringRequestError as error:
            raise HTTPException(status_code=error.status_code, detail=error.detail) from error

        performance_notes = list(request.performance_notes)
        has_submitted_performance = score_track_request_has_performance(request)
        if request.performance_audio_base64 is not None:
            performance_notes = self._extract_scoring_audio(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=request.performance_filename or "scoring-take.wav",
                content_base64=request.performance_audio_base64,
                bpm=studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            )

        if not has_submitted_performance:
            raise HTTPException(
                status_code=422,
                detail="Scoring requires a recorded performance with detectable notes.",
            )

        timestamp = _now()
        report = build_score_track_report(
            studio=studio,
            target_slot_id=slot_id,
            target_track=target_track,
            request=request,
            reference_slot_ids=reference_slot_ids,
            performance_notes=performance_notes,
            created_at=timestamp,
        )

        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            studio.reports.append(report)
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

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
    ) -> list[TrackNote]:
        source_path = self._assets.save_temp_upload(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=content_base64,
        )
        try:
            return self._transcribe_voice_file(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
        except VoiceTranscriptionError:
            return []
        finally:
            self._assets.delete_temp_file(source_path)

    def _update_track(
        self,
        studio_id: str,
        slot_id: int,
        *,
        source_kind: SourceKind,
        source_label: str,
        notes: list[TrackNote],
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            registration = self._prepare_registration_notes(
                studio,
                slot_id,
                source_kind=source_kind,
                notes=notes,
            )
            _register_track_material(
                track,
                timestamp=timestamp,
                source_kind=source_kind,
                source_label=source_label,
                notes=registration.notes,
                duration_seconds=_track_duration_seconds(registration.notes),
                registration_diagnostics=registration.diagnostics,
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
        mapped_notes: dict[int, list[TrackNote]],
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
                mapped_notes,
                source_kind=source_kind,
            )
            for slot_id in mapped_notes:
                track = self._find_track(studio, slot_id)
                registration = registrations[slot_id]
                _register_track_material(
                    track,
                    timestamp=timestamp,
                    source_kind=source_kind,
                    source_label=source_label,
                    notes=registration.notes,
                    duration_seconds=_track_duration_seconds(registration.notes),
                    registration_diagnostics=registration.diagnostics,
                )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _prepare_registration_notes(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackNote],
    ) -> RegistrationNotationResult:
        return self._registration_preparer.prepare_notes(
            studio,
            slot_id,
            source_kind=source_kind,
            notes=notes,
        )

    def _prepare_registration_batch(
        self,
        studio: Studio,
        mapped_notes: dict[int, list[TrackNote]],
        *,
        source_kind: SourceKind,
    ) -> dict[int, RegistrationNotationResult]:
        return self._registration_preparer.prepare_batch(
            studio,
            mapped_notes,
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
        source_path = self._prepare_studio_seed_upload(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=source_content_base64,
            source_asset_path=source_asset_path,
        )
        suffix = source_path.suffix.lower()

        if source_kind == "score" and suffix in SYMBOLIC_SOURCE_SUFFIXES:
            try:
                parsed_symbolic = parse_symbolic_file_with_metadata(source_path, bpm=studio.bpm)
            except SymbolicParseError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            registered_source_kind: SourceKind = "midi" if suffix in {".mid", ".midi"} else "score"
            if parsed_symbolic.has_time_signature:
                studio.time_signature_numerator = parsed_symbolic.time_signature_numerator
                studio.time_signature_denominator = parsed_symbolic.time_signature_denominator
            timestamp = _now()
            registrations = self._prepare_registration_batch(
                studio,
                parsed_symbolic.mapped_notes,
                source_kind=registered_source_kind,
            )
            for slot_id in parsed_symbolic.mapped_notes:
                track = self._find_track(studio, slot_id)
                registration = registrations[slot_id]
                _register_track_material(
                    track,
                    timestamp=timestamp,
                    source_kind=registered_source_kind,
                    source_label=source_filename,
                    notes=registration.notes,
                    duration_seconds=_track_duration_seconds(registration.notes),
                    registration_diagnostics=registration.diagnostics,
                )
            studio.updated_at = timestamp
            return studio

        if source_kind == "music" and suffix in AUDIO_SOURCE_SUFFIXES:
            if suffix != ".wav":
                raise HTTPException(
                    status_code=422,
                    detail="Audio analysis currently supports WAV. MP3/M4A/OGG/FLAC upload is accepted by the UI but still needs a decoder path before analysis can run.",
                )
            try:
                suggested_slot_id, transcription, confidence = extract_home_audio_candidate(
                    studio,
                    source_path,
                    transcribe_with_alignment=self._transcribe_voice_file_with_alignment,
                )
            except VoiceTranscriptionError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            audio_source_path = self._assets.relative_data_asset_path(source_path)
            self._assets.replace_audio_asset_with_aligned_wav(
                relative_audio_path=audio_source_path,
                source_path=source_path,
                source_label=source_filename,
                audio_mime_type=_guess_audio_mime_type(source_filename),
                transcription=transcription,
            )
            self._append_initial_candidate(
                studio,
                suggested_slot_id=suggested_slot_id,
                source_kind="audio",
                source_label=source_filename,
                method="home_voice_transcription_review",
                confidence=confidence,
                notes=transcription.notes,
                message="Audio upload produced a reviewable track candidate.",
                audio_source_path=audio_source_path,
                audio_source_label=source_filename,
                audio_mime_type=_guess_audio_mime_type(source_filename),
            )
            return studio

        raise HTTPException(status_code=422, detail="Unsupported upload processing path.")

    def _prepare_studio_seed_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
        source_asset_path: str | None,
    ) -> Path:
        filename, _suffix = _validated_studio_seed_upload_filename(source_kind, source_filename)
        has_inline_content = bool(source_content_base64)
        has_asset_path = bool(source_asset_path)
        if has_inline_content == has_asset_path:
            raise HTTPException(status_code=422, detail="Upload start requires exactly one source file.")

        if source_asset_path is not None:
            return self._assets.promote_staged_seed_asset(
                studio_id=studio.studio_id,
                filename=filename,
                source_kind=source_kind,
                asset_path=source_asset_path,
            )

        return self._assets.save_upload(
            studio_id=studio.studio_id,
            slot_id=0,
            filename=filename,
            content_base64=source_content_base64 or "",
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
        notes: list[TrackNote],
        message: str,
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
    ) -> None:
        timestamp = _now()
        registration = self._prepare_registration_notes(
            studio,
            suggested_slot_id,
            source_kind=source_kind,
            notes=notes,
        )
        notes = registration.notes
        diagnostics = _candidate_diagnostics(
            suggested_slot_id,
            notes,
            method=method,
            confidence=confidence,
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
            notes=notes,
            source_kind=source_kind,
            source_label=source_label,
            suggested_slot_id=suggested_slot_id,
            updated_at=timestamp,
        )
        studio.candidates.append(candidate)
        track = self._find_track(studio, suggested_slot_id)
        mark_track_needs_review(
            track,
            source_kind=source_kind,
            source_label=source_label,
            timestamp=timestamp,
        )
        studio.updated_at = timestamp

    def _enqueue_omr_job(
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
        timestamp = _now()
        settings = get_settings()
        job = create_omr_extraction_job(
            input_path=self._assets.relative_data_asset_path(source_path),
            max_attempts=settings.engine_job_max_attempts,
            parse_all_parts=parse_all_parts,
            slot_id=slot_id,
            source_kind=source_kind,
            source_label=source_label,
            timestamp=timestamp,
        )

        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            placeholder_tracks = (
                [track for track in studio.tracks if track.slot_id <= 5]
                if parse_all_parts
                else [self._find_track(studio, slot_id)]
            )
            for track in placeholder_tracks:
                if _track_has_content(track):
                    continue
                track.status = "extracting"
                track.source_kind = source_kind
                track.source_label = source_label
                track.updated_at = timestamp
            studio.jobs.append(job)
            studio.updated_at = timestamp
            self._save_studio(studio)

        self._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=omr_queue_payload(job),
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
        self._schedule_engine_queue_processing(background_tasks)
        return studio

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
        settings = get_settings()
        timestamp = _now()
        input_path = self._assets.relative_data_asset_path(source_path)
        audio_mime_type = _guess_audio_mime_type(source_label)
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

        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            track = self._find_track(studio, slot_id)
            if not _track_has_content(track) or not review_before_register:
                track.status = "extracting"
                track.source_kind = source_kind
                track.source_label = source_label
                track.updated_at = timestamp
            studio.jobs.append(job)
            studio.updated_at = timestamp
            self._save_studio(studio)

        self._engine_queue.enqueue(
            engine_queue_job_from_extraction(
                job,
                payload=voice_queue_payload(job),
                studio_id=studio_id,
                timestamp=timestamp,
            )
        )
        self._schedule_engine_queue_processing(background_tasks)
        return studio

    def process_engine_queue_once(self) -> EngineQueueJob | None:
        return self._engine_commands.process_once()

    def _process_omr_queue_record(self, record: EngineQueueJob) -> None:
        settings = get_settings()
        studio = self.get_studio(record.studio_id)
        input_path = self._assets.resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "uploaded-score")
        try:
            result = run_omr_pipeline(
                audiveris_bin=settings.audiveris_bin,
                audiveris_runner=self._run_audiveris_omr,
                backend=settings.omr_backend,
                input_path=input_path,
                job_output_dir=self._job_output_dir(record.studio_id, record.job_id),
                job_slot_id=record.slot_id,
                persist_generated_asset=self._assets.persist_generated_asset,
                record=record,
                source_label=source_label,
                studio=studio,
                timeout_seconds=settings.engine_processing_timeout_seconds,
                vector_parser=parse_born_digital_pdf_score,
            )
        except OmrPipelineError as error:
            self._mark_job_failed(record.studio_id, record.job_id, message=str(error))
            return

        parsed_symbolic = result.parsed_symbolic
        mapped_notes = _mark_notes_as_omr(
            parsed_symbolic.mapped_notes,
            extraction_method=result.extraction_method,
        )
        if not mapped_notes:
            self._mark_job_failed(record.studio_id, record.job_id, message="OMR did not produce any track notes.")
            return

        if parsed_symbolic.has_time_signature:
            self._update_time_signature(
                record.studio_id,
                parsed_symbolic.time_signature_numerator,
                parsed_symbolic.time_signature_denominator,
            )
        self._mark_job_completed(
            record.studio_id,
            record.job_id,
            output_path=result.output_reference,
            method=result.job_method,
        )
        diagnostics_by_slot = _parsed_track_diagnostics_by_slot(
            parsed_symbolic,
            method=result.extraction_method,
            fallback_method=result.candidate_method,
        )
        confidence_by_slot = {
            slot_id: _estimate_candidate_confidence(
                slot_id,
                notes,
                method=result.candidate_method,
                fallback_confidence=result.confidence,
                diagnostics=diagnostics_by_slot.get(slot_id),
            )
            for slot_id, notes in mapped_notes.items()
        }
        message_by_slot = {
            slot_id: _candidate_review_message(
                slot_id,
                notes,
                method=result.candidate_method,
                diagnostics=_candidate_diagnostics(
                    slot_id,
                    notes,
                    method=result.candidate_method,
                    confidence=confidence_by_slot[slot_id],
                    source_diagnostics=diagnostics_by_slot.get(slot_id),
                ),
                default_message=result.message,
            )
            for slot_id, notes in mapped_notes.items()
        }
        self._add_extraction_candidates(
            record.studio_id,
            mapped_notes,
            source_kind="score",
            source_label=source_label,
            method=result.candidate_method,
            confidence=result.confidence,
            confidence_by_slot=confidence_by_slot,
            diagnostics_by_slot=diagnostics_by_slot,
            job_id=record.job_id,
            message=result.message,
            message_by_slot=message_by_slot,
        )

    def _process_voice_queue_record(self, record: EngineQueueJob) -> None:
        studio = self.get_studio(record.studio_id)
        source_path = self._assets.resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "voice.wav")
        review_before_register = bool(record.payload.get("review_before_register"))
        allow_overwrite = bool(record.payload.get("allow_overwrite"))
        audio_mime_type = str(record.payload.get("audio_mime_type") or _guess_audio_mime_type(source_label))
        result = run_voice_pipeline(
            audio_mime_type=audio_mime_type,
            record=record,
            replace_audio_asset_with_aligned_wav=self._assets.replace_audio_asset_with_aligned_wav,
            source_label=source_label,
            source_path=source_path,
            studio=studio,
            transcribe_with_alignment=self._transcribe_voice_file_with_alignment,
        )
        if review_before_register:
            self._add_extraction_candidates(
                record.studio_id,
                {record.slot_id: result.notes},
                source_kind="audio",
                source_label=result.source_label,
                method="voice_transcription_review",
                confidence=min((note.confidence for note in result.notes), default=0.45),
                message="Voice transcription is waiting for user approval.",
                job_id=record.job_id,
                audio_source_path=result.relative_audio_path,
                audio_source_label=result.source_label,
                audio_mime_type=result.audio_mime_type,
            )
            return

        track = self._find_track(studio, record.slot_id)
        if _track_has_content(track) and not allow_overwrite:
            self._mark_job_failed(
                record.studio_id,
                record.job_id,
                message="Upload would overwrite an existing registered track.",
            )
            return
        self._update_track(
            record.studio_id,
            record.slot_id,
            source_kind="audio",
            source_label=result.source_label,
            notes=result.notes,
            audio_source_path=result.relative_audio_path,
            audio_source_label=result.source_label,
            audio_mime_type=result.audio_mime_type,
        )
        self._mark_job_completed(record.studio_id, record.job_id, output_path=result.relative_audio_path)

    def _add_extraction_candidates(
        self,
        studio_id: str,
        mapped_notes: dict[int, list[TrackNote]],
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
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for slot_id, notes in mapped_notes.items():
                registration = self._prepare_registration_notes(
                    studio,
                    slot_id,
                    source_kind=source_kind,
                    notes=notes,
                )
                notes = registration.notes
                source_diagnostics = (diagnostics_by_slot or {}).get(slot_id)
                slot_confidence = (
                    confidence_by_slot.get(slot_id)
                    if confidence_by_slot and slot_id in confidence_by_slot
                    else _estimate_candidate_confidence(
                        slot_id,
                        notes,
                        method=method,
                        fallback_confidence=confidence,
                        diagnostics=source_diagnostics,
                    )
                )
                slot_diagnostics = _candidate_diagnostics(
                    slot_id,
                    notes,
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
                        _candidate_review_message(
                            slot_id,
                            notes,
                            method=method,
                            diagnostics=slot_diagnostics,
                            default_message=message,
                        ),
                    ),
                    method=method,
                    notes=notes,
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
                track = self._find_track(studio, slot_id)
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
                        clear_unmapped_omr_placeholders(
                            studio,
                            job,
                            mapped_slot_ids=set(mapped_notes),
                            timestamp=timestamp,
                        )
                    break
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _add_generation_candidates(
        self,
        studio_id: str,
        slot_id: int,
        candidate_notes: list[list[TrackNote]],
        *,
        source_label: str,
        method: str,
        message: str,
        llm_plan: DeepSeekHarmonyPlan | None = None,
    ) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            candidate_group_id = uuid4().hex
            for index, notes in enumerate(candidate_notes, start=1):
                registration = self._prepare_registration_notes(
                    studio,
                    slot_id,
                    source_kind="ai",
                    notes=notes,
                )
                notes = registration.notes
                confidence = min((note.confidence for note in notes), default=0.65)
                diagnostics, variant_label = generation_candidate_review_metadata(
                    slot_id=slot_id,
                    notes=notes,
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
                    notes=notes,
                    source_kind="ai",
                    source_label=source_label,
                    suggested_slot_id=slot_id,
                    updated_at=timestamp,
                    variant_label=variant_label,
                )
                studio.candidates.append(candidate)

            track = self._find_track(studio, slot_id)
            mark_track_needs_review_if_empty(
                track,
                source_kind="ai",
                source_label=source_label,
                timestamp=timestamp,
            )
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

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

    def _mapped_notes_would_overwrite(
        self,
        studio: Studio,
        mapped_notes: dict[int, list[TrackNote]],
    ) -> bool:
        return any(_track_has_content(self._find_track(studio, slot_id)) for slot_id in mapped_notes)

    def _transcribe_voice_file(
        self,
        source_path: Path,
        *,
        bpm: int,
        slot_id: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
    ) -> list[TrackNote]:
        with _engine_execution_lock:
            return transcribe_voice_file(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )

    def _transcribe_voice_file_with_alignment(
        self,
        source_path: Path,
        *,
        bpm: int,
        slot_id: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
    ) -> VoiceTranscriptionResult:
        with _engine_execution_lock:
            if transcribe_voice_file is not _ORIGINAL_TRANSCRIBE_VOICE_FILE:
                return VoiceTranscriptionResult(
                    notes=transcribe_voice_file(
                        source_path,
                        bpm=bpm,
                        slot_id=slot_id,
                        time_signature_numerator=time_signature_numerator,
                        time_signature_denominator=time_signature_denominator,
                    ),
                    alignment=NO_METRONOME_ALIGNMENT,
                )
            return transcribe_voice_file_with_alignment(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )

    def _run_audiveris_omr(
        self,
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        with _engine_execution_lock:
            return run_audiveris_omr(
                input_path=input_path,
                output_dir=output_dir,
                audiveris_bin=audiveris_bin,
                timeout_seconds=timeout_seconds,
            )

    def _job_output_dir(self, studio_id: str, job_id: str) -> Path:
        return self._root / "jobs" / studio_id / job_id

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
