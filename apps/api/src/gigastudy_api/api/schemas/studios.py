from math import isfinite
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from gigastudy_api.domain.track_events import PitchEventSource as EventSource, TrackPitchEvent as _TrackPitchEvent
from gigastudy_api.services.engine.event_normalization import (
    enforce_monophonic_vocal_events,
    merge_contiguous_same_pitch_events,
)
from gigastudy_api.services.studio_time import (
    STUDIO_TIME_PRECISION_SECONDS,
    clamp_studio_duration_seconds,
    studio_time_precision_beats,
)

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
SourceKind = Literal["recording", "audio", "midi", "document", "ai"]
ScoreMode = Literal["answer", "harmony"]
StartMode = Literal["blank", "upload"]
SeedSourceKind = Literal["document"]
TrackMaterialArchiveReason = Literal["original_score", "before_overwrite"]
ExtractionJobStatus = Literal[
    "tempo_review_required",
    "queued",
    "running",
    "needs_review",
    "completed",
    "failed",
]
ExtractionJobType = Literal["document", "voice", "generation", "scoring"]
JobProgressStage = Literal[
    "queued",
    "preparing",
    "reading_source",
    "analyzing",
    "mapping_parts",
    "normalizing",
    "registering",
    "reviewing",
    "scoring",
    "completed",
    "failed",
]
StudioResponseView = Literal["full", "studio", "edit", "practice"]
ExtractionCandidateStatus = Literal["pending", "approved", "rejected"]
TimeSignatureDenominator = Literal[1, 2, 4, 8, 16, 32]


class SourceKindModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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
    source: EventSource
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


