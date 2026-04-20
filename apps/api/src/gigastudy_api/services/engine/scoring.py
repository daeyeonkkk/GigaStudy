from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, median
from uuid import uuid4

from gigastudy_api.api.schemas.studios import ReportIssue, ScoringReport, TrackNote


@dataclass(frozen=True)
class NoteMatch:
    answer: TrackNote
    performance: TrackNote
    timing_error_seconds: float
    pitch_error_semitones: float


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
