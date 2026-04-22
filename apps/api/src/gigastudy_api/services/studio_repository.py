from __future__ import annotations

import base64
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.admin import (
    AdminAssetSummary,
    AdminDeleteResult,
    AdminStorageSummary,
    AdminStudioSummary,
)
from gigastudy_api.api.schemas.studios import (
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    ExtractionCandidate,
    GenerateTrackRequest,
    ScoreTrackRequest,
    SeedSourceKind,
    SourceKind,
    Studio,
    StudioListItem,
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
    StoredAssetInfo,
    build_asset_storage,
)
from gigastudy_api.services.engine.harmony import generate_rule_based_harmony_candidates
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    TRACKS,
    infer_slot_id,
    midi_to_label,
    track_name,
)
from gigastudy_api.services.engine.omr import OmrUnavailableError, run_audiveris_omr
from gigastudy_api.services.engine.pdf_export import ScorePdfExportError, build_studio_score_pdf
from gigastudy_api.services.engine.scoring import build_scoring_report
from gigastudy_api.services.engine.symbolic import SymbolicParseError, parse_symbolic_file_with_metadata
from gigastudy_api.services.engine.voice import VoiceTranscriptionError, transcribe_voice_file
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
AUDIO_MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


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
        self._lock = RLock()

    def list_studios(self) -> list[StudioListItem]:
        with self._lock:
            studios = list(self._load().values())
        return sorted(
            (
                StudioListItem(
                    studio_id=studio.studio_id,
                    title=studio.title,
                    bpm=studio.bpm,
                    time_signature_numerator=studio.time_signature_numerator,
                    time_signature_denominator=studio.time_signature_denominator,
                    registered_track_count=sum(
                        1 for track in studio.tracks if track.status == "registered"
                    ),
                    report_count=len(studio.reports),
                    updated_at=studio.updated_at,
                )
                for studio in studios
            ),
            key=lambda item: item.updated_at,
            reverse=True,
        )

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
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        timestamp = _now()
        resolved_bpm = bpm if bpm is not None else DEFAULT_UPLOAD_BPM
        studio = Studio(
            studio_id=uuid4().hex,
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
            if self._should_start_omr_job(
                source_kind=source_kind,
                source_filename=source_filename,
                source_content_base64=source_content_base64,
            ):
                source_label = source_filename or "uploaded-score.pdf"
                source_path = self._save_upload(
                    studio_id=studio.studio_id,
                    slot_id=0,
                    filename=source_label,
                    content_base64=source_content_base64 or "",
                )
                with self._lock:
                    payload = self._load()
                    payload[studio.studio_id] = studio
                    self._save(payload)
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
                source_filename=source_filename or f"uploaded-{source_kind}",
                source_content_base64=source_content_base64,
            )

        with self._lock:
            payload = self._load()
            payload[studio.studio_id] = studio
            self._save(payload)
        return studio

    def get_studio(self, studio_id: str) -> Studio:
        with self._lock:
            studio = self._load().get(studio_id)
        if studio is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        return studio

    def export_score_pdf(self, studio_id: str) -> tuple[str, bytes]:
        studio = self.get_studio(studio_id)
        try:
            return f"{studio.studio_id}-score.pdf", build_studio_score_pdf(studio)
        except ScorePdfExportError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    def get_track_audio(self, studio_id: str, slot_id: int) -> tuple[Path, str, str]:
        studio = self.get_studio(studio_id)
        track = self._find_track(studio, slot_id)
        if track.status != "registered" or track.audio_source_path is None:
            raise HTTPException(status_code=404, detail="Track audio source not found.")

        source_path = self._resolve_data_asset_path(track.audio_source_path)
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Track audio source file is missing.")

        media_type = track.audio_mime_type or _guess_audio_mime_type(source_path.name)
        filename = track.audio_source_label or track.source_label or source_path.name
        return source_path, media_type, filename

    def get_admin_storage_summary(self) -> AdminStorageSummary:
        with self._lock:
            payload = self._load()
            studios = list(payload.values())

        studio_summaries = [self._build_admin_studio_summary(studio) for studio in studios]
        metadata_bytes = self._store.estimate_bytes(self._encode_payload(payload))
        asset_count = sum(studio.asset_count for studio in studio_summaries)
        asset_bytes = sum(studio.asset_bytes for studio in studio_summaries)
        return AdminStorageSummary(
            storage_root=self._asset_storage.label,
            studio_count=len(studio_summaries),
            asset_count=asset_count,
            total_bytes=metadata_bytes + asset_bytes,
            metadata_bytes=metadata_bytes,
            studios=sorted(studio_summaries, key=lambda studio: studio.updated_at, reverse=True),
        )

    def delete_admin_studio(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            payload = self._load()
            studio = payload.pop(studio_id, None)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            self._save(payload)

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
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            self._clear_studio_asset_references(studio, timestamp)
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)

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

    def delete_admin_asset(self, asset_id: str) -> AdminDeleteResult:
        relative_path = self._decode_asset_id(asset_id)
        deleted_files, deleted_bytes = self._delete_asset_file(relative_path)
        if deleted_files == 0:
            raise HTTPException(status_code=404, detail="Asset not found.")

        with self._lock:
            payload = self._load()
            timestamp = _now()
            changed = False
            for studio in payload.values():
                studio_changed = self._clear_asset_references(studio, relative_path, timestamp)
                if studio_changed:
                    studio.updated_at = timestamp
                    changed = True
            if changed:
                self._save(payload)

        studio_id = _studio_id_from_asset_path(relative_path)
        return AdminDeleteResult(
            deleted=True,
            message="Asset deleted.",
            studio_id=studio_id,
            asset_id=asset_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def upload_track(
        self,
        studio_id: str,
        slot_id: int,
        request: UploadTrackRequest,
        *,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        allowed_suffixes = {
            "audio": tuple(AUDIO_SOURCE_SUFFIXES),
            "midi": (".mid", ".midi"),
            "score": tuple(SYMBOLIC_SOURCE_SUFFIXES | OMR_SOURCE_SUFFIXES),
        }
        filename = request.filename.strip()
        suffix = Path(filename).suffix.lower()
        if not filename.lower().endswith(allowed_suffixes[request.source_kind]):
            raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")

        studio = self.get_studio(studio_id)

        source_path = self._save_upload(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=request.content_base64,
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
                notes = transcribe_voice_file(
                    source_path,
                    bpm=studio.bpm,
                    slot_id=slot_id,
                    time_signature_numerator=studio.time_signature_numerator,
                    time_signature_denominator=studio.time_signature_denominator,
                )
                if request.review_before_register:
                    return self._add_extraction_candidates(
                        studio_id,
                        {slot_id: notes},
                        source_kind="audio",
                        source_label=filename,
                        method="voice_transcription_review",
                        confidence=min((note.confidence for note in notes), default=0.45),
                        message="Voice transcription is waiting for user approval.",
                        audio_source_path=self._relative_data_asset_path(source_path),
                        audio_source_label=filename,
                        audio_mime_type=_guess_audio_mime_type(filename),
                    )
                track = self._find_track(studio, slot_id)
                if _track_has_content(track) and not request.allow_overwrite:
                    raise HTTPException(
                        status_code=409,
                        detail="Upload would overwrite an existing registered track.",
                    )
                return self._update_track(
                    studio_id,
                    slot_id,
                    source_kind="audio",
                    source_label=filename,
                    notes=notes,
                    audio_source_path=self._relative_data_asset_path(source_path),
                    audio_source_label=filename,
                    audio_mime_type=_guess_audio_mime_type(filename),
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

    def generate_track(self, studio_id: str, slot_id: int, request: GenerateTrackRequest) -> Studio:
        studio = self.get_studio(studio_id)
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

        candidate_notes = generate_rule_based_harmony_candidates(
            target_slot_id=slot_id,
            context_tracks=context_notes,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            context_notes_by_slot=context_notes_by_slot,
            candidate_count=request.candidate_count,
        )
        if not candidate_notes:
            raise HTTPException(status_code=409, detail="No harmony notes could be generated.")

        label = "Generated percussion groove" if slot_id == 6 else "Voice-leading harmony score"
        if request.review_before_register:
            return self._add_generation_candidates(
                studio_id,
                slot_id,
                candidate_notes,
                source_label=label,
                method="rule_based_percussion_candidates_v0"
                if slot_id == 6
                else "rule_based_voice_leading_candidates_v1",
                message="AI generated multiple candidates. Approve one candidate to register it.",
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

    def update_sync(self, studio_id: str, slot_id: int, request: SyncTrackRequest) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            track.sync_offset_seconds = round(request.sync_offset_seconds, 2)
            track.updated_at = timestamp
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def _update_time_signature(
        self,
        studio_id: str,
        numerator: int,
        denominator: int,
    ) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            studio.time_signature_numerator = numerator
            studio.time_signature_denominator = denominator
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def approve_candidate(
        self,
        studio_id: str,
        candidate_id: str,
        request: ApproveCandidateRequest,
    ) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
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
            candidate.status = "approved"
            candidate.updated_at = timestamp
            track.status = "registered"
            track.source_kind = candidate.source_kind
            track.source_label = candidate.source_label
            track.audio_source_path = candidate.audio_source_path
            track.audio_source_label = candidate.audio_source_label
            track.audio_mime_type = candidate.audio_mime_type
            track.duration_seconds = _track_duration_seconds(candidate.notes)
            track.notes = candidate.notes
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
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def reject_candidate(self, studio_id: str, candidate_id: str) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
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
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def approve_job_candidates(
        self,
        studio_id: str,
        job_id: str,
        request: ApproveJobCandidatesRequest,
    ) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")

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
            for slot_id, candidate in unique_candidates_by_slot.items():
                track = self._find_track(studio, slot_id)
                candidate.status = "approved"
                candidate.updated_at = timestamp
                track.status = "registered"
                track.source_kind = candidate.source_kind
                track.source_label = candidate.source_label
                track.audio_source_path = candidate.audio_source_path
                track.audio_source_label = candidate.audio_source_label
                track.audio_mime_type = candidate.audio_mime_type
                track.duration_seconds = _track_duration_seconds(candidate.notes)
                track.notes = candidate.notes
                track.updated_at = timestamp

            for candidate in duplicate_candidates:
                candidate.status = "rejected"
                candidate.updated_at = timestamp

            job.status = "completed"
            job.message = "OMR candidates registered into their suggested tracks."
            job.updated_at = timestamp
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def score_track(self, studio_id: str, slot_id: int, request: ScoreTrackRequest) -> Studio:
        studio = self.get_studio(studio_id)
        target_track = self._find_track(studio, slot_id)
        if target_track.status != "registered" or not target_track.notes:
            raise HTTPException(status_code=409, detail="Scoring requires a registered answer track.")

        valid_reference_ids = {
            track.slot_id for track in studio.tracks if track.status == "registered"
        }
        reference_slot_ids = [
            reference_id
            for reference_id in request.reference_slot_ids
            if reference_id in valid_reference_ids and reference_id != slot_id
        ]
        if not reference_slot_ids and not request.include_metronome:
            raise HTTPException(
                status_code=422,
                detail="Choose at least one reference track or the metronome.",
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
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            studio.reports.append(report)
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

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
            return transcribe_voice_file(
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
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            track = self._find_track(studio, slot_id)
            track.status = "registered"
            track.source_kind = source_kind
            track.source_label = source_label
            track.audio_source_path = audio_source_path
            track.audio_source_label = audio_source_label
            track.audio_mime_type = audio_mime_type
            track.duration_seconds = _track_duration_seconds(notes)
            track.notes = notes
            track.updated_at = timestamp
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
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
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for slot_id, notes in mapped_notes.items():
                track = self._find_track(studio, slot_id)
                track.status = "registered"
                track.source_kind = source_kind
                track.source_label = source_label
                track.audio_source_path = None
                track.audio_source_label = None
                track.audio_mime_type = None
                track.duration_seconds = _track_duration_seconds(notes)
                track.notes = notes
                track.updated_at = timestamp
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def _should_start_omr_job(
        self,
        *,
        source_kind: SeedSourceKind,
        source_filename: str | None,
        source_content_base64: str | None,
    ) -> bool:
        if source_kind != "score" or source_content_base64 is None or source_filename is None:
            return False
        return Path(source_filename).suffix.lower() in OMR_SOURCE_SUFFIXES

    def _seed_from_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
    ) -> Studio:
        if source_content_base64 is None:
            raise HTTPException(status_code=422, detail="Upload start requires a source file.")
        return self._seed_from_upload_content(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=source_content_base64,
        )

    def _seed_from_upload_content(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str,
    ) -> Studio:
        source_path = self._save_upload(
            studio_id=studio.studio_id,
            slot_id=0,
            filename=source_filename,
            content_base64=source_content_base64,
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
            for slot_id, notes in parsed_symbolic.mapped_notes.items():
                track = self._find_track(studio, slot_id)
                track.status = "registered"
                track.source_kind = registered_source_kind
                track.source_label = source_filename
                track.duration_seconds = _track_duration_seconds(notes)
                track.notes = notes
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

    def _extract_home_audio_candidate(self, studio: Studio, source_path: Path) -> tuple[int, list[TrackNote], float]:
        attempts: list[tuple[int, list[TrackNote], float]] = []
        errors: list[str] = []
        for slot_id, _track_name in TRACKS:
            if slot_id == 6:
                continue
            try:
                notes = transcribe_voice_file(
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
        return suggested_slot_id, notes, confidence

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
        job = TrackExtractionJob(
            job_id=uuid4().hex,
            slot_id=slot_id,
            source_kind=source_kind,
            source_label=source_label,
            status="queued",
            method="audiveris_cli",
            input_path=self._relative_data_asset_path(source_path),
            created_at=timestamp,
            updated_at=timestamp,
        )

        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            track = self._find_track(studio, slot_id)
            if not _track_has_content(track):
                track.status = "extracting"
                track.source_kind = source_kind
                track.source_label = source_label
                track.updated_at = timestamp
            studio.jobs.append(job)
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)

        if background_tasks is None:
            self._process_omr_job(studio_id, job.job_id, source_path, source_label, parse_all_parts)
        else:
            background_tasks.add_task(
                self._process_omr_job,
                studio_id,
                job.job_id,
                source_path,
                source_label,
                parse_all_parts,
            )
        return studio

    def _process_omr_job(
        self,
        studio_id: str,
        job_id: str,
        source_path: Path,
        source_label: str,
        parse_all_parts: bool = False,
    ) -> None:
        settings = get_settings()
        studio = self.get_studio(studio_id)
        self._mark_job_running(studio_id, job_id)
        try:
            output_path = run_audiveris_omr(
                input_path=source_path,
                output_dir=self._job_output_dir(studio_id, job_id),
                audiveris_bin=settings.audiveris_bin,
                timeout_seconds=settings.engine_processing_timeout_seconds,
            )
            parsed_symbolic = parse_symbolic_file_with_metadata(
                output_path,
                bpm=studio.bpm,
                target_slot_id=None if parse_all_parts else self._job_slot_id(studio_id, job_id),
            )
            output_reference = self._persist_generated_asset(output_path)
            mapped_notes = _mark_notes_as_omr(parsed_symbolic.mapped_notes)
        except (OmrUnavailableError, SymbolicParseError) as error:
            self._mark_job_failed(studio_id, job_id, message=str(error))
            return
        except AssetStorageError as error:
            self._mark_job_failed(studio_id, job_id, message=str(error))
            return

        if parsed_symbolic.has_time_signature:
            self._update_time_signature(
                studio_id,
                parsed_symbolic.time_signature_numerator,
                parsed_symbolic.time_signature_denominator,
            )
        self._mark_job_completed(studio_id, job_id, output_path=output_reference)
        self._add_extraction_candidates(
            studio_id,
            mapped_notes,
            source_kind="score",
            source_label=source_label,
            method="audiveris_omr_review",
            confidence=0.55,
            job_id=job_id,
            message="OMR result requires user approval before track registration.",
        )

    def _add_extraction_candidates(
        self,
        studio_id: str,
        mapped_notes: dict[int, list[TrackNote]],
        *,
        source_kind: SourceKind,
        source_label: str,
        method: str,
        confidence: float,
        job_id: str | None = None,
        message: str | None = None,
        candidate_group_id: str | None = None,
        variant_label: str | None = None,
        audio_source_path: str | None = None,
        audio_source_label: str | None = None,
        audio_mime_type: str | None = None,
    ) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for slot_id, notes in mapped_notes.items():
                candidate = ExtractionCandidate(
                    candidate_id=uuid4().hex,
                    candidate_group_id=candidate_group_id,
                    suggested_slot_id=slot_id,
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
                    break
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
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
    ) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            candidate_group_id = uuid4().hex
            for index, notes in enumerate(candidate_notes, start=1):
                candidate = ExtractionCandidate(
                    candidate_id=uuid4().hex,
                    candidate_group_id=candidate_group_id,
                    suggested_slot_id=slot_id,
                    source_kind="ai",
                    source_label=source_label,
                    method=method,
                    variant_label=_generation_variant_label(index, slot_id, notes),
                    confidence=min((note.confidence for note in notes), default=0.65),
                    notes=notes,
                    message=message,
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
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def _job_slot_id(self, studio_id: str, job_id: str) -> int:
        studio = self.get_studio(studio_id)
        for job in studio.jobs:
            if job.job_id == job_id:
                return job.slot_id
        raise HTTPException(status_code=404, detail="Extraction job not found.")

    def _mark_job_running(self, studio_id: str, job_id: str) -> None:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "running"
                    job.updated_at = timestamp
                    break
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)

    def _mark_job_failed(self, studio_id: str, job_id: str, *, message: str) -> Studio:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "failed"
                    job.message = message
                    job.updated_at = timestamp
                    track = self._find_track(studio, job.slot_id)
                    if not _track_has_content(track):
                        track.status = "failed"
                        track.updated_at = timestamp
                    break
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)
        return studio

    def _mark_job_completed(self, studio_id: str, job_id: str, *, output_path: str) -> None:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "completed"
                    job.output_path = output_path
                    job.updated_at = timestamp
                    break
            studio.updated_at = timestamp
            payload[studio_id] = studio
            self._save(payload)

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
        track.updated_at = timestamp

    def _build_admin_studio_summary(self, studio: Studio) -> AdminStudioSummary:
        assets = list(self._iter_admin_assets(studio))
        asset_bytes = sum(asset.size_bytes for asset in assets)
        return AdminStudioSummary(
            studio_id=studio.studio_id,
            title=studio.title,
            bpm=studio.bpm,
            registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
            report_count=len(studio.reports),
            candidate_count=len(studio.candidates),
            job_count=len(studio.jobs),
            asset_count=len(assets),
            asset_bytes=asset_bytes,
            created_at=studio.created_at,
            updated_at=studio.updated_at,
            assets=assets,
        )

    def _iter_admin_assets(self, studio: Studio) -> list[AdminAssetSummary]:
        referenced_paths = self._referenced_asset_paths(studio)
        assets: list[AdminAssetSummary] = []
        try:
            stored_assets = self._asset_storage.iter_studio_assets(studio.studio_id)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        for asset in sorted(stored_assets, key=lambda item: item.relative_path):
            assets.append(
                AdminAssetSummary(
                    asset_id=self._encode_asset_id(asset.relative_path),
                    studio_id=studio.studio_id,
                    kind=_admin_asset_kind(asset),
                    filename=asset.filename,
                    relative_path=asset.relative_path,
                    size_bytes=asset.size_bytes,
                    updated_at=asset.updated_at,
                    referenced=asset.relative_path in referenced_paths,
                )
            )
        return assets

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

    def _delete_asset_file(self, relative_path: str) -> tuple[int, int]:
        try:
            return self._asset_storage.delete_file(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Asset not found.") from error

    def _delete_asset_prefix(self, relative_prefix: str) -> tuple[int, int]:
        try:
            return self._asset_storage.delete_prefix(relative_prefix)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

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
        try:
            return self._asset_storage.write_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content=content,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

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
        return self._asset_storage.persist_file(path)

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

    def _load(self) -> dict[str, Studio]:
        raw_payload = self._store.load_raw()
        return {
            studio_id: Studio.model_validate(_migrate_legacy_studio_payload(studio_payload))
            for studio_id, studio_payload in raw_payload.items()
        }

    def _save(self, payload: dict[str, Studio]) -> None:
        self._store.save_raw(self._encode_payload(payload))

    def _encode_payload(self, payload: dict[str, Studio]) -> dict[str, Any]:
        return {
            studio_id: studio.model_dump(mode="json")
            for studio_id, studio in payload.items()
        }


def _track_duration_seconds(notes: list[TrackNote]) -> float:
    if not notes:
        return 0
    return round(max(note.onset_seconds + note.duration_seconds for note in notes), 4)


def _mark_notes_as_omr(mapped_notes: dict[int, list[TrackNote]]) -> dict[int, list[TrackNote]]:
    return {
        slot_id: [
            note.model_copy(
                update={
                    "source": "omr",
                    "extraction_method": "audiveris_omr_v0",
                }
            )
            for note in notes
        ]
        for slot_id, notes in mapped_notes.items()
    }


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


def _admin_asset_kind(asset: StoredAssetInfo) -> str:
    if asset.kind in {"upload", "generated"}:
        return asset.kind
    return "unknown"


def _studio_id_from_asset_path(relative_path: str) -> str | None:
    parts = Path(relative_path).parts
    if len(parts) >= 2 and parts[0] in {"uploads", "jobs"}:
        return parts[1]
    return None


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
