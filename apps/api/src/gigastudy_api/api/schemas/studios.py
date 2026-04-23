from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

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
SourceKind = Literal["recording", "audio", "midi", "score", "music", "ai"]
StartMode = Literal["blank", "upload"]
SeedSourceKind = Literal["score", "music"]
NoteSource = Literal["musicxml", "midi", "omr", "voice", "ai", "recording", "audio"]
ExtractionJobStatus = Literal["queued", "running", "needs_review", "completed", "failed"]
ExtractionJobType = Literal["omr", "voice"]
ExtractionCandidateStatus = Literal["pending", "approved", "rejected"]
TimeSignatureDenominator = Literal[1, 2, 4, 8, 16, 32]


class TrackNote(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    label: str
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


ScoreNote = TrackNote


class TrackExtractionJob(BaseModel):
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


class ExtractionCandidate(BaseModel):
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
    created_at: str
    updated_at: str


class TrackSlot(BaseModel):
    slot_id: int
    name: str
    status: TrackStatus
    sync_offset_seconds: float = 0
    source_kind: SourceKind | None = None
    source_label: str | None = None
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    duration_seconds: float = 0
    notes: list[TrackNote] = Field(default_factory=list)
    updated_at: str


class ReportIssue(BaseModel):
    at_seconds: float
    issue_type: Literal["pitch", "rhythm", "pitch_rhythm", "missing", "extra"]
    severity: Literal["info", "warn", "error"] = "warn"
    answer_note_id: str | None = None
    performance_note_id: str | None = None
    answer_label: str | None = None
    performance_label: str | None = None
    expected_at_seconds: float | None = None
    actual_at_seconds: float | None = None
    timing_error_seconds: float | None = None
    pitch_error_semitones: float | None = None
    message: str | None = None
    correction_hint: str | None = None


class ScoringReport(BaseModel):
    report_id: str
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
    mean_abs_pitch_error_semitones: float | None = None
    mean_abs_timing_error_seconds: float | None = None
    pitch_summary: str = ""
    rhythm_summary: str = ""
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


class StudioListItem(BaseModel):
    studio_id: str
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    registered_track_count: int
    report_count: int
    updated_at: str


class CreateStudioRequest(BaseModel):
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


class UploadTrackRequest(BaseModel):
    source_kind: Literal["audio", "midi", "score"]
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


class DirectUploadRequest(BaseModel):
    source_kind: Literal["audio", "midi", "score"]
    filename: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(ge=1)
    content_type: str | None = Field(default=None, max_length=120)


class StudioSeedUploadRequest(BaseModel):
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


class ScoreTrackRequest(BaseModel):
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