class TrackMaterialArchive(SourceKindModel):
    archive_id: str
    track_slot_id: int
    track_name: str
    source_kind: SourceKind | None = None
    source_label: str | None = None
    archived_at: str
    reason: TrackMaterialArchiveReason
    pinned: bool = False
    region_snapshots: list[ArrangementRegion] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def migrate_single_region_snapshot(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "region_snapshots" in data or "region_snapshot" not in data:
            return data
        migrated = dict(data)
        region_snapshot = migrated.pop("region_snapshot")
        migrated["region_snapshots"] = [region_snapshot] if region_snapshot is not None else []
        return migrated


class TrackMaterialArchiveSummary(SourceKindModel):
    archive_id: str
    track_slot_id: int
    track_name: str
    source_kind: SourceKind | None = None
    source_label: str | None = None
    archived_at: str
    reason: TrackMaterialArchiveReason
    pinned: bool = False
    duration_seconds: float
    event_count: int
    has_audio: bool = False


class CandidateRegion(SourceKindModel):
    region_id: str
    suggested_slot_id: int
    source_kind: SourceKind
    source_label: str
    start_seconds: float
    duration_seconds: float
    pitch_events: list[PitchEvent] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class JobProgress(SourceKindModel):
    stage: JobProgressStage
    stage_label: str
    completed_units: int | None = Field(default=None, ge=0)
    total_units: int | None = Field(default=None, ge=1)
    unit_label: str | None = None
    estimated_seconds_remaining: int | None = Field(default=None, ge=0)
    updated_at: str


class TrackExtractionJob(SourceKindModel):
    job_id: str
    job_type: ExtractionJobType = "document"
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
    use_source_tempo: bool = False
    review_before_register: bool = False
    allow_overwrite: bool = False
    audio_mime_type: str | None = None
    progress: JobProgress | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
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
    events: list[_TrackPitchEvent] = Field(default_factory=list)
    audio_source_path: str | None = None
    audio_source_label: str | None = None
    audio_mime_type: str | None = None
    job_id: str | None = None
    message: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    region: CandidateRegion | None = None
    created_at: str
    updated_at: str


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
    events: list[_TrackPitchEvent] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    updated_at: str


def build_arrangement_regions(
    tracks: list[TrackSlot],
    bpm: int,
    *,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> list[ArrangementRegion]:
    regions: list[ArrangementRegion] = []
    for track in tracks:
        region = _build_track_region(
            track,
            bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if region is not None:
            regions.append(region)
    return regions


def _build_track_region(
    track: TrackSlot,
    bpm: int,
    *,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> ArrangementRegion | None:
    return build_arrangement_region_from_track_events(
        track,
        events=track.events,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def build_arrangement_region_from_track_events(
    track: TrackSlot,
    *,
    events: list[_TrackPitchEvent],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> ArrangementRegion | None:
    if track.status != "registered" or (not events and not track.audio_source_path):
        return None

    region_id = f"track-{track.slot_id}-region-1"
    region_events = enforce_monophonic_vocal_events(
        events,
        bpm=bpm,
        slot_id=track.slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    region_events = merge_contiguous_same_pitch_events(
        region_events,
        bpm=bpm,
        merge_policy="tied_contiguous",
    )
    pitch_events = [
        _pitch_event_from_track_event(event, track=track, region_id=region_id, bpm=bpm)
        for event in sorted(region_events, key=lambda item: (item.beat, item.id))
    ]
    region_start = track.sync_offset_seconds
    event_end_seconds = max(
        (event.start_seconds + event.duration_seconds for event in pitch_events),
        default=region_start,
    )
    content_duration = max(
        STUDIO_TIME_PRECISION_SECONDS,
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


def _pitch_event_from_track_event(
    event: _TrackPitchEvent,
    *,
    track: TrackSlot,
    region_id: str,
    bpm: int,
) -> PitchEvent:
    return PitchEvent(
        event_id=f"{region_id}-{event.id}",
        track_slot_id=track.slot_id,
        region_id=region_id,
        label=event.label,
        pitch_midi=event.pitch_midi,
        pitch_hz=event.pitch_hz,
        start_seconds=track.sync_offset_seconds + _track_event_start_seconds(event, bpm),
        duration_seconds=_track_event_duration_seconds(event, bpm),
        start_beat=event.beat,
        duration_beats=event.duration_beats,
        confidence=event.confidence,
        source=event.source,
        extraction_method=event.extraction_method,
        is_rest=event.is_rest,
        measure_index=event.measure_index,
        beat_in_measure=event.beat_in_measure,
        quality_warnings=event.quality_warnings,
    )


def _track_event_start_seconds(event: _TrackPitchEvent, bpm: int) -> float:
    if isfinite(event.onset_seconds) and event.onset_seconds > 0:
        return event.onset_seconds
    return max(0.0, (event.beat - 1) * _beat_seconds(bpm))


def _track_event_duration_seconds(event: _TrackPitchEvent, bpm: int) -> float:
    if isfinite(event.duration_seconds) and event.duration_seconds > 0:
        return event.duration_seconds
    return clamp_studio_duration_seconds(event.duration_beats * _beat_seconds(bpm))


def _beat_seconds(bpm: int) -> float:
    return 60 / max(1, bpm)


def _bpm_from_events(events: list[_TrackPitchEvent]) -> int:
    for event in events:
        if event.duration_beats > 0 and isfinite(event.duration_seconds) and event.duration_seconds > 0:
            return max(1, round(60 / (event.duration_seconds / event.duration_beats)))
    return 120


def build_candidate_region(candidate: ExtractionCandidate) -> CandidateRegion:
    region_id = f"candidate-{candidate.candidate_id}-region-1"
    candidate_events = enforce_monophonic_vocal_events(
        candidate.events,
        bpm=_bpm_from_events(candidate.events),
        slot_id=candidate.suggested_slot_id,
    )
    candidate_events = merge_contiguous_same_pitch_events(
        candidate_events,
        bpm=_bpm_from_events(candidate.events),
        merge_policy="tied_contiguous",
    )
    pitch_events = [
        _candidate_pitch_event_from_track_event(event, candidate=candidate, region_id=region_id)
        for event in sorted(candidate_events, key=lambda item: (item.beat, item.id))
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
        duration_seconds=clamp_studio_duration_seconds(region_end - region_start),
        pitch_events=pitch_events,
        diagnostics=candidate.diagnostics,
    )


def extraction_candidate_region(candidate: ExtractionCandidate) -> CandidateRegion:
    return candidate.region or build_candidate_region(candidate)


def sync_extraction_candidate_region(candidate: ExtractionCandidate) -> CandidateRegion:
    if candidate.region is not None and not candidate.events:
        return candidate.region
    candidate.region = build_candidate_region(candidate)
    return candidate.region


def _candidate_pitch_event_from_track_event(
    event: _TrackPitchEvent,
    *,
    candidate: ExtractionCandidate,
    region_id: str,
) -> PitchEvent:
    return PitchEvent(
        event_id=f"{region_id}-{event.id}",
        track_slot_id=candidate.suggested_slot_id,
        region_id=region_id,
        label=event.label,
        pitch_midi=event.pitch_midi,
        pitch_hz=event.pitch_hz,
        start_seconds=event.onset_seconds if isfinite(event.onset_seconds) else max(0.0, event.beat - 1),
        duration_seconds=event.duration_seconds
        if isfinite(event.duration_seconds) and event.duration_seconds > 0
        else clamp_studio_duration_seconds(event.duration_beats),
        start_beat=event.beat,
        duration_beats=event.duration_beats,
        confidence=event.confidence,
        source=event.source,
        extraction_method=event.extraction_method,
        is_rest=event.is_rest,
        measure_index=event.measure_index,
        beat_in_measure=event.beat_in_measure,
        quality_warnings=event.quality_warnings,
    )


class ReportIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    answer_source_event_id: str | None = None
    performance_source_event_id: str | None = None
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
    model_config = ConfigDict(extra="forbid")

    report_id: str
    score_mode: ScoreMode = "answer"
    target_slot_id: int
    target_track_name: str
    reference_slot_ids: list[int]
    include_metronome: bool
    created_at: str
    answer_event_count: int = 0
    performance_event_count: int = 0
    matched_event_count: int = 0
    missing_event_count: int = 0
    extra_event_count: int = 0
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
    client_request_id: str | None = Field(default=None, exclude=True)
    client_request_fingerprint: str | None = Field(default=None, exclude=True)
    is_active: bool = True
    deactivated_at: str | None = None
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    tracks: list[TrackSlot]
    regions: list[ArrangementRegion] = Field(default_factory=list)
    track_material_archives: list[TrackMaterialArchive] = Field(default_factory=list)
    reports: list[ScoringReport]
    jobs: list[TrackExtractionJob] = Field(default_factory=list)
    candidates: list[ExtractionCandidate] = Field(default_factory=list)
    created_at: str
    updated_at: str


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
    is_active: bool = True
    deactivated_at: str | None = None
    title: str
    bpm: int
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4
    tracks: list[TrackSlotResponse]
    regions: list[ArrangementRegion]
    track_material_archives: list[TrackMaterialArchiveSummary] = Field(default_factory=list)
    reports: list[ScoringReport]
    jobs: list[TrackExtractionJob] = Field(default_factory=list)
    candidates: list[ExtractionCandidateResponse] = Field(default_factory=list)
    created_at: str
    updated_at: str


class StudioActivityResponse(BaseModel):
    studio_id: str
    updated_at: str
    jobs: list[TrackExtractionJob] = Field(default_factory=list)
    pending_candidate_count: int
    report_count: int
    registered_track_count: int


class TrackVolumePatch(BaseModel):
    slot_id: int
    volume_percent: int = Field(ge=0, le=100)


class TrackVolumeMinimalResponse(BaseModel):
    studio_id: str
    updated_at: str
    track: TrackVolumePatch
    affected_region_ids: list[str] = Field(default_factory=list)


def studio_arrangement_regions(studio: Studio) -> list[ArrangementRegion]:
    return _merged_arrangement_regions(studio)


def sync_studio_arrangement_regions(studio: Studio) -> list[ArrangementRegion]:
    studio.regions = _merged_arrangement_regions(studio)
    _clear_track_event_shadows_for_explicit_regions(studio)
    return studio.regions


def _merged_arrangement_regions(studio: Studio) -> list[ArrangementRegion]:
    tracks_by_slot = {track.slot_id: track for track in studio.tracks}
    derived_regions = build_arrangement_regions(
        studio.tracks,
        studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )
    explicit_regions = [
        region
        for region in studio.regions
        if _should_preserve_explicit_region(region, tracks_by_slot.get(region.track_slot_id))
    ]
    explicit_slot_ids = {region.track_slot_id for region in explicit_regions}
    derived_regions = [region for region in derived_regions if region.track_slot_id not in explicit_slot_ids]
    merged_regions = [*explicit_regions, *derived_regions]
    return sorted(
        merged_regions,
        key=lambda region: (region.track_slot_id, region.start_seconds, region.region_id),
    )


def _should_preserve_explicit_region(region: ArrangementRegion, track: TrackSlot | None) -> bool:
    if track is not None and track.status == "empty":
        return False
    return bool(region.pitch_events or region.audio_source_path)


def _sanitize_arrangement_region(studio: Studio, region: ArrangementRegion) -> ArrangementRegion:
    if region.track_slot_id == 6 or not region.pitch_events:
        return region

    track_events = [
        _track_event_from_region_pitch_event(event)
        for event in region.pitch_events
    ]
    sanitized_track_events = enforce_monophonic_vocal_events(
        track_events,
        bpm=studio.bpm,
        slot_id=region.track_slot_id,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        minimum_duration_beats=studio_time_precision_beats(_beat_seconds(studio.bpm)),
    )
    if _region_event_identity(track_events) == _region_event_identity(sanitized_track_events):
        return region

    sanitized_pitch_events = [
        _region_pitch_event_from_track_event(
            event,
            region=region,
            studio=studio,
        )
        for event in sanitized_track_events
    ]
    region_start = min(
        (event.start_seconds for event in sanitized_pitch_events),
        default=region.start_seconds,
    )
    region_end = max(
        (event.start_seconds + event.duration_seconds for event in sanitized_pitch_events),
        default=region.start_seconds + region.duration_seconds,
    )
    diagnostics = dict(region.diagnostics)
    actions = list(diagnostics.get("actions", []))
    if "region_monophonic_vocal_line" not in actions:
        actions.append("region_monophonic_vocal_line")
    diagnostics["actions"] = actions
    return region.model_copy(
        update={
            "pitch_events": sanitized_pitch_events,
            "duration_seconds": round(
                max(
                    region.duration_seconds,
                    region_end - region.start_seconds,
                    region_end - region_start,
                    STUDIO_TIME_PRECISION_SECONDS,
                ),
                4,
            ),
            "diagnostics": diagnostics,
        }
    )


def _track_event_from_region_pitch_event(event: PitchEvent) -> _TrackPitchEvent:
    return _TrackPitchEvent(
        id=event.event_id,
        pitch_midi=event.pitch_midi,
        pitch_hz=event.pitch_hz,
        label=event.label,
        onset_seconds=event.start_seconds,
        duration_seconds=event.duration_seconds,
        beat=event.start_beat,
        duration_beats=event.duration_beats,
        measure_index=event.measure_index,
        beat_in_measure=event.beat_in_measure,
        confidence=event.confidence,
        source=event.source,
        extraction_method=event.extraction_method,
        is_rest=event.is_rest,
        quality_warnings=list(event.quality_warnings),
    )


def _region_pitch_event_from_track_event(
    event: _TrackPitchEvent,
    *,
    region: ArrangementRegion,
    studio: Studio,
) -> PitchEvent:
    return PitchEvent(
        event_id=event.id,
        track_slot_id=region.track_slot_id,
        region_id=region.region_id,
        label=event.label,
        pitch_midi=event.pitch_midi,
        pitch_hz=event.pitch_hz,
        start_seconds=_track_event_start_seconds(event, studio.bpm),
        duration_seconds=_track_event_duration_seconds(event, studio.bpm),
        start_beat=event.beat,
        duration_beats=event.duration_beats,
        confidence=event.confidence,
        source=event.source,
        extraction_method=event.extraction_method,
        is_rest=event.is_rest,
        measure_index=event.measure_index,
        beat_in_measure=event.beat_in_measure,
        quality_warnings=event.quality_warnings,
    )


def _region_event_identity(events: list[_TrackPitchEvent]) -> list[tuple[str, int | None, float, float]]:
    return [
        (
            event.id,
            event.pitch_midi,
            round(event.beat, 4),
            round(event.duration_beats, 4),
        )
        for event in events
    ]


def _clear_track_event_shadows_for_explicit_regions(studio: Studio) -> None:
    tracks_by_slot = {track.slot_id: track for track in studio.tracks}
    region_slot_ids = {
        region.track_slot_id
        for region in studio.regions
        if _should_preserve_explicit_region(region, tracks_by_slot.get(region.track_slot_id))
    }
    for track in studio.tracks:
        if track.slot_id in region_slot_ids and track.events:
            track.events = []


def sync_studio_candidate_regions(studio: Studio) -> list[CandidateRegion]:
    return [sync_extraction_candidate_region(candidate) for candidate in studio.candidates]


def track_material_archive_summaries(studio: Studio) -> list[TrackMaterialArchiveSummary]:
    summaries = [
        TrackMaterialArchiveSummary(
            archive_id=archive.archive_id,
            track_slot_id=archive.track_slot_id,
            track_name=archive.track_name,
            source_kind=archive.source_kind,
            source_label=archive.source_label,
            archived_at=archive.archived_at,
            reason=archive.reason,
            pinned=archive.pinned,
            duration_seconds=_archive_snapshot_duration_seconds(archive.region_snapshots),
            event_count=sum(len(region.pitch_events) for region in archive.region_snapshots),
            has_audio=any(region.audio_source_path is not None for region in archive.region_snapshots),
        )
        for archive in studio.track_material_archives
    ]
    return sorted(
        summaries,
        key=lambda archive: (
            archive.track_slot_id,
            not archive.pinned,
            archive.archived_at,
            archive.archive_id,
        ),
    )


def _archive_snapshot_duration_seconds(region_snapshots: list[ArrangementRegion]) -> float:
    if not region_snapshots:
        return 0
    start_seconds = min(region.start_seconds for region in region_snapshots)
    end_seconds = max(region.start_seconds + region.duration_seconds for region in region_snapshots)
    return max(0, end_seconds - start_seconds)


def scoring_report_summary(report: ScoringReport) -> ScoringReport:
    return report.model_copy(update={"issues": []})


def extraction_candidate_response(
    candidate: ExtractionCandidate,
    *,
    include_region_events: bool = True,
) -> ExtractionCandidateResponse:
    region = extraction_candidate_region(candidate)
    if not include_region_events:
        region = region.model_copy(update={"pitch_events": []})
    return ExtractionCandidateResponse.model_validate(
        {
            **candidate.model_dump(mode="json", exclude={"events", "region"}),
            "region": region.model_dump(mode="json"),
        }
    )


def build_studio_response(studio: Studio, *, view: StudioResponseView = "full") -> StudioResponse:
    include_report_detail = view == "full"
    include_candidate_region_events = view == "full"
    return StudioResponse(
        studio_id=studio.studio_id,
        is_active=studio.is_active,
        deactivated_at=studio.deactivated_at,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        tracks=[
            TrackSlotResponse.model_validate(track.model_dump(mode="json", exclude={"events"}))
            for track in studio.tracks
        ],
        regions=studio_arrangement_regions(studio),
        track_material_archives=track_material_archive_summaries(studio),
        reports=[
            report if include_report_detail else scoring_report_summary(report)
            for report in studio.reports
        ],
        jobs=studio.jobs,
        candidates=[
            extraction_candidate_response(
                candidate,
                include_region_events=include_candidate_region_events,
            )
            for candidate in studio.candidates
        ],
        created_at=studio.created_at,
        updated_at=studio.updated_at,
    )


def build_studio_activity_response(studio: Studio) -> StudioActivityResponse:
    return StudioActivityResponse(
        studio_id=studio.studio_id,
        updated_at=studio.updated_at,
        jobs=studio.jobs,
        pending_candidate_count=sum(1 for candidate in studio.candidates if candidate.status == "pending"),
        report_count=len(studio.reports),
        registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
    )


def build_track_volume_minimal_response(studio: Studio, slot_id: int) -> TrackVolumeMinimalResponse:
    track = next((candidate for candidate in studio.tracks if candidate.slot_id == slot_id), None)
    if track is None:
        raise ValueError("Track slot not found.")
    affected_region_ids = [
        region.region_id
        for region in studio_arrangement_regions(studio)
        if region.track_slot_id == slot_id
    ]
    return TrackVolumeMinimalResponse(
        studio_id=studio.studio_id,
        updated_at=studio.updated_at,
        track=TrackVolumePatch(slot_id=slot_id, volume_percent=track.volume_percent),
        affected_region_ids=affected_region_ids,
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
    client_request_id: str | None = Field(
        default=None,
        min_length=8,
        max_length=120,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )
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
    source_kind: Literal["audio"]
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
    source_kind: Literal["audio"]
    filename: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(ge=1)
    content_type: str | None = Field(default=None, max_length=120)


class ApproveJobTempoRequest(BaseModel):
    bpm: int = Field(ge=40, le=240)
    time_signature_numerator: int = Field(default=4, ge=1, le=32)
    time_signature_denominator: TimeSignatureDenominator = 4


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


class UpdateRegionRequest(BaseModel):
    target_track_slot_id: int | None = Field(default=None, ge=1, le=6)
    start_seconds: float | None = Field(default=None, ge=-30, le=3600)
    duration_seconds: float | None = Field(default=None, gt=0, le=3600)
    volume_percent: int | None = Field(default=None, ge=0, le=100)
    source_label: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def validate_update_fields(self) -> "UpdateRegionRequest":
        if not self.model_fields_set:
            raise ValueError("Region update requires at least one field.")
        return self


class CopyRegionRequest(BaseModel):
    target_track_slot_id: int | None = Field(default=None, ge=1, le=6)
    start_seconds: float | None = Field(default=None, ge=-30, le=3600)


class SplitRegionRequest(BaseModel):
    split_seconds: float = Field(ge=-30, le=3600)


class UpdatePitchEventRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=32)
    pitch_midi: int | None = Field(default=None, ge=0, le=127)
    start_seconds: float | None = Field(default=None, ge=-30, le=3600)
    duration_seconds: float | None = Field(default=None, gt=0, le=3600)
    start_beat: float | None = Field(default=None, ge=0)
    duration_beats: float | None = Field(default=None, gt=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    is_rest: bool | None = None

    @model_validator(mode="after")
    def validate_update_fields(self) -> "UpdatePitchEventRequest":
        if not self.model_fields_set:
            raise ValueError("Pitch event update requires at least one field.")
        return self


class SaveRegionEventPatch(BaseModel):
    event_id: str = Field(min_length=1, max_length=180)
    label: str | None = Field(default=None, min_length=1, max_length=32)
    pitch_midi: int | None = Field(default=None, ge=0, le=127)
    start_seconds: float | None = Field(default=None, ge=-30, le=3600)
    duration_seconds: float | None = Field(default=None, gt=0, le=3600)
    start_beat: float | None = Field(default=None, ge=0)
    duration_beats: float | None = Field(default=None, gt=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    is_rest: bool | None = None

    @model_validator(mode="after")
    def validate_update_fields(self) -> "SaveRegionEventPatch":
        if self.model_fields_set <= {"event_id"}:
            raise ValueError("Region event save requires at least one editable field.")
        return self


class SaveRegionRevisionRequest(BaseModel):
    target_track_slot_id: int | None = Field(default=None, ge=1, le=6)
    start_seconds: float | None = Field(default=None, ge=-30, le=3600)
    duration_seconds: float | None = Field(default=None, gt=0, le=3600)
    volume_percent: int | None = Field(default=None, ge=0, le=100)
    source_label: str | None = Field(default=None, max_length=180)
    events: list[SaveRegionEventPatch] = Field(default_factory=list)
    revision_label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_update_fields(self) -> "SaveRegionRevisionRequest":
        region_fields = {
            "target_track_slot_id",
            "start_seconds",
            "duration_seconds",
            "volume_percent",
            "source_label",
        }
        if not (self.model_fields_set & region_fields) and not self.events:
            raise ValueError("Region revision save requires region fields or event patches.")
        return self


class PerformanceEvent(BaseModel):
    event_id: str | None = None
    track_slot_id: int | None = None
    region_id: str | None = None
    label: str
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    start_seconds: float
    duration_seconds: float
    start_beat: float
    duration_beats: float
    confidence: float = Field(default=1, ge=0, le=1)
    source: EventSource
    extraction_method: str = "unknown"
    is_rest: bool = False
    measure_index: int | None = None
    beat_in_measure: float | None = None
    quality_warnings: list[str] = Field(default_factory=list)


class ScoreTrackRequest(BaseModel):
    score_mode: ScoreMode = "answer"
    reference_slot_ids: list[int] = Field(default_factory=list)
    include_metronome: bool = False
    performance_events: list[PerformanceEvent] = Field(default_factory=list)
    performance_audio_base64: str | None = None
    performance_asset_path: str | None = Field(default=None, max_length=500)
    performance_filename: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def validate_performance_audio_source(self) -> "ScoreTrackRequest":
        if self.performance_audio_base64 is not None and self.performance_asset_path is not None:
            raise ValueError("Scoring performance audio must use either base64 or asset_path, not both.")
        return self


class ApproveCandidateRequest(BaseModel):
    target_slot_id: int | None = Field(default=None, ge=1, le=6)
    allow_overwrite: bool = False


class ApproveJobCandidatesRequest(BaseModel):
    allow_overwrite: bool = False
