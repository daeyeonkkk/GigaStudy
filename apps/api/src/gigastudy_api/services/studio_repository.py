from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock, RLock
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.admin import (
    AdminAssetSummary,
    AdminDeleteResult,
    AdminEngineDrainResult,
    AdminLimitSummary,
    AdminStorageSummary,
    AdminStudioSummary,
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
    SourceKind,
    Studio,
    StudioListItem,
    StudioSeedUploadRequest,
    SyncTrackRequest,
    TrackExtractionJob,
    TrackNote,
    TrackSlot,
    UploadTrackRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.services.asset_storage import (
    AssetStorage,
    AssetStorageError,
    build_asset_storage,
)
from gigastudy_api.services.asset_registry import AssetRecord, AssetRegistry, build_asset_registry
from gigastudy_api.services.engine.arrangement import prepare_ensemble_registration
from gigastudy_api.services.engine.harmony import generate_rule_based_harmony_candidates
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    TRACKS,
    infer_slot_id,
    midi_to_label,
    seconds_per_beat,
    track_name,
)
from gigastudy_api.services.engine.omr import OmrUnavailableError, run_audiveris_omr
from gigastudy_api.services.engine.notation import annotate_track_notes_for_slot
from gigastudy_api.services.engine.notation_quality import (
    RegistrationNotationResult,
    apply_notation_review_instruction,
    prepare_notes_for_track_registration,
)
from gigastudy_api.services.engine.pdf_vector_omr import (
    PdfVectorOmrError,
    parse_born_digital_pdf_score,
)
from gigastudy_api.services.engine.pdf_export import ScorePdfExportError, build_studio_score_pdf
from gigastudy_api.services.engine.scoring import build_harmony_scoring_report, build_scoring_report
from gigastudy_api.services.engine.score_preview import ScorePreviewError, render_score_source_preview
from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine.voice import VoiceTranscriptionError, transcribe_voice_file
from gigastudy_api.services.engine_queue import EngineQueueJob, EngineQueueStore, build_engine_queue_store
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan, plan_harmony_with_deepseek
from gigastudy_api.services.llm.notation_review import (
    review_ensemble_registration_with_deepseek,
    review_notation_with_deepseek,
)
from gigastudy_api.services.studio_store import StudioStore, build_studio_store


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _empty_tracks(timestamp: str) -> list[TrackSlot]:
    return [
        TrackSlot(
            slot_id=slot_id,
            name=name,
            status="empty",
            updated_at=timestamp,
        )
        for slot_id, name in TRACKS
    ]


