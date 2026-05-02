from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    beat_in_measure_from_beat,
    measure_index_from_beat,
    midi_to_frequency,
    midi_to_label,
    quarter_beats_per_measure,
    track_name,
)
from gigastudy_api.services.engine.event_normalization import accidental_for_key, spell_midi_label

ENSEMBLE_VALIDATION_VERSION = "ensemble_arrangement_v2"
ENSEMBLE_REPAIR_VERSION = "ensemble_octave_repair_v1"
VOCAL_SLOT_IDS = (1, 2, 3, 4, 5)
ADJACENT_VOCAL_PAIRS = ((1, 2), (2, 3), (3, 4), (4, 5))
UPPER_PAIR_MAX_GAP_SEMITONES = 12
BARITONE_BASS_MAX_GAP_SEMITONES = 19
LOW_GAP_MIN_SEMITONES = 3
MAX_EXPOSED_ISSUES = 24
ENSEMBLE_REPAIR_SOURCE_KINDS = {"recording", "audio", "music", "ai"}
MELODIC_LEAP_WARN_SEMITONES = 12
REPEATED_LEAP_WARN_SEMITONES = 7
DENSITY_WARN_EVENTS_PER_MEASURE_FACTOR = 2.25
BASS_HIGH_FOUNDATION_PITCH = 55


@dataclass(frozen=True)
class EnsembleValidationResult:
    notes: list[TrackPitchEvent]
    diagnostics: dict[str, Any]


