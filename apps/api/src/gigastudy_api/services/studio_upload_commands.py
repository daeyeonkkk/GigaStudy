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
    midi_seed_empty_named_parts,
    parse_symbolic_file_with_metadata,
    symbolic_seed_review_reasons,
)
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import register_track_material, studio_has_active_track_material
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs
from gigastudy_api.services.upload_policy import (
    SYMBOLIC_SOURCE_SUFFIXES,
    validate_studio_seed_upload_filename,
    validate_track_upload_filename,
)
from gigastudy_api.config import get_settings
from gigastudy_api.services.llm.midi_role_review import (
    apply_midi_role_review_instruction,
    review_midi_roles_with_deepseek,
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
        ensure_no_active_extraction_jobs(
            studio,
            {slot_id},
            action_label="Upload preparation",
        )
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
        filename, _suffix = validate_track_upload_filename(request.source_kind, request.filename)

        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        self._repository._find_track(studio, slot_id)
        ensure_no_active_extraction_jobs(
            studio,
            {slot_id},
            action_label="Upload",
        )

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
            if request.source_kind == "audio":
                if (
                    studio_has_active_track_material(studio, slot_id)
                    and not request.allow_overwrite
                    and not request.review_before_register
                ):
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
        use_source_tempo: bool = True,
    ) -> Studio:
        source_path = self.prepare_studio_seed_upload(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=source_content_base64,
            source_asset_path=source_asset_path,
        )
        suffix = source_path.suffix.lower()

        if source_kind == "document" and suffix in SYMBOLIC_SOURCE_SUFFIXES:
            try:
                parsed_symbolic = parse_symbolic_file_with_metadata(source_path, bpm=studio.bpm)
                if use_source_tempo and parsed_symbolic.source_bpm is not None:
                    studio.bpm = parsed_symbolic.source_bpm
                    parsed_symbolic = parse_symbolic_file_with_metadata(source_path, bpm=studio.bpm)
            except SymbolicParseError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            registered_source_kind: SourceKind = "midi" if suffix in {".mid", ".midi"} else "document"
            if parsed_symbolic.has_time_signature:
                studio.time_signature_numerator = parsed_symbolic.time_signature_numerator
                studio.time_signature_denominator = parsed_symbolic.time_signature_denominator
            if suffix in {".mid", ".midi"}:
                midi_role_instruction = review_midi_roles_with_deepseek(
                    settings=get_settings(),
                    title=studio.title,
                    source_label=source_filename,
                    parsed_symbolic=parsed_symbolic,
                )
                apply_midi_role_review_instruction(
                    parsed_symbolic=parsed_symbolic,
                    instruction=midi_role_instruction,
                    bpm=studio.bpm,
                )
            review_reasons = symbolic_seed_review_reasons(parsed_symbolic, source_suffix=suffix)
            if review_reasons:
                review_reason_text = ", ".join(review_reasons)
                empty_named_parts = midi_seed_empty_named_parts(parsed_symbolic)
                diagnostics_by_slot = {
                    track.slot_id: dict(track.diagnostics)
                    for track in parsed_symbolic.tracks
                    if track.slot_id in parsed_symbolic.mapped_events
                }
                for slot_id, events in parsed_symbolic.mapped_events.items():
                    self._repository._append_initial_candidate(
                        studio,
                        suggested_slot_id=slot_id,
                        source_kind=registered_source_kind,
                        source_label=source_filename,
                        method="midi_seed_review",
                        confidence=0.68,
                        events=events,
                        message=(
                            "MIDI parts need review before registration because some material still "
                            f"looks ambiguous after voice-role analysis ({review_reason_text})."
                        ),
                        source_diagnostics={
                            **diagnostics_by_slot.get(slot_id, {}),
                            "seed_review_reasons": review_reasons,
                            "source_suffix": suffix,
                            "midi_named_empty_parts": empty_named_parts,
                        },
                    )
                return studio
            timestamp = self._now()
            registrations = self._repository._prepare_registration_batch(
                studio,
                parsed_symbolic.mapped_events,
                source_kind=registered_source_kind,
            )
            for slot_id in parsed_symbolic.mapped_events:
                track = self._repository._find_track(studio, slot_id)
                registration = registrations[slot_id]
                register_track_material(
                    studio,
                    track,
                    timestamp=timestamp,
                    source_kind=registered_source_kind,
                    source_label=source_filename,
                    events=registration.events,
                    duration_seconds=track_duration_seconds(registration.events),
                    registration_diagnostics=registration.diagnostics,
                )
            studio.updated_at = timestamp
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
