from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, median
from uuid import uuid4

from gigastudy_api.api.schemas.studios import ReportIssue, ScoringReport, TrackNote
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    quarter_beats_per_measure,
    seconds_per_beat,
)


@dataclass(frozen=True)
class NoteMatch:
    answer: TrackNote
    performance: TrackNote
    timing_error_seconds: float
    pitch_error_semitones: float


@dataclass(frozen=True)
class HarmonyNoteEvaluation:
    performance: TrackNote
    adjusted_beat: float
    context_notes: tuple[TrackNote, ...]
    harmony_score: float
    chord_fit_score: float
    rhythm_score: float
    range_score: float
    spacing_score: float
    crossing_issue: bool


@dataclass(frozen=True)
class ChordFitResult:
    score: float
    root: int
    quality_name: str
    template: frozenset[int]
    required_tones: frozenset[int]
    normalized: frozenset[int]
    outsiders: frozenset[int]
    missing_required: frozenset[int]


NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
CHORD_QUALITIES: tuple[tuple[str, set[int], set[int]], ...] = (
    ("maj", {0, 4, 7}, {0, 4}),
    ("min", {0, 3, 7}, {0, 3}),
    ("dim", {0, 3, 6}, {0, 3}),
    ("aug", {0, 4, 8}, {0, 4}),
    ("sus2", {0, 2, 7}, {0, 2}),
    ("sus4", {0, 5, 7}, {0, 5}),
    ("maj7", {0, 4, 7, 11}, {0, 4, 11}),
    ("7", {0, 4, 7, 10}, {0, 4, 10}),
    ("min7", {0, 3, 7, 10}, {0, 3, 10}),
    ("m7b5", {0, 3, 6, 10}, {0, 3, 6}),
    ("dim7", {0, 3, 6, 9}, {0, 3, 6}),
)
COMMON_COLOR_TONES = {2, 5, 9, 10, 11}


def build_scoring_report(
    *,
    target_slot_id: int,
    target_track_name: str,
    reference_slot_ids: list[int],
    include_metronome: bool,
    created_at: str,
    answer_notes: list[TrackNote],
    performance_notes: list[TrackNote],
) -> ScoringReport:
    answer = _pitched_notes(answer_notes)
    performance = _pitched_notes(performance_notes)
    alignment_offset = estimate_alignment_offset(answer, performance)
    matches, missing, extra = match_notes(
        answer,
        performance,
        alignment_offset_seconds=alignment_offset,
    )

    pitch_errors = [abs(match.pitch_error_semitones) for match in matches]
    timing_errors = [abs(match.timing_error_seconds) for match in matches]
    mean_pitch_error = round(mean(pitch_errors), 4) if pitch_errors else None
    mean_timing_error = round(mean(timing_errors), 4) if timing_errors else None
    denominator = max(1, len(answer))
    missing_ratio = len(missing) / denominator
    extra_ratio = len(extra) / max(1, len(performance))

    pitch_score = _score_pitch(mean_pitch_error, missing_ratio, extra_ratio)
    rhythm_score = _score_rhythm(mean_timing_error, missing_ratio, extra_ratio)
    overall_score = round((pitch_score + rhythm_score) / 2, 2)

    return ScoringReport(
        report_id=uuid4().hex,
        score_mode="answer",
        target_slot_id=target_slot_id,
        target_track_name=target_track_name,
        reference_slot_ids=reference_slot_ids,
        include_metronome=include_metronome,
        created_at=created_at,
        answer_note_count=len(answer),
        performance_note_count=len(performance),
        matched_note_count=len(matches),
        missing_note_count=len(missing),
        extra_note_count=len(extra),
        alignment_offset_seconds=alignment_offset,
        overall_score=overall_score,
        pitch_score=pitch_score,
        rhythm_score=rhythm_score,
        mean_abs_pitch_error_semitones=mean_pitch_error,
        mean_abs_timing_error_seconds=mean_timing_error,
        pitch_summary=_metric_summary("pitch", pitch_score, mean_pitch_error),
        rhythm_summary=_metric_summary("rhythm", rhythm_score, mean_timing_error),
        issues=_build_issues(matches, missing, extra, alignment_offset),
    )


