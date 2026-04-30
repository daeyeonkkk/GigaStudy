from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from gigastudy_api.api.schemas.studios import (
    DirectUploadRequest,
    DirectUploadTarget,
    SeedSourceKind,
    SourceKind,
    Studio,
    StudioSeedUploadRequest,
    UploadTrackRequest,
)
from gigastudy_api.services.engine.candidate_diagnostics import track_duration_seconds
from gigastudy_api.services.engine.symbolic import (
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import register_track_material, track_has_content
from gigastudy_api.services.studio_home_audio_import import extract_home_audio_candidate
from gigastudy_api.services.upload_policy import (
    AUDIO_SOURCE_SUFFIXES,
    OMR_SOURCE_SUFFIXES,
    SYMBOLIC_SOURCE_SUFFIXES,
    guess_audio_mime_type,
    validate_studio_seed_upload_filename,
    validate_track_upload_filename,
)


class StudioUploadCommands:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        now: Callable[[], str],
        repository: Any,
    ) -> None:
        self._assets = assets
        self._now = now
        self._repository = repository

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
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._repository._find_track(studio, slot_id)
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
            validate_track_upload_owner=self.validate_track_upload_owner,
        )

    def validate_track_upload_owner(self, studio_id: str, slot_id: int) -> None:
        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
        if studio is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        self._repository._find_track(studio, slot_id)

    def upload_track(
        self,
        studio_id: str,
        slot_id: int,
        request: UploadTrackRequest,
        *,
        owner_token: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        filename, suffix = validate_track_upload_filename(request.source_kind, request.filename)

        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._repository._find_track(studio, slot_id)

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
                    self._repository._update_time_signature(
                        studio_id,
                        parsed_symbolic.time_signature_numerator,
                        parsed_symbolic.time_signature_denominator,
                    )
                mapped_notes = parsed_symbolic.mapped_notes
                if request.review_before_register:
                    return self._repository._add_extraction_candidates(
                        studio_id,
                        mapped_notes,
                        source_kind=registered_source_kind,
                        source_label=filename,
                        method="symbolic_import_review",
                        confidence=0.92,
                        message="Symbolic import is waiting for user approval.",
                    )
                if self._repository._mapped_notes_would_overwrite(studio, mapped_notes) and not request.allow_overwrite:
                    raise HTTPException(
                        status_code=409,
                        detail="Upload would overwrite an existing registered track.",
                    )
                return self._repository._apply_extracted_tracks(
                    studio_id,
                    mapped_notes,
                    source_kind=registered_source_kind,
                    source_label=filename,
                )

            if request.source_kind == "audio":
                track = self._repository._find_track(studio, slot_id)
                if track_has_content(track) and not request.allow_overwrite and not request.review_before_register:
                    raise HTTPException(
                        status_code=409,
                        detail="Upload would overwrite an existing registered track.",
                    )
                return self._repository._enqueue_voice_job(
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
                return self._repository._enqueue_omr_job(
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

    def seed_from_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
        source_asset_path: str | None,
    ) -> Studio:
        source_path = self.prepare_studio_seed_upload(
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
            timestamp = self._now()
            registrations = self._repository._prepare_registration_batch(
                studio,
                parsed_symbolic.mapped_notes,
                source_kind=registered_source_kind,
            )
            for slot_id in parsed_symbolic.mapped_notes:
                track = self._repository._find_track(studio, slot_id)
                registration = registrations[slot_id]
                register_track_material(
                    track,
                    timestamp=timestamp,
                    source_kind=registered_source_kind,
                    source_label=source_filename,
                    notes=registration.notes,
                    duration_seconds=track_duration_seconds(registration.notes),
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
                    transcribe_with_alignment=self._repository._transcribe_voice_file_with_alignment,
                )
            except VoiceTranscriptionError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            audio_source_path = self._assets.relative_data_asset_path(source_path)
            self._assets.replace_audio_asset_with_aligned_wav(
                relative_audio_path=audio_source_path,
                source_path=source_path,
                source_label=source_filename,
                audio_mime_type=guess_audio_mime_type(source_filename),
                transcription=transcription,
            )
            self._repository._append_initial_candidate(
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
                audio_mime_type=guess_audio_mime_type(source_filename),
            )
            return studio

        raise HTTPException(status_code=422, detail="Unsupported upload processing path.")

    def prepare_studio_seed_upload(
        self,
        studio: Studio,
        *,
        source_kind: SeedSourceKind,
        source_filename: str,
        source_content_base64: str | None,
        source_asset_path: str | None,
    ) -> Path:
        filename, _suffix = validate_studio_seed_upload_filename(source_kind, source_filename)
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