DEFAULT_UPLOAD_BPM = 92
OMR_SOURCE_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
SYMBOLIC_SOURCE_SUFFIXES = {".musicxml", ".xml", ".mxl", ".mid", ".midi"}
AUDIO_SOURCE_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".flac"}
TRACK_UPLOAD_SUFFIXES = {
    "audio": tuple(AUDIO_SOURCE_SUFFIXES),
    "midi": (".mid", ".midi"),
    "score": tuple(SYMBOLIC_SOURCE_SUFFIXES | OMR_SOURCE_SUFFIXES),
}
STUDIO_SEED_UPLOAD_SUFFIXES = {
    "score": tuple(SYMBOLIC_SOURCE_SUFFIXES | OMR_SOURCE_SUFFIXES),
    "music": tuple(AUDIO_SOURCE_SUFFIXES),
}
AUDIO_MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}
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
            self._asset_storage: AssetStorage = build_asset_storage(
                storage_root=self._root,
                settings=settings,
            )
        except AssetStorageError as error:
            raise RuntimeError(str(error)) from error
        self._asset_registry: AssetRegistry = build_asset_registry(
            storage_root=self._root,
            database_url=settings.database_url,
        )
        self._engine_queue: EngineQueueStore = build_engine_queue_store(
            storage_root=self._root,
            database_url=settings.database_url,
        )
        self._last_lifecycle_cleanup_at: datetime | None = None
        self._lock = RLock()

    def list_studios(self, *, limit: int = 50, offset: int = 0) -> list[StudioListItem]:
        with self._lock:
            rows = self._store.list_summary_raw(limit=limit, offset=offset)
        return [_studio_list_item_from_payload(studio_id, studio_payload) for studio_id, studio_payload in rows]

    def list_accessible_studios(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        owner_token: str | None = None,
    ) -> list[StudioListItem]:
        owner_hash = self._owner_hash_for_request(owner_token, allow_missing=True)
        if self._owner_policy_enabled() and owner_hash is None:
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
        self._ensure_studio_capacity()
        owner_hash = self._owner_hash_for_request(owner_token)
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
            if self._should_start_omr_job(
                source_kind=source_kind,
                source_filename=source_label,
            ):
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
            self._require_studio_access(studio, owner_token)
        self._ensure_queue_records_for_active_jobs(studio)
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

        source_path = self._resolve_data_asset_path(track.audio_source_path)
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

        source_path = self._resolve_data_asset_path(job.input_path)
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
        with self._lock:
            studio_count = self._count_studios()
            studios = self._list_studios(limit=studio_limit, offset=studio_offset)

        studio_summaries = [
            self._build_admin_studio_summary(
                studio,
                asset_limit=asset_limit,
                asset_offset=asset_offset,
            )
            for studio in studios
        ]
        metadata_bytes = self._store.estimate_total_bytes()
        asset_count, asset_bytes = self._asset_registry.summarize_all()
        listed_asset_count = sum(len(studio.assets) for studio in studio_summaries)
        return AdminStorageSummary(
            storage_root=self._asset_storage.label,
            studio_count=studio_count,
            listed_studio_count=len(studio_summaries),
            studio_limit=studio_limit,
            studio_offset=studio_offset,
            has_more_studios=studio_offset + len(studio_summaries) < studio_count,
            asset_limit=asset_limit,
            asset_offset=asset_offset,
            asset_count=asset_count,
            listed_asset_count=listed_asset_count,
            total_asset_bytes=asset_bytes,
            total_bytes=metadata_bytes + asset_bytes,
            metadata_bytes=metadata_bytes,
            limits=self._build_admin_limit_summary(
                studio_count=studio_count,
                asset_bytes=asset_bytes,
            ),
            studios=studio_summaries,
        )

    def delete_admin_studio(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            if not self._delete_studio(studio_id):
                raise HTTPException(status_code=404, detail="Studio not found.")

        self._engine_queue.delete_studio_jobs(studio_id)
        upload_files, upload_bytes = self._delete_asset_prefix(f"uploads/{studio_id}/")
        job_files, job_bytes = self._delete_asset_prefix(f"jobs/{studio_id}/")
        deleted_files = upload_files + job_files
        deleted_bytes = upload_bytes + job_bytes
        return AdminDeleteResult(
            deleted=True,
            message="Studio and stored assets deleted.",
            studio_id=studio_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_admin_studio_assets(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            self._clear_studio_asset_references(studio, timestamp)
            studio.updated_at = timestamp
            self._save_studio(studio)

        upload_files, upload_bytes = self._delete_asset_prefix(f"uploads/{studio_id}/")
        job_files, job_bytes = self._delete_asset_prefix(f"jobs/{studio_id}/")
        deleted_files = upload_files + job_files
        deleted_bytes = upload_bytes + job_bytes
        return AdminDeleteResult(
            deleted=True,
            message="Studio assets deleted. Normalized track notes and reports were kept.",
            studio_id=studio_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_admin_staged_assets(self) -> AdminDeleteResult:
        deleted_files, deleted_bytes = self._delete_asset_prefix("staged/")
        return AdminDeleteResult(
            deleted=True,
            message="Abandoned staged upload assets deleted.",
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_admin_expired_staged_assets(self) -> AdminDeleteResult:
        deleted_files, deleted_bytes = self._delete_expired_staged_uploads()
        return AdminDeleteResult(
            deleted=True,
            message="Expired staged upload assets deleted.",
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_admin_asset(self, asset_id: str) -> AdminDeleteResult:
        relative_path = self._decode_asset_id(asset_id)
        deleted_files, deleted_bytes = self._delete_asset_file(relative_path)
        if deleted_files == 0:
            raise HTTPException(status_code=404, detail="Asset not found.")

        with self._lock:
            studio_id = _studio_id_from_asset_path(relative_path)
            timestamp = _now()
            if studio_id is not None:
                studio = self._load_studio(studio_id)
                if studio is not None and self._clear_asset_references(studio, relative_path, timestamp):
                    studio.updated_at = timestamp
                    self._save_studio(studio)

        return AdminDeleteResult(
            deleted=True,
            message="Asset deleted.",
            studio_id=studio_id,
            asset_id=asset_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def create_studio_upload_target(
        self,
        request: StudioSeedUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        self._owner_hash_for_request(owner_token)
        self._cleanup_expired_staged_uploads_if_due()
        filename, _suffix = _validated_studio_seed_upload_filename(request.source_kind, request.filename)
        settings = get_settings()
        if request.size_bytes > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {settings.max_upload_bytes} byte limit.",
            )
        self._ensure_asset_capacity(request.size_bytes)
        try:
            upload_info = self._asset_storage.create_staged_upload(
                filename=filename,
                content_type=request.content_type,
                expires_in_seconds=settings.direct_upload_expiration_seconds,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        return DirectUploadTarget(
            asset_id=self._encode_asset_id(upload_info.relative_path),
            asset_path=upload_info.relative_path,
            upload_url=upload_info.upload_url or "",
            method="PUT",
            headers=upload_info.headers,
            expires_at=upload_info.expires_at,
            max_bytes=settings.max_upload_bytes,
        )

    def create_track_upload_target(
        self,
        studio_id: str,
        slot_id: int,
        request: DirectUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        self._cleanup_expired_staged_uploads_if_due()
        studio = self.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._find_track(studio, slot_id)
        filename, _suffix = _validated_track_upload_filename(request.source_kind, request.filename)
        settings = get_settings()
        if request.size_bytes > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {settings.max_upload_bytes} byte limit.",
            )
        self._ensure_asset_capacity(request.size_bytes)
        try:
            upload_info = self._asset_storage.create_direct_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content_type=request.content_type,
                expires_in_seconds=settings.direct_upload_expiration_seconds,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        return DirectUploadTarget(
            asset_id=self._encode_asset_id(upload_info.relative_path),
            asset_path=upload_info.relative_path,
            upload_url=upload_info.upload_url or "",
            method="PUT",
            headers=upload_info.headers,
            expires_at=upload_info.expires_at,
            max_bytes=settings.max_upload_bytes,
        )

    def write_direct_upload_content(self, asset_id: str, content: bytes) -> dict[str, int | str]:
        relative_path = self._decode_asset_id(asset_id)
        upload_owner = _track_upload_owner_from_path(relative_path)
        is_staged_upload = _is_staged_upload_path(relative_path)
        if upload_owner is None and not is_staged_upload:
            raise HTTPException(status_code=404, detail="Upload target not found.")
        if upload_owner is not None:
            studio_id, slot_id = upload_owner
            studio = self.get_studio(studio_id)
            self._find_track(studio, slot_id)
        max_upload_bytes = get_settings().max_upload_bytes
        if len(content) > max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
            )
        self._ensure_asset_capacity(len(content))
        try:
            self._asset_storage.write_direct_upload(relative_path=relative_path, content=content)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error
        return {"asset_path": relative_path, "size_bytes": len(content)}

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
            source_path = self._resolve_existing_upload_asset(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                asset_path=request.asset_path,
            )
        else:
            source_path = self._save_upload(
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
        registered_tracks = [track for track in studio.tracks if track.status == "registered"]
        context_slot_ids = request.context_slot_ids or [track.slot_id for track in registered_tracks]
        context_notes = [
            note
            for track in registered_tracks
            if track.slot_id in context_slot_ids and track.slot_id != slot_id
            for note in track.notes
        ]
        context_notes_by_slot = {
            track.slot_id: track.notes
            for track in registered_tracks
            if track.slot_id in context_slot_ids and track.slot_id != slot_id
        }
        if not context_notes:
            raise HTTPException(
                status_code=409,
                detail="AI generation requires at least one registered context track.",
            )

        llm_plan = plan_harmony_with_deepseek(
            settings=get_settings(),
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            target_slot_id=slot_id,
            context_notes_by_slot=context_notes_by_slot,
            candidate_count=request.candidate_count,
        )
        candidate_notes = generate_rule_based_harmony_candidates(
            target_slot_id=slot_id,
            context_tracks=context_notes,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            context_notes_by_slot=context_notes_by_slot,
            candidate_count=request.candidate_count,
            profile_names=llm_plan.profile_names() if llm_plan is not None else None,
            harmony_plan=llm_plan,
        )
        if not candidate_notes:
            raise HTTPException(status_code=409, detail="No harmony notes could be generated.")

        label = "Generated percussion groove" if slot_id == 6 else "Voice-leading harmony score"
        method = (
            "rule_based_percussion_candidates_v0"
            if slot_id == 6
            else (
                "deepseek_v4_flash_guided_voice_leading_candidates_v1"
                if llm_plan is not None
                else "rule_based_voice_leading_candidates_v1"
            )
        )
        message = (
            "DeepSeek V4 Flash planned candidate directions; deterministic engine generated valid TrackNote candidates."
            if llm_plan is not None
            else "AI generated multiple candidates. Approve one candidate to register it."
        )
        if request.review_before_register:
            return self._add_generation_candidates(
                studio_id,
                slot_id,
                candidate_notes,
                source_label=label,
                method=method,
                message=message,
                llm_plan=llm_plan,
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
            source_label=label,
            notes=candidate_notes[0],
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
            self._require_studio_access(studio, owner_token)
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            track.sync_offset_seconds = round(request.sync_offset_seconds, 2)
            track.updated_at = timestamp
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
            studio.time_signature_numerator = numerator
            studio.time_signature_denominator = denominator
            studio.updated_at = timestamp
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
            self._require_studio_access(studio, owner_token)
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
            candidate.status = "approved"
            candidate.notes = registration.notes
            candidate.diagnostics = {
                **candidate.diagnostics,
                "registration_quality": registration.diagnostics,
            }
            candidate.updated_at = timestamp
            track.status = "registered"
            track.source_kind = candidate.source_kind
            track.source_label = candidate.source_label
            track.audio_source_path = candidate.audio_source_path
            track.audio_source_label = candidate.audio_source_label
            track.audio_mime_type = candidate.audio_mime_type
            track.duration_seconds = _track_duration_seconds(registration.notes)
            track.notes = registration.notes
            track.diagnostics = {"registration_quality": registration.diagnostics}
            track.updated_at = timestamp
            if target_slot_id != candidate.suggested_slot_id:
                self._release_review_track_if_empty(
                    studio,
                    candidate.suggested_slot_id,
                    candidate.candidate_id,
                    timestamp,
                )
            if candidate.candidate_group_id is not None:
                for sibling in studio.candidates:
                    if (
                        sibling.candidate_group_id == candidate.candidate_group_id
                        and sibling.candidate_id != candidate.candidate_id
                        and sibling.status == "pending"
                    ):
                        sibling.status = "rejected"
                        sibling.updated_at = timestamp
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
            self._require_studio_access(studio, owner_token)
            timestamp = _now()
            candidate = self._find_candidate(studio, candidate_id)
            if candidate.status != "pending":
                raise HTTPException(status_code=409, detail="Only pending candidates can be rejected.")
            candidate.status = "rejected"
            candidate.updated_at = timestamp
            self._release_review_track_if_empty(
                studio,
                candidate.suggested_slot_id,
                candidate.candidate_id,
                timestamp,
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
            self._require_studio_access(studio, owner_token)

            job = next((candidate_job for candidate_job in studio.jobs if candidate_job.job_id == job_id), None)
            if job is None:
                raise HTTPException(status_code=404, detail="Extraction job not found.")

            pending_candidates = [
                candidate
                for candidate in studio.candidates
                if candidate.job_id == job_id and candidate.status == "pending"
            ]
            if not pending_candidates:
                raise HTTPException(status_code=409, detail="No pending candidates are waiting for this job.")

            unique_candidates_by_slot: dict[int, ExtractionCandidate] = {}
            duplicate_candidates: list[ExtractionCandidate] = []
            for candidate in pending_candidates:
                if candidate.suggested_slot_id in unique_candidates_by_slot:
                    duplicate_candidates.append(candidate)
                    continue
                unique_candidates_by_slot[candidate.suggested_slot_id] = candidate

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
                candidate.status = "approved"
                candidate.notes = registration.notes
                candidate.diagnostics = {
                    **candidate.diagnostics,
                    "registration_quality": registration.diagnostics,
                }
                candidate.updated_at = timestamp
                track.status = "registered"
                track.source_kind = candidate.source_kind
                track.source_label = candidate.source_label
                track.audio_source_path = candidate.audio_source_path
                track.audio_source_label = candidate.audio_source_label
                track.audio_mime_type = candidate.audio_mime_type
                track.duration_seconds = _track_duration_seconds(registration.notes)
                track.notes = registration.notes
                track.diagnostics = {"registration_quality": registration.diagnostics}
                track.updated_at = timestamp

            for candidate in duplicate_candidates:
                candidate.status = "rejected"
                candidate.updated_at = timestamp

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
            self._require_studio_access(studio, owner_token)
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

        self._enqueue_existing_extraction_job(studio_id, job_id)
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
        if request.score_mode == "answer" and (target_track.status != "registered" or not target_track.notes):
            raise HTTPException(status_code=409, detail="Scoring requires a registered answer track.")

        valid_reference_ids = {
            track.slot_id for track in studio.tracks if track.status == "registered"
        }
        reference_slot_ids = [
            reference_id
            for reference_id in request.reference_slot_ids
            if reference_id in valid_reference_ids and reference_id != slot_id
        ]
        if request.score_mode == "answer" and not reference_slot_ids and not request.include_metronome:
            raise HTTPException(
                status_code=422,
                detail="Choose at least one reference track or the metronome.",
            )
        if request.score_mode == "harmony" and not reference_slot_ids:
            raise HTTPException(
                status_code=422,
                detail="Harmony scoring requires at least one registered reference track.",
            )

        performance_notes = list(request.performance_notes)
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

        timestamp = _now()
        if request.score_mode == "harmony":
            reference_tracks_by_slot = {
                track.slot_id: _notes_with_sync_offset(
                    track.notes,
                    track.sync_offset_seconds,
                    studio.bpm,
                    voice_index=track.slot_id,
                )
                for track in studio.tracks
                if track.slot_id in reference_slot_ids
            }
            report = build_harmony_scoring_report(
                target_slot_id=slot_id,
                target_track_name=target_track.name,
                reference_slot_ids=reference_slot_ids,
                include_metronome=request.include_metronome,
                created_at=timestamp,
                reference_tracks_by_slot=reference_tracks_by_slot,
                performance_notes=performance_notes,
                bpm=studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            )
        else:
            report = build_scoring_report(
                target_slot_id=slot_id,
                target_track_name=target_track.name,
                reference_slot_ids=reference_slot_ids,
                include_metronome=request.include_metronome,
                created_at=timestamp,
                answer_notes=target_track.notes,
                performance_notes=performance_notes,
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
        settings = get_settings()
        job_limit = max(1, min(max_jobs or settings.engine_drain_max_jobs, 20))
        processed = 0
        messages: list[str] = []
        for _ in range(job_limit):
            record = self.process_engine_queue_once()
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
        source_path = self._save_temp_upload(
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
            self._delete_temp_file(source_path)

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
            track.status = "registered"
            track.source_kind = source_kind
            track.source_label = source_label
            track.audio_source_path = audio_source_path
            track.audio_source_label = audio_source_label
            track.audio_mime_type = audio_mime_type
            track.duration_seconds = _track_duration_seconds(registration.notes)
            track.notes = registration.notes
            track.diagnostics = {"registration_quality": registration.diagnostics}
            track.updated_at = timestamp
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
                track.status = "registered"
                track.source_kind = source_kind
                track.source_label = source_label
                track.audio_source_path = None
                track.audio_source_label = None
                track.audio_mime_type = None
                track.duration_seconds = _track_duration_seconds(registration.notes)
                track.notes = registration.notes
                track.diagnostics = {"registration_quality": registration.diagnostics}
                track.updated_at = timestamp
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
        registration = self._prepare_single_track_notation(
            studio,
            slot_id,
            source_kind=source_kind,
            notes=notes,
        )
        return self._apply_ensemble_arrangement_gate(
            studio,
            slot_id,
            registration,
            source_kind=source_kind,
        )

    def _prepare_registration_batch(
        self,
        studio: Studio,
        mapped_notes: dict[int, list[TrackNote]],
        *,
        source_kind: SourceKind,
    ) -> dict[int, RegistrationNotationResult]:
        first_pass = {
            slot_id: self._prepare_single_track_notation(
                studio,
                slot_id,
                source_kind=source_kind,
                notes=notes,
            )
            for slot_id, notes in mapped_notes.items()
        }
        proposed_tracks_by_slot = {
            slot_id: registration.notes
            for slot_id, registration in first_pass.items()
        }
        return {
            slot_id: self._apply_ensemble_arrangement_gate(
                studio,
                slot_id,
                registration,
                source_kind=source_kind,
                proposed_tracks_by_slot=proposed_tracks_by_slot,
            )
            for slot_id, registration in first_pass.items()
        }

    def _prepare_single_track_notation(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackNote],
    ) -> RegistrationNotationResult:
        reference_tracks = self._registration_reference_tracks(studio, exclude_slot_id=slot_id)
        reference_tracks_by_slot = self._registration_reference_tracks_by_slot(studio, exclude_slot_id=slot_id)
        registration = prepare_notes_for_track_registration(
            notes,
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            reference_tracks=reference_tracks,
        )
        settings = get_settings()
        instruction = review_notation_with_deepseek(
            settings=settings,
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            slot_id=slot_id,
            source_kind=source_kind,
            original_notes=notes,
            prepared_notes=registration.notes,
            diagnostics=registration.diagnostics,
            context_tracks_by_slot=reference_tracks_by_slot,
        )
        if instruction is None:
            return registration
        reviewed_registration = apply_notation_review_instruction(
            notes,
            instruction=instruction.model_dump(exclude_none=True),
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            baseline_result=registration,
            reference_tracks=reference_tracks,
        )
        return reviewed_registration

    def _apply_ensemble_arrangement_gate(
        self,
        studio: Studio,
        slot_id: int,
        registration: RegistrationNotationResult,
        *,
        source_kind: SourceKind,
        proposed_tracks_by_slot: dict[int, list[TrackNote]] | None = None,
    ) -> RegistrationNotationResult:
        existing_tracks_by_slot = {
            track.slot_id: track.notes
            for track in studio.tracks
            if track.slot_id != slot_id
            and track.status == "registered"
            and track.notes
        }
        if proposed_tracks_by_slot:
            existing_tracks_by_slot.update(
                {
                    proposed_slot_id: proposed_notes
                    for proposed_slot_id, proposed_notes in proposed_tracks_by_slot.items()
                    if proposed_slot_id != slot_id and proposed_notes
                }
            )
        ensemble_result = prepare_ensemble_registration(
            target_slot_id=slot_id,
            candidate_notes=registration.notes,
            existing_tracks_by_slot=existing_tracks_by_slot,
            bpm=studio.bpm,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        ensemble_registration = RegistrationNotationResult(
            notes=ensemble_result.notes,
            diagnostics={
                **registration.diagnostics,
                "ensemble_arrangement": ensemble_result.diagnostics,
            },
        )
        settings = get_settings()
        instruction = review_ensemble_registration_with_deepseek(
            settings=settings,
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            slot_id=slot_id,
            source_kind=source_kind,
            original_notes=registration.notes,
            prepared_notes=ensemble_registration.notes,
            diagnostics=ensemble_registration.diagnostics,
            context_tracks_by_slot=existing_tracks_by_slot,
            proposed_tracks_by_slot=proposed_tracks_by_slot,
        )
        if instruction is None:
            return ensemble_registration

        reviewed_registration = apply_notation_review_instruction(
            ensemble_registration.notes,
            instruction=instruction.model_dump(exclude_none=True),
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            baseline_result=ensemble_registration,
            reference_tracks=list(existing_tracks_by_slot.values()),
        )
        reviewed_ensemble_result = prepare_ensemble_registration(
            target_slot_id=slot_id,
            candidate_notes=reviewed_registration.notes,
            existing_tracks_by_slot=existing_tracks_by_slot,
            bpm=studio.bpm,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        return RegistrationNotationResult(
            notes=reviewed_ensemble_result.notes,
            diagnostics={
                **reviewed_registration.diagnostics,
                "ensemble_arrangement": reviewed_ensemble_result.diagnostics,
                "pre_ensemble_llm_registration_quality": ensemble_registration.diagnostics,
            },
        )

    def _registration_reference_tracks(
        self,
        studio: Studio,
        *,
        exclude_slot_id: int,
    ) -> list[list[TrackNote]]:
        return [
            track.notes
            for track in studio.tracks
            if track.slot_id != exclude_slot_id
            and track.status == "registered"
            and track.notes
        ]

    def _registration_reference_tracks_by_slot(
        self,
        studio: Studio,
        *,
        exclude_slot_id: int,
    ) -> dict[int, list[TrackNote]]:
        return {
            track.slot_id: track.notes
            for track in studio.tracks
            if track.slot_id != exclude_slot_id
            and track.status == "registered"
            and track.notes
        }

    def _should_start_omr_job(
        self,
        *,
        source_kind: SeedSourceKind,
        source_filename: str | None,
    ) -> bool:
        if source_kind != "score" or source_filename is None:
            return False
        return Path(source_filename).suffix.lower() in OMR_SOURCE_SUFFIXES

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
                track.status = "registered"
                track.source_kind = registered_source_kind
                track.source_label = source_filename
                track.duration_seconds = _track_duration_seconds(registration.notes)
                track.notes = registration.notes
                track.diagnostics = {"registration_quality": registration.diagnostics}
                track.updated_at = timestamp
            studio.updated_at = timestamp
            return studio

        if source_kind == "music" and suffix in AUDIO_SOURCE_SUFFIXES:
            if suffix != ".wav":
                raise HTTPException(
                    status_code=422,
                    detail="Audio analysis currently supports WAV. MP3/M4A/OGG/FLAC upload is accepted by the UI but still needs a decoder path before analysis can run.",
                )
            try:
                suggested_slot_id, notes, confidence = self._extract_home_audio_candidate(studio, source_path)
            except VoiceTranscriptionError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            self._append_initial_candidate(
                studio,
                suggested_slot_id=suggested_slot_id,
                source_kind="audio",
                source_label=source_filename,
                method="home_voice_transcription_review",
                confidence=confidence,
                notes=notes,
                message="Audio upload produced a reviewable track candidate.",
                audio_source_path=self._relative_data_asset_path(source_path),
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
            return self._promote_staged_seed_asset(
                studio_id=studio.studio_id,
                filename=filename,
                source_kind=source_kind,
                asset_path=source_asset_path,
            )

        return self._save_upload(
            studio_id=studio.studio_id,
            slot_id=0,
            filename=filename,
            content_base64=source_content_base64 or "",
        )

    def _extract_home_audio_candidate(self, studio: Studio, source_path: Path) -> tuple[int, list[TrackNote], float]:
        attempts: list[tuple[int, list[TrackNote], float]] = []
        errors: list[str] = []
        for slot_id, _track_name in TRACKS:
            if slot_id == 6:
                continue
            try:
                notes = self._transcribe_voice_file(
                    source_path,
                    bpm=studio.bpm,
                    slot_id=slot_id,
                    time_signature_numerator=studio.time_signature_numerator,
                    time_signature_denominator=studio.time_signature_denominator,
                )
            except VoiceTranscriptionError as error:
                errors.append(str(error))
                continue
            confidence = sum(note.confidence for note in notes) / len(notes)
            attempts.append((slot_id, notes, confidence))

        if not attempts:
            detail = errors[0] if errors else "No usable audio notes were extracted."
            raise VoiceTranscriptionError(detail)

        source_slot_id, notes, confidence = max(attempts, key=lambda attempt: (len(attempt[1]), attempt[2]))
        suggested_slot_id = infer_slot_id(None, notes, fallback=source_slot_id)
        return suggested_slot_id, annotate_track_notes_for_slot(notes, slot_id=suggested_slot_id), confidence

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
        diagnostics["registration_quality"] = registration.diagnostics
        candidate = ExtractionCandidate(
            candidate_id=uuid4().hex,
            suggested_slot_id=suggested_slot_id,
            source_kind=source_kind,
            source_label=source_label,
            method=method,
            confidence=confidence,
            notes=notes,
            audio_source_path=audio_source_path,
            audio_source_label=audio_source_label,
            audio_mime_type=audio_mime_type,
            message=message,
            diagnostics=diagnostics,
            created_at=timestamp,
            updated_at=timestamp,
        )
        studio.candidates.append(candidate)
        track = self._find_track(studio, suggested_slot_id)
        track.status = "needs_review"
        track.source_kind = source_kind
        track.source_label = source_label
        track.updated_at = timestamp
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
        job = TrackExtractionJob(
            job_id=uuid4().hex,
            job_type="omr",
            slot_id=slot_id,
            source_kind=source_kind,
            source_label=source_label,
            status="queued",
            method="audiveris_cli",
            input_path=self._relative_data_asset_path(source_path),
            max_attempts=settings.engine_job_max_attempts,
            parse_all_parts=parse_all_parts,
            created_at=timestamp,
            updated_at=timestamp,
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
            EngineQueueJob(
                job_id=job.job_id,
                studio_id=studio_id,
                slot_id=slot_id,
                job_type="omr",
                status="queued",
                payload={
                    "input_path": job.input_path,
                    "source_kind": source_kind,
                    "source_label": source_label,
                    "parse_all_parts": parse_all_parts,
                },
                attempt_count=0,
                max_attempts=settings.engine_job_max_attempts,
                locked_until=None,
                message=None,
                created_at=timestamp,
                updated_at=timestamp,
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
        input_path = self._relative_data_asset_path(source_path)
        audio_mime_type = _guess_audio_mime_type(source_label)
        job = TrackExtractionJob(
            job_id=uuid4().hex,
            job_type="voice",
            slot_id=slot_id,
            source_kind=source_kind,
            source_label=source_label,
            status="queued",
            method="voice_transcription",
            message="Voice extraction queued.",
            input_path=input_path,
            max_attempts=settings.engine_job_max_attempts,
            review_before_register=review_before_register,
            allow_overwrite=allow_overwrite,
            audio_mime_type=audio_mime_type,
            created_at=timestamp,
            updated_at=timestamp,
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
            EngineQueueJob(
                job_id=job.job_id,
                studio_id=studio_id,
                slot_id=slot_id,
                job_type="voice",
                status="queued",
                payload={
                    "input_path": input_path,
                    "source_kind": source_kind,
                    "source_label": source_label,
                    "review_before_register": review_before_register,
                    "allow_overwrite": allow_overwrite,
                    "audio_mime_type": audio_mime_type,
                },
                attempt_count=0,
                max_attempts=settings.engine_job_max_attempts,
                locked_until=None,
                message=None,
                created_at=timestamp,
                updated_at=timestamp,
            )
        )
        self._schedule_engine_queue_processing(background_tasks)
        return studio

    def process_engine_queue_once(self) -> EngineQueueJob | None:
        settings = get_settings()
        record = self._engine_queue.claim_next(
            max_active=settings.max_active_engine_jobs,
            lease_seconds=settings.engine_job_lease_seconds,
        )
        if record is None:
            return None

        self._mark_job_running(
            record.studio_id,
            record.job_id,
            attempt_count=record.attempt_count,
            max_attempts=record.max_attempts,
        )
        try:
            if record.job_type == "omr":
                self._process_omr_queue_record(record)
            elif record.job_type == "voice":
                self._process_voice_queue_record(record)
            else:
                raise RuntimeError(f"Unsupported engine job type: {record.job_type}")
        except Exception as error:
            message = str(error) or "Engine job failed."
            self._mark_job_failed(record.studio_id, record.job_id, message=message)
            self._engine_queue.fail(record.job_id, message=message)
            return record

        refreshed = self.get_studio(record.studio_id)
        final_status = next((job.status for job in refreshed.jobs if job.job_id == record.job_id), None)
        if final_status == "failed":
            failed_job = next((job for job in refreshed.jobs if job.job_id == record.job_id), None)
            self._engine_queue.fail(record.job_id, message=failed_job.message or "Engine job failed.")
        else:
            self._engine_queue.complete(record.job_id)
        return record

    def _process_omr_queue_record(self, record: EngineQueueJob) -> None:
        settings = get_settings()
        studio = self.get_studio(record.studio_id)
        input_path = self._resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "uploaded-score")
        parse_all_parts = bool(record.payload.get("parse_all_parts"))
        candidate_method = "audiveris_omr_review"
        extraction_method = "audiveris_omr_v0"
        job_method = "audiveris_cli"
        confidence = 0.55
        message = "OMR result requires user approval before track registration."
        omr_backend = settings.omr_backend.strip().lower()
        try:
            if omr_backend in {"pdf_vector", "vector_pdf"}:
                parsed_symbolic, output_path, output_reference = self._run_pdf_vector_omr_fallback(
                    record=record,
                    input_path=input_path,
                    studio=studio,
                    source_label=source_label,
                    primary_error="Audiveris skipped because GIGASTUDY_API_OMR_BACKEND=pdf_vector.",
                )
                candidate_method = "pdf_vector_omr_review"
                extraction_method = "pdf_vector_omr_v0"
                job_method = "pdf_vector_omr"
                confidence = 0.46
                message = "Vector PDF extraction produced reviewable part candidates."
            elif omr_backend == "vector_first" and input_path.suffix.lower() == ".pdf":
                try:
                    parsed_symbolic, output_path, output_reference = self._run_pdf_vector_omr_fallback(
                        record=record,
                        input_path=input_path,
                        studio=studio,
                        source_label=source_label,
                        primary_error="Vector-first OMR mode.",
                    )
                    candidate_method = "pdf_vector_omr_review"
                    extraction_method = "pdf_vector_omr_v0"
                    job_method = "pdf_vector_omr"
                    confidence = 0.46
                    message = "Vector PDF extraction produced reviewable part candidates."
                except (PdfVectorOmrError, AssetStorageError):
                    output_path = self._run_audiveris_omr(
                        input_path=input_path,
                        output_dir=self._job_output_dir(record.studio_id, record.job_id),
                        audiveris_bin=settings.audiveris_bin,
                        timeout_seconds=settings.engine_processing_timeout_seconds,
                    )
                    parsed_symbolic = parse_symbolic_file_with_metadata(
                        output_path,
                        bpm=studio.bpm,
                        target_slot_id=None if parse_all_parts else self._job_slot_id(record.studio_id, record.job_id),
                    )
                    output_reference = self._persist_generated_asset(output_path)
            else:
                output_path = self._run_audiveris_omr(
                    input_path=input_path,
                    output_dir=self._job_output_dir(record.studio_id, record.job_id),
                    audiveris_bin=settings.audiveris_bin,
                    timeout_seconds=settings.engine_processing_timeout_seconds,
                )
                parsed_symbolic = parse_symbolic_file_with_metadata(
                    output_path,
                    bpm=studio.bpm,
                    target_slot_id=None if parse_all_parts else self._job_slot_id(record.studio_id, record.job_id),
                )
                output_reference = self._persist_generated_asset(output_path)
        except (OmrUnavailableError, SymbolicParseError) as primary_error:
            if omr_backend == "audiveris":
                self._mark_job_failed(record.studio_id, record.job_id, message=str(primary_error))
                return
            if input_path.suffix.lower() != ".pdf":
                self._mark_job_failed(record.studio_id, record.job_id, message=str(primary_error))
                return
            try:
                parsed_symbolic, output_path, output_reference = self._run_pdf_vector_omr_fallback(
                    record=record,
                    input_path=input_path,
                    studio=studio,
                    source_label=source_label,
                    primary_error=str(primary_error),
                )
                candidate_method = "pdf_vector_omr_review"
                extraction_method = "pdf_vector_omr_v0"
                job_method = "pdf_vector_omr"
                confidence = 0.46
                message = (
                    "Audiveris failed or was unavailable; vector PDF extraction produced "
                    "reviewable part candidates."
                )
            except (PdfVectorOmrError, AssetStorageError) as fallback_error:
                self._mark_job_failed(
                    record.studio_id,
                    record.job_id,
                    message=f"{primary_error}; PDF vector fallback failed: {fallback_error}",
                )
                return
        except PdfVectorOmrError as error:
            self._mark_job_failed(record.studio_id, record.job_id, message=str(error))
            return
        except AssetStorageError as error:
            self._mark_job_failed(record.studio_id, record.job_id, message=str(error))
            return

        mapped_notes = _mark_notes_as_omr(
            parsed_symbolic.mapped_notes,
            extraction_method=extraction_method,
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
        self._mark_job_completed(record.studio_id, record.job_id, output_path=output_reference, method=job_method)
        diagnostics_by_slot = _parsed_track_diagnostics_by_slot(
            parsed_symbolic,
            method=extraction_method,
            fallback_method=candidate_method,
        )
        confidence_by_slot = {
            slot_id: _estimate_candidate_confidence(
                slot_id,
                notes,
                method=candidate_method,
                fallback_confidence=confidence,
                diagnostics=diagnostics_by_slot.get(slot_id),
            )
            for slot_id, notes in mapped_notes.items()
        }
        message_by_slot = {
            slot_id: _candidate_review_message(
                slot_id,
                notes,
                method=candidate_method,
                diagnostics=_candidate_diagnostics(
                    slot_id,
                    notes,
                    method=candidate_method,
                    confidence=confidence_by_slot[slot_id],
                    source_diagnostics=diagnostics_by_slot.get(slot_id),
                ),
                default_message=message,
            )
            for slot_id, notes in mapped_notes.items()
        }
        self._add_extraction_candidates(
            record.studio_id,
            mapped_notes,
            source_kind="score",
            source_label=source_label,
            method=candidate_method,
            confidence=confidence,
            confidence_by_slot=confidence_by_slot,
            diagnostics_by_slot=diagnostics_by_slot,
            job_id=record.job_id,
            message=message,
            message_by_slot=message_by_slot,
        )

    def _run_pdf_vector_omr_fallback(
        self,
        *,
        record: EngineQueueJob,
        input_path: Path,
        studio: Studio,
        source_label: str,
        primary_error: str,
    ) -> tuple[ParsedSymbolicFile, Path, str]:
        if input_path.suffix.lower() != ".pdf":
            raise PdfVectorOmrError("Vector PDF extraction only supports PDF input.")
        parsed_symbolic = parse_born_digital_pdf_score(
            input_path,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        output_path = _write_pdf_vector_omr_summary(
            self._job_output_dir(record.studio_id, record.job_id),
            parsed_symbolic,
            source_label=source_label,
            primary_error=primary_error,
        )
        output_reference = self._persist_generated_asset(output_path)
        return parsed_symbolic, output_path, output_reference

    def _process_voice_queue_record(self, record: EngineQueueJob) -> None:
        studio = self.get_studio(record.studio_id)
        source_path = self._resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "voice.wav")
        review_before_register = bool(record.payload.get("review_before_register"))
        allow_overwrite = bool(record.payload.get("allow_overwrite"))
        audio_mime_type = str(record.payload.get("audio_mime_type") or _guess_audio_mime_type(source_label))
        notes = self._transcribe_voice_file(
            source_path,
            bpm=studio.bpm,
            slot_id=record.slot_id,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        if review_before_register:
            self._add_extraction_candidates(
                record.studio_id,
                {record.slot_id: notes},
                source_kind="audio",
                source_label=source_label,
                method="voice_transcription_review",
                confidence=min((note.confidence for note in notes), default=0.45),
                message="Voice transcription is waiting for user approval.",
                job_id=record.job_id,
                audio_source_path=str(record.payload.get("input_path") or ""),
                audio_source_label=source_label,
                audio_mime_type=audio_mime_type,
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
            source_label=source_label,
            notes=notes,
            audio_source_path=str(record.payload.get("input_path") or ""),
            audio_source_label=source_label,
            audio_mime_type=audio_mime_type,
        )
        self._mark_job_completed(record.studio_id, record.job_id, output_path=str(record.payload.get("input_path") or ""))

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
                slot_diagnostics["registration_quality"] = registration.diagnostics
                candidate = ExtractionCandidate(
                    candidate_id=uuid4().hex,
                    candidate_group_id=candidate_group_id,
                    suggested_slot_id=slot_id,
                    source_kind=source_kind,
                    source_label=source_label,
                    method=method,
                    variant_label=variant_label,
                    confidence=slot_confidence,
                    notes=notes,
                    audio_source_path=audio_source_path,
                    audio_source_label=audio_source_label,
                    audio_mime_type=audio_mime_type,
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
                    diagnostics=slot_diagnostics,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
                studio.candidates.append(candidate)
                track = self._find_track(studio, slot_id)
                if not _track_has_content(track):
                    track.status = "needs_review"
                    track.source_kind = source_kind
                    track.source_label = source_label
                    track.updated_at = timestamp
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "needs_review"
                    job.message = message
                    job.updated_at = timestamp
                    if job.parse_all_parts:
                        self._clear_unmapped_omr_placeholders(
                            studio,
                            job,
                            mapped_slot_ids=set(mapped_notes),
                            timestamp=timestamp,
                        )
                    break
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _clear_unmapped_omr_placeholders(
        self,
        studio: Studio,
        job: TrackExtractionJob,
        *,
        mapped_slot_ids: set[int],
        timestamp: str,
    ) -> None:
        for track in studio.tracks:
            if track.slot_id > 5 or track.slot_id in mapped_slot_ids:
                continue
            if _track_has_content(track):
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
                llm_direction = llm_plan.direction_for_index(index) if llm_plan is not None else None
                diagnostics = _candidate_diagnostics(
                    slot_id,
                    notes,
                    method=method,
                    confidence=confidence,
                )
                diagnostics["registration_quality"] = registration.diagnostics
                if llm_plan is not None:
                    diagnostics["llm_provider"] = llm_plan.provider
                    diagnostics["llm_model"] = llm_plan.model
                    diagnostics["llm_plan_confidence"] = round(llm_plan.confidence, 3)
                    diagnostics["llm_key"] = llm_plan.key
                    diagnostics["llm_mode"] = llm_plan.mode
                    diagnostics["llm_phrase_summary"] = llm_plan.phrase_summary
                    diagnostics["llm_warnings"] = llm_plan.warnings
                    diagnostics["llm_revision_cycles"] = llm_plan.revision_cycles
                    diagnostics["llm_measure_intent_count"] = len(llm_plan.measures)
                    diagnostics["llm_critique_summary"] = llm_plan.critique_summary
                if llm_direction is not None:
                    diagnostics["llm_profile"] = llm_direction.profile_name
                    diagnostics["llm_goal"] = llm_direction.goal
                    diagnostics["llm_register_bias"] = llm_direction.register_bias
                    diagnostics["llm_motion_bias"] = llm_direction.motion_bias
                    diagnostics["llm_rhythm_policy"] = llm_direction.rhythm_policy
                    diagnostics["llm_chord_tone_priority"] = llm_direction.chord_tone_priority
                    diagnostics["selection_hint"] = llm_direction.selection_hint
                    diagnostics["candidate_role"] = llm_direction.role
                    diagnostics["risk_tags"] = llm_direction.risk_tags
                candidate = ExtractionCandidate(
                    candidate_id=uuid4().hex,
                    candidate_group_id=candidate_group_id,
                    suggested_slot_id=slot_id,
                    source_kind="ai",
                    source_label=source_label,
                    method=method,
                    variant_label=llm_direction.title if llm_direction is not None else _generation_variant_label(index, slot_id, notes),
                    confidence=confidence,
                    notes=notes,
                    message=message,
                    diagnostics=diagnostics,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
                studio.candidates.append(candidate)

            track = self._find_track(studio, slot_id)
            if track.status != "registered" and not track.notes:
                track.status = "needs_review"
                track.source_kind = "ai"
                track.source_label = source_label
                track.updated_at = timestamp
            studio.updated_at = timestamp
            self._save_studio(studio)
        return studio

    def _job_slot_id(self, studio_id: str, job_id: str) -> int:
        studio = self.get_studio(studio_id)
        for job in studio.jobs:
            if job.job_id == job_id:
                return job.slot_id
        raise HTTPException(status_code=404, detail="Extraction job not found.")

    def _schedule_engine_queue_processing(self, background_tasks: BackgroundTasks | None) -> None:
        if background_tasks is None:
            self._process_engine_queue_until_idle()
            return
        background_tasks.add_task(self._process_engine_queue_until_idle)

    def _process_engine_queue_until_idle(self) -> None:
        settings = get_settings()
        job_limit = max(1, min(settings.engine_drain_max_jobs, 20))
        for _ in range(job_limit):
            if self.process_engine_queue_once() is None:
                break

    def _ensure_queue_records_for_active_jobs(self, studio: Studio) -> None:
        for job in studio.jobs:
            if job.status not in {"queued", "running"}:
                continue
            if self._engine_queue.get(job.job_id) is not None:
                continue
            self._enqueue_existing_extraction_job(studio.studio_id, job.job_id)

    def _enqueue_existing_extraction_job(self, studio_id: str, job_id: str) -> None:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            job = next((candidate_job for candidate_job in studio.jobs if candidate_job.job_id == job_id), None)
            if job is None:
                raise HTTPException(status_code=404, detail="Extraction job not found.")
            if not job.input_path:
                raise HTTPException(status_code=409, detail="Extraction job has no stored input file.")
            job_type = job.job_type
            payload: dict[str, Any] = {
                "input_path": job.input_path,
                "source_kind": job.source_kind,
                "source_label": job.source_label,
            }
            if job_type == "omr":
                payload["parse_all_parts"] = job.parse_all_parts
            elif job_type == "voice":
                queue_record = self._engine_queue.get(job_id)
                if queue_record is not None:
                    payload.update(queue_record.payload)
                payload.setdefault("review_before_register", job.review_before_register)
                payload.setdefault("allow_overwrite", job.allow_overwrite)
                payload.setdefault("audio_mime_type", job.audio_mime_type or _guess_audio_mime_type(job.source_label))
            else:
                raise HTTPException(status_code=409, detail="Unsupported extraction job type.")
            timestamp = _now()
            job.attempt_count = 0
            job.max_attempts = get_settings().engine_job_max_attempts
            job.updated_at = timestamp
            self._save_studio(studio)

        self._engine_queue.enqueue(
            EngineQueueJob(
                job_id=job.job_id,
                studio_id=studio_id,
                slot_id=job.slot_id,
                job_type=job_type,
                status="queued",
                payload=payload,
                attempt_count=0,
                max_attempts=job.max_attempts,
                locked_until=None,
                message=None,
                created_at=job.created_at,
                updated_at=timestamp,
            )
        )

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
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "running"
                    job.message = "Full-score extraction running." if job.parse_all_parts else "Extraction running."
                    if attempt_count is not None:
                        job.attempt_count = attempt_count
                    if max_attempts is not None:
                        job.max_attempts = max_attempts
                    job.updated_at = timestamp
                    break
            studio.updated_at = timestamp
            self._save_studio(studio)

    def _mark_job_failed(self, studio_id: str, job_id: str, *, message: str) -> Studio:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "failed"
                    job.message = message
                    job.updated_at = timestamp
                    failed_tracks = (
                        [track for track in studio.tracks if track.slot_id <= 5]
                        if job.parse_all_parts
                        else [self._find_track(studio, job.slot_id)]
                    )
                    for track in failed_tracks:
                        if _track_has_content(track):
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
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "completed"
                    job.output_path = output_path
                    if method is not None:
                        job.method = method
                    job.updated_at = timestamp
                    break
            studio.updated_at = timestamp
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

    def _owner_policy_enabled(self) -> bool:
        return get_settings().studio_access_policy.strip().lower() not in {"", "public", "off", "false"}

    def _owner_hash_for_request(self, owner_token: str | None, *, allow_missing: bool = False) -> str | None:
        if not self._owner_policy_enabled():
            return None
        normalized = (owner_token or "").strip()
        if not normalized:
            if allow_missing:
                return None
            raise HTTPException(status_code=401, detail="Studio owner token is required.")
        if len(normalized) < 24 or len(normalized) > 256:
            raise HTTPException(status_code=401, detail="Studio owner token is invalid.")
        return _hash_owner_token(normalized)

    def _require_studio_access(self, studio: Studio, owner_token: str | None) -> None:
        if not self._owner_policy_enabled():
            return
        if studio.owner_token_hash is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        if self._owner_hash_for_request(owner_token) != studio.owner_token_hash:
            raise HTTPException(status_code=404, detail="Studio not found.")

    def _mapped_notes_would_overwrite(
        self,
        studio: Studio,
        mapped_notes: dict[int, list[TrackNote]],
    ) -> bool:
        return any(_track_has_content(self._find_track(studio, slot_id)) for slot_id in mapped_notes)

    def _release_review_track_if_empty(
        self,
        studio: Studio,
        slot_id: int,
        resolved_candidate_id: str,
        timestamp: str,
    ) -> None:
        track = self._find_track(studio, slot_id)
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

    def _build_admin_studio_summary(
        self,
        studio: Studio,
        *,
        asset_limit: int,
        asset_offset: int,
    ) -> AdminStudioSummary:
        asset_count, asset_bytes = self._asset_registry.summarize_studio(studio.studio_id)
        if asset_count == 0:
            self._sync_studio_asset_registry(studio.studio_id)
            asset_count, asset_bytes = self._asset_registry.summarize_studio(studio.studio_id)
        records = (
            self._asset_registry.list_studio_assets(
                studio.studio_id,
                limit=asset_limit,
                offset=asset_offset,
            )
            if asset_limit > 0
            else []
        )
        referenced_paths = self._referenced_asset_paths(studio)
        return AdminStudioSummary(
            studio_id=studio.studio_id,
            title=studio.title,
            bpm=studio.bpm,
            registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
            report_count=len(studio.reports),
            candidate_count=len(studio.candidates),
            job_count=len(studio.jobs),
            asset_count=asset_count,
            asset_bytes=asset_bytes,
            created_at=studio.created_at,
            updated_at=studio.updated_at,
            assets=[self._admin_asset_summary_from_record(record, referenced_paths) for record in records],
        )

    def _sync_studio_asset_registry(self, studio_id: str) -> None:
        try:
            stored_assets = self._asset_storage.iter_studio_assets(studio_id)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        self._asset_registry.sync_studio_assets(studio_id, stored_assets)

    def _admin_asset_summary_from_record(
        self,
        record: AssetRecord,
        referenced_paths: set[str],
    ) -> AdminAssetSummary:
        return AdminAssetSummary(
            asset_id=record.asset_id,
            studio_id=record.studio_id or "",
            kind=_admin_asset_kind(record.kind),
            filename=record.filename,
            relative_path=record.relative_path,
            size_bytes=record.size_bytes,
            updated_at=record.updated_at,
            referenced=record.relative_path in referenced_paths,
        )

    def _referenced_asset_paths(self, studio: Studio) -> set[str]:
        references: set[str] = set()
        for track in studio.tracks:
            normalized = self._normalize_asset_reference(track.audio_source_path)
            if normalized is not None:
                references.add(normalized)
        for candidate in studio.candidates:
            normalized = self._normalize_asset_reference(candidate.audio_source_path)
            if normalized is not None:
                references.add(normalized)
        for job in studio.jobs:
            for job_path in (job.input_path, job.output_path):
                normalized = self._normalize_asset_reference(job_path)
                if normalized is not None:
                    references.add(normalized)
        return references

    def _clear_studio_asset_references(self, studio: Studio, timestamp: str) -> None:
        for track in studio.tracks:
            if track.audio_source_path is not None:
                track.audio_source_path = None
                track.audio_source_label = None
                track.audio_mime_type = None
                track.updated_at = timestamp
        for candidate in studio.candidates:
            candidate.audio_source_path = None
            candidate.audio_source_label = None
            candidate.audio_mime_type = None
            candidate.updated_at = timestamp
        for job in studio.jobs:
            job.input_path = None
            job.output_path = None
            job.updated_at = timestamp

    def _clear_asset_references(self, studio: Studio, relative_path: str, timestamp: str) -> bool:
        changed = False
        for track in studio.tracks:
            if self._normalize_asset_reference(track.audio_source_path) == relative_path:
                track.audio_source_path = None
                track.audio_source_label = None
                track.audio_mime_type = None
                track.updated_at = timestamp
                changed = True
        for candidate in studio.candidates:
            if self._normalize_asset_reference(candidate.audio_source_path) == relative_path:
                candidate.audio_source_path = None
                candidate.audio_source_label = None
                candidate.audio_mime_type = None
                candidate.updated_at = timestamp
                changed = True
        for job in studio.jobs:
            if self._normalize_asset_reference(job.input_path) == relative_path:
                job.input_path = None
                job.updated_at = timestamp
                changed = True
            if self._normalize_asset_reference(job.output_path) == relative_path:
                job.output_path = None
                job.updated_at = timestamp
                changed = True
        return changed

    def _normalize_asset_reference(self, asset_path: str | None) -> str | None:
        if asset_path is None:
            return None
        try:
            return self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError:
            return None

    def _build_admin_limit_summary(self, *, studio_count: int, asset_bytes: int) -> AdminLimitSummary:
        settings = get_settings()
        studio_warning = studio_count >= settings.studio_soft_limit
        studio_limit_reached = studio_count >= settings.studio_hard_limit
        asset_warning = asset_bytes >= settings.asset_warning_bytes
        asset_limit_reached = asset_bytes >= settings.asset_hard_bytes
        warnings: list[str] = []
        if studio_warning:
            warnings.append(f"Studio warning line reached: {studio_count}/{settings.studio_soft_limit}.")
        if studio_limit_reached:
            warnings.append(f"Studio hard limit reached: {studio_count}/{settings.studio_hard_limit}.")
        if asset_warning:
            warnings.append(
                f"Asset storage warning line reached: {asset_bytes}/{settings.asset_warning_bytes} bytes."
            )
        if asset_limit_reached:
            warnings.append(f"Asset hard limit reached: {asset_bytes}/{settings.asset_hard_bytes} bytes.")
        return AdminLimitSummary(
            studio_soft_limit=settings.studio_soft_limit,
            studio_hard_limit=settings.studio_hard_limit,
            asset_warning_bytes=settings.asset_warning_bytes,
            asset_hard_bytes=settings.asset_hard_bytes,
            max_upload_bytes=settings.max_upload_bytes,
            max_active_engine_jobs=settings.max_active_engine_jobs,
            studio_warning=studio_warning,
            studio_limit_reached=studio_limit_reached,
            asset_warning=asset_warning,
            asset_limit_reached=asset_limit_reached,
            warnings=warnings,
        )

    def _ensure_studio_capacity(self) -> None:
        settings = get_settings()
        if settings.studio_hard_limit <= 0:
            return
        with self._lock:
            studio_count = self._count_studios()
        if studio_count >= settings.studio_hard_limit:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Studio creation is temporarily capped for the alpha environment "
                    f"({studio_count}/{settings.studio_hard_limit})."
                ),
            )

    def _ensure_asset_capacity(self, incoming_bytes: int) -> None:
        settings = get_settings()
        if settings.asset_hard_bytes <= 0:
            return
        _asset_count, current_bytes = self._asset_registry.summarize_all()
        if current_bytes + incoming_bytes > settings.asset_hard_bytes:
            raise HTTPException(
                status_code=507,
                detail=(
                    "Stored asset capacity is temporarily capped for the alpha environment "
                    f"({current_bytes + incoming_bytes}/{settings.asset_hard_bytes} bytes)."
                ),
            )

    def _register_asset(
        self,
        *,
        relative_path: str,
        kind: str,
        filename: str,
        size_bytes: int,
        content_type: str | None = None,
    ) -> None:
        self._asset_registry.upsert(
            AssetRecord(
                relative_path=relative_path,
                studio_id=_studio_id_from_asset_path(relative_path),
                kind=kind,
                filename=Path(filename).name or Path(relative_path).name,
                size_bytes=size_bytes,
                updated_at=_now(),
                content_type=content_type,
            )
        )

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

    def _delete_asset_file(self, relative_path: str) -> tuple[int, int]:
        try:
            result = self._asset_storage.delete_file(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Asset not found.") from error
        if result[0] > 0:
            self._asset_registry.mark_deleted(relative_path)
        return result

    def _delete_asset_prefix(self, relative_prefix: str) -> tuple[int, int]:
        try:
            result = self._asset_storage.delete_prefix(relative_prefix)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        self._asset_registry.mark_prefix_deleted(relative_prefix)
        return result

    def _delete_expired_staged_uploads(self) -> tuple[int, int]:
        settings = get_settings()
        cutoff = datetime.now(UTC) - timedelta(seconds=settings.staged_upload_retention_seconds)
        try:
            return self._asset_storage.delete_prefix_older_than("staged/", cutoff)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    def _cleanup_expired_staged_uploads_if_due(self) -> None:
        settings = get_settings()
        if settings.lifecycle_cleanup_interval_seconds <= 0:
            return
        now = datetime.now(UTC)
        if (
            self._last_lifecycle_cleanup_at is not None
            and now - self._last_lifecycle_cleanup_at
            < timedelta(seconds=settings.lifecycle_cleanup_interval_seconds)
        ):
            return
        self._last_lifecycle_cleanup_at = now
        self._delete_expired_staged_uploads()

    def _encode_asset_id(self, relative_path: str) -> str:
        encoded = base64.urlsafe_b64encode(relative_path.encode("utf-8")).decode("ascii")
        return encoded.rstrip("=")

    def _decode_asset_id(self, asset_id: str) -> str:
        padding = "=" * (-len(asset_id) % 4)
        try:
            decoded = base64.urlsafe_b64decode(f"{asset_id}{padding}").decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(status_code=404, detail="Asset not found.") from error
        if decoded.startswith("/") or decoded.startswith("\\") or ".." in Path(decoded).parts:
            raise HTTPException(status_code=404, detail="Asset not found.")
        return decoded

    def _save_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
    ) -> Path:
        content = _decode_base64(content_base64)
        self._ensure_asset_capacity(len(content))
        try:
            path = self._asset_storage.write_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content=content,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        relative_path = self._relative_data_asset_path(path)
        self._register_asset(
            relative_path=relative_path,
            kind="upload",
            filename=filename,
            size_bytes=len(content),
            content_type=_guess_content_type(filename),
        )
        return path

    def _resolve_existing_upload_asset(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        asset_path: str,
    ) -> Path:
        try:
            relative_path = self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error

        expected_prefix = f"uploads/{studio_id}/{slot_id}/"
        if not relative_path.startswith(expected_prefix):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        try:
            source_path = self._asset_storage.resolve_path(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.") from error
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.")

        size_bytes = source_path.stat().st_size
        if size_bytes <= 0:
            raise HTTPException(status_code=422, detail="Uploaded asset is empty.")
        max_upload_bytes = get_settings().max_upload_bytes
        if size_bytes > max_upload_bytes:
            self._delete_asset_file(relative_path)
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
            )

        self._ensure_asset_capacity(size_bytes)
        self._register_asset(
            relative_path=relative_path,
            kind="upload",
            filename=filename,
            size_bytes=size_bytes,
            content_type=_guess_content_type(filename),
        )
        return source_path

    def _promote_staged_seed_asset(
        self,
        *,
        studio_id: str,
        filename: str,
        source_kind: SeedSourceKind,
        asset_path: str,
    ) -> Path:
        filename, _suffix = _validated_studio_seed_upload_filename(source_kind, filename)
        try:
            relative_path = self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error

        if not _is_staged_upload_path(relative_path):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        try:
            staged_path = self._asset_storage.resolve_path(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.") from error
        if not staged_path.exists() or not staged_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.")

        size_bytes = staged_path.stat().st_size
        if size_bytes <= 0:
            raise HTTPException(status_code=422, detail="Uploaded asset is empty.")
        max_upload_bytes = get_settings().max_upload_bytes
        if size_bytes > max_upload_bytes:
            self._delete_asset_file(relative_path)
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
            )

        self._ensure_asset_capacity(size_bytes)
        try:
            promoted_path = self._asset_storage.write_upload(
                studio_id=studio_id,
                slot_id=0,
                filename=filename,
                content=staged_path.read_bytes(),
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        promoted_relative_path = self._relative_data_asset_path(promoted_path)
        self._register_asset(
            relative_path=promoted_relative_path,
            kind="upload",
            filename=filename,
            size_bytes=size_bytes,
            content_type=_guess_content_type(filename),
        )
        self._delete_asset_file(relative_path)
        return promoted_path

    def _save_temp_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
    ) -> Path:
        content = _decode_base64(content_base64)
        safe_filename = Path(filename).name.strip() or "take.wav"
        temp_dir = self._root / "tmp" / studio_id / str(slot_id)
        temp_dir.mkdir(parents=True, exist_ok=True)
        path = temp_dir / f"{uuid4().hex}-{safe_filename}"
        path.write_bytes(content)
        return path

    def _delete_temp_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            resolved_root = self._root.resolve()
            if resolved != resolved_root and resolved_root in resolved.parents and resolved.exists():
                resolved.unlink()
                current = resolved.parent
                while current != resolved_root and resolved_root in current.parents:
                    try:
                        current.rmdir()
                    except OSError:
                        break
                    current = current.parent
        except OSError:
            return

    def _persist_generated_asset(self, path: Path) -> str:
        size_bytes = path.stat().st_size if path.exists() else 0
        self._ensure_asset_capacity(size_bytes)
        relative_path = self._asset_storage.persist_file(path)
        self._register_asset(
            relative_path=relative_path,
            kind="generated",
            filename=path.name,
            size_bytes=size_bytes,
        )
        return relative_path

    def _relative_data_asset_path(self, path: Path) -> str:
        try:
            return self._asset_storage.relative_path(path)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail="Uploaded asset is outside storage root.") from error

    def _resolve_data_asset_path(self, asset_path: str) -> Path:
        try:
            return self._asset_storage.resolve_path(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Track audio source not found.") from error

    def _job_output_dir(self, studio_id: str, job_id: str) -> Path:
        return self._root / "jobs" / studio_id / job_id

    def _list_studios(self, *, limit: int, offset: int) -> list[Studio]:
        raw_rows = self._store.list_raw(limit=limit, offset=offset)
        return [
            Studio.model_validate(_migrate_legacy_studio_payload(studio_payload))
            for _studio_id, studio_payload in raw_rows
        ]

    def _count_studios(self) -> int:
        return self._store.count()

    def _load_studio(self, studio_id: str) -> Studio | None:
        raw_payload = self._store.load_one_raw(studio_id)
        if raw_payload is None:
            return None
        return Studio.model_validate(_migrate_legacy_studio_payload(raw_payload))

    def _save_studio(self, studio: Studio) -> None:
        payload = studio.model_dump(mode="json")
        if studio.owner_token_hash is not None:
            payload["owner_token_hash"] = studio.owner_token_hash
        self._store.save_one_raw(studio.studio_id, payload)

    def _delete_studio(self, studio_id: str) -> bool:
        return self._store.delete_one_raw(studio_id)

    def _load(self) -> dict[str, Studio]:
        raw_payload = self._store.load_raw()
        return {
            studio_id: Studio.model_validate(_migrate_legacy_studio_payload(studio_payload))
            for studio_id, studio_payload in raw_payload.items()
        }

    def _save(self, payload: dict[str, Studio]) -> None:
        self._store.save_raw(self._encode_payload(payload))

    def _encode_payload(self, payload: dict[str, Studio]) -> dict[str, Any]:
        encoded: dict[str, Any] = {}
        for studio_id, studio in payload.items():
            studio_payload = studio.model_dump(mode="json")
            if studio.owner_token_hash is not None:
                studio_payload["owner_token_hash"] = studio.owner_token_hash
            encoded[studio_id] = studio_payload
        return encoded


def _studio_list_item(studio: Studio) -> StudioListItem:
    return StudioListItem(
        studio_id=studio.studio_id,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
        report_count=len(studio.reports),
        updated_at=studio.updated_at,
    )


def _studio_list_item_from_payload(studio_id: str, studio_payload: Any) -> StudioListItem:
    migrated_payload = _migrate_legacy_studio_payload(studio_payload)
    if not isinstance(migrated_payload, dict):
        raise HTTPException(status_code=500, detail="Stored studio payload is invalid.")
    shallow_payload = dict(migrated_payload)
    report_count = _payload_sidecar_count(shallow_payload, "reports")
    shallow_payload["reports"] = []
    shallow_payload["candidates"] = []
    studio = Studio.model_validate(shallow_payload)
    return StudioListItem(
        studio_id=studio_id,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
        report_count=report_count,
        updated_at=studio.updated_at,
    )


def _payload_sidecar_count(studio_payload: dict[str, Any], key: str) -> int:
    counts = studio_payload.get("_sidecar_counts")
    if isinstance(counts, dict):
        count = counts.get(key)
        if isinstance(count, int):
            return count
    value = studio_payload.get(key)
    return len(value) if isinstance(value, list) else 0


def _track_duration_seconds(notes: list[TrackNote]) -> float:
    if not notes:
        return 0
    return round(max(note.onset_seconds + note.duration_seconds for note in notes), 4)


def _notes_with_sync_offset(
    notes: list[TrackNote],
    sync_offset_seconds: float,
    bpm: int,
    *,
    voice_index: int | None = None,
) -> list[TrackNote]:
    beat_offset = sync_offset_seconds / seconds_per_beat(bpm)
    return [
        note.model_copy(
            update={
                "onset_seconds": round(max(0, note.onset_seconds + sync_offset_seconds), 4),
                "beat": round(max(1, note.beat + beat_offset), 4),
                "voice_index": voice_index if note.voice_index is None else note.voice_index,
            }
        )
        for note in notes
    ]


def _parsed_track_diagnostics_by_slot(
    parsed_symbolic: ParsedSymbolicFile,
    *,
    method: str,
    fallback_method: str,
) -> dict[int, dict[str, Any]]:
    diagnostics_by_slot: dict[int, dict[str, Any]] = {}
    for parsed_track in parsed_symbolic.tracks:
        if parsed_track.slot_id is None or not parsed_track.notes:
            continue
        diagnostics = dict(parsed_track.diagnostics)
        diagnostics.setdefault("engine", method)
        diagnostics.setdefault("candidate_method", fallback_method)
        diagnostics.setdefault("part_name", parsed_track.name)
        diagnostics_by_slot[parsed_track.slot_id] = diagnostics
    return diagnostics_by_slot


def _candidate_diagnostics(
    slot_id: int,
    notes: list[TrackNote],
    *,
    method: str,
    confidence: float,
    source_diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    diagnostics = dict(source_diagnostics or {})
    pitched_notes = [
        note
        for note in notes
        if not note.is_rest and note.pitch_midi is not None
    ]
    measure_indices = {
        note.measure_index
        for note in notes
        if note.measure_index is not None
    }
    duration_seconds = _track_duration_seconds(notes) if notes else 0
    measure_count = len(measure_indices)
    if measure_count == 0 and notes:
        measure_count = max(1, int(max(note.beat + note.duration_beats for note in notes) // 4) + 1)
    avg_note_confidence = sum(note.confidence for note in notes) / len(notes) if notes else 0
    range_fit_ratio = _candidate_range_fit_ratio(slot_id, pitched_notes)
    timing_grid_ratio = _candidate_timing_grid_ratio(notes)
    note_count = len(notes)
    diagnostics.update(
        {
            "candidate_method": method,
            "track": track_name(slot_id),
            "note_count": note_count,
            "pitched_note_count": len(pitched_notes),
            "rest_count": note_count - len(pitched_notes),
            "measure_count": measure_count,
            "duration_seconds": round(duration_seconds, 3),
            "range": _candidate_range_label(pitched_notes),
            "avg_note_confidence": round(avg_note_confidence, 3),
            "range_fit_ratio": round(range_fit_ratio, 3),
            "timing_grid_ratio": round(timing_grid_ratio, 3),
            "density_notes_per_measure": round(note_count / max(1, measure_count), 2),
            "confidence_label": _confidence_label(confidence),
            "review_hint": diagnostics.get("review_hint")
            or _review_hint_for_candidate(
                method=method,
                note_count=note_count,
                range_fit_ratio=range_fit_ratio,
                timing_grid_ratio=timing_grid_ratio,
                avg_note_confidence=avg_note_confidence,
            ),
        }
    )
    return diagnostics


def _estimate_candidate_confidence(
    slot_id: int,
    notes: list[TrackNote],
    *,
    method: str,
    fallback_confidence: float,
    diagnostics: dict[str, Any] | None = None,
) -> float:
    if not notes:
        return 0

    if method.startswith("audiveris"):
        base = max(fallback_confidence, 0.62)
    elif method.startswith("pdf_vector"):
        base = max(fallback_confidence, 0.44)
    elif method.startswith("voice"):
        base = max(fallback_confidence, 0.4)
    else:
        base = fallback_confidence

    avg_note_confidence = sum(note.confidence for note in notes) / len(notes)
    range_fit_ratio = _diagnostic_float(
        diagnostics,
        "range_fit_ratio",
        default=_candidate_range_fit_ratio(slot_id, [note for note in notes if note.pitch_midi is not None]),
    )
    timing_grid_ratio = _diagnostic_float(
        diagnostics,
        "timing_grid_ratio",
        default=_candidate_timing_grid_ratio(notes),
    )
    measure_count = _diagnostic_int(diagnostics, "measure_count", default=0)

    note_volume_bonus = min(0.12, len(notes) / 1200)
    measure_bonus = min(0.08, measure_count / 80)
    confidence = (
        base * 0.52
        + avg_note_confidence * 0.3
        + range_fit_ratio * 0.12
        + timing_grid_ratio * 0.06
        + note_volume_bonus
        + measure_bonus
    )
    if len(notes) < 4:
        confidence -= 0.08
    if range_fit_ratio < 0.85:
        confidence -= (0.85 - range_fit_ratio) * 0.16
    if timing_grid_ratio < 0.75:
        confidence -= (0.75 - timing_grid_ratio) * 0.08
    return round(max(0.15, min(0.92, confidence)), 3)


def _candidate_review_message(
    slot_id: int,
    notes: list[TrackNote],
    *,
    method: str,
    diagnostics: dict[str, Any] | None,
    default_message: str | None,
) -> str | None:
    if not notes:
        return default_message
    if diagnostics is None:
        diagnostics = _candidate_diagnostics(
            slot_id,
            notes,
            method=method,
            confidence=0.5,
        )
    note_count = _diagnostic_int(diagnostics, "note_count", default=len(notes))
    measure_count = _diagnostic_int(diagnostics, "measure_count", default=0)
    confidence_label = str(diagnostics.get("confidence_label") or "review")
    hint = str(diagnostics.get("review_hint") or "")
    hint_label = _review_hint_label(hint)
    if method.startswith("pdf_vector"):
        return (
            f"{track_name(slot_id)}: vector PDF에서 {measure_count}마디, "
            f"{note_count}개 음표를 추출했습니다. {confidence_label}; {hint_label}"
        )
    if method.startswith("audiveris"):
        return (
            f"{track_name(slot_id)}: Audiveris MusicXML 결과에서 {measure_count}마디, "
            f"{note_count}개 음표를 추출했습니다. {confidence_label}; 원본과 대조 후 승인하세요."
        )
    return default_message


def _candidate_range_fit_ratio(slot_id: int, notes: list[TrackNote]) -> float:
    pitched = [note for note in notes if note.pitch_midi is not None]
    if not pitched:
        return 0
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    in_range = [
        note
        for note in pitched
        if note.pitch_midi is not None and low <= note.pitch_midi <= high
    ]
    return len(in_range) / len(pitched)


def _candidate_timing_grid_ratio(notes: list[TrackNote]) -> float:
    if not notes:
        return 0
    aligned = 0
    for note in notes:
        beat_aligned = abs(note.beat * 4 - round(note.beat * 4)) <= 0.03
        duration_aligned = abs(note.duration_beats * 4 - round(note.duration_beats * 4)) <= 0.03
        if beat_aligned and duration_aligned:
            aligned += 1
    return aligned / len(notes)


def _candidate_range_label(notes: list[TrackNote]) -> str:
    midi_notes = [
        note
        for note in notes
        if note.pitch_midi is not None
    ]
    if not midi_notes:
        return "-"
    sorted_notes = sorted(midi_notes, key=lambda note: note.pitch_midi or 0)
    return f"{sorted_notes[0].label} - {sorted_notes[-1].label}"


def _confidence_label(confidence: float) -> str:
    if confidence >= 0.72:
        return "높은 신뢰도"
    if confidence >= 0.5:
        return "검토 필요"
    return "낮은 신뢰도"


def _review_hint_for_candidate(
    *,
    method: str,
    note_count: int,
    range_fit_ratio: float,
    timing_grid_ratio: float,
    avg_note_confidence: float,
) -> str:
    if note_count < 4:
        return "few_notes"
    if avg_note_confidence < 0.52:
        return "low_note_confidence"
    if range_fit_ratio < 0.85:
        return "range_outliers"
    if timing_grid_ratio < 0.82:
        return "rhythm_grid_review"
    if method.startswith("pdf_vector"):
        return "review_accidentals_and_rhythm"
    return "review_against_source"


def _review_hint_label(hint: str) -> str:
    return {
        "few_notes": "음표 수가 적어 파트 판독을 꼭 확인하세요.",
        "low_note_confidence": "음표별 신뢰도가 낮아 원본 대조가 필요합니다.",
        "range_outliers": "파트 음역 밖 음이 있어 트랙 배정을 확인하세요.",
        "rhythm_grid_review": "리듬 격자가 불안정해 박자 판독을 확인하세요.",
        "partial_score_review": "일부 파트만 감지되어 누락 파트를 확인하세요.",
        "review_accidentals_and_rhythm": "조표/임시표와 리듬을 원본과 대조하세요.",
        "review_against_source": "원본과 대조 후 승인하세요.",
    }.get(hint, "원본과 대조 후 승인하세요.")


def _diagnostic_float(diagnostics: dict[str, Any] | None, key: str, *, default: float) -> float:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return float(value) if isinstance(value, (int, float)) else default


def _diagnostic_int(diagnostics: dict[str, Any] | None, key: str, *, default: int) -> int:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return int(value) if isinstance(value, (int, float)) else default


def _mark_notes_as_omr(
    mapped_notes: dict[int, list[TrackNote]],
    *,
    extraction_method: str = "audiveris_omr_v0",
) -> dict[int, list[TrackNote]]:
    return {
        slot_id: annotate_track_notes_for_slot(
            [
                note.model_copy(
                    update={
                        "source": "omr",
                        "extraction_method": extraction_method,
                    }
                )
                for note in notes
            ],
            slot_id=slot_id,
        )
        for slot_id, notes in mapped_notes.items()
    }


def _write_pdf_vector_omr_summary(
    output_dir: Path,
    parsed_symbolic: ParsedSymbolicFile,
    *,
    source_label: str,
    primary_error: str,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "pdf-vector-omr-summary.json"
    payload = {
        "method": "pdf_vector_omr_v0",
        "source_label": source_label,
        "fallback_reason": primary_error,
        "tracks": [
            {
                "slot_id": track.slot_id,
                "name": track.name,
                "note_count": len(track.notes),
                "diagnostics": track.diagnostics,
            }
            for track in parsed_symbolic.tracks
        ],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def _generation_variant_label(index: int, slot_id: int, notes: list[TrackNote]) -> str:
    if slot_id == 6:
        return _percussion_variant_label(index, notes)

    pitched_notes = [
        note
        for note in notes
        if note.pitch_midi is not None and not note.is_rest
    ]
    if not pitched_notes:
        return f"Candidate {index}"

    midi_values = [note.pitch_midi for note in pitched_notes if note.pitch_midi is not None]
    average_midi = sum(midi_values) / len(midi_values)
    low, high = SLOT_RANGES.get(slot_id, (min(midi_values), max(midi_values)))
    slot_center = (low + high) / 2
    if average_midi < slot_center - 2:
        register_label = "Lower support"
    elif average_midi > slot_center + 2:
        register_label = "Upper blend"
    else:
        register_label = "Balanced"

    intervals = [
        abs(midi_values[index] - midi_values[index - 1])
        for index in range(1, len(midi_values))
    ]
    average_step = sum(intervals) / len(intervals) if intervals else 0
    leap_count = sum(1 for interval in intervals if interval >= 5)
    if average_step <= 1.25:
        motion_label = "stepwise"
    elif leap_count >= 2:
        motion_label = "active leaps"
    else:
        motion_label = "gentle motion"

    contour_delta = midi_values[-1] - midi_values[0]
    if contour_delta >= 3:
        contour_label = "rising"
    elif contour_delta <= -3:
        contour_label = "falling"
    else:
        contour_label = "level"

    average_label = midi_to_label(round(average_midi))
    return f"{register_label} {motion_label} - {contour_label} - avg {average_label}"


def _percussion_variant_label(index: int, notes: list[TrackNote]) -> str:
    labels = [note.label for note in notes[:8]]
    kick_count = labels.count("Kick")
    snare_count = labels.count("Snare")
    if kick_count > snare_count:
        feel = "kick-led"
    elif snare_count > kick_count:
        feel = "snare-led"
    else:
        feel = "balanced"
    return f"Groove {index} - {feel}"


def _track_has_content(track: TrackSlot) -> bool:
    return track.status == "registered" or bool(track.notes)


def _validated_track_upload_filename(source_kind: str, filename: str) -> tuple[str, str]:
    safe_filename = Path(filename.strip()).name
    suffix = Path(safe_filename).suffix.lower()
    allowed_suffixes = TRACK_UPLOAD_SUFFIXES.get(source_kind)
    if not safe_filename or allowed_suffixes is None or not safe_filename.lower().endswith(allowed_suffixes):
        raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")
    return safe_filename, suffix


def _validated_studio_seed_upload_filename(source_kind: str, filename: str) -> tuple[str, str]:
    safe_filename = Path(filename.strip()).name
    suffix = Path(safe_filename).suffix.lower()
    allowed_suffixes = STUDIO_SEED_UPLOAD_SUFFIXES.get(source_kind)
    if not safe_filename or allowed_suffixes is None or not safe_filename.lower().endswith(allowed_suffixes):
        raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")
    return safe_filename, suffix


def _decode_base64(content_base64: str) -> bytes:
    payload = content_base64.split(",", 1)[1] if "," in content_base64 else content_base64
    try:
        content = base64.b64decode(payload, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid base64 upload content.") from error
    max_upload_bytes = get_settings().max_upload_bytes
    if len(content) > max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
        )
    return content


def _guess_audio_mime_type(filename: str) -> str:
    return AUDIO_MIME_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


def _guess_content_type(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix in AUDIO_SOURCE_SUFFIXES:
        return _guess_audio_mime_type(filename)
    if suffix in {".musicxml", ".xml"}:
        return "application/vnd.recordare.musicxml+xml"
    if suffix == ".mxl":
        return "application/vnd.recordare.musicxml"
    if suffix in {".mid", ".midi"}:
        return "audio/midi"
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}:
        if suffix in {".jpg", ".jpeg"}:
            return "image/jpeg"
        if suffix in {".tif", ".tiff"}:
            return "image/tiff"
        return f"image/{suffix.lstrip('.')}"
    return None


def _track_upload_owner_from_path(relative_path: str) -> tuple[str, int] | None:
    parts = relative_path.split("/")
    if len(parts) < 4 or parts[0] != "uploads":
        return None
    try:
        slot_id = int(parts[2])
    except ValueError:
        return None
    if slot_id < 1 or slot_id > 6:
        return None
    return parts[1], slot_id


def _is_staged_upload_path(relative_path: str) -> bool:
    parts = relative_path.split("/")
    return len(parts) >= 3 and parts[0] == "staged"


def _admin_asset_kind(kind: str) -> str:
    if kind in {"upload", "generated"}:
        return kind
    return "unknown"


def _studio_id_from_asset_path(relative_path: str) -> str | None:
    parts = Path(relative_path).parts
    if len(parts) >= 2 and parts[0] in {"uploads", "jobs"}:
        return parts[1]
    return None


def _hash_owner_token(owner_token: str) -> str:
    return hashlib.sha256(owner_token.strip().encode("utf-8")).hexdigest()


def _migrate_legacy_studio_payload(studio_payload: Any) -> Any:
    if not isinstance(studio_payload, dict):
        return studio_payload

    for track in studio_payload.get("tracks", []):
        if isinstance(track, dict):
            _replace_legacy_fixture_note_source(track.get("notes", []), track.get("source_kind"))

    for candidate in studio_payload.get("candidates", []):
        if isinstance(candidate, dict):
            _replace_legacy_fixture_note_source(candidate.get("notes", []), candidate.get("source_kind"))

    return studio_payload


def _replace_legacy_fixture_note_source(notes: Any, source_kind: Any) -> None:
    if not isinstance(notes, list):
        return
    replacement = _note_source_from_source_kind(source_kind)
    for note in notes:
        if isinstance(note, dict) and note.get("source") == "fixture":
            note["source"] = replacement


def _note_source_from_source_kind(source_kind: Any) -> str:
    if source_kind in {"recording", "audio", "midi", "ai"}:
        return str(source_kind)
    if source_kind == "music":
        return "audio"
    if source_kind in {"score", None}:
        return "musicxml"
    return "musicxml"


_repository: StudioRepository | None = None


def get_studio_repository() -> StudioRepository:
    global _repository
    if _repository is None:
        _repository = StudioRepository(get_settings().storage_root)
    return _repository