def build_harmony_scoring_report(
    *,
    target_slot_id: int,
    target_track_name: str,
    reference_slot_ids: list[int],
    include_metronome: bool,
    created_at: str,
    reference_tracks_by_slot: dict[int, list[TrackNote]],
    performance_notes: list[TrackNote],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> ScoringReport:
    references = {
        slot_id: _pitched_notes(_notes_with_voice_index(notes, slot_id))
        for slot_id, notes in reference_tracks_by_slot.items()
        if slot_id in reference_slot_ids
    }
    performance = _pitched_notes(performance_notes)
    alignment_offset = estimate_harmony_alignment_offset(
        references,
        performance,
        bpm=bpm,
        include_metronome=include_metronome,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    evaluations = [
        _evaluate_harmony_note(
            note,
            target_slot_id=target_slot_id,
            references=references,
            alignment_offset_seconds=alignment_offset,
            bpm=bpm,
            include_metronome=include_metronome,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        for note in performance
    ]

    if evaluations:
        harmony_score = round(_weighted_average([item.harmony_score for item in evaluations], performance), 2)
        chord_fit_score = round(_weighted_average([item.chord_fit_score for item in evaluations], performance), 2)
        rhythm_score = round(_weighted_average([item.rhythm_score for item in evaluations], performance), 2)
        range_score = round(_weighted_average([item.range_score for item in evaluations], performance), 2)
        spacing_score = round(_weighted_average([item.spacing_score for item in evaluations], performance), 2)
        voice_leading_score = _score_voice_leading(
            performance,
            target_slot_id=target_slot_id,
            references=references,
            alignment_offset_seconds=alignment_offset,
            bpm=bpm,
        )
        structural_penalty = _score_structural_arrangement_penalty(
            evaluations,
            performance,
            target_slot_id=target_slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        arrangement_score = round(
            max(
                0,
                harmony_score * 0.24
                + chord_fit_score * 0.24
                + spacing_score * 0.18
                + voice_leading_score * 0.18
                + range_score * 0.16
                - structural_penalty,
            ),
            2,
        )
        overall_score = round(
            max(
                0,
                harmony_score * 0.24
                + chord_fit_score * 0.2
                + rhythm_score * 0.16
                + spacing_score * 0.14
                + range_score * 0.11
                + voice_leading_score * 0.15
                - structural_penalty * 0.15,
            ),
            2,
        )
    else:
        harmony_score = 0.0
        chord_fit_score = 0.0
        rhythm_score = 0.0
        range_score = 0.0
        spacing_score = 0.0
        voice_leading_score = 0.0
        arrangement_score = 0.0
        overall_score = 0.0

    issues = _build_harmony_issues(
        evaluations,
        performance,
        references=references,
        target_slot_id=target_slot_id,
        alignment_offset_seconds=alignment_offset,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        reference_count=sum(len(notes) for notes in references.values()),
    )
    return ScoringReport(
        report_id=uuid4().hex,
        score_mode="harmony",
        target_slot_id=target_slot_id,
        target_track_name=target_track_name,
        reference_slot_ids=reference_slot_ids,
        include_metronome=include_metronome,
        created_at=created_at,
        answer_note_count=sum(len(notes) for notes in references.values()),
        performance_note_count=len(performance),
        matched_note_count=sum(1 for item in evaluations if item.context_notes),
        missing_note_count=0,
        extra_note_count=0,
        alignment_offset_seconds=alignment_offset,
        overall_score=overall_score,
        pitch_score=harmony_score,
        rhythm_score=rhythm_score,
        harmony_score=harmony_score,
        chord_fit_score=chord_fit_score,
        range_score=range_score,
        spacing_score=spacing_score,
        voice_leading_score=voice_leading_score,
        arrangement_score=arrangement_score,
        mean_abs_pitch_error_semitones=None,
        mean_abs_timing_error_seconds=_mean_harmony_rhythm_error(evaluations, bpm=bpm),
        pitch_summary=f"harmony_score={harmony_score:.2f};chord_fit={chord_fit_score:.2f}",
        rhythm_summary=f"rhythm_score={rhythm_score:.2f};grid_context_alignment",
        harmony_summary=(
            f"harmony={harmony_score:.2f};chord={chord_fit_score:.2f};spacing={spacing_score:.2f};"
            f"range={range_score:.2f};voice_leading={voice_leading_score:.2f};"
            f"arrangement={arrangement_score:.2f};context_notes={sum(len(notes) for notes in references.values())}"
        ),
        issues=issues,
    )


def estimate_alignment_offset(answer: list[TrackNote], performance: list[TrackNote]) -> float:
    if not answer or not performance:
        return 0

    pair_count = min(len(answer), len(performance), 16)
    candidates = [
        performance[index].onset_seconds - answer[index].onset_seconds
        for index in range(pair_count)
    ]

    for answer_note in answer[:16]:
        for performance_note in performance[:20]:
            if _pitch_error(answer_note, performance_note) <= 2:
                candidates.append(performance_note.onset_seconds - answer_note.onset_seconds)

    candidates.append(median(candidates))
    best_offset = min(candidates, key=lambda offset: _alignment_cost(answer, performance, offset))
    return round(best_offset, 2)


def estimate_harmony_alignment_offset(
    references: dict[int, list[TrackNote]],
    performance: list[TrackNote],
    *,
    bpm: int,
    include_metronome: bool,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> float:
    if not performance:
        return 0
    anchor_seconds = _reference_anchor_seconds(
        references,
        bpm=bpm,
        include_metronome=include_metronome,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if not anchor_seconds:
        return 0

    candidates: list[float] = [0]
    for performance_note in performance[:16]:
        nearest_anchor = min(anchor_seconds, key=lambda anchor: abs(anchor - performance_note.onset_seconds))
        candidates.append(performance_note.onset_seconds - nearest_anchor)
    if candidates:
        candidates.append(median(candidates))

    def cost(offset: float) -> float:
        total = 0.0
        for performance_note in performance[:32]:
            adjusted = performance_note.onset_seconds - offset
            total += min(abs(anchor - adjusted) for anchor in anchor_seconds)
        return total / max(1, min(len(performance), 32))

    best_offset = min(candidates, key=cost)
    return round(best_offset, 2)


def match_notes(
    answer: list[TrackNote],
    performance: list[TrackNote],
    *,
    alignment_offset_seconds: float,
) -> tuple[list[NoteMatch], list[TrackNote], list[TrackNote]]:
    used_performance_ids: set[str] = set()
    matches: list[NoteMatch] = []
    missing: list[TrackNote] = []

    for answer_note in answer:
        candidate = _best_candidate(
            answer_note,
            performance,
            used_performance_ids,
            alignment_offset_seconds,
        )
        if candidate is None:
            missing.append(answer_note)
            continue

        timing_error = _timing_error(answer_note, candidate, alignment_offset_seconds)
        pitch_error = _signed_pitch_error(answer_note, candidate)
        matches.append(
            NoteMatch(
                answer=answer_note,
                performance=candidate,
                timing_error_seconds=round(timing_error, 4),
                pitch_error_semitones=round(pitch_error, 4),
            )
        )
        used_performance_ids.add(candidate.id)

    extra = [note for note in performance if note.id not in used_performance_ids]
    return matches, missing, extra


def _pitched_notes(notes: list[TrackNote]) -> list[TrackNote]:
    return sorted(
        (note for note in notes if not note.is_rest and note.pitch_midi is not None),
        key=lambda note: (note.onset_seconds, note.beat),
    )


def _notes_with_voice_index(notes: list[TrackNote], slot_id: int) -> list[TrackNote]:
    return [
        note if note.voice_index is not None else note.model_copy(update={"voice_index": slot_id})
        for note in notes
    ]


def _evaluate_harmony_note(
    note: TrackNote,
    *,
    target_slot_id: int,
    references: dict[int, list[TrackNote]],
    alignment_offset_seconds: float,
    bpm: int,
    include_metronome: bool,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> HarmonyNoteEvaluation:
    beat_seconds = seconds_per_beat(bpm)
    adjusted_beat = max(1, note.beat - alignment_offset_seconds / beat_seconds)
    context_notes = tuple(_active_reference_notes_at(references, adjusted_beat))
    if not context_notes:
        context_notes = tuple(_nearest_reference_notes_at(references, adjusted_beat))
    harmony_score = _score_harmonic_fit(
        note,
        context_notes,
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    chord_fit_score = _score_chord_fit(
        note,
        context_notes,
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    rhythm_score = _score_harmony_rhythm(
        note,
        adjusted_beat=adjusted_beat,
        references=references,
        bpm=bpm,
        include_metronome=include_metronome,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    range_score = _score_range_fit(note, target_slot_id)
    spacing_score = _score_spacing_fit(note, target_slot_id=target_slot_id, context_notes=context_notes)
    return HarmonyNoteEvaluation(
        performance=note,
        adjusted_beat=round(adjusted_beat, 4),
        context_notes=context_notes,
        harmony_score=harmony_score,
        chord_fit_score=chord_fit_score,
        rhythm_score=rhythm_score,
        range_score=range_score,
        spacing_score=spacing_score,
        crossing_issue=_has_voice_crossing(note, target_slot_id=target_slot_id, context_notes=context_notes),
    )


def _best_candidate(
    answer_note: TrackNote,
    performance: list[TrackNote],
    used_performance_ids: set[str],
    alignment_offset_seconds: float,
) -> TrackNote | None:
    tolerance_seconds = max(0.18, answer_note.duration_seconds * 0.65)
    candidates: list[tuple[float, TrackNote]] = []
    for performance_note in performance:
        if performance_note.id in used_performance_ids:
            continue
        timing_error = abs(_timing_error(answer_note, performance_note, alignment_offset_seconds))
        pitch_error = _pitch_error(answer_note, performance_note)
        if timing_error <= tolerance_seconds and pitch_error <= 7:
            candidates.append((timing_error + pitch_error * 0.035, performance_note))

    if not candidates:
        return None
    return min(candidates, key=lambda candidate: candidate[0])[1]


def _alignment_cost(answer: list[TrackNote], performance: list[TrackNote], offset: float) -> float:
    matches, missing, extra = match_notes(answer, performance, alignment_offset_seconds=offset)
    timing_cost = sum(abs(match.timing_error_seconds) for match in matches)
    pitch_cost = sum(abs(match.pitch_error_semitones) * 0.035 for match in matches)
    return timing_cost + pitch_cost + len(missing) * 1.5 + len(extra) * 0.6


def _timing_error(answer_note: TrackNote, performance_note: TrackNote, offset: float) -> float:
    return performance_note.onset_seconds - offset - answer_note.onset_seconds


def _signed_pitch_error(answer_note: TrackNote, performance_note: TrackNote) -> float:
    if answer_note.pitch_midi is None or performance_note.pitch_midi is None:
        return 0
    return float(performance_note.pitch_midi - answer_note.pitch_midi)


def _pitch_error(answer_note: TrackNote, performance_note: TrackNote) -> float:
    return abs(_signed_pitch_error(answer_note, performance_note))


def _reference_anchor_seconds(
    references: dict[int, list[TrackNote]],
    *,
    bpm: int,
    include_metronome: bool,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[float]:
    anchors = {
        round(note.onset_seconds, 4)
        for notes in references.values()
        for note in notes
        if not note.is_rest
    }
    if include_metronome:
        beat_seconds = seconds_per_beat(bpm)
        max_reference_beat = max(
            (note.beat + note.duration_beats for notes in references.values() for note in notes),
            default=quarter_beats_per_measure(time_signature_numerator, time_signature_denominator) * 2,
        )
        for beat_index in range(max(1, int(max_reference_beat) + 2)):
            anchors.add(round(beat_index * beat_seconds, 4))
    return sorted(anchors)


def _active_reference_notes_at(
    references: dict[int, list[TrackNote]],
    beat: float,
) -> list[TrackNote]:
    active: list[TrackNote] = []
    for notes in references.values():
        candidates = [
            note
            for note in notes
            if note.beat <= beat + 0.0001 and beat < note.beat + max(0.25, note.duration_beats) - 0.0001
        ]
        if candidates:
            active.append(max(candidates, key=lambda note: (note.beat, note.duration_beats)))
    return active


def _nearest_reference_notes_at(
    references: dict[int, list[TrackNote]],
    beat: float,
) -> list[TrackNote]:
    nearest: list[TrackNote] = []
    for notes in references.values():
        if not notes:
            continue
        candidate = min(notes, key=lambda note: abs(note.beat - beat))
        if abs(candidate.beat - beat) <= 0.5:
            nearest.append(candidate)
    return nearest


def _score_harmonic_fit(
    note: TrackNote,
    context_notes: tuple[TrackNote, ...],
    *,
    adjusted_beat: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    if note.pitch_midi is None:
        return 0
    if not context_notes:
        return 45
    interval_scores = [
        _interval_consonance_score((note.pitch_midi - context_note.pitch_midi) % 12)
        for context_note in context_notes
        if context_note.pitch_midi is not None
    ]
    if not interval_scores:
        return 45
    base_score = min(interval_scores) * 0.55 + mean(interval_scores) * 0.45
    if base_score < 62 and _is_passing_dissonance(
        note,
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        base_score += 14
    elif base_score < 70 and _is_strong_beat(
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        base_score -= 6
    return round(max(0, min(100, base_score)), 2)


def _score_chord_fit(
    note: TrackNote,
    context_notes: tuple[TrackNote, ...],
    *,
    adjusted_beat: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    pitch_classes = {
        candidate.pitch_midi % 12
        for candidate in (note, *context_notes)
        if candidate.pitch_midi is not None
    }
    if len(pitch_classes) <= 1:
        return 55
    if len(pitch_classes) == 2:
        pitch_list = sorted(pitch_classes)
        interval = (pitch_list[1] - pitch_list[0]) % 12
        score = max(
            _interval_consonance_score(interval),
            _interval_consonance_score((12 - interval) % 12),
        )
        if score < 62 and _is_passing_dissonance(
            note,
            adjusted_beat=adjusted_beat,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            score += 10
        return round(max(0, min(100, score)), 2)

    chord = _best_chord_fit_result(pitch_classes)
    if chord is None:
        return 45
    best_score = chord.score

    if len(chord.outsiders) == 1 and _has_common_color_tone(set(chord.normalized)):
        best_score += 8
    if best_score < 68 and _is_passing_dissonance(
        note,
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        best_score += 14
    elif best_score < 74 and _is_strong_beat(
        adjusted_beat=adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        best_score -= 5
    return round(max(0, min(100, best_score)), 2)


def _best_chord_fit_result(pitch_classes: set[int]) -> ChordFitResult | None:
    if len(pitch_classes) < 3:
        return None
    best: ChordFitResult | None = None
    for root in range(12):
        normalized = frozenset((pitch_class - root) % 12 for pitch_class in pitch_classes)
        for quality_name, template, required_tones in CHORD_QUALITIES:
            frozen_template = frozenset(template)
            frozen_required = frozenset(required_tones)
            outsiders = frozenset(normalized - frozen_template)
            missing_required = frozenset(frozen_required - normalized)
            covered = normalized & frozen_template
            score = 100.0
            score -= len(outsiders) * 38
            score -= len(missing_required) * 12
            score -= max(0, len(frozen_template - normalized) - 1) * 4
            score += min(8, len(covered) * 2)
            candidate = ChordFitResult(
                score=score,
                root=root,
                quality_name=quality_name,
                template=frozen_template,
                required_tones=frozen_required,
                normalized=normalized,
                outsiders=outsiders,
                missing_required=missing_required,
            )
            if best is None or candidate.score > best.score:
                best = candidate
    return best


def _has_common_color_tone(normalized: set[int]) -> bool:
    for stable_core in ({0, 4, 7}, {0, 3, 7}):
        extra_tones = normalized - stable_core
        if stable_core <= normalized and len(extra_tones) == 1:
            return next(iter(extra_tones)) in COMMON_COLOR_TONES
    return False


def _interval_consonance_score(interval_class: int) -> float:
    scores = {
        0: 84,
        1: 30,
        2: 58,
        3: 94,
        4: 96,
        5: 72,
        6: 24,
        7: 94,
        8: 88,
        9: 90,
        10: 58,
        11: 34,
    }
    return scores.get(interval_class, 50)


def _is_strong_beat(
    *,
    adjusted_beat: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    beat_in_measure = ((adjusted_beat - 1) % beats_per_measure) + 1
    if abs(beat_in_measure - 1) <= 0.08:
        return True
    if beats_per_measure >= 4 and abs(beat_in_measure - 3) <= 0.08:
        return True
    return False


def _is_passing_dissonance(
    note: TrackNote,
    *,
    adjusted_beat: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    if note.duration_beats > 0.5:
        return False
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    beat_in_measure = ((adjusted_beat - 1) % beats_per_measure) + 1
    return abs(beat_in_measure - round(beat_in_measure)) > 0.08


def _score_spacing_fit(
    note: TrackNote,
    *,
    target_slot_id: int,
    context_notes: tuple[TrackNote, ...],
) -> float:
    if note.pitch_midi is None:
        return 0
    stack = _vertical_voice_stack(note, target_slot_id=target_slot_id, context_notes=context_notes)
    if len(stack) < 2:
        return 70

    penalties = 0.0
    for (upper_slot, upper_pitch), (lower_slot, lower_pitch) in zip(stack, stack[1:], strict=False):
        gap = upper_pitch - lower_pitch
        if gap < 0:
            penalties += 28 + abs(gap) * 2
            continue
        if gap == 0 and upper_slot != lower_slot:
            penalties += 12
        max_gap = 16 if lower_slot >= 5 or upper_slot >= 4 else 12
        if gap > max_gap:
            penalties += (gap - max_gap) * 4
        if upper_pitch < 60 and lower_pitch < 60 and 0 < gap < 3:
            penalties += 10

    return round(max(0, min(100, 100 - penalties)), 2)


def _vertical_voice_stack(
    note: TrackNote,
    *,
    target_slot_id: int,
    context_notes: tuple[TrackNote, ...],
) -> list[tuple[int, int]]:
    entries: list[tuple[int, int]] = []
    if note.pitch_midi is not None:
        entries.append((target_slot_id, note.pitch_midi))
    for context_note in context_notes:
        if context_note.pitch_midi is None:
            continue
        entries.append((context_note.voice_index or 99, context_note.pitch_midi))
    return sorted(entries, key=lambda item: item[0])


def _score_harmony_rhythm(
    note: TrackNote,
    *,
    adjusted_beat: float,
    references: dict[int, list[TrackNote]],
    bpm: int,
    include_metronome: bool,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    anchor_seconds = _reference_anchor_seconds(
        references,
        bpm=bpm,
        include_metronome=include_metronome,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if not anchor_seconds:
        return 50
    adjusted_seconds = (adjusted_beat - 1) * seconds_per_beat(bpm)
    nearest_error = min(abs(anchor - adjusted_seconds) for anchor in anchor_seconds)
    return round(max(0, min(100, 100 - nearest_error * 150)), 2)


def _score_range_fit(note: TrackNote, target_slot_id: int) -> float:
    if note.pitch_midi is None:
        return 0
    low, high = SLOT_RANGES.get(target_slot_id, (0, 127))
    if low <= note.pitch_midi <= high:
        return 100
    distance = low - note.pitch_midi if note.pitch_midi < low else note.pitch_midi - high
    return round(max(0, 100 - distance * 18), 2)


def _has_voice_crossing(
    note: TrackNote,
    *,
    target_slot_id: int,
    context_notes: tuple[TrackNote, ...],
) -> bool:
    if note.pitch_midi is None:
        return False
    for context_note in context_notes:
        if context_note.pitch_midi is None or context_note.voice_index is None:
            continue
        if context_note.voice_index < target_slot_id and note.pitch_midi > context_note.pitch_midi + 1:
            return True
        if context_note.voice_index > target_slot_id and note.pitch_midi < context_note.pitch_midi - 1:
            return True
    return False


def _score_voice_leading(
    performance: list[TrackNote],
    *,
    target_slot_id: int,
    references: dict[int, list[TrackNote]] | None = None,
    alignment_offset_seconds: float = 0,
    bpm: int | None = None,
) -> float:
    if len(performance) < 2:
        return 100 if performance else 0
    penalties = 0.0
    low, high = SLOT_RANGES.get(target_slot_id, (0, 127))
    for previous, current in zip(performance, performance[1:], strict=False):
        if previous.pitch_midi is None or current.pitch_midi is None:
            continue
        leap = abs(current.pitch_midi - previous.pitch_midi)
        if leap > 12:
            penalties += (leap - 12) * 5 + 18
        elif leap > 9:
            penalties += (leap - 9) * 3
        if not (low <= current.pitch_midi <= high):
            penalties += 8
    if references and bpm:
        penalties += _parallel_motion_count(
            performance,
            references=references,
            alignment_offset_seconds=alignment_offset_seconds,
            bpm=bpm,
        ) * 16
    return round(max(0, 100 - penalties / max(1, len(performance) - 1)), 2)


def _parallel_motion_count(
    performance: list[TrackNote],
    *,
    references: dict[int, list[TrackNote]],
    alignment_offset_seconds: float,
    bpm: int,
) -> int:
    beat_offset = alignment_offset_seconds / seconds_per_beat(bpm)
    count = 0
    for previous, current in zip(performance, performance[1:], strict=False):
        if previous.pitch_midi is None or current.pitch_midi is None:
            continue
        performance_motion = current.pitch_midi - previous.pitch_midi
        if abs(performance_motion) < 2:
            continue
        previous_beat = max(1, previous.beat - beat_offset)
        current_beat = max(1, current.beat - beat_offset)
        for reference_notes in references.values():
            previous_reference = _reference_note_from_track_at(reference_notes, previous_beat)
            current_reference = _reference_note_from_track_at(reference_notes, current_beat)
            if (
                previous_reference is None
                or current_reference is None
                or previous_reference.pitch_midi is None
                or current_reference.pitch_midi is None
            ):
                continue
            if not _is_structural_parallel_motion(previous, current, previous_reference, current_reference):
                continue
            reference_motion = current_reference.pitch_midi - previous_reference.pitch_midi
            if abs(reference_motion) < 2 or _motion_direction(reference_motion) != _motion_direction(performance_motion):
                continue
            previous_interval = abs(previous.pitch_midi - previous_reference.pitch_midi) % 12
            current_interval = abs(current.pitch_midi - current_reference.pitch_midi) % 12
            if previous_interval in {0, 7} and current_interval == previous_interval:
                count += 1
    return count


def _reference_note_from_track_at(notes: list[TrackNote], beat: float) -> TrackNote | None:
    active = [
        note
        for note in notes
        if note.beat <= beat + 0.0001 and beat < note.beat + max(0.25, note.duration_beats) - 0.0001
    ]
    if active:
        return max(active, key=lambda note: (note.beat, note.duration_beats))
    if not notes:
        return None
    nearest = min(notes, key=lambda note: abs(note.beat - beat))
    return nearest if abs(nearest.beat - beat) <= 0.5 else None


def _motion_direction(value: int) -> int:
    return 1 if value > 0 else -1 if value < 0 else 0


def _is_structural_parallel_motion(
    previous: TrackNote,
    current: TrackNote,
    previous_reference: TrackNote,
    current_reference: TrackNote,
) -> bool:
    return min(
        previous.duration_beats,
        current.duration_beats,
        previous_reference.duration_beats,
        current_reference.duration_beats,
    ) >= 0.75


def _weighted_average(values: list[float], notes: list[TrackNote]) -> float:
    if not values:
        return 0
    weights = [max(0.25, note.duration_beats) * max(0.35, note.confidence) for note in notes[: len(values)]]
    total_weight = sum(weights)
    if total_weight <= 0:
        return mean(values)
    return sum(value * weight for value, weight in zip(values, weights, strict=False)) / total_weight


def _mean_harmony_rhythm_error(evaluations: list[HarmonyNoteEvaluation], *, bpm: int) -> float | None:
    if not evaluations:
        return None
    errors = [max(0, (100 - evaluation.rhythm_score) / 150) for evaluation in evaluations]
    if not errors:
        return None
    return round(mean(errors), 4)


def _score_structural_arrangement_penalty(
    evaluations: list[HarmonyNoteEvaluation],
    performance: list[TrackNote],
    *,
    target_slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    penalty = 0.0
    for evaluation in evaluations:
        if _has_unresolved_structural_tension(
            evaluation,
            performance,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            penalty += 12
        if _has_chord_coverage_issue(
            evaluation,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            penalty += 7
        if _has_bass_foundation_issue(
            evaluation,
            target_slot_id=target_slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            penalty += 8
    return min(28, penalty)


def _has_unresolved_structural_tension(
    evaluation: HarmonyNoteEvaluation,
    performance: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    note = evaluation.performance
    if note.pitch_midi is None or len(evaluation.context_notes) < 2:
        return False
    if not _is_structural_harmony_position(
        evaluation,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        return False
    pitch_classes = _pitch_classes_for_notes((note, *evaluation.context_notes))
    chord = _best_chord_fit_result(pitch_classes)
    if chord is None:
        return False
    degree = (note.pitch_midi % 12 - chord.root) % 12
    if degree in chord.template:
        return False
    if degree in COMMON_COLOR_TONES and _has_common_color_tone(set(chord.normalized)):
        return False
    if _resolves_stepwise_to_chord_tone(note, performance, chord):
        return False
    return True


def _has_chord_coverage_issue(
    evaluation: HarmonyNoteEvaluation,
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    if len(evaluation.context_notes) < 2:
        return False
    if not _is_structural_harmony_position(
        evaluation,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        return False
    pitch_classes = _pitch_classes_for_notes((evaluation.performance, *evaluation.context_notes))
    if len(pitch_classes) <= 2:
        return True
    chord = _best_chord_fit_result(pitch_classes)
    if chord is None or chord.score < _chord_fit_issue_threshold(evaluation):
        return False
    return not ({3, 4} & set(chord.normalized))


def _has_bass_foundation_issue(
    evaluation: HarmonyNoteEvaluation,
    *,
    target_slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    note = evaluation.performance
    if target_slot_id != 5 or note.pitch_midi is None or len(evaluation.context_notes) < 2:
        return False
    if not _is_structural_harmony_position(
        evaluation,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        return False
    return note.pitch_midi > 55


def _is_structural_harmony_position(
    evaluation: HarmonyNoteEvaluation,
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    return evaluation.performance.duration_beats >= 0.75 and _is_strong_beat(
        adjusted_beat=evaluation.adjusted_beat,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _pitch_classes_for_notes(notes: tuple[TrackNote, ...]) -> set[int]:
    return {
        note.pitch_midi % 12
        for note in notes
        if note.pitch_midi is not None
    }


def _resolves_stepwise_to_chord_tone(
    note: TrackNote,
    performance: list[TrackNote],
    chord: ChordFitResult,
) -> bool:
    following_notes = [
        candidate
        for candidate in performance
        if candidate.id != note.id
        and candidate.pitch_midi is not None
        and note.beat + 0.05 <= candidate.beat <= note.beat + 2
    ]
    if not following_notes:
        return False
    next_note = min(following_notes, key=lambda candidate: candidate.beat)
    if next_note.pitch_midi is None or note.pitch_midi is None:
        return False
    if abs(next_note.pitch_midi - note.pitch_midi) > 2:
        return False
    next_degree = (next_note.pitch_midi % 12 - chord.root) % 12
    return next_degree in chord.template


def _score_pitch(mean_error: float | None, missing_ratio: float, extra_ratio: float) -> float:
    if mean_error is None:
        base = 0.0
    else:
        base = 100 - mean_error * 22
    return round(max(0, min(100, base - missing_ratio * 35 - extra_ratio * 10)), 2)


def _score_rhythm(mean_error: float | None, missing_ratio: float, extra_ratio: float) -> float:
    if mean_error is None:
        base = 0.0
    else:
        base = 100 - mean_error * 140
    return round(max(0, min(100, base - missing_ratio * 35 - extra_ratio * 10)), 2)


def _metric_summary(metric: str, score: float, error: float | None) -> str:
    error_text = "none" if error is None else f"{error:.4f}"
    return f"{metric}_score={score:.2f};mean_abs_error={error_text}"


def _build_harmony_issues(
    evaluations: list[HarmonyNoteEvaluation],
    performance: list[TrackNote],
    *,
    references: dict[int, list[TrackNote]],
    target_slot_id: int,
    alignment_offset_seconds: float,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    reference_count: int,
) -> list[ReportIssue]:
    issues: list[ReportIssue] = []
    if reference_count == 0:
        issues.append(
            ReportIssue(
                at_seconds=0,
                issue_type="harmony",
                severity="error",
                message="화음 채점에는 등록된 비교 트랙이 최소 1개 필요합니다.",
            )
        )
    if not performance:
        issues.append(
            ReportIssue(
                at_seconds=0,
                issue_type="missing",
                severity="error",
                message="채점할 음성 입력에서 안정적인 노래 음을 찾지 못했습니다.",
            )
        )
        return issues

    for evaluation in evaluations:
        note = evaluation.performance
        actual_at = round(max(0, note.onset_seconds - alignment_offset_seconds), 4)
        if evaluation.harmony_score < 55:
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="harmony",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message=_harmony_issue_message(note, evaluation.context_notes),
                )
            )
        if evaluation.chord_fit_score < _chord_fit_issue_threshold(evaluation):
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="chord_fit",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message=_chord_fit_issue_message(note, evaluation.context_notes),
                )
            )
        if evaluation.rhythm_score < 72:
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="rhythm",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message="선택한 기준 트랙/메트로놈의 박자 지점에서 다소 벗어났습니다.",
                )
            )
        if evaluation.range_score < 80:
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="range",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message=f"{note.label} 음이 선택한 성부의 권장 음역에서 벗어납니다.",
                )
            )
        if evaluation.spacing_score < 70:
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="spacing",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message="동시에 울리는 성부 간격이 너무 넓거나 낮은 음역에서 밀집되어 편곡선이 불안정합니다.",
                )
            )
        if evaluation.crossing_issue:
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="crossing",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message="선택한 기준 트랙과 성부 상하 관계가 뒤집힐 가능성이 있습니다.",
                )
            )
        if _has_unresolved_structural_tension(
            evaluation,
            performance,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="tension_resolution",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message=(
                        f"{note.label} is a structural non-chord tension that does not resolve "
                        "stepwise into the inferred sonority."
                    ),
                )
            )
        if _has_chord_coverage_issue(
            evaluation,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="chord_coverage",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message="This structural beat has too few distinct chord tones for a stable a cappella sonority.",
                )
            )
        if _has_bass_foundation_issue(
            evaluation,
            target_slot_id=target_slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            issues.append(
                ReportIssue(
                    at_seconds=actual_at,
                    issue_type="bass_foundation",
                    severity="warn",
                    performance_note_id=note.id,
                    performance_label=note.label,
                    actual_at_seconds=actual_at,
                    message="The bass note is high for a structural beat, so the ensemble foundation may feel weak.",
                )
            )

    low, high = SLOT_RANGES.get(target_slot_id, (0, 127))
    for previous, current in zip(performance, performance[1:], strict=False):
        if previous.pitch_midi is None or current.pitch_midi is None:
            continue
        leap = abs(current.pitch_midi - previous.pitch_midi)
        if leap > 12 or (leap > 9 and not (low <= current.pitch_midi <= high)):
            issues.append(
                ReportIssue(
                    at_seconds=round(max(0, current.onset_seconds - alignment_offset_seconds), 4),
                    issue_type="voice_leading",
                    severity="warn",
                    performance_note_id=current.id,
                    performance_label=current.label,
                    actual_at_seconds=round(max(0, current.onset_seconds - alignment_offset_seconds), 4),
                    pitch_error_semitones=float(current.pitch_midi - previous.pitch_midi),
                    message="성부 진행이 갑자기 크게 도약해 노래하기 어렵거나 편곡선이 튈 수 있습니다.",
                )
            )
    issues.extend(
        _build_parallel_motion_issues(
            performance,
            references=references,
            alignment_offset_seconds=alignment_offset_seconds,
            bpm=bpm,
        )
    )
    return sorted(issues[:48], key=lambda issue: (issue.at_seconds, issue.issue_type))


def _chord_fit_issue_threshold(evaluation: HarmonyNoteEvaluation) -> float:
    context_count = len(evaluation.context_notes)
    if context_count <= 1:
        return 52
    if context_count == 2:
        return 56
    return 64


def _harmony_issue_message(note: TrackNote, context_notes: tuple[TrackNote, ...]) -> str:
    if not context_notes:
        return f"{note.label} 음 주변에 동시에 비교할 기준음이 부족합니다."
    context = ", ".join(context_note.label for context_note in context_notes[:5])
    return f"{note.label} 음이 기준 화음({context})과 강하게 부딪힐 가능성이 있습니다."


def _chord_fit_issue_message(note: TrackNote, context_notes: tuple[TrackNote, ...]) -> str:
    if not context_notes:
        return f"{note.label} 음을 판단할 기준 화음이 부족합니다."
    context = ", ".join(context_note.label for context_note in context_notes[:5])
    best_label = _best_chord_label((note, *context_notes))
    if best_label:
        return f"{note.label} 음을 포함한 세로 화음({context})이 {best_label}로는 깔끔하게 정리되지 않습니다."
    return f"{note.label} 음을 포함한 세로 화음({context})이 일반적인 아카펠라 코드 톤으로 정리되기 어렵습니다."


def _best_chord_label(notes: tuple[TrackNote, ...]) -> str | None:
    pitch_classes = {
        note.pitch_midi % 12
        for note in notes
        if note.pitch_midi is not None
    }
    if len(pitch_classes) < 3:
        return None
    best: tuple[float, int, str] | None = None
    for root in range(12):
        normalized = {(pitch_class - root) % 12 for pitch_class in pitch_classes}
        for quality_name, template, required_tones in CHORD_QUALITIES:
            outsiders = normalized - template
            missing_required = required_tones - normalized
            score = 100 - len(outsiders) * 28 - len(missing_required) * 12
            if best is None or score > best[0]:
                best = (score, root, quality_name)
    if best is None or best[0] < 62:
        return None
    return f"{NOTE_NAMES[best[1]]}{best[2]}"


def _build_parallel_motion_issues(
    performance: list[TrackNote],
    *,
    references: dict[int, list[TrackNote]],
    alignment_offset_seconds: float,
    bpm: int,
) -> list[ReportIssue]:
    beat_offset = alignment_offset_seconds / seconds_per_beat(bpm)
    issues: list[ReportIssue] = []
    for previous, current in zip(performance, performance[1:], strict=False):
        if previous.pitch_midi is None or current.pitch_midi is None:
            continue
        performance_motion = current.pitch_midi - previous.pitch_midi
        if abs(performance_motion) < 2:
            continue
        previous_beat = max(1, previous.beat - beat_offset)
        current_beat = max(1, current.beat - beat_offset)
        for reference_notes in references.values():
            previous_reference = _reference_note_from_track_at(reference_notes, previous_beat)
            current_reference = _reference_note_from_track_at(reference_notes, current_beat)
            if (
                previous_reference is None
                or current_reference is None
                or previous_reference.pitch_midi is None
                or current_reference.pitch_midi is None
            ):
                continue
            if not _is_structural_parallel_motion(previous, current, previous_reference, current_reference):
                continue
            reference_motion = current_reference.pitch_midi - previous_reference.pitch_midi
            if abs(reference_motion) < 2 or _motion_direction(reference_motion) != _motion_direction(performance_motion):
                continue
            previous_interval = abs(previous.pitch_midi - previous_reference.pitch_midi) % 12
            current_interval = abs(current.pitch_midi - current_reference.pitch_midi) % 12
            if previous_interval in {0, 7} and current_interval == previous_interval:
                actual_at = round(max(0, current.onset_seconds - alignment_offset_seconds), 4)
                interval_name = "8도/유니즌" if current_interval == 0 else "5도"
                issues.append(
                    ReportIssue(
                        at_seconds=actual_at,
                        issue_type="parallel_motion",
                        severity="warn",
                        performance_note_id=current.id,
                        performance_label=current.label,
                        actual_at_seconds=actual_at,
                        pitch_error_semitones=float(performance_motion),
                        message=f"기준 성부와 같은 방향으로 병행 {interval_name} 진행이 생길 수 있습니다.",
                    )
                )
                break
    return issues


def _build_issues(
    matches: list[NoteMatch],
    missing: list[TrackNote],
    extra: list[TrackNote],
    alignment_offset: float,
) -> list[ReportIssue]:
    issues: list[ReportIssue] = []
    for match in matches:
        pitch_error = match.pitch_error_semitones
        timing_error = match.timing_error_seconds
        if abs(pitch_error) < 0.5 and abs(timing_error) < 0.03:
            continue
        if abs(pitch_error) >= 0.5 and abs(timing_error) >= 0.03:
            issue_type = "pitch_rhythm"
        elif abs(pitch_error) >= 0.5:
            issue_type = "pitch"
        else:
            issue_type = "rhythm"
        issues.append(
            ReportIssue(
                at_seconds=round(match.answer.onset_seconds, 4),
                issue_type=issue_type,
                severity="warn",
                answer_note_id=match.answer.id,
                performance_note_id=match.performance.id,
                answer_label=match.answer.label,
                performance_label=match.performance.label,
                expected_at_seconds=round(match.answer.onset_seconds, 4),
                actual_at_seconds=round(match.performance.onset_seconds - alignment_offset, 4),
                timing_error_seconds=timing_error,
                pitch_error_semitones=pitch_error,
            )
        )

    for note in missing:
        issues.append(
            ReportIssue(
                at_seconds=round(note.onset_seconds, 4),
                issue_type="missing",
                severity="error",
                answer_note_id=note.id,
                answer_label=note.label,
                expected_at_seconds=round(note.onset_seconds, 4),
            )
        )

    for note in extra:
        issues.append(
            ReportIssue(
                at_seconds=round(max(0, note.onset_seconds - alignment_offset), 4),
                issue_type="extra",
                severity="warn",
                performance_note_id=note.id,
                performance_label=note.label,
                actual_at_seconds=round(note.onset_seconds - alignment_offset, 4),
            )
        )

    return sorted(issues, key=lambda issue: (issue.at_seconds, issue.issue_type))