def prepare_ensemble_registration(
    *,
    target_slot_id: int,
    candidate_notes: list[TrackPitchEvent],
    existing_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    bpm: int,
    source_kind: str,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> EnsembleValidationResult:
    """Polish and validate a track in the context of the full a cappella score.

    The repair stage is deliberately conservative: it may only move vocal notes
    by octaves, preserving pitch class, rhythm, measure ownership, and source
    ids. This catches common voice-extraction octave errors and AI voicing
    mistakes without rewriting a user's melody into a new composition.
    """

    repaired_notes, repair_diagnostics = _repair_contextual_octaves(
        target_slot_id=target_slot_id,
        candidate_notes=candidate_notes,
        existing_tracks_by_slot=existing_tracks_by_slot,
        bpm=bpm,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    validation = validate_ensemble_registration(
        target_slot_id=target_slot_id,
        candidate_notes=repaired_notes,
        existing_tracks_by_slot=existing_tracks_by_slot,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return EnsembleValidationResult(
        notes=validation.notes,
        diagnostics={
            **validation.diagnostics,
            "repair": repair_diagnostics,
        },
    )


def validate_ensemble_registration(
    *,
    target_slot_id: int,
    candidate_notes: list[TrackPitchEvent],
    existing_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> EnsembleValidationResult:
    """Validate a proposed track against the full six-track region context.

    The validator is intentionally diagnostic-first. It flags arrangement risks
    before registration without rewriting intentional harmony or counterpoint.
    Deterministic note cleanup remains in event_quality.py.
    """

    if target_slot_id not in range(1, 7):
        return EnsembleValidationResult(
            notes=candidate_notes,
            diagnostics=_empty_diagnostics(target_slot_id, reason="invalid_target_slot"),
        )

    if target_slot_id == 6:
        diagnostics = _percussion_diagnostics(
            target_slot_id,
            candidate_notes,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        return EnsembleValidationResult(notes=candidate_notes, diagnostics=diagnostics)

    ensemble_tracks = {
        slot_id: list(notes)
        for slot_id, notes in existing_tracks_by_slot.items()
        if slot_id in VOCAL_SLOT_IDS and slot_id != target_slot_id and notes
    }
    ensemble_tracks[target_slot_id] = candidate_notes

    target_pitched = _pitched_notes(candidate_notes)
    if not target_pitched:
        return EnsembleValidationResult(
            notes=candidate_notes,
            diagnostics=_empty_diagnostics(target_slot_id, reason="no_target_pitched_notes"),
        )

    issues: list[dict[str, Any]] = []
    issues.extend(_range_issues(target_slot_id, target_pitched))
    snapshot_beats = _snapshot_beats(
        ensemble_tracks,
        target_notes=target_pitched,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    issues.extend(_vertical_snapshot_issues(target_slot_id, ensemble_tracks, snapshot_beats))
    issues.extend(_parallel_perfect_issues(target_slot_id, ensemble_tracks, target_pitched))
    issues.extend(_thin_chord_issues(target_slot_id, ensemble_tracks, snapshot_beats))
    issues.extend(
        _melodic_singability_issues(
            target_slot_id,
            target_pitched,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )
    issues.extend(
        _ensemble_tendency_issues(
            target_slot_id,
            ensemble_tracks,
            snapshot_beats,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )
    issues.extend(
        _bass_foundation_issues(
            target_slot_id,
            ensemble_tracks,
            snapshot_beats,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )

    diagnostics = _build_diagnostics(
        target_slot_id=target_slot_id,
        candidate_notes=candidate_notes,
        existing_tracks_by_slot=existing_tracks_by_slot,
        issues=issues,
        snapshot_count=len(snapshot_beats),
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    annotated_notes = _attach_ensemble_warnings(candidate_notes, issues)
    return EnsembleValidationResult(notes=annotated_notes, diagnostics=diagnostics)


def _repair_contextual_octaves(
    *,
    target_slot_id: int,
    candidate_notes: list[TrackPitchEvent],
    existing_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    bpm: int,
    source_kind: str,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], dict[str, Any]]:
    diagnostics: dict[str, Any] = {
        "version": ENSEMBLE_REPAIR_VERSION,
        "evaluated": True,
        "applied": False,
        "source_kind": source_kind,
        "target_slot_id": target_slot_id,
        "target_track_name": _safe_track_name(target_slot_id),
        "changed_note_count": 0,
        "changes": [],
        "reason": "no_repair_needed",
    }
    if target_slot_id not in VOCAL_SLOT_IDS:
        diagnostics["reason"] = "non_vocal_target"
        return candidate_notes, diagnostics
    if source_kind not in ENSEMBLE_REPAIR_SOURCE_KINDS:
        diagnostics["reason"] = "symbolic_source_preserved"
        return candidate_notes, diagnostics
    if not candidate_notes or not existing_tracks_by_slot:
        diagnostics["reason"] = "insufficient_context"
        return candidate_notes, diagnostics

    context_tracks = {
        slot_id: notes
        for slot_id, notes in existing_tracks_by_slot.items()
        if slot_id in VOCAL_SLOT_IDS and notes
    }
    if not context_tracks:
        diagnostics["reason"] = "no_vocal_context"
        return candidate_notes, diagnostics

    repaired: list[TrackPitchEvent] = []
    changed: list[dict[str, Any]] = []
    previous_pitch: int | None = None
    pitched_notes = _pitched_notes(candidate_notes)
    next_pitch_by_id = _next_pitch_by_note_id(pitched_notes)

    for note in candidate_notes:
        if note.is_rest or note.pitch_midi is None:
            repaired.append(note)
            continue

        context = _context_bounds_at(
            target_slot_id=target_slot_id,
            context_tracks=context_tracks,
            beat=note.beat,
        )
        replacement_pitch = _choose_contextual_octave(
            target_slot_id=target_slot_id,
            note=note,
            context=context,
            previous_pitch=previous_pitch,
            next_pitch=next_pitch_by_id.get(note.id),
        )
        if replacement_pitch == note.pitch_midi:
            repaired.append(note)
            previous_pitch = note.pitch_midi
            continue

        repaired_note = _copy_note_pitch(
            note,
            replacement_pitch,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            warning="ensemble_octave_repaired",
        )
        repaired.append(repaired_note)
        changed.append(
            {
                "note_id": note.id,
                "beat": note.beat,
                "from": note.label,
                "to": repaired_note.label,
                "from_midi": note.pitch_midi,
                "to_midi": replacement_pitch,
                "reason": context["reason"],
            }
        )
        previous_pitch = replacement_pitch

    if changed:
        diagnostics.update(
            {
                "applied": True,
                "changed_note_count": len(changed),
                "changes": changed[:MAX_EXPOSED_ISSUES],
                "reason": "contextual_octave_repair_applied",
            }
        )
    return repaired, diagnostics


def _empty_diagnostics(target_slot_id: int, *, reason: str) -> dict[str, Any]:
    return {
        "version": ENSEMBLE_VALIDATION_VERSION,
        "evaluated": False,
        "target_slot_id": target_slot_id,
        "target_track_name": _safe_track_name(target_slot_id),
        "passed": True,
        "blocking": False,
        "reason": reason,
        "issue_count": 0,
        "severity_counts": {},
        "issues": [],
    }


def _percussion_diagnostics(
    target_slot_id: int,
    notes: list[TrackPitchEvent],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    pitched_count = sum(1 for note in notes if note.pitch_midi is not None and not note.is_rest)
    issues = []
    if pitched_count:
        issues.append(
            _issue(
                code="percussion_pitch_review",
                severity="info",
                beat=min((note.beat for note in notes), default=1),
                slot_ids=[target_slot_id],
                message="Percussion material contains pitched notes; verify this is intentional.",
            )
        )
    return _build_diagnostics(
        target_slot_id=target_slot_id,
        candidate_notes=notes,
        existing_tracks_by_slot={},
        issues=issues,
        snapshot_count=0,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _context_bounds_at(
    *,
    target_slot_id: int,
    context_tracks: dict[int, list[TrackPitchEvent]],
    beat: float,
) -> dict[str, Any]:
    active = _active_vocal_notes_at(context_tracks, beat)
    upper_pitches = [
        note.pitch_midi
        for slot_id, note in active.items()
        if slot_id < target_slot_id and note.pitch_midi is not None
    ]
    lower_pitches = [
        note.pitch_midi
        for slot_id, note in active.items()
        if slot_id > target_slot_id and note.pitch_midi is not None
    ]
    higher_neighbor = min(upper_pitches) if upper_pitches else None
    lower_neighbor = max(lower_pitches) if lower_pitches else None
    return {
        "higher_neighbor": higher_neighbor,
        "lower_neighbor": lower_neighbor,
        "active_voice_count": len(active),
        "reason": _context_reason(higher_neighbor, lower_neighbor),
    }


def _context_reason(higher_neighbor: int | None, lower_neighbor: int | None) -> str:
    if higher_neighbor is not None and lower_neighbor is not None:
        return "fit_between_adjacent_voices"
    if higher_neighbor is not None:
        return "fit_below_upper_voice"
    if lower_neighbor is not None:
        return "fit_above_lower_voice"
    return "range_and_contour_only"


def _choose_contextual_octave(
    *,
    target_slot_id: int,
    note: TrackPitchEvent,
    context: dict[str, Any],
    previous_pitch: int | None,
    next_pitch: int | None,
) -> int:
    original_pitch = note.pitch_midi
    if original_pitch is None:
        return original_pitch or 0

    low, high = SLOT_RANGES[target_slot_id]
    higher_neighbor = context.get("higher_neighbor")
    lower_neighbor = context.get("lower_neighbor")
    if not isinstance(higher_neighbor, int):
        higher_neighbor = None
    if not isinstance(lower_neighbor, int):
        lower_neighbor = None

    lower_bound = max(low, (lower_neighbor + 1) if lower_neighbor is not None else low)
    upper_bound = min(high, (higher_neighbor - 1) if higher_neighbor is not None else high)
    candidates = [
        original_pitch + 12 * octave_shift
        for octave_shift in range(-3, 4)
        if low <= original_pitch + 12 * octave_shift <= high
    ]
    if not candidates:
        return original_pitch

    current_is_invalid = (
        original_pitch < low
        or original_pitch > high
        or (higher_neighbor is not None and original_pitch >= higher_neighbor)
        or (lower_neighbor is not None and original_pitch <= lower_neighbor)
        or _has_bad_adjacent_gap(target_slot_id, original_pitch, higher_neighbor, lower_neighbor)
    )
    ordered_candidates = [
        pitch
        for pitch in candidates
        if lower_bound <= pitch <= upper_bound
    ]
    if not ordered_candidates:
        ordered_candidates = candidates

    current_score = _contextual_octave_score(
        target_slot_id=target_slot_id,
        pitch=original_pitch,
        original_pitch=original_pitch,
        higher_neighbor=higher_neighbor,
        lower_neighbor=lower_neighbor,
        previous_pitch=previous_pitch,
        next_pitch=next_pitch,
    )
    best_pitch = min(
        ordered_candidates,
        key=lambda pitch: _contextual_octave_score(
            target_slot_id=target_slot_id,
            pitch=pitch,
            original_pitch=original_pitch,
            higher_neighbor=higher_neighbor,
            lower_neighbor=lower_neighbor,
            previous_pitch=previous_pitch,
            next_pitch=next_pitch,
        ),
    )
    best_score = _contextual_octave_score(
        target_slot_id=target_slot_id,
        pitch=best_pitch,
        original_pitch=original_pitch,
        higher_neighbor=higher_neighbor,
        lower_neighbor=lower_neighbor,
        previous_pitch=previous_pitch,
        next_pitch=next_pitch,
    )
    if current_is_invalid or best_score + 1.5 < current_score:
        return best_pitch
    return original_pitch


def _contextual_octave_score(
    *,
    target_slot_id: int,
    pitch: int,
    original_pitch: int,
    higher_neighbor: int | None,
    lower_neighbor: int | None,
    previous_pitch: int | None,
    next_pitch: int | None,
) -> float:
    low, high = SLOT_RANGES[target_slot_id]
    center = (low + high) / 2
    score = abs(pitch - original_pitch) * 0.28
    score += abs(pitch - center) * 0.035
    if pitch < low or pitch > high:
        score += 100
    if higher_neighbor is not None:
        gap = higher_neighbor - pitch
        score += _adjacent_gap_cost(gap, target_slot_id=target_slot_id, upper_side=True)
        if gap <= 0:
            score += 100
    if lower_neighbor is not None:
        gap = pitch - lower_neighbor
        score += _adjacent_gap_cost(gap, target_slot_id=target_slot_id, upper_side=False)
        if gap <= 0:
            score += 100
    if previous_pitch is not None:
        score += _melodic_gap_cost(abs(pitch - previous_pitch)) * 0.5
    if next_pitch is not None:
        score += _melodic_gap_cost(abs(next_pitch - pitch)) * 0.35
    return score


def _adjacent_gap_cost(gap: int, *, target_slot_id: int, upper_side: bool) -> float:
    max_gap = BARITONE_BASS_MAX_GAP_SEMITONES if target_slot_id in {4, 5} and not upper_side else UPPER_PAIR_MAX_GAP_SEMITONES
    if gap < 0:
        return 100
    if gap < LOW_GAP_MIN_SEMITONES:
        return 5.0 + (LOW_GAP_MIN_SEMITONES - gap) * 1.5
    if gap > max_gap:
        return (gap - max_gap) * 0.85
    return 0


def _has_bad_adjacent_gap(
    target_slot_id: int,
    pitch: int,
    higher_neighbor: int | None,
    lower_neighbor: int | None,
) -> bool:
    if higher_neighbor is not None and _adjacent_gap_cost(
        higher_neighbor - pitch,
        target_slot_id=target_slot_id,
        upper_side=True,
    ) >= 5:
        return True
    if lower_neighbor is not None and _adjacent_gap_cost(
        pitch - lower_neighbor,
        target_slot_id=target_slot_id,
        upper_side=False,
    ) >= 5:
        return True
    return False


def _melodic_gap_cost(interval: int) -> float:
    if interval <= 2:
        return -0.4
    if interval <= 5:
        return 0
    if interval <= 7:
        return 0.4
    if interval <= 12:
        return 1.2
    return 4.0 + (interval - 12) * 0.4


def _next_pitch_by_note_id(notes: list[TrackPitchEvent]) -> dict[str, int]:
    ordered = sorted(notes, key=lambda note: (note.beat, note.id))
    result: dict[str, int] = {}
    for index, note in enumerate(ordered[:-1]):
        next_note = ordered[index + 1]
        if next_note.pitch_midi is not None:
            result[note.id] = next_note.pitch_midi
    return result


def _copy_note_pitch(
    note: TrackPitchEvent,
    pitch_midi: int,
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    warning: str,
) -> TrackPitchEvent:
    label = midi_to_label(pitch_midi)
    key_signature = note.key_signature or "C"
    spelling_mode = "flat" if "b" in key_signature and "#" not in key_signature else "sharp"
    spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
    return note.model_copy(
        update={
            "pitch_midi": pitch_midi,
            "pitch_hz": midi_to_frequency(pitch_midi),
            "label": label,
            "spelled_label": spelled_label,
            "accidental": accidental_for_key(spelled_label, key_signature),
            "onset_seconds": round(max(0, (note.beat - 1) * (60 / max(1, bpm))), 4),
            "measure_index": measure_index_from_beat(
                note.beat,
                time_signature_numerator,
                time_signature_denominator,
            ),
            "beat_in_measure": round(
                beat_in_measure_from_beat(
                    note.beat,
                    time_signature_numerator,
                    time_signature_denominator,
                ),
                4,
            ),
            "duration_seconds": round(note.duration_beats * (60 / max(1, bpm)), 4),
            "quality_warnings": _append_warning(note.quality_warnings, warning),
        }
    )


def _range_issues(target_slot_id: int, notes: list[TrackPitchEvent]) -> list[dict[str, Any]]:
    low, high = SLOT_RANGES[target_slot_id]
    issues: list[dict[str, Any]] = []
    for note in notes:
        pitch = note.pitch_midi
        if pitch is None:
            continue
        if pitch < low or pitch > high:
            issues.append(
                _issue(
                    code="range_outlier",
                    severity="warn",
                    beat=note.beat,
                    slot_ids=[target_slot_id],
                    target_note_id=note.id,
                    message=f"{_safe_track_name(target_slot_id)} note is outside the configured vocal range.",
                )
            )
    return issues


def _snapshot_beats(
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    *,
    target_notes: list[TrackPitchEvent],
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[float]:
    target_start = min(note.beat for note in target_notes)
    target_end = max(note.beat + max(0, note.duration_beats) for note in target_notes)
    beats = {
        round(note.beat, 4)
        for notes in tracks_by_slot.values()
        for note in notes
        if not note.is_rest and target_start - 0.001 <= note.beat <= target_end + 0.001
    }
    beats.update(round(note.beat, 4) for note in target_notes)

    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    first_measure_start = ((max(1, target_start) - 1) // beats_per_measure) * beats_per_measure + 1
    measure_count = int(((target_end - first_measure_start) // beats_per_measure) + 2)
    for measure_offset in range(max(1, measure_count)):
        beats.add(round(first_measure_start + measure_offset * beats_per_measure, 4))
    return sorted(beat for beat in beats if beat >= 1)


def _vertical_snapshot_issues(
    target_slot_id: int,
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    snapshot_beats: list[float],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for beat in snapshot_beats:
        active = _active_vocal_notes_at(tracks_by_slot, beat)
        target_note = active.get(target_slot_id)
        if target_note is None or target_note.pitch_midi is None:
            continue

        for upper_slot_id in (slot_id for slot_id in VOCAL_SLOT_IDS if slot_id < target_slot_id):
            upper_note = active.get(upper_slot_id)
            if upper_note is not None and upper_note.pitch_midi is not None and target_note.pitch_midi >= upper_note.pitch_midi:
                issues.append(
                    _issue(
                        code="voice_crossing",
                        severity="error",
                        beat=beat,
                        slot_ids=[upper_slot_id, target_slot_id],
                        target_note_id=target_note.id,
                        message=f"{_safe_track_name(target_slot_id)} crosses above {_safe_track_name(upper_slot_id)}.",
                    )
                )
        for lower_slot_id in (slot_id for slot_id in VOCAL_SLOT_IDS if slot_id > target_slot_id):
            lower_note = active.get(lower_slot_id)
            if lower_note is not None and lower_note.pitch_midi is not None and target_note.pitch_midi <= lower_note.pitch_midi:
                issues.append(
                    _issue(
                        code="voice_crossing",
                        severity="error",
                        beat=beat,
                        slot_ids=[target_slot_id, lower_slot_id],
                        target_note_id=target_note.id,
                        message=f"{_safe_track_name(target_slot_id)} crosses below {_safe_track_name(lower_slot_id)}.",
                    )
                )

        for upper_slot_id, lower_slot_id in ADJACENT_VOCAL_PAIRS:
            upper_note = active.get(upper_slot_id)
            lower_note = active.get(lower_slot_id)
            if upper_note is None or lower_note is None:
                continue
            if upper_note.pitch_midi is None or lower_note.pitch_midi is None:
                continue
            if target_slot_id not in {upper_slot_id, lower_slot_id}:
                continue

            gap = upper_note.pitch_midi - lower_note.pitch_midi
            max_gap = BARITONE_BASS_MAX_GAP_SEMITONES if (upper_slot_id, lower_slot_id) == (4, 5) else UPPER_PAIR_MAX_GAP_SEMITONES
            if gap > max_gap:
                issues.append(
                    _issue(
                        code="spacing_too_wide",
                        severity="warn",
                        beat=beat,
                        slot_ids=[upper_slot_id, lower_slot_id],
                        target_note_id=target_note.id,
                        message=f"{_safe_track_name(upper_slot_id)} and {_safe_track_name(lower_slot_id)} are spaced too far apart.",
                    )
                )
            elif 0 <= gap < LOW_GAP_MIN_SEMITONES:
                issues.append(
                    _issue(
                        code="spacing_too_close",
                        severity="info",
                        beat=beat,
                        slot_ids=[upper_slot_id, lower_slot_id],
                        target_note_id=target_note.id,
                        message=f"{_safe_track_name(upper_slot_id)} and {_safe_track_name(lower_slot_id)} are very close.",
                    )
                )
    return issues


def _parallel_perfect_issues(
    target_slot_id: int,
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    target_notes: list[TrackPitchEvent],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    ordered_target = sorted(target_notes, key=lambda note: note.beat)
    for previous_target, current_target in zip(ordered_target, ordered_target[1:], strict=False):
        if previous_target.pitch_midi is None or current_target.pitch_midi is None:
            continue
        target_motion = _motion_direction(previous_target.pitch_midi, current_target.pitch_midi)
        if target_motion == 0:
            continue
        for slot_id, context_notes in tracks_by_slot.items():
            if slot_id == target_slot_id or slot_id not in VOCAL_SLOT_IDS:
                continue
            previous_context = _active_note_at(context_notes, previous_target.beat)
            current_context = _active_note_at(context_notes, current_target.beat)
            if previous_context is None or current_context is None:
                continue
            if previous_context.pitch_midi is None or current_context.pitch_midi is None:
                continue
            context_motion = _motion_direction(previous_context.pitch_midi, current_context.pitch_midi)
            if context_motion == 0 or context_motion != target_motion:
                continue

            previous_interval = _vertical_interval_class(previous_target.pitch_midi, previous_context.pitch_midi)
            current_interval = _vertical_interval_class(current_target.pitch_midi, current_context.pitch_midi)
            if previous_interval in {0, 7} and current_interval in {0, 7}:
                issues.append(
                    _issue(
                        code="parallel_perfect_interval",
                        severity="warn",
                        beat=current_target.beat,
                        slot_ids=[target_slot_id, slot_id],
                        target_note_id=current_target.id,
                        message=f"{_safe_track_name(target_slot_id)} moves in parallel perfect interval with {_safe_track_name(slot_id)}.",
                    )
                )
    return issues


def _thin_chord_issues(
    target_slot_id: int,
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    snapshot_beats: list[float],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for beat in snapshot_beats:
        active = _active_vocal_notes_at(tracks_by_slot, beat)
        if target_slot_id not in active or len(active) < 4:
            continue
        pitch_classes = {
            note.pitch_midi % 12
            for note in active.values()
            if note.pitch_midi is not None
        }
        if len(pitch_classes) <= 2:
            target_note = active.get(target_slot_id)
            issues.append(
                _issue(
                    code="thin_chord_coverage",
                    severity="info",
                    beat=beat,
                    slot_ids=sorted(active),
                    target_note_id=target_note.id if target_note is not None else None,
                    message="Four or more vocal parts collapse into only one or two pitch classes.",
                )
            )
    return issues


def _melodic_singability_issues(
    target_slot_id: int,
    target_notes: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    ordered = sorted(target_notes, key=lambda note: (note.beat, note.id))
    previous_interval = 0
    previous_direction = 0
    for previous_note, current_note in zip(ordered, ordered[1:], strict=False):
        if previous_note.pitch_midi is None or current_note.pitch_midi is None:
            continue
        motion = current_note.pitch_midi - previous_note.pitch_midi
        interval = abs(motion)
        direction = _motion_direction(previous_note.pitch_midi, current_note.pitch_midi)
        if interval > MELODIC_LEAP_WARN_SEMITONES:
            issues.append(
                _issue(
                    code="large_melodic_leap",
                    severity="warn",
                    beat=current_note.beat,
                    slot_ids=[target_slot_id],
                    target_note_id=current_note.id,
                    message=f"{_safe_track_name(target_slot_id)} has a leap larger than an octave.",
                )
            )
        elif interval == 6:
            issues.append(
                _issue(
                    code="tritone_melodic_leap",
                    severity="info",
                    beat=current_note.beat,
                    slot_ids=[target_slot_id],
                    target_note_id=current_note.id,
                    message=f"{_safe_track_name(target_slot_id)} has an exposed tritone leap.",
                )
            )
        if (
            interval >= REPEATED_LEAP_WARN_SEMITONES
            and previous_interval >= REPEATED_LEAP_WARN_SEMITONES
            and direction != 0
            and direction == previous_direction
        ):
            issues.append(
                _issue(
                    code="repeated_same_direction_leap",
                    severity="warn",
                    beat=current_note.beat,
                    slot_ids=[target_slot_id],
                    target_note_id=current_note.id,
                    message=f"{_safe_track_name(target_slot_id)} repeats large leaps in the same direction.",
                )
            )
        previous_interval = interval
        previous_direction = direction

    notes_by_measure: dict[int, list[TrackPitchEvent]] = defaultdict(list)
    for note in target_notes:
        measure_index = note.measure_index or measure_index_from_beat(
            note.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        notes_by_measure[measure_index].append(note)
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    density_limit = max(6, round(beats_per_measure * DENSITY_WARN_EVENTS_PER_MEASURE_FACTOR))
    for measure_index, measure_notes in notes_by_measure.items():
        if len(measure_notes) > density_limit:
            first_note = min(measure_notes, key=lambda note: note.beat)
            issues.append(
                _issue(
                    code="excessive_vocal_density",
                    severity="warn",
                    beat=first_note.beat,
                    slot_ids=[target_slot_id],
                    target_note_id=first_note.id,
                    message=f"{_safe_track_name(target_slot_id)} has too many vocal events in measure {measure_index}.",
                )
            )
    return issues


def _ensemble_tendency_issues(
    target_slot_id: int,
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    snapshot_beats: list[float],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    key_tonic = _estimate_major_tonic(tracks_by_slot)
    leading_tone = (key_tonic - 1) % 12
    issues: list[dict[str, Any]] = []
    for beat in snapshot_beats:
        if _beat_strength(beat, time_signature_numerator, time_signature_denominator) < 1.0:
            continue
        active = _active_vocal_notes_at(tracks_by_slot, beat)
        target_note = active.get(target_slot_id)
        if target_note is None or target_note.pitch_midi is None or len(active) < 3:
            continue
        leading_notes = [
            note
            for note in active.values()
            if note.pitch_midi is not None and note.pitch_midi % 12 == leading_tone
        ]
        if len(leading_notes) >= 2 and target_note in leading_notes:
            issues.append(
                _issue(
                    code="doubled_leading_tone",
                    severity="info",
                    beat=beat,
                    slot_ids=sorted(active),
                    target_note_id=target_note.id,
                    message="Multiple voices double the leading tone on a structural beat.",
                )
            )
    return issues


def _bass_foundation_issues(
    target_slot_id: int,
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    snapshot_beats: list[float],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    if target_slot_id != 5:
        return []
    issues: list[dict[str, Any]] = []
    for beat in snapshot_beats:
        if _beat_strength(beat, time_signature_numerator, time_signature_denominator) < 1.45:
            continue
        active = _active_vocal_notes_at(tracks_by_slot, beat)
        bass_note = active.get(5)
        if bass_note is None or bass_note.pitch_midi is None or len(active) < 3:
            continue
        if bass_note.pitch_midi > BASS_HIGH_FOUNDATION_PITCH:
            issues.append(
                _issue(
                    code="bass_high_on_downbeat",
                    severity="info",
                    beat=beat,
                    slot_ids=[5],
                    target_note_id=bass_note.id,
                    message="Bass foundation is high on a structural downbeat.",
                )
            )
    return issues


def _estimate_major_tonic(tracks_by_slot: dict[int, list[TrackPitchEvent]]) -> int:
    weights = [0.0] * 12
    for notes in tracks_by_slot.values():
        for note in notes:
            if note.is_rest or note.pitch_midi is None:
                continue
            weights[note.pitch_midi % 12] += max(0.25, note.duration_beats) * max(0.2, note.confidence)
    if sum(weights) <= 0:
        return 0
    major_profile = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
    return max(
        range(12),
        key=lambda tonic: sum(weights[(tonic + offset) % 12] * major_profile[offset] for offset in range(12)),
    )


def _beat_strength(
    beat: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    beat_in_measure = beat_in_measure_from_beat(
        beat,
        time_signature_numerator,
        time_signature_denominator,
    )
    if abs(beat_in_measure - 1) < 0.001:
        return 1.5
    if abs(beat_in_measure - round(beat_in_measure)) < 0.001:
        return 1.0
    return 0.6


def _build_diagnostics(
    *,
    target_slot_id: int,
    candidate_notes: list[TrackPitchEvent],
    existing_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    issues: list[dict[str, Any]],
    snapshot_count: int,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    severity_counts = Counter(issue["severity"] for issue in issues)
    code_counts = Counter(issue["code"] for issue in issues)
    active_vocal_track_count = sum(
        1
        for slot_id, notes in existing_tracks_by_slot.items()
        if slot_id in VOCAL_SLOT_IDS and _pitched_notes(notes)
    )
    target_range_fit_ratio = _range_fit_ratio(target_slot_id, _pitched_notes(candidate_notes))
    return {
        "version": ENSEMBLE_VALIDATION_VERSION,
        "evaluated": True,
        "target_slot_id": target_slot_id,
        "target_track_name": _safe_track_name(target_slot_id),
        "passed": severity_counts.get("error", 0) == 0,
        "blocking": False,
        "bpm": bpm,
        "time_signature": f"{time_signature_numerator}/{time_signature_denominator}",
        "active_reference_vocal_track_count": active_vocal_track_count,
        "snapshot_count": snapshot_count,
        "target_note_count": len([note for note in candidate_notes if not note.is_rest]),
        "target_range_fit_ratio": round(target_range_fit_ratio, 4),
        "issue_count": len(issues),
        "severity_counts": dict(severity_counts),
        "issue_code_counts": dict(code_counts),
        "issues": issues[:MAX_EXPOSED_ISSUES],
    }


def _attach_ensemble_warnings(notes: list[TrackPitchEvent], issues: list[dict[str, Any]]) -> list[TrackPitchEvent]:
    warnings_by_note_id: dict[str, set[str]] = defaultdict(set)
    for issue in issues:
        note_id = issue.get("target_note_id")
        if isinstance(note_id, str):
            warnings_by_note_id[note_id].add(f"ensemble_{issue['code']}")
    if not warnings_by_note_id:
        return notes
    return [
        note.model_copy(
            update={
                "quality_warnings": sorted(
                    {
                        *note.quality_warnings,
                        *warnings_by_note_id.get(note.id, set()),
                    }
                )
            }
        )
        if note.id in warnings_by_note_id
        else note
        for note in notes
    ]


def _active_vocal_notes_at(
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    beat: float,
) -> dict[int, TrackPitchEvent]:
    return {
        slot_id: note
        for slot_id, notes in tracks_by_slot.items()
        if slot_id in VOCAL_SLOT_IDS
        for note in [_active_note_at(notes, beat)]
        if note is not None and note.pitch_midi is not None and not note.is_rest
    }


def _active_note_at(notes: list[TrackPitchEvent], beat: float) -> TrackPitchEvent | None:
    candidates = [
        note
        for note in notes
        if not note.is_rest
        and note.pitch_midi is not None
        and note.beat <= beat + 0.001
        and beat < note.beat + max(0.001, note.duration_beats) - 0.001
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda note: (note.confidence, note.duration_beats))


def _pitched_notes(notes: list[TrackPitchEvent]) -> list[TrackPitchEvent]:
    return [
        note
        for note in notes
        if not note.is_rest and note.pitch_midi is not None
    ]


def _range_fit_ratio(slot_id: int, notes: list[TrackPitchEvent]) -> float:
    if not notes:
        return 1.0
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    in_range = sum(1 for note in notes if note.pitch_midi is not None and low <= note.pitch_midi <= high)
    return in_range / len(notes)


def _issue(
    *,
    code: str,
    severity: str,
    beat: float,
    slot_ids: list[int],
    message: str,
    target_note_id: str | None = None,
) -> dict[str, Any]:
    issue = {
        "code": code,
        "severity": severity,
        "beat": round(beat, 4),
        "slot_ids": slot_ids,
        "track_names": [_safe_track_name(slot_id) for slot_id in slot_ids],
        "message": message,
    }
    if target_note_id is not None:
        issue["target_note_id"] = target_note_id
    return issue


def _motion_direction(previous_pitch: int, current_pitch: int) -> int:
    if current_pitch > previous_pitch:
        return 1
    if current_pitch < previous_pitch:
        return -1
    return 0


def _vertical_interval_class(first_pitch: int, second_pitch: int) -> int:
    return abs(first_pitch - second_pitch) % 12


def _safe_track_name(slot_id: int) -> str:
    try:
        return track_name(slot_id)
    except ValueError:
        return f"Track {slot_id}"


def _append_warning(existing: list[str], *warnings: str) -> list[str]:
    merged = list(existing)
    for warning in warnings:
        if warning not in merged:
            merged.append(warning)
    return merged
