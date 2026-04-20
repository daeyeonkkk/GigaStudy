from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

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
from gigastudy_api.services.engine.harmony import generate_rule_based_harmony_candidates
from gigastudy_api.services.engine.music_theory import TRACKS, seed_notes_for_slot, track_name
from gigastudy_api.services.engine.omr import OmrUnavailableError, run_audiveris_omr
from gigastudy_api.services.engine.pdf_export import ScorePdfExportError, build_studio_score_pdf
from gigastudy_api.services.engine.scoring import build_scoring_report
from gigastudy_api.services.engine.symbolic import SymbolicParseError, parse_symbolic_file_with_metadata
from gigastudy_api.services.engine.voice import VoiceTranscriptionError, transcribe_voice_file


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


OMR_SOURCE_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}


class StudioRepository:
    def __init__(self, storage_root: str) -> None:
        self._root = Path(storage_root)
        self._path = self._root / "six_track_studios.json"
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
        bpm: int,
        start_mode: str,
        time_signature_numerator: int = 4,
        time_signature_denominator: int = 4,
        source_kind: SeedSourceKind | None = None,
        source_filename: str | None = None,
        source_content_base64: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Studio:
        timestamp = _now()
        studio = Studio(
            studio_id=uuid4().hex,
            title=title.strip(),
            bpm=bpm,
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

    def complete_recording(self, studio_id: str, slot_id: int) -> Studio:
        studio = self.get_studio(studio_id)
        return self._update_track(
            studio_id,
            slot_id,
            source_kind="recording",
            source_label="Recorded take",
            notes=seed_notes_for_slot(
                slot_id,
                studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            ),
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
            "audio": (".wav", ".mp3", ".m4a", ".ogg", ".flac"),
            "midi": (".mid", ".midi"),
            "score": (".musicxml", ".xml", ".mxl", ".pdf", ".png", ".jpg", ".jpeg"),
        }
        filename = request.filename.strip()
        suffix = Path(filename).suffix.lower()
        if not filename.lower().endswith(allowed_suffixes[request.source_kind]):
            raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")

        studio = self.get_studio(studio_id)
        if request.content_base64 is None:
            track = self._find_track(studio, slot_id)
            if _track_has_content(track) and not request.allow_overwrite:
                raise HTTPException(
                    status_code=409,
                    detail="Upload would overwrite an existing registered track.",
                )
            return self._update_track(
                studio_id,
                slot_id,
                source_kind=request.source_kind,
                source_label=filename,
                notes=seed_notes_for_slot(
                    slot_id,
                    studio.bpm,
                    time_signature_numerator=studio.time_signature_numerator,
                    time_signature_denominator=studio.time_signature_denominator,
                ),
            )

        source_path = self._save_upload(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=request.content_base64,
        )

        try:
            if request.source_kind == "midi" or suffix in {".musicxml", ".xml", ".mxl"}:
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
                        source_kind=request.source_kind,
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
                    source_kind=request.source_kind,
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
        source_path = self._save_upload(
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

    def _update_track(
        self,
        studio_id: str,
        slot_id: int,
        *,
        source_kind: SourceKind,
        source_label: str,
        notes: list[TrackNote],
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
        if source_content_base64 is not None:
            studio = self._seed_from_upload_content(
                studio,
                source_kind=source_kind,
                source_filename=source_filename,
                source_content_base64=source_content_base64,
            )
            return studio

        timestamp = _now()
        if source_kind == "score":
            seed_slots = [1, 2, 3, 4, 5] if "aca" in source_filename.lower() or "satb" in source_filename.lower() else [1]
        else:
            seed_slots = [1, 5, 6]

        for slot_id in seed_slots:
            track = self._find_track(studio, slot_id)
            track.status = "registered"
            track.source_kind = source_kind
            track.source_label = source_filename
            track.duration_seconds = 8
            track.notes = seed_notes_for_slot(
                slot_id,
                studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            )
            track.updated_at = timestamp

        studio.updated_at = timestamp
        return studio

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

        if source_kind == "score" and suffix in {".musicxml", ".xml", ".mxl"}:
            try:
                parsed_symbolic = parse_symbolic_file_with_metadata(source_path, bpm=studio.bpm)
            except SymbolicParseError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            if parsed_symbolic.has_time_signature:
                studio.time_signature_numerator = parsed_symbolic.time_signature_numerator
                studio.time_signature_denominator = parsed_symbolic.time_signature_denominator
            timestamp = _now()
            for slot_id, notes in parsed_symbolic.mapped_notes.items():
                track = self._find_track(studio, slot_id)
                track.status = "registered"
                track.source_kind = "score"
                track.source_label = source_filename
                track.duration_seconds = _track_duration_seconds(notes)
                track.notes = notes
                track.updated_at = timestamp
            studio.updated_at = timestamp
            return studio

        return self._seed_from_upload(
            studio,
            source_kind=source_kind,
            source_filename=source_filename,
            source_content_base64=None,
        )

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
            input_path=str(source_path),
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
            mapped_notes = _mark_notes_as_omr(parsed_symbolic.mapped_notes)
        except (OmrUnavailableError, SymbolicParseError) as error:
            self._mark_job_failed(studio_id, job_id, message=str(error))
            return

        if parsed_symbolic.has_time_signature:
            self._update_time_signature(
                studio_id,
                parsed_symbolic.time_signature_numerator,
                parsed_symbolic.time_signature_denominator,
            )
        self._mark_job_completed(studio_id, job_id, output_path=output_path)
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
                    variant_label=f"Candidate {index}",
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

    def _mark_job_completed(self, studio_id: str, job_id: str, *, output_path: Path) -> None:
        with self._lock:
            payload = self._load()
            studio = payload.get(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = _now()
            for job in studio.jobs:
                if job.job_id == job_id:
                    job.status = "completed"
                    job.output_path = str(output_path)
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
            track.duration_seconds = 0
        track.updated_at = timestamp

    def _save_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
    ) -> Path:
        content = _decode_base64(content_base64)
        safe_filename = Path(filename).name
        upload_dir = self._root / "uploads" / studio_id / str(slot_id)
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{uuid4().hex}-{safe_filename}"
        path.write_bytes(content)
        return path

    def _job_output_dir(self, studio_id: str, job_id: str) -> Path:
        return self._root / "jobs" / studio_id / job_id

    def _load(self) -> dict[str, Studio]:
        if not self._path.exists():
            return {}
        raw_payload = json.loads(self._path.read_text(encoding="utf-8"))
        return {
            studio_id: Studio.model_validate(studio_payload)
            for studio_id, studio_payload in raw_payload.items()
        }

    def _save(self, payload: dict[str, Studio]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        encoded = {
            studio_id: studio.model_dump(mode="json")
            for studio_id, studio in payload.items()
        }
        self._path.write_text(
            json.dumps(encoded, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


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


def _track_has_content(track: TrackSlot) -> bool:
    return track.status == "registered" or bool(track.notes)


def _decode_base64(content_base64: str) -> bytes:
    payload = content_base64.split(",", 1)[1] if "," in content_base64 else content_base64
    try:
        return base64.b64decode(payload, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid base64 upload content.") from error


_repository: StudioRepository | None = None


def get_studio_repository() -> StudioRepository:
    global _repository
    if _repository is None:
        _repository = StudioRepository(get_settings().storage_root)
    return _repository
