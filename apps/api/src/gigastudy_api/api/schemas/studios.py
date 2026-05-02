from math import isfinite
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

TrackStatus = Literal[
    "empty",
    "recording",
    "uploading",
    "extracting",
    "generating",
    "needs_review",
    "registered",
    "failed",
]
SourceKind = Literal["recording", "audio", "midi", "document", "music", "ai"]
ScoreMode = Literal["answer", "harmony"]
StartMode = Literal["blank", "upload"]
SeedSourceKind = Literal["document", "music"]
NoteSource = Literal["musicxml", "midi", "omr", "voice", "ai", "recording", "audio"]
ExtractionJobStatus = Literal["queued", "running", "needs_review", "completed", "failed"]
ExtractionJobType = Literal["omr", "voice"]
ExtractionCandidateStatus = Literal["pending", "approved", "rejected"]
TimeSignatureDenominator = Literal[1, 2, 4, 8, 16, 32]


def _normalize_source_kind(value: Any) -> Any:
    return "document" if value == "score" else value


class SourceKindModel(BaseModel):
    @field_validator("source_kind", mode="before", check_fields=False)
    @classmethod
    def normalize_source_kind(cls, value: Any) -> Any:
        return _normalize_source_kind(value)


class TrackNote(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    label: str
    spelled_label: str | None = None
    accidental: str | None = None
    clef: str | None = None
    key_signature: str | None = None
    display_octave_shift: int = 0
    onset_seconds: float = 0
    duration_seconds: float = 0
    beat: float
    duration_beats: float
    measure_index: int | None = None
    beat_in_measure: float | None = None
    confidence: float = Field(default=1, ge=0, le=1)
    source: NoteSource
    extraction_method: str = "unknown"
    is_rest: bool = False
    is_tied: bool = False
    voice_index: int | None = None
    staff_index: int | None = None
    quantization_grid: float | None = None
    notation_warnings: list[str] = Field(default_factory=list)

class PitchEvent(BaseModel):
    event_id: str
    track_slot_id: int
    region_id: str
    label: str
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    start_seconds: float
    duration_seconds: float
    start_beat: float
    duration_beats: float
    confidence: float = Field(default=1, ge=0, le=1)
    source: NoteSource
    extraction_method: str = "unknown"
    is_rest: bool = False
    measure_index: int | None = None
    beat_in_measure: float | None = None
    quality_warnings: list[str] = Field(default_factory=list)


class ArrangementRegion(SourceKindModel):
    region_id: str
    track_slot_id: int
    track_name: str
    source_kind: SourceKind | None = None
    source_label: str | None = None
    audio_source_path: str | None = None
    audio_mime_type: str | None = None
    start_seconds: float
    duration_seconds: float
    sync_offset_seconds: float = 0
    volume_percent: int = Field(default=100, ge=0, le=100)
    pitch_events: list[PitchEvent] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class CandidateRegion(SourceKindModel):
    region_id: str
    suggested_slot_id: int
    source_kind: SourceKind
    source_label: str
    start_seconds: float
    duration_seconds: float
    pitch_events: list[PitchEvent] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class TrackExtractionJob(SourceKindModel):
    job_id: str
    job_type: ExtractionJobType = "omr"
    slot_id: int
    source_kind: SourceKind
    source_label: str
    status: ExtractionJobStatus
    method: str
    message: str | None = None
    input_path: str | None = None
    output_path: str | None = None
    attempt_count: int = Field(default=0, ge=0)
    max_attempts: int = Field(default=3, ge=1)
    parse_all_parts: bool = False
    review_before_register: bool = False
    allow_overwrite: bool = False
    audio_mime_type: str | None = None
    created_at: str
    updated_at: str


class ExtractionCandidate(SourceKindModel):
    candidate_id: str
    candidate_group_id: str | None = None
    suggested_slot_id: int
    source_kind: SourceKind
    source_label: str
    method: str
    variant_label: str | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    status: ExtractionCandidateStatus = "pending"
    notes: list[TrackNote] = Field(default_factory=list)
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    job_id: str | None = None
    message: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

    @computed_field(return_type=CandidateRegion)
    @property
    def region(self) -> CandidateRegion:
        return build_candidate_region(self)


class TrackSlot(SourceKindModel):
    slot_id: int
    name: str
    status: TrackStatus
    sync_offset_seconds: float = 0
    volume_percent: int = Field(default=100, ge=0, le=100)
    source_kind: SourceKind | None = None
    source_label: str | None = None
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    duration_seconds: float = 0
    notes: list[TrackNote] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    updated_at: str


def build_arrangement_regions(tracks: list[TrackSlot], bpm: int) -> list[ArrangementRegion]:
    return [
        region
        for track in tracks
        if (region := _build_track_region(track, bpm)) is not None
    ]


def _build_track_region(track: TrackSlot, bpm: int) -> ArrangementRegion | None:
    if track.status != "registered" or (not track.notes and not track.audio_source_path):
        return None

    region_id = f"track-{track.slot_id}-region-1"
    pitch_events = [
        _pitch_event_from_note(note, track=track, region_id=region_id, bpm=bpm)
        for note in sorted(track.notes, key=lambda item: (item.beat, item.id))
    ]
    region_start = track.sync_offset_seconds
    event_end_seconds = max(
        (event.start_seconds + event.duration_seconds for event in pitch_events),
        default=region_start,
    )
    content_duration = max(
        4.0,
        track.duration_seconds,
        event_end_seconds - region_start,
    )
    return ArrangementRegion(
        region_id=region_id,
        track_slot_id=track.slot_id,
        track_name=track.name,
        source_kind=track.source_kind,
        source_label=track.source_label,
        audio_source_path=track.audio_source_path,
        audio_mime_type=track.audio_mime_type,
        start_seconds=region_start,
        duration_seconds=content_duration,
        sync_offset_seconds=track.sync_offset_seconds,
        volume_percent=track.volume_percent,
        pitch_events=pitch_events,
        diagnostics=track.diagnostics,
    )


def _pitch_event_from_note(
    note: TrackNote,
    *,
    track: TrackSlot,
    region_id: str,
    bpm: int,
) -> PitchEvent:
    return PitchEvent(
        event_id=f"{region_id}-{note.id}",
        track_slot_id=track.slot_id,
        region_id=region_id,
        label=note.label,
        pitch_midi=note.pitch_midi,
        pitch_hz=note.pitch_hz,
        start_seconds=track.sync_offset_seconds + _note_start_seconds(note, bpm),
        duration_seconds=_note_duration_seconds(note, bpm),
        start_beat=note.beat,
        duration_beats=note.duration_beats,
        confidence=note.confidence,
        source=note.source,
        extraction_method=note.extraction_method,
        is_rest=note.is_rest,
        measure_index=note.measure_index,
        beat_in_measure=note.beat_in_measure,
        quality_warnings=note.notation_warnings,
    )


def _note_start_seconds(note: TrackNote, bpm: int) -> float:
    if isfinite(note.onset_seconds) and note.onset_seconds > 0:
        return note.onset_seconds
    return max(0.0, (note.beat - 1) * _beat_seconds(bpm))


def _note_duration_seconds(note: TrackNote, bpm: int) -> float:
    if isfinite(note.duration_seconds) and note.duration_seconds > 0:
        return note.duration_seconds
    return max(0.08, note.duration_beats * _beat_seconds(bpm))


def _beat_seconds(bpm: int) -> float:
    return 60 / max(1, bpm)


def build_candidate_region(candidate: ExtractionCandidate) -> CandidateRegion:
    region_id = f"candidate-{candidate.candidate_id}-region-1"
    pitch_events = [
        _candidate_pitch_event_from_note(note, candidate=candidate, region_id=region_id)
        for note in sorted(candidate.notes, key=lambda item: (item.beat, item.id))
    ]
    region_start = min((event.start_seconds for event in pitch_events), default=0.0)
    region_end = max(
        (event.start_seconds + event.duration_seconds for event in pitch_events),
        default=region_start,
    )
    return CandidateRegion(
        region_id=region_id,
        suggested_slot_id=candidate.suggested_slot_id,
        source_kind=candidate.source_kind,
        source_label=candidate.source_label,
        start_seconds=region_start,
        duration_seconds=max(4.0, region_end - region_start),
        pitch_events=pitch_events,
        diagnostics=candidate.diagnostics,
    )


def _candidate_pitch_event_from_note(
    note: TrackNote,
    *,
    candidate: ExtractionCandidate,
    region_id: str,
) -> PitchEvent:
    return PitchEvent(
        event_id=f"{region_id}-{note.id}",
        track_slot_id=candidate.suggested_slot_id,
        region_id=region_id,
        label=note.label,
        pitch_midi=note.pitch_midi,
        pitch_hz=note.pitch_hz,
        start_seconds=note.onset_seconds if isfinite(note.onset_seconds) else max(0.0, note.beat - 1),
        duration_seconds=note.duration_seconds if isfinite(note.duration_seconds) and note.duration_seconds > 0 else max(0.08, note.duration_beats),
        start_beat=note.beat,
        duration_beats=note.duration_beats,
        confidence=note.confidence,
        source=note.source,
        extraction_method=note.extraction_method,
        is_rest=note.is_rest,
        measure_index=note.measure_index,
        beat_in_measure=note.beat_in_measure,
        quality_warnings=note.notation_warnings,
    )


class ReportIssue(BaseModel):
    at_seconds: float
    issue_type: Literal[
        "pitch",
        "rhythm",
        "pitch_rhythm",
        "missing",
        "extra",
        "harmony",
        "chord_fit",
        "range",
        "spacing",
        "voice_leading",
        "crossing",
        "parallel_motion",
        "tension_resolution",
        "bass_foundation",
        "chord_coverage",
    ]
    severity: Literal["info", "warn", "error"] = "warn"
    answer_note_id: str | None = None
    performance_note_id: str | None = None
    answer_region_id: str | None = None
    answer_event_id: str | None = None
    performance_region_id: str | None = None
    performance_event_id: str | None = None
    answer_label: str | None = None
    performance_label: str | None = None
    expected_at_seconds: float | None = None
    actual_at_seconds: float | None = None
    expected_beat: float | None = None
    actual_beat: float | None = None
    timing_error_seconds: float | None = None
    pitch_error_semitones: float | None = None
    message: str | None = None
    correction_hint: str | None = None


class ScoringReport(BaseModel):
    report_id: str
    score_mode: ScoreMode = "answer"
    target_slot_id: int
    target_track_name: str
    reference_slot_ids: list[int]
    include_metronome: bool
    created_at: str
    answer_note_count: int = 0
    performance_note_count: int = 0
    matched_note_count: int = 0
    missing_note_count: int = 0
    extra_note_count: int = 0
    alignment_offset_seconds: float = 0
    overall_score: float = 0
    pitch_score: float = 0
    rhythm_score: float = 0
    harmony_score: float | None = None
    chord_fit_score: float | None = None
    range_score: float | None = None
    spacing_score: float | None = None
    voice_leading_score: float | None = None
    arrangement_score: float | None = None
    mean_abs_pitch_error_semitones: float | None = None
    mean_abs_timing_error_seconds: float | None = None
    pitch_summary: str = ""
    rhythm_summary: str = ""
    harmony_summary: str = ""
    issues: list[ReportIssue]


class Studio(BaseModel):
    studio_id: str
    owner_token_hash: str | None = Field(default=None, exclude=True)
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    tracks: list[TrackSlot]
    reports: list[ScoringReport]
    jobs: list[TrackExtractionJob] = Field(default_factory=list)
    candidates: list[ExtractionCandidate] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @computed_field(return_type=list[ArrangementRegion])
    @property
    def regions(self) -> list[ArrangementRegion]:
        return build_arrangement_regions(self.tracks, self.bpm)


class TrackSlotResponse(SourceKindModel):
    slot_id: int
    name: str
    status: TrackStatus
    sync_offset_seconds: float = 0
    volume_percent: int = Field(default=100, ge=0, le=100)
    source_kind: SourceKind | None = None
    source_label: str | None = None
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    duration_seconds: float = 0
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    updated_at: str


class ExtractionCandidateResponse(SourceKindModel):
    candidate_id: str
    candidate_group_id: str | None = None
    suggested_slot_id: int
    source_kind: SourceKind
    source_label: str
    method: str
    variant_label: str | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    status: ExtractionCandidateStatus = "pending"
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    job_id: str | None = None
    message: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    region: CandidateRegion
    created_at: str
    updated_at: str


class StudioResponse(BaseModel):
    studio_id: str
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    tracks: list[TrackSlotResponse]
    regions: list[ArrangementRegion]
    reports: list[ScoringReport]
    jobs: list[TrackExtractionJob] = Field(default_factory=list)
    candidates: list[ExtractionCandidateResponse] = Field(default_factory=list)
    created_at: str
    updated_at: str


def build_studio_response(studio: Studio) -> StudioResponse:
    return StudioResponse(
        studio_id=studio.studio_id,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        tracks=[
            TrackSlotResponse.model_validate(track.model_dump(mode="json", exclude={"notes"}))
            for track in studio.tracks
        ],
        regions=studio.regions,
        reports=studio.reports,
        jobs=studio.jobs,
        candidates=[
            ExtractionCandidateResponse.model_validate(
                candidate.model_dump(mode="json", exclude={"notes"})
            )
            for candidate in studio.candidates
        ],
        created_at=studio.created_at,
        updated_at=studio.updated_at,
    )


class StudioListItem(BaseModel):
    studio_id: str
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    registered_track_count: int
    report_count: int
    updated_at: str


class CreateStudioRequest(SourceKindModel):
    title: str = Field(min_length=1, max_length=100)
    bpm: int | None = Field(default=None, ge=40, le=240)
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    start_mode: StartMode
    source_kind: SeedSourceKind | None = None
    source_filename: str | None = Field(default=None, max_length=180)
    source_content_base64: str | None = None
    source_asset_path: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_start_contract(self) -> "CreateStudioRequest":
        if self.start_mode == "blank" and self.bpm is None:
            raise ValueError("Blank studio start requires BPM.")
        if self.start_mode == "blank" and (self.source_content_base64 or self.source_asset_path):
            raise ValueError("Blank studio start cannot include a source file.")
        if self.start_mode == "upload":
            if self.source_kind is None:
                raise ValueError("Upload start requires a source kind.")
            has_inline_content = bool(self.source_content_base64)
            has_asset_path = bool(self.source_asset_path)
            if not self.source_filename or has_inline_content == has_asset_path:
                raise ValueError("Upload start requires a source file.")
        return self


class UploadTrackRequest(SourceKindModel):
    source_kind: Literal["audio", "midi", "document"]
    filename: str = Field(min_length=1, max_length=180)
    content_base64: str | None = Field(default=None, min_length=1)
    asset_path: str | None = Field(default=None, min_length=1)
    review_before_register: bool = False
    allow_overwrite: bool = False

    @model_validator(mode="after")
    def validate_upload_source(self) -> "UploadTrackRequest":
        has_inline_content = bool(self.content_base64)
        has_asset_path = bool(self.asset_path)
        if has_inline_content == has_asset_path:
            raise ValueError("Track upload requires exactly one of content_base64 or asset_path.")
        return self


class DirectUploadRequest(SourceKindModel):
    source_kind: Literal["audio", "midi", "document"]
    filename: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(ge=1)
    content_type: str | None = Field(default=None, max_length=120)


class StudioSeedUploadRequest(SourceKindModel):
    source_kind: SeedSourceKind
    filename: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(ge=1)
    content_type: str | None = Field(default=None, max_length=120)


class DirectUploadTarget(BaseModel):
    asset_id: str
    asset_path: str
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_at: str
    max_bytes: int


class GenerateTrackRequest(BaseModel):
    context_slot_ids: list[int] = Field(default_factory=list)
    allow_overwrite: bool = False
    review_before_register: bool = True
    candidate_count: int = Field(default=3, ge=1, le=5)


class SyncTrackRequest(BaseModel):
    sync_offset_seconds: float = Field(ge=-30, le=30)


class ShiftTrackSyncRequest(BaseModel):
    delta_seconds: float = Field(ge=-10, le=10)


class VolumeTrackRequest(BaseModel):
    volume_percent: int = Field(ge=0, le=100)


class ScoreTrackRequest(BaseModel):
    score_mode: ScoreMode = "answer"
    reference_slot_ids: list[int] = Field(default_factory=list)
    include_metronome: bool = False
    performance_notes: list[TrackNote] = Field(default_factory=list)
    performance_audio_base64: str | None = None
    performance_filename: str | None = Field(default=None, max_length=180)


class ApproveCandidateRequest(BaseModel):
    target_slot_id: int | None = Field(default=None, ge=1, le=6)
    allow_overwrite: bool = False


class ApproveJobCandidatesRequest(BaseModel):
    allow_overwrite: bool = False
