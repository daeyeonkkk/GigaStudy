from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any, Literal

from gigastudy_api.domain.track_events import TrackNote
from gigastudy_api.services.engine.music_theory import SLOT_RANGES, track_name

ExtractionGrid = Literal[0.25, 0.5]
ExtractionPolicy = Literal["loose", "normal", "strict"]


@dataclass(frozen=True)
class VoiceExtractionPlan:
    """Bounded pre-transcription plan for turning voice frames into score notes.

    This is the point where product rules enter before note extraction. The
    LLM may help choose this plan, but only deterministic code applies it.
    """

    version: str = "voice_extraction_plan_v1"
    provider: str = "deterministic"
    model: str | None = None
    used_llm: bool = False
    slot_id: int = 1
    track_name: str = "Soprano"
    low_midi: int = 60
    high_midi: int = 81
    quantization_grid: ExtractionGrid = 0.25
    min_segment_seconds: float = 0.15
    min_frame_confidence: float = 0.42
    min_voiced_probability: float = 0.48
    min_segment_confidence: float = 0.46
    max_pitch_std: float = 0.65
    segment_pitch_tolerance: float = 0.75
    max_gap_seconds: float = 0.11
    merge_adjacent_same_pitch: bool = True
    suppress_unstable_notes: bool = True
    reasons: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    def diagnostics(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["reasons"] = list(self.reasons)
        payload["warnings"] = list(self.warnings)
        return payload


def default_voice_extraction_plan(
    *,
    slot_id: int,
    bpm: int,
    source_kind: str = "audio",
    context_tracks_by_slot: dict[int, list[TrackNote]] | None = None,
) -> VoiceExtractionPlan:
    low, high = SLOT_RANGES.get(slot_id, (40, 81))
    track = track_name(slot_id)
    context_note_count = sum(len(notes) for notes in (context_tracks_by_slot or {}).values())
    slower_piece = bpm <= 72
    fast_piece = bpm >= 144
    strict_source = source_kind in {"recording", "audio", "music"}

    quantization_grid: ExtractionGrid = 0.25
    min_segment_seconds = 0.15
    min_frame_confidence = 0.42
    min_voiced_probability = 0.48
    min_segment_confidence = 0.46
    max_pitch_std = 0.65
    segment_pitch_tolerance = 0.75
    max_gap_seconds = 0.11
    reasons = [
        "Studio BPM and meter are fixed; voice extraction must land on the existing beat grid.",
        f"Use {track} vocal range before extracting pitch segments.",
    ]

    if slower_piece:
        quantization_grid = 0.5
        min_segment_seconds = 0.18
        segment_pitch_tolerance = 0.82
        reasons.append("Slow BPM favors a coarser, more singable grid.")
    elif fast_piece:
        min_segment_seconds = 0.12
        max_gap_seconds = 0.09
        reasons.append("Fast BPM allows shorter stable segments while keeping the beat grid absolute.")

    if strict_source:
        min_segment_confidence = 0.48
        max_pitch_std = 0.62
        reasons.append("Recorded audio is filtered for stable singing before notation.")

    if context_note_count:
        reasons.append("Existing tracks are present; keep extraction compatible with the ensemble grid.")

    return VoiceExtractionPlan(
        slot_id=slot_id,
        track_name=track,
        low_midi=low,
        high_midi=high,
        quantization_grid=quantization_grid,
        min_segment_seconds=min_segment_seconds,
        min_frame_confidence=min_frame_confidence,
        min_voiced_probability=min_voiced_probability,
        min_segment_confidence=min_segment_confidence,
        max_pitch_std=max_pitch_std,
        segment_pitch_tolerance=segment_pitch_tolerance,
        max_gap_seconds=max_gap_seconds,
        reasons=tuple(reasons),
    )


def apply_voice_extraction_instruction(
    base_plan: VoiceExtractionPlan,
    *,
    confidence: float,
    provider: str,
    model: str | None,
    quantization_grid: float | None = None,
    min_segment_policy: ExtractionPolicy | None = None,
    confidence_policy: ExtractionPolicy | None = None,
    widen_range_semitones: int = 0,
    merge_adjacent_same_pitch: bool | None = None,
    suppress_unstable_notes: bool | None = None,
    reasons: list[str] | tuple[str, ...] | None = None,
    warnings: list[str] | tuple[str, ...] | None = None,
) -> VoiceExtractionPlan:
    if confidence < 0.45:
        return replace(
            base_plan,
            warnings=base_plan.warnings
            + ("LLM extraction plan ignored because confidence was below 0.45.",),
        )

    grid: ExtractionGrid = base_plan.quantization_grid
    if quantization_grid == 0.5:
        grid = 0.5
    elif quantization_grid == 0.25:
        grid = 0.25

    min_segment_seconds = base_plan.min_segment_seconds
    max_gap_seconds = base_plan.max_gap_seconds
    segment_pitch_tolerance = base_plan.segment_pitch_tolerance
    max_pitch_std = base_plan.max_pitch_std
    min_frame_confidence = base_plan.min_frame_confidence
    min_voiced_probability = base_plan.min_voiced_probability
    min_segment_confidence = base_plan.min_segment_confidence

    if min_segment_policy == "loose":
        min_segment_seconds = max(0.1, base_plan.min_segment_seconds - 0.04)
        max_gap_seconds = max(base_plan.max_gap_seconds, 0.13)
        segment_pitch_tolerance = min(0.95, base_plan.segment_pitch_tolerance + 0.12)
    elif min_segment_policy == "strict":
        min_segment_seconds = min(0.28, base_plan.min_segment_seconds + 0.06)
        max_gap_seconds = min(base_plan.max_gap_seconds, 0.09)
        segment_pitch_tolerance = max(0.55, base_plan.segment_pitch_tolerance - 0.12)

    if confidence_policy == "loose":
        min_frame_confidence = max(0.34, base_plan.min_frame_confidence - 0.05)
        min_voiced_probability = max(0.38, base_plan.min_voiced_probability - 0.06)
        min_segment_confidence = max(0.38, base_plan.min_segment_confidence - 0.05)
        max_pitch_std = min(0.82, base_plan.max_pitch_std + 0.1)
    elif confidence_policy == "strict":
        min_frame_confidence = min(0.58, base_plan.min_frame_confidence + 0.05)
        min_voiced_probability = min(0.64, base_plan.min_voiced_probability + 0.06)
        min_segment_confidence = min(0.62, base_plan.min_segment_confidence + 0.06)
        max_pitch_std = max(0.48, base_plan.max_pitch_std - 0.08)

    widen = max(0, min(2, int(widen_range_semitones or 0)))
    low, high = SLOT_RANGES.get(base_plan.slot_id, (base_plan.low_midi, base_plan.high_midi))
    low_midi = max(0, low - widen)
    high_midi = min(127, high + widen)

    return replace(
        base_plan,
        provider=provider,
        model=model,
        used_llm=provider != "deterministic",
        low_midi=low_midi,
        high_midi=high_midi,
        quantization_grid=grid,
        min_segment_seconds=round(min_segment_seconds, 4),
        min_frame_confidence=round(min_frame_confidence, 4),
        min_voiced_probability=round(min_voiced_probability, 4),
        min_segment_confidence=round(min_segment_confidence, 4),
        max_pitch_std=round(max_pitch_std, 4),
        segment_pitch_tolerance=round(segment_pitch_tolerance, 4),
        max_gap_seconds=round(max_gap_seconds, 4),
        merge_adjacent_same_pitch=(
            base_plan.merge_adjacent_same_pitch
            if merge_adjacent_same_pitch is None
            else bool(merge_adjacent_same_pitch)
        ),
        suppress_unstable_notes=(
            base_plan.suppress_unstable_notes
            if suppress_unstable_notes is None
            else bool(suppress_unstable_notes)
        ),
        reasons=base_plan.reasons + _clean_text_tuple(reasons),
        warnings=base_plan.warnings + _clean_text_tuple(warnings),
    )


def _clean_text_tuple(value: list[str] | tuple[str, ...] | None) -> tuple[str, ...]:
    if not value:
        return ()
    cleaned: list[str] = []
    for item in value[:8]:
        text = str(item).strip()
        if text:
            cleaned.append(text[:180])
    return tuple(cleaned)
