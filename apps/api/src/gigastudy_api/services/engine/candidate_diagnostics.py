from __future__ import annotations

from typing import Any

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import SLOT_RANGES, midi_to_label, track_name
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile


def track_duration_seconds(notes: list[TrackPitchEvent]) -> float:
    if not notes:
        return 0
    return round(max(note.onset_seconds + note.duration_seconds for note in notes), 4)


def parsed_track_diagnostics_by_slot(
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


def candidate_diagnostics(
    slot_id: int,
    notes: list[TrackPitchEvent],
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
    duration_seconds = track_duration_seconds(notes) if notes else 0
    measure_count = len(measure_indices)
    if measure_count == 0 and notes:
        measure_count = max(1, int(max(note.beat + note.duration_beats for note in notes) // 4) + 1)
    avg_note_confidence = sum(note.confidence for note in notes) / len(notes) if notes else 0
    range_fit_ratio = candidate_range_fit_ratio(slot_id, pitched_notes)
    timing_grid_ratio = candidate_timing_grid_ratio(notes)
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
            "range": candidate_range_label(pitched_notes),
            "avg_note_confidence": round(avg_note_confidence, 3),
            "range_fit_ratio": round(range_fit_ratio, 3),
            "timing_grid_ratio": round(timing_grid_ratio, 3),
            "density_notes_per_measure": round(note_count / max(1, measure_count), 2),
            "confidence_label": confidence_label(confidence),
            "review_hint": diagnostics.get("review_hint")
            or review_hint_for_candidate(
                method=method,
                note_count=note_count,
                range_fit_ratio=range_fit_ratio,
                timing_grid_ratio=timing_grid_ratio,
                avg_note_confidence=avg_note_confidence,
            ),
        }
    )
    return diagnostics


def estimate_candidate_confidence(
    slot_id: int,
    notes: list[TrackPitchEvent],
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
    range_fit_ratio = diagnostic_float(
        diagnostics,
        "range_fit_ratio",
        default=candidate_range_fit_ratio(slot_id, [note for note in notes if note.pitch_midi is not None]),
    )
    timing_grid_ratio = diagnostic_float(
        diagnostics,
        "timing_grid_ratio",
        default=candidate_timing_grid_ratio(notes),
    )
    measure_count = diagnostic_int(diagnostics, "measure_count", default=0)

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


def candidate_review_message(
    slot_id: int,
    notes: list[TrackPitchEvent],
    *,
    method: str,
    diagnostics: dict[str, Any] | None,
    default_message: str | None,
) -> str | None:
    if not notes:
        return default_message
    if diagnostics is None:
        diagnostics = candidate_diagnostics(
            slot_id,
            notes,
            method=method,
            confidence=0.5,
        )
    note_count = diagnostic_int(diagnostics, "note_count", default=len(notes))
    measure_count = diagnostic_int(diagnostics, "measure_count", default=0)
    candidate_confidence_label = str(diagnostics.get("confidence_label") or "review")
    hint = str(diagnostics.get("review_hint") or "")
    hint_label = review_hint_label(hint)
    if method.startswith("pdf_vector"):
        return (
            f"{track_name(slot_id)}: vector PDF에서 {measure_count}마디, "
            f"{note_count}개 음표를 추출했습니다. {candidate_confidence_label}; {hint_label}"
        )
    if method.startswith("audiveris"):
        return (
            f"{track_name(slot_id)}: Audiveris MusicXML 결과에서 {measure_count}마디, "
            f"{note_count}개 음표를 추출했습니다. {candidate_confidence_label}; 원본과 대조 후 승인하세요."
        )
    return default_message


def generation_variant_label(index: int, slot_id: int, notes: list[TrackPitchEvent]) -> str:
    if slot_id == 6:
        return percussion_variant_label(index, notes)

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


def percussion_variant_label(index: int, notes: list[TrackPitchEvent]) -> str:
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


def diagnostic_float(diagnostics: dict[str, Any] | None, key: str, *, default: float) -> float:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return float(value) if isinstance(value, (int, float)) else default


def diagnostic_int(diagnostics: dict[str, Any] | None, key: str, *, default: int) -> int:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return int(value) if isinstance(value, (int, float)) else default


def candidate_range_fit_ratio(slot_id: int, notes: list[TrackPitchEvent]) -> float:
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


def candidate_timing_grid_ratio(notes: list[TrackPitchEvent]) -> float:
    if not notes:
        return 0
    aligned = 0
    for note in notes:
        beat_aligned = abs(note.beat * 4 - round(note.beat * 4)) <= 0.03
        duration_aligned = abs(note.duration_beats * 4 - round(note.duration_beats * 4)) <= 0.03
        if beat_aligned and duration_aligned:
            aligned += 1
    return aligned / len(notes)


def candidate_range_label(notes: list[TrackPitchEvent]) -> str:
    midi_notes = [
        note
        for note in notes
        if note.pitch_midi is not None
    ]
    if not midi_notes:
        return "-"
    sorted_notes = sorted(midi_notes, key=lambda note: note.pitch_midi or 0)
    return f"{sorted_notes[0].label} - {sorted_notes[-1].label}"


def confidence_label(confidence: float) -> str:
    if confidence >= 0.72:
        return "높은 신뢰도"
    if confidence >= 0.5:
        return "검토 필요"
    return "낮은 신뢰도"


def review_hint_for_candidate(
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


def review_hint_label(hint: str) -> str:
    return {
        "few_notes": "음표 수가 적어 파트 판독을 꼭 확인하세요.",
        "low_note_confidence": "음표별 신뢰도가 낮아 원본 대조가 필요합니다.",
        "range_outliers": "파트 음역 밖 음이 있어 트랙 배정을 확인하세요.",
        "rhythm_grid_review": "리듬 격자가 불안정해 박자 판독을 확인하세요.",
        "partial_score_review": "일부 파트만 감지되어 누락 파트를 확인하세요.",
        "review_accidentals_and_rhythm": "조표/임시표와 리듬을 원본과 대조하세요.",
        "review_against_source": "원본과 대조 후 승인하세요.",
    }.get(hint, "원본과 대조 후 승인하세요.")
