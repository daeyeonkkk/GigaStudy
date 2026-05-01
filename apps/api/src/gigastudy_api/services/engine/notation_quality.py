from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from math import ceil, floor
from typing import Any, Mapping

from gigastudy_api.api.schemas.studios import SourceKind, TrackNote
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    beat_in_measure_from_beat,
    label_to_midi,
    measure_index_from_beat,
    midi_to_frequency,
    midi_to_label,
    quarter_beats_per_measure,
    quantize,
    seconds_per_beat,
)
from gigastudy_api.services.engine.notation import (
    KEY_FIFTHS,
    MIN_NOTATED_DURATION_BEATS,
    VOICE_QUANTIZATION_GRID_BEATS,
    annotate_track_notes_for_slot,
    accidental_for_key,
    clef_for_slot,
    display_octave_shift_for_slot,
    normalize_track_notes,
    spell_midi_label,
)

VOICE_LIKE_SOURCE_KINDS: set[str] = {"recording", "audio", "music"}
VOICE_LIKE_NOTE_SOURCES: set[str] = {"voice", "recording", "audio"}
NOTE_GENERATION_SOURCE_KINDS: set[str] = {"ai"}
MAX_VOICE_EVENTS_PER_MEASURE_FACTOR = 2.0
VOICE_DENSITY_SIMPLIFICATION_GRID = 0.5
VOICE_SUSTAIN_MERGE_GAP_BEATS = 0.25
VOICE_NEIGHBOR_BLIP_MAX_DURATION_BEATS = 0.5
VOICE_NEIGHBOR_BLIP_MAX_INTERVAL = 2
VOICE_ISOLATED_ARTIFACT_MAX_DURATION_BEATS = 0.5
VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS = 0.75
VOICE_ISOLATED_ARTIFACT_MAX_CONFIDENCE = 0.58
VOICE_PHRASE_GAP_MAX_BEATS = 0.25
VOICE_PHRASE_GAP_MIN_CONFIDENCE = 0.55
VOICE_PHRASE_GAP_MAX_INTERVAL = 12
VOICE_MEASURE_TAIL_GAP_MAX_BEATS = 0.25
VOICE_MEASURE_TAIL_FOLLOWUP_MAX_BEATS = 0.5
VOICE_MEASURE_TAIL_MIN_DURATION_BEATS = 0.5
VOICE_MEASURE_TAIL_MIN_CONFIDENCE = 0.55
VOICE_SHORT_CLUSTER_MIN_NOTES = 3
VOICE_SHORT_CLUSTER_MAX_DURATION_BEATS = 0.25
VOICE_SHORT_CLUSTER_MAX_GAP_BEATS = 0.25
VOICE_SHORT_CLUSTER_MAX_SPAN_BEATS = 1.0
VOICE_SHORT_CLUSTER_MAX_AVERAGE_CONFIDENCE = 0.66
VOICE_SHORT_CLUSTER_MAX_PITCH_SPAN = 2
MIN_VOICE_CONFIDENCE = 0.34
MIN_VOICE_DURATION_BEATS = 0.08
LLM_REVIEW_MIN_CONFIDENCE = 0.55
REFERENCE_ALIGNMENT_GRID_BEATS = 0.25
REFERENCE_ALIGNMENT_MAX_OFFSET_BEATS = 0.25
REFERENCE_ALIGNMENT_MAX_DISTANCE_BEATS = 0.5
REFERENCE_ALIGNMENT_MIN_NOTES = 2
REFERENCE_ALIGNMENT_MIN_MATCH_RATIO = 0.5
REFERENCE_ALIGNMENT_MIN_IMPROVEMENT = 0.12


@dataclass(frozen=True)
class RegistrationNotationResult:
    notes: list[TrackNote]
    diagnostics: dict[str, Any]


def prepare_notes_for_track_registration(
    notes: list[TrackNote],
    *,
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    reference_tracks: list[list[TrackNote]] | None = None,
) -> RegistrationNotationResult:
    """Prepare TrackNote material for final region-event registration.

    This is the single cleanup gate for user-visible track registration. Audio
    and generated material is rewritten onto the studio's fixed BPM grid;
    symbolic document imports keep their timing unless extraction noise needs
    deterministic cleanup.
    """

    original_count = len(notes)
    actions: list[str] = []
    if not notes:
        return RegistrationNotationResult(
            notes=[],
            diagnostics=_registration_diagnostics(
                [],
                slot_id=slot_id,
                original_count=0,
                source_kind=source_kind,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                actions=["empty_input"],
            ),
        )

    if _requires_grid_rewrite(source_kind, notes):
        working_notes = notes
        if _requires_noise_filter(source_kind, notes):
            working_notes, filter_actions = _filter_voice_noise(notes)
            actions.extend(filter_actions)
        normalized_notes = normalize_track_notes(
            working_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=VOICE_QUANTIZATION_GRID_BEATS,
            merge_adjacent_same_pitch=True,
        )
        actions.append("fixed_bpm_grid_normalization")
        if _has_dense_voice_measures(
            normalized_notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            simplified_notes = _simplify_dense_voice_measures(
                normalized_notes,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            normalized_notes = normalize_track_notes(
                simplified_notes,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
                merge_adjacent_same_pitch=True,
            )
            actions.append("dense_voice_measure_simplification")
        normalized_notes, polish_actions = _polish_voice_notation(
            normalized_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=normalized_notes[0].quantization_grid or VOICE_QUANTIZATION_GRID_BEATS
            if normalized_notes
            else VOICE_QUANTIZATION_GRID_BEATS,
        )
        actions.extend(polish_actions)
        normalized_notes, optimizer_actions = _choose_readable_voice_candidate(
            working_notes,
            current_notes=normalized_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        actions.extend(optimizer_actions)
        prepared_notes = normalized_notes
    else:
        repaired_notes = _repair_symbolic_timing_metadata(
            notes,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        prepared_notes = annotate_track_notes_for_slot(repaired_notes, slot_id=slot_id)
        actions.append("symbolic_metadata_annotation")
        if _has_measure_crossing_notes(
            prepared_notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_notes = normalize_track_notes(
                prepared_notes,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=0.125,
                merge_adjacent_same_pitch=False,
            )
            actions.append("symbolic_measure_boundary_split")

    prepared_notes = _deduplicate_and_sort(prepared_notes)
    alignment = _align_to_reference_tracks(
        prepared_notes,
        reference_tracks or [],
        bpm=bpm,
        slot_id=slot_id,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if alignment["applied"]:
        prepared_notes = alignment["notes"]
        actions.append("reference_track_grid_alignment")
    prepared_notes, contract_actions, score_contract = _enforce_registration_score_contract(
        prepared_notes,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    actions.extend(contract_actions)
    diagnostics = _registration_diagnostics(
        prepared_notes,
        slot_id=slot_id,
        original_count=original_count,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        actions=actions,
    )
    if alignment["evaluated"]:
        diagnostics["reference_alignment"] = {
            key: value
            for key, value in alignment.items()
            if key != "notes"
        }
    diagnostics["score_contract"] = score_contract
    prepared_notes = _attach_quality_warnings(prepared_notes, diagnostics)
    return RegistrationNotationResult(notes=prepared_notes, diagnostics=diagnostics)


def apply_notation_review_instruction(
    notes: list[TrackNote],
    *,
    instruction: Mapping[str, Any],
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    baseline_result: RegistrationNotationResult | None = None,
    reference_tracks: list[list[TrackNote]] | None = None,
) -> RegistrationNotationResult:
    """Apply a bounded LLM registration cleanup plan through deterministic code.

    The LLM never writes TrackNotes. It can only request a small set of repairs
    such as coarser quantization, sustain merging, dense-measure simplification,
    voice-noise filtering, and key-spelling preference. This function validates
    those requests and re-runs the local registration engine against the studio's
    fixed BPM/meter.
    """

    baseline = baseline_result or prepare_notes_for_track_registration(
        notes,
        bpm=bpm,
        slot_id=slot_id,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        reference_tracks=reference_tracks,
    )
    instruction_data = _coerce_review_instruction(instruction)
    confidence = _instruction_confidence(instruction_data)

    if confidence < LLM_REVIEW_MIN_CONFIDENCE:
        return _with_llm_review_diagnostics(
            baseline,
            instruction_data,
            applied=False,
            reason="low_confidence",
        )
    if not _has_review_directive(instruction_data):
        return _with_llm_review_diagnostics(
            baseline,
            instruction_data,
            applied=False,
            reason="no_repair_directive",
        )

    if not notes:
        return _with_llm_review_diagnostics(
            baseline,
            instruction_data,
            applied=False,
            reason="empty_input",
        )

    actions = ["llm_notation_review_applied"]
    quantization_grid = _instruction_grid(instruction_data) or VOICE_QUANTIZATION_GRID_BEATS
    if _instruction_bool(instruction_data, "simplify_dense_measures"):
        quantization_grid = max(quantization_grid, VOICE_DENSITY_SIMPLIFICATION_GRID)
    merge_adjacent_same_pitch = _instruction_bool(
        instruction_data,
        "merge_adjacent_same_pitch",
        default=True,
    ) or _instruction_bool(instruction_data, "sustain_repeated_notes")
    preferred_key = _instruction_key_signature(instruction_data)

    if _requires_grid_rewrite(source_kind, notes):
        working_notes = notes
        if _instruction_bool(instruction_data, "suppress_unstable_notes") and _requires_noise_filter(source_kind, notes):
            working_notes, filter_actions = _filter_voice_noise(notes)
            actions.extend(f"llm_{action}" for action in filter_actions)

        prepared_notes = normalize_track_notes(
            working_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            merge_adjacent_same_pitch=merge_adjacent_same_pitch,
        )
        actions.append(f"llm_fixed_bpm_grid_{quantization_grid:g}")

        if _should_simplify_after_review(
            prepared_notes,
            instruction_data,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            simplified_notes = _simplify_dense_voice_measures(
                prepared_notes,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            prepared_notes = normalize_track_notes(
                simplified_notes,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
                merge_adjacent_same_pitch=True,
            )
            actions.append("llm_dense_voice_measure_simplification")
        prepared_notes, polish_actions = _polish_voice_notation(
            prepared_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            collapse_pitch_blips=_instruction_bool(instruction_data, "collapse_pitch_blips", default=True),
            remove_isolated_artifacts=_instruction_bool(
                instruction_data,
                "remove_isolated_artifacts",
                default=True,
            ),
            bridge_short_phrase_gaps=_instruction_bool(
                instruction_data,
                "bridge_short_phrase_gaps",
                default=True,
            ),
            bridge_measure_tail_gaps=_instruction_bool(
                instruction_data,
                "bridge_measure_tail_gaps",
                default=True,
            ),
            collapse_short_note_clusters=_instruction_bool(
                instruction_data,
                "collapse_short_note_clusters",
                default=True,
            ),
            sustain_repetitions=merge_adjacent_same_pitch,
        )
        actions.extend(f"llm_{action}" for action in polish_actions)
        prepared_notes, optimizer_actions = _choose_readable_voice_candidate(
            working_notes,
            current_notes=prepared_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        actions.extend(f"llm_{action}" for action in optimizer_actions)
    else:
        repaired_notes = _repair_symbolic_timing_metadata(
            notes,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        prepared_notes = annotate_track_notes_for_slot(repaired_notes, slot_id=slot_id)
        actions.append("llm_symbolic_review_annotation")
        if _instruction_bool(instruction_data, "simplify_dense_measures") and _has_dense_voice_measures(
            prepared_notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_notes = normalize_track_notes(
                prepared_notes,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=quantization_grid,
                merge_adjacent_same_pitch=merge_adjacent_same_pitch,
            )
            actions.append("llm_symbolic_dense_measure_rewrite")
        elif _has_measure_crossing_notes(
            prepared_notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_notes = normalize_track_notes(
                prepared_notes,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=0.125,
                merge_adjacent_same_pitch=False,
            )
            actions.append("llm_symbolic_measure_boundary_split")

    if preferred_key is not None:
        prepared_notes = _force_key_signature(prepared_notes, slot_id=slot_id, key_signature=preferred_key)
        actions.append(f"llm_prefer_key_{preferred_key}")

    prepared_notes = _deduplicate_and_sort(prepared_notes)
    alignment = _align_to_reference_tracks(
        prepared_notes,
        reference_tracks or [],
        bpm=bpm,
        slot_id=slot_id,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if alignment["applied"]:
        prepared_notes = alignment["notes"]
        actions.append("llm_reference_track_grid_alignment")
    prepared_notes, contract_actions, score_contract = _enforce_registration_score_contract(
        prepared_notes,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    actions.extend(f"llm_{action}" for action in contract_actions)
    diagnostics = _registration_diagnostics(
        prepared_notes,
        slot_id=slot_id,
        original_count=len(notes),
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        actions=actions,
    )
    diagnostics["llm_notation_review"] = {
        "applied": True,
        "confidence": confidence,
        "instruction": _public_review_instruction(instruction_data),
    }
    if alignment["evaluated"]:
        diagnostics["reference_alignment"] = {
            key: value
            for key, value in alignment.items()
            if key != "notes"
        }
    diagnostics["score_contract"] = score_contract
    diagnostics["pre_llm_registration_quality"] = baseline.diagnostics
    prepared_notes = _attach_quality_warnings(prepared_notes, diagnostics)
    return RegistrationNotationResult(notes=prepared_notes, diagnostics=diagnostics)


def _requires_grid_rewrite(source_kind: SourceKind, notes: list[TrackNote]) -> bool:
    if source_kind in VOICE_LIKE_SOURCE_KINDS or source_kind in NOTE_GENERATION_SOURCE_KINDS:
        return True
    return any(note.source in VOICE_LIKE_NOTE_SOURCES or note.source == "ai" for note in notes)


def _requires_noise_filter(source_kind: SourceKind, notes: list[TrackNote]) -> bool:
    if source_kind in NOTE_GENERATION_SOURCE_KINDS:
        return False
    return source_kind in VOICE_LIKE_SOURCE_KINDS or any(note.source in VOICE_LIKE_NOTE_SOURCES for note in notes)


def _filter_voice_noise(notes: list[TrackNote]) -> tuple[list[TrackNote], list[str]]:
    pitched_notes = [note for note in notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
    if not pitched_notes:
        return notes, []

    keep_threshold = MIN_VOICE_CONFIDENCE
    strong_notes = [note for note in pitched_notes if note.confidence >= 0.48]
    if len(strong_notes) < 2:
        keep_threshold = min(0.22, min(note.confidence for note in pitched_notes))

    filtered: list[TrackNote] = []
    removed_count = 0
    for note in notes:
        if note.is_rest:
            if note.duration_beats >= MIN_NOTATED_DURATION_BEATS:
                filtered.append(note)
            else:
                removed_count += 1
            continue
        if _resolve_pitch_midi(note) is None:
            removed_count += 1
            continue
        if note.duration_beats < MIN_VOICE_DURATION_BEATS:
            removed_count += 1
            continue
        if note.confidence < keep_threshold:
            removed_count += 1
            continue
        filtered.append(note)

    if not filtered:
        filtered = [max(pitched_notes, key=lambda note: (note.confidence, note.duration_beats))]
        removed_count = max(0, len(notes) - 1)

    actions = [f"voice_noise_filter_removed_{removed_count}"] if removed_count else []
    return filtered, actions


def _has_dense_voice_measures(
    notes: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    for measure_notes in _notes_by_measure(notes).values():
        pitched_count = sum(1 for note in measure_notes if not note.is_rest)
        if pitched_count > max_events:
            return True
    return False


def _simplify_dense_voice_measures(
    notes: list[TrackNote],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackNote]:
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    simplified: list[TrackNote] = []
    for measure_index, measure_notes in sorted(_notes_by_measure(notes).items()):
        pitched_notes = [note for note in measure_notes if not note.is_rest]
        if len(pitched_notes) <= max_events:
            simplified.extend(measure_notes)
            continue

        cells: dict[int, TrackNote] = {}
        measure_start = _measure_start_beat(
            measure_index,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        for note in pitched_notes:
            cell_index = max(0, floor((note.beat - measure_start) / VOICE_DENSITY_SIMPLIFICATION_GRID))
            current = cells.get(cell_index)
            if current is None or _note_weight(note) > _note_weight(current):
                cell_start = measure_start + cell_index * VOICE_DENSITY_SIMPLIFICATION_GRID
                cells[cell_index] = note.model_copy(
                    update={
                        "beat": round(cell_start, 4),
                        "duration_beats": VOICE_DENSITY_SIMPLIFICATION_GRID,
                        "onset_seconds": round(max(0, (cell_start - 1) * seconds_per_beat(bpm)), 4),
                        "duration_seconds": round(VOICE_DENSITY_SIMPLIFICATION_GRID * seconds_per_beat(bpm), 4),
                        "notation_warnings": _append_warning(note.notation_warnings, "dense_measure_simplified"),
                    }
                )
        simplified.extend(cells[index] for index in sorted(cells))
    return simplified


def _polish_voice_notation(
    notes: list[TrackNote],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    quantization_grid: float,
    collapse_pitch_blips: bool = True,
    remove_isolated_artifacts: bool = True,
    bridge_short_phrase_gaps: bool = True,
    bridge_measure_tail_gaps: bool = True,
    collapse_short_note_clusters: bool = True,
    sustain_repetitions: bool = True,
) -> tuple[list[TrackNote], list[str]]:
    """Make voice-like TrackNotes behave like sung pitch events, not frame artifacts."""

    if len(notes) < 2:
        return notes, []

    polished_notes = notes
    actions: list[str] = []
    if remove_isolated_artifacts:
        polished_notes, removed_count = _remove_isolated_short_artifacts(polished_notes)
        if removed_count:
            actions.append(f"voice_isolated_artifact_removed_{removed_count}")
    if collapse_pitch_blips:
        polished_notes, collapsed_count = _collapse_neighbor_pitch_blips(polished_notes, bpm=bpm)
        if collapsed_count:
            actions.append(f"voice_pitch_blip_collapse_{collapsed_count}")
    if collapse_short_note_clusters:
        polished_notes, cluster_count = _collapse_short_note_clusters(
            polished_notes,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if cluster_count:
            actions.append(f"voice_short_cluster_collapse_{cluster_count}")
    if bridge_measure_tail_gaps:
        polished_notes, tail_count = _bridge_measure_tail_gaps(
            polished_notes,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if tail_count:
            actions.append(f"voice_measure_tail_bridge_{tail_count}")
    if bridge_short_phrase_gaps:
        polished_notes, bridged_count = _bridge_short_voice_phrase_gaps(polished_notes, bpm=bpm)
        if bridged_count:
            actions.append(f"voice_phrase_gap_bridge_{bridged_count}")
    if sustain_repetitions:
        polished_notes, merged_count = _merge_voice_sustain_repetitions(polished_notes, bpm=bpm)
        if merged_count:
            actions.append(f"voice_sustain_merge_{merged_count}")

    if not actions:
        return notes, []

    normalized = normalize_track_notes(
        polished_notes,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=quantization_grid,
        merge_adjacent_same_pitch=True,
    )
    return normalized, actions


def count_isolated_short_voice_artifacts(notes: list[TrackNote]) -> int:
    """Count short, low-confidence notes that are isolated from nearby singing."""

    return len(_isolated_short_artifact_indices(_deduplicate_and_sort(notes)))


def count_short_voice_phrase_gaps(notes: list[TrackNote]) -> int:
    """Count tiny detector dropouts between confident adjacent sung notes."""

    return len(_short_voice_phrase_gap_targets(_deduplicate_and_sort(notes)))


def count_measure_tail_gaps(
    notes: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> int:
    """Count tiny missing tails before barlines in otherwise connected singing."""

    return len(
        _measure_tail_gap_targets(
            _deduplicate_and_sort(notes),
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )


def count_short_note_clusters(
    notes: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> int:
    """Count low-confidence short-note clusters that read like tracker chatter."""

    ordered_notes = _deduplicate_and_sort(notes)
    cluster_count = 0
    index = 0
    while index < len(ordered_notes):
        cluster_indices = _short_note_cluster_at(
            ordered_notes,
            start_index=index,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if cluster_indices:
            cluster_count += 1
            index = cluster_indices[-1] + 1
            continue
        index += 1
    return cluster_count


def _remove_isolated_short_artifacts(notes: list[TrackNote]) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    remove_indices = _isolated_short_artifact_indices(ordered_notes)
    if not remove_indices:
        return ordered_notes, 0

    pitched_indices = [
        index
        for index, note in enumerate(ordered_notes)
        if not note.is_rest and _resolve_pitch_midi(note) is not None
    ]
    if len(pitched_indices) - len(remove_indices) <= 0:
        return ordered_notes, 0

    filtered_notes = [note for index, note in enumerate(ordered_notes) if index not in remove_indices]
    return filtered_notes, len(remove_indices)


def _isolated_short_artifact_indices(ordered_notes: list[TrackNote]) -> set[int]:
    pitched_indices = [
        index
        for index, note in enumerate(ordered_notes)
        if not note.is_rest and _resolve_pitch_midi(note) is not None
    ]
    if len(pitched_indices) <= 1:
        return set()

    artifact_indices: set[int] = set()
    for position, note_index in enumerate(pitched_indices):
        note = ordered_notes[note_index]
        if note.duration_beats > VOICE_ISOLATED_ARTIFACT_MAX_DURATION_BEATS:
            continue
        if note.confidence > VOICE_ISOLATED_ARTIFACT_MAX_CONFIDENCE:
            continue

        previous_note = ordered_notes[pitched_indices[position - 1]] if position > 0 else None
        next_note = ordered_notes[pitched_indices[position + 1]] if position < len(pitched_indices) - 1 else None
        left_gap = _gap_between(previous_note, note) if previous_note is not None else VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        right_gap = _gap_between(note, next_note) if next_note is not None else VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        if (
            left_gap >= VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
            and right_gap >= VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        ):
            artifact_indices.add(note_index)

    return artifact_indices


def _bridge_short_voice_phrase_gaps(notes: list[TrackNote], *, bpm: int) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    bridge_targets = _short_voice_phrase_gap_targets(ordered_notes)
    if not bridge_targets:
        return ordered_notes, 0

    bridged_notes: list[TrackNote] = []
    for index, note in enumerate(ordered_notes):
        next_note = bridge_targets.get(index)
        if next_note is None:
            bridged_notes.append(note)
            continue
        bridged_notes.append(
            _extend_note_to_beat(
                note,
                end_beat=next_note.beat,
                bpm=bpm,
                warning="voice_phrase_gap_bridged",
            )
        )
    return bridged_notes, len(bridge_targets)


def _short_voice_phrase_gap_targets(ordered_notes: list[TrackNote]) -> dict[int, TrackNote]:
    pitched_indices = [
        index
        for index, note in enumerate(ordered_notes)
        if not note.is_rest and _resolve_pitch_midi(note) is not None
    ]
    if len(pitched_indices) < 2:
        return {}

    bridge_targets: dict[int, TrackNote] = {}
    for left_index, right_index in zip(pitched_indices, pitched_indices[1:], strict=False):
        left_note = ordered_notes[left_index]
        right_note = ordered_notes[right_index]
        gap = _gap_between(left_note, right_note)
        if gap <= 0 or gap > VOICE_PHRASE_GAP_MAX_BEATS:
            continue
        if left_note.confidence < VOICE_PHRASE_GAP_MIN_CONFIDENCE:
            continue
        if right_note.confidence < VOICE_PHRASE_GAP_MIN_CONFIDENCE:
            continue
        if left_note.duration_beats < MIN_NOTATED_DURATION_BEATS or right_note.duration_beats < MIN_NOTATED_DURATION_BEATS:
            continue
        left_pitch = _resolve_pitch_midi(left_note)
        right_pitch = _resolve_pitch_midi(right_note)
        if left_pitch is None or right_pitch is None:
            continue
        if left_pitch == right_pitch:
            continue
        if abs(left_pitch - right_pitch) > VOICE_PHRASE_GAP_MAX_INTERVAL:
            continue
        if any(note.is_rest for note in ordered_notes[left_index + 1 : right_index]):
            continue
        bridge_targets[left_index] = right_note
    return bridge_targets


def _bridge_measure_tail_gaps(
    notes: list[TrackNote],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    bridge_targets = _measure_tail_gap_targets(
        ordered_notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if not bridge_targets:
        return ordered_notes, 0

    bridged_notes: list[TrackNote] = []
    for index, note in enumerate(ordered_notes):
        measure_end = bridge_targets.get(index)
        if measure_end is None:
            bridged_notes.append(note)
            continue
        bridged_notes.append(
            _extend_note_to_beat(
                note,
                end_beat=measure_end,
                bpm=bpm,
                warning="voice_measure_tail_bridged",
            )
        )
    return bridged_notes, len(bridge_targets)


def _measure_tail_gap_targets(
    ordered_notes: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[int, float]:
    pitched_indices = [
        index
        for index, note in enumerate(ordered_notes)
        if not note.is_rest and _resolve_pitch_midi(note) is not None
    ]
    if len(pitched_indices) < 2:
        return {}

    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    bridge_targets: dict[int, float] = {}
    for position, note_index in enumerate(pitched_indices[:-1]):
        note = ordered_notes[note_index]
        if note.confidence < VOICE_MEASURE_TAIL_MIN_CONFIDENCE:
            continue
        if note.duration_beats < VOICE_MEASURE_TAIL_MIN_DURATION_BEATS:
            continue

        note_end = note.beat + note.duration_beats
        measure_index = measure_index_from_beat(
            note.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        measure_end = 1 + measure_index * beats_per_measure
        tail_gap = round(measure_end - note_end, 4)
        if tail_gap <= 0 or tail_gap > VOICE_MEASURE_TAIL_GAP_MAX_BEATS:
            continue

        next_note = ordered_notes[pitched_indices[position + 1]]
        if next_note.beat < measure_end - 0.001:
            continue
        if next_note.beat - measure_end > VOICE_MEASURE_TAIL_FOLLOWUP_MAX_BEATS:
            continue
        if any(
            candidate.is_rest and candidate.beat < measure_end
            for candidate in ordered_notes[note_index + 1 : pitched_indices[position + 1]]
        ):
            continue
        bridge_targets[note_index] = measure_end
    return bridge_targets


def _collapse_short_note_clusters(
    notes: list[TrackNote],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    collapsed_notes: list[TrackNote] = []
    collapse_count = 0
    index = 0
    while index < len(ordered_notes):
        cluster_indices = _short_note_cluster_at(
            ordered_notes,
            start_index=index,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if not cluster_indices:
            collapsed_notes.append(ordered_notes[index])
            index += 1
            continue

        cluster_notes = [ordered_notes[cluster_index] for cluster_index in cluster_indices]
        representative = max(cluster_notes, key=_note_weight)
        representative_pitch = _resolve_pitch_midi(representative)
        if representative_pitch is None:
            collapsed_notes.extend(cluster_notes)
            index = cluster_indices[-1] + 1
            continue

        collapsed_notes.append(
            _merge_note_span(
                cluster_notes[0],
                cluster_notes[-1],
                bpm=bpm,
                pitch_midi=representative_pitch,
                warning="voice_short_cluster_collapsed",
                confidence=max(note.confidence for note in cluster_notes),
            )
        )
        collapse_count += 1
        index = cluster_indices[-1] + 1
    return collapsed_notes, collapse_count


def _short_note_cluster_at(
    ordered_notes: list[TrackNote],
    *,
    start_index: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[int]:
    if start_index >= len(ordered_notes):
        return []

    first_note = ordered_notes[start_index]
    first_pitch = _resolve_pitch_midi(first_note)
    if first_note.is_rest or first_pitch is None:
        return []
    if first_note.duration_beats > VOICE_SHORT_CLUSTER_MAX_DURATION_BEATS:
        return []

    measure_index = measure_index_from_beat(
        first_note.beat,
        time_signature_numerator,
        time_signature_denominator,
    )
    cluster_indices = [start_index]
    previous_note = first_note
    for candidate_index in range(start_index + 1, len(ordered_notes)):
        candidate = ordered_notes[candidate_index]
        candidate_pitch = _resolve_pitch_midi(candidate)
        if candidate.is_rest or candidate_pitch is None:
            break
        if candidate.duration_beats > VOICE_SHORT_CLUSTER_MAX_DURATION_BEATS:
            break
        candidate_measure = measure_index_from_beat(
            candidate.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        if candidate_measure != measure_index:
            break
        gap = _gap_between(previous_note, candidate)
        if gap < -0.001 or gap > VOICE_SHORT_CLUSTER_MAX_GAP_BEATS:
            break
        cluster_span = candidate.beat + candidate.duration_beats - first_note.beat
        if cluster_span > VOICE_SHORT_CLUSTER_MAX_SPAN_BEATS + 0.001:
            break
        cluster_indices.append(candidate_index)
        previous_note = candidate

    if len(cluster_indices) < VOICE_SHORT_CLUSTER_MIN_NOTES:
        return []

    cluster_notes = [ordered_notes[index] for index in cluster_indices]
    average_confidence = sum(note.confidence for note in cluster_notes) / len(cluster_notes)
    pitches = [_resolve_pitch_midi(note) for note in cluster_notes]
    resolved_pitches = [pitch for pitch in pitches if pitch is not None]
    pitch_span = max(resolved_pitches) - min(resolved_pitches) if resolved_pitches else 999
    if average_confidence > VOICE_SHORT_CLUSTER_MAX_AVERAGE_CONFIDENCE:
        return []
    if pitch_span > VOICE_SHORT_CLUSTER_MAX_PITCH_SPAN:
        return []
    return cluster_indices


def _collapse_neighbor_pitch_blips(notes: list[TrackNote], *, bpm: int) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    collapsed: list[TrackNote] = []
    collapse_count = 0
    index = 0
    while index < len(ordered_notes):
        if index <= len(ordered_notes) - 3:
            previous_note = ordered_notes[index]
            current_note = ordered_notes[index + 1]
            next_note = ordered_notes[index + 2]
            previous_pitch = _resolve_pitch_midi(previous_note)
            current_pitch = _resolve_pitch_midi(current_note)
            next_pitch = _resolve_pitch_midi(next_note)
            if (
                previous_pitch is not None
                and current_pitch is not None
                and next_pitch is not None
                and previous_pitch == next_pitch
                and current_pitch != previous_pitch
                and abs(current_pitch - previous_pitch) <= VOICE_NEIGHBOR_BLIP_MAX_INTERVAL
                and current_note.duration_beats <= VOICE_NEIGHBOR_BLIP_MAX_DURATION_BEATS
                and current_note.confidence <= max(previous_note.confidence, next_note.confidence) + 0.04
                and _gap_between(previous_note, current_note) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
                and _gap_between(current_note, next_note) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
            ):
                merged_note = _merge_note_span(
                    previous_note,
                    next_note,
                    bpm=bpm,
                    pitch_midi=previous_pitch,
                    warning="voice_pitch_blip_collapsed",
                    confidence=max(previous_note.confidence, next_note.confidence, current_note.confidence * 0.94),
                )
                collapsed.append(merged_note)
                collapse_count += 1
                index += 3
                continue
        collapsed.append(ordered_notes[index])
        index += 1
    return collapsed, collapse_count


def _merge_voice_sustain_repetitions(notes: list[TrackNote], *, bpm: int) -> tuple[list[TrackNote], int]:
    ordered_notes = _deduplicate_and_sort(notes)
    if len(ordered_notes) < 2:
        return ordered_notes, 0

    merged: list[TrackNote] = []
    merge_count = 0
    current = ordered_notes[0]
    for next_note in ordered_notes[1:]:
        current_pitch = _resolve_pitch_midi(current)
        next_pitch = _resolve_pitch_midi(next_note)
        if (
            current_pitch is not None
            and next_pitch == current_pitch
            and not current.is_rest
            and not next_note.is_rest
            and _gap_between(current, next_note) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
        ):
            current = _merge_note_span(
                current,
                next_note,
                bpm=bpm,
                pitch_midi=current_pitch,
                warning="voice_sustain_merged",
                confidence=max(current.confidence, next_note.confidence),
            )
            merge_count += 1
            continue
        merged.append(current)
        current = next_note
    merged.append(current)
    return merged, merge_count


def _choose_readable_voice_candidate(
    source_notes: list[TrackNote],
    *,
    current_notes: list[TrackNote],
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackNote], list[str]]:
    if not current_notes:
        return current_notes, []

    coarse_notes = normalize_track_notes(
        source_notes,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
        merge_adjacent_same_pitch=True,
    )
    coarse_notes, polish_actions = _polish_voice_notation(
        coarse_notes,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
    )

    current_score = _voice_readability_score(
        current_notes,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    coarse_score = _voice_readability_score(
        coarse_notes,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )

    if coarse_score + 0.75 < current_score:
        return coarse_notes, ["readability_grid_0.5", *polish_actions]
    return current_notes, []


def _voice_readability_score(
    notes: list[TrackNote],
    *,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    if not notes:
        return 999.0

    pitched_notes = [note for note in notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
    if not pitched_notes:
        return 999.0
    measure_groups = _notes_by_measure(pitched_notes)
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    max_notes_per_measure = max((len(group) for group in measure_groups.values()), default=0)
    short_ratio = sum(1 for note in pitched_notes if note.duration_beats <= 0.25) / len(pitched_notes)
    isolated_artifact_ratio = count_isolated_short_voice_artifacts(pitched_notes) / len(pitched_notes)
    short_gap_ratio = count_short_voice_phrase_gaps(pitched_notes) / len(pitched_notes)
    measure_tail_ratio = count_measure_tail_gaps(
        pitched_notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ) / len(pitched_notes)
    short_cluster_ratio = count_short_note_clusters(
        pitched_notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ) / len(pitched_notes)
    tie_ratio = sum(1 for note in pitched_notes if note.is_tied) / len(pitched_notes)
    accidental_ratio = sum(1 for note in pitched_notes if note.accidental) / len(pitched_notes)
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    out_of_range_ratio = sum(
        1 for note in pitched_notes if not low <= (_resolve_pitch_midi(note) or 0) <= high
    ) / len(pitched_notes)
    density_penalty = max(0, max_notes_per_measure - max_events) * 1.25
    return (
        density_penalty
        + max_notes_per_measure * 0.35
        + short_ratio * 4.0
        + isolated_artifact_ratio * 3.5
        + short_gap_ratio * 2.5
        + measure_tail_ratio * 2.0
        + short_cluster_ratio * 3.0
        + tie_ratio * 0.8
        + accidental_ratio * 0.7
        + out_of_range_ratio * 5.0
    )


def _gap_between(left: TrackNote, right: TrackNote) -> float:
    return round(right.beat - (left.beat + left.duration_beats), 4)


def _merge_note_span(
    first_note: TrackNote,
    last_note: TrackNote,
    *,
    bpm: int,
    pitch_midi: int,
    warning: str,
    confidence: float,
) -> TrackNote:
    start_beat = first_note.beat
    end_beat = max(start_beat + MIN_NOTATED_DURATION_BEATS, last_note.beat + last_note.duration_beats)
    duration_beats = round(end_beat - start_beat, 4)
    return first_note.model_copy(
        update={
            "pitch_midi": pitch_midi,
            "label": midi_to_label(pitch_midi),
            "spelled_label": None,
            "accidental": None,
            "beat": round(start_beat, 4),
            "duration_beats": duration_beats,
            "onset_seconds": round(max(0, (start_beat - 1) * seconds_per_beat(bpm)), 4),
            "duration_seconds": round(duration_beats * seconds_per_beat(bpm), 4),
            "confidence": round(min(1.0, max(0.0, confidence)), 4),
            "is_tied": first_note.is_tied or last_note.is_tied,
            "notation_warnings": _append_warning(first_note.notation_warnings, warning),
        }
    )


def _extend_note_to_beat(note: TrackNote, *, end_beat: float, bpm: int, warning: str) -> TrackNote:
    duration_beats = round(max(note.duration_beats, end_beat - note.beat), 4)
    return note.model_copy(
        update={
            "duration_beats": duration_beats,
            "duration_seconds": round(duration_beats * seconds_per_beat(bpm), 4),
            "notation_warnings": _append_warning(note.notation_warnings, warning),
        }
    )


def _repair_symbolic_timing_metadata(
    notes: list[TrackNote],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackNote]:
    beat_seconds = seconds_per_beat(max(1, bpm))
    repaired: list[TrackNote] = []
    for note in notes:
        beat = max(1.0, round(note.beat, 4))
        duration_beats = max(0.0625, round(note.duration_beats, 4))
        pitch_midi = note.pitch_midi
        if pitch_midi is None and not note.is_rest:
            pitch_midi = label_to_midi(note.label)
        repaired.append(
            note.model_copy(
                update={
                    "pitch_midi": pitch_midi,
                    "beat": beat,
                    "duration_beats": duration_beats,
                    "onset_seconds": round(max(0, (beat - 1) * beat_seconds), 4),
                    "duration_seconds": round(duration_beats * beat_seconds, 4),
                    "measure_index": measure_index_from_beat(
                        beat,
                        time_signature_numerator,
                        time_signature_denominator,
                    ),
                    "beat_in_measure": round(
                        beat_in_measure_from_beat(
                            beat,
                            time_signature_numerator,
                            time_signature_denominator,
                        ),
                        4,
                    ),
                }
            )
        )
    return repaired


def _enforce_registration_score_contract(
    notes: list[TrackNote],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackNote], list[str], dict[str, Any]]:
    """Force final TrackNotes onto the studio region-event clock.

    Earlier stages may transcribe, import, simplify, align, or review notes.
    Registration must end with one canonical score contract: the studio BPM and
    meter define seconds, measures, track voice identity, clef, and key spelling.
    """

    if not notes:
        return [], [], _score_contract_diagnostics(
            [],
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )

    contract_notes = notes
    actions: list[str] = []
    if _has_measure_crossing_notes(
        contract_notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        quantization_grid = min(
            (
                note.quantization_grid
                for note in contract_notes
                if note.quantization_grid is not None and note.quantization_grid > 0
            ),
            default=VOICE_QUANTIZATION_GRID_BEATS,
        )
        contract_notes = normalize_track_notes(
            contract_notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            merge_adjacent_same_pitch=False,
        )
        actions.append("score_contract_measure_split")

    shared_key_signature = _shared_key_signature(contract_notes)
    annotated_notes = annotate_track_notes_for_slot(
        contract_notes,
        slot_id=slot_id,
        key_signature=shared_key_signature,
    )
    clef = clef_for_slot(slot_id)
    display_octave_shift = display_octave_shift_for_slot(slot_id)
    key_signature = shared_key_signature or _shared_key_signature(annotated_notes) or "C"
    spelling_mode = "flat" if KEY_FIFTHS.get(key_signature, 0) < 0 else "sharp"
    beat_seconds = seconds_per_beat(max(1, bpm))

    enforced: list[TrackNote] = []
    changed_count = 0
    for note in annotated_notes:
        beat = max(1.0, round(note.beat, 4))
        duration_beats = max(0.0625, round(note.duration_beats, 4))
        pitch_midi = _resolve_pitch_midi(note)
        spelled_label = note.spelled_label
        accidental = note.accidental
        label = note.label
        if not note.is_rest and pitch_midi is not None:
            spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
            accidental = accidental_for_key(spelled_label, key_signature)
            label = spelled_label

        update = {
            "pitch_midi": pitch_midi,
            "pitch_hz": midi_to_frequency(pitch_midi) if pitch_midi is not None else None,
            "label": label,
            "spelled_label": spelled_label,
            "accidental": accidental,
            "clef": clef,
            "key_signature": key_signature,
            "display_octave_shift": display_octave_shift,
            "onset_seconds": round(max(0, (beat - 1) * beat_seconds), 4),
            "duration_seconds": round(duration_beats * beat_seconds, 4),
            "beat": beat,
            "duration_beats": duration_beats,
            "measure_index": measure_index_from_beat(
                beat,
                time_signature_numerator,
                time_signature_denominator,
            ),
            "beat_in_measure": round(
                beat_in_measure_from_beat(
                    beat,
                    time_signature_numerator,
                    time_signature_denominator,
                ),
                4,
            ),
            "voice_index": slot_id,
        }
        if any(getattr(note, key) != value for key, value in update.items()):
            changed_count += 1
        enforced.append(note.model_copy(update=update))

    if changed_count:
        actions.append(f"score_contract_enforced_{changed_count}")
    return enforced, actions, _score_contract_diagnostics(
        enforced,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _shared_key_signature(notes: list[TrackNote]) -> str | None:
    key_counts = Counter(note.key_signature for note in notes if note.key_signature in KEY_FIFTHS)
    if not key_counts:
        return None
    return key_counts.most_common(1)[0][0]


def _score_contract_diagnostics(
    notes: list[TrackNote],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    if not notes:
        return {
            "version": "score_contract_v1",
            "note_count": 0,
            "single_voice_index": True,
            "single_key_signature": True,
            "seconds_follow_beat_grid": True,
            "measure_metadata_consistent": True,
            "clef_policy_consistent": True,
        }

    voice_indices = {note.voice_index for note in notes}
    key_signatures = {note.key_signature for note in notes}
    clefs = {note.clef for note in notes}
    beat_seconds = seconds_per_beat(max(1, bpm))
    expected_clef = clef_for_slot(slot_id)
    seconds_follow_beat_grid = all(
        abs(note.onset_seconds - round(max(0, (note.beat - 1) * beat_seconds), 4)) <= 0.0001
        and abs(note.duration_seconds - round(note.duration_beats * beat_seconds, 4)) <= 0.0001
        for note in notes
    )
    measure_metadata_consistent = all(
        note.measure_index == measure_index_from_beat(
            note.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        and abs(
            (note.beat_in_measure or 0)
            - round(
                beat_in_measure_from_beat(
                    note.beat,
                    time_signature_numerator,
                    time_signature_denominator,
                ),
                4,
            )
        )
        <= 0.0001
        for note in notes
    )
    return {
        "version": "score_contract_v1",
        "note_count": len(notes),
        "single_voice_index": len(voice_indices) == 1 and slot_id in voice_indices,
        "single_key_signature": len(key_signatures) == 1 and None not in key_signatures,
        "seconds_follow_beat_grid": seconds_follow_beat_grid,
        "measure_metadata_consistent": measure_metadata_consistent,
        "clef_policy_consistent": clefs == {expected_clef},
        "voice_index": next(iter(voice_indices)) if len(voice_indices) == 1 else None,
        "key_signature": next(iter(key_signatures)) if len(key_signatures) == 1 else None,
        "clef": next(iter(clefs)) if len(clefs) == 1 else None,
    }


def _align_to_reference_tracks(
    notes: list[TrackNote],
    reference_tracks: list[list[TrackNote]],
    *,
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    base_result: dict[str, Any] = {
        "notes": notes,
        "evaluated": False,
        "applied": False,
        "offset_beats": 0.0,
        "zero_score": None,
        "best_score": None,
        "matched_note_count": 0,
        "reference_note_count": 0,
        "candidate_note_count": len([note for note in notes if not note.is_rest]),
        "reason": "not_evaluated",
    }
    if not _is_reference_alignable(source_kind, notes):
        return {**base_result, "reason": "source_not_reference_alignable"}

    reference_notes = [
        note
        for track_notes in reference_tracks
        for note in track_notes
        if not note.is_rest
    ]
    candidate_notes = [note for note in notes if not note.is_rest]
    base_result["reference_note_count"] = len(reference_notes)
    if len(candidate_notes) < REFERENCE_ALIGNMENT_MIN_NOTES:
        return {**base_result, "reason": "too_few_candidate_notes"}
    if len(reference_notes) < REFERENCE_ALIGNMENT_MIN_NOTES:
        return {**base_result, "reason": "too_few_reference_notes"}

    reference_beats = sorted({round(note.beat, 4) for note in reference_notes})
    candidate_beats = [round(note.beat, 4) for note in candidate_notes]
    if not reference_beats or not candidate_beats:
        return {**base_result, "reason": "missing_reference_grid"}

    offsets = _reference_alignment_offsets()
    zero_score, zero_matches = _reference_alignment_score(
        candidate_beats,
        reference_beats,
        offset_beats=0.0,
    )
    scored_offsets = [
        (
            *_reference_alignment_score(candidate_beats, reference_beats, offset_beats=offset),
            offset,
        )
        for offset in offsets
    ]
    scored_offsets.sort(key=lambda item: (item[0], abs(item[2])))
    best_score, best_matches, best_offset = scored_offsets[0]
    match_ratio = best_matches / max(1, len(candidate_beats))
    improvement = zero_score - best_score

    evaluation = {
        **base_result,
        "evaluated": True,
        "offset_beats": round(best_offset, 4),
        "zero_score": round(zero_score, 4),
        "best_score": round(best_score, 4),
        "matched_note_count": best_matches,
        "match_ratio": round(match_ratio, 4),
        "improvement": round(improvement, 4),
        "reason": "best_offset_is_zero",
    }
    if abs(best_offset) < 0.0001:
        return evaluation
    if match_ratio < REFERENCE_ALIGNMENT_MIN_MATCH_RATIO:
        return {**evaluation, "offset_beats": 0.0, "reason": "insufficient_reference_matches"}
    if improvement < REFERENCE_ALIGNMENT_MIN_IMPROVEMENT:
        return {**evaluation, "offset_beats": 0.0, "reason": "insufficient_improvement"}
    if min(candidate_beats) + best_offset < 1.0:
        return {**evaluation, "offset_beats": 0.0, "reason": "would_shift_before_score_start"}

    shifted_notes = _shift_notes_to_reference_grid(
        notes,
        offset_beats=best_offset,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return {
        **evaluation,
        "notes": shifted_notes,
        "applied": True,
        "reason": "applied_reference_grid_alignment",
    }


def _is_reference_alignable(source_kind: SourceKind, notes: list[TrackNote]) -> bool:
    if source_kind in VOICE_LIKE_SOURCE_KINDS:
        return True
    return any(note.source in {"voice", "recording", "audio", "omr"} for note in notes)


def _reference_alignment_offsets() -> list[float]:
    offsets: list[float] = []
    step_count = int(REFERENCE_ALIGNMENT_MAX_OFFSET_BEATS / REFERENCE_ALIGNMENT_GRID_BEATS)
    for index in range(-step_count, step_count + 1):
        offsets.append(round(index * REFERENCE_ALIGNMENT_GRID_BEATS, 4))
    return offsets


def _reference_alignment_score(
    candidate_beats: list[float],
    reference_beats: list[float],
    *,
    offset_beats: float,
) -> tuple[float, int]:
    distances: list[float] = []
    matches = 0
    for beat in candidate_beats:
        shifted_beat = beat + offset_beats
        if shifted_beat < 1:
            distances.append(REFERENCE_ALIGNMENT_MAX_DISTANCE_BEATS * 2)
            continue
        nearest_distance = min(abs(shifted_beat - reference_beat) for reference_beat in reference_beats)
        clipped_distance = min(REFERENCE_ALIGNMENT_MAX_DISTANCE_BEATS, nearest_distance)
        distances.append(clipped_distance)
        if nearest_distance <= REFERENCE_ALIGNMENT_GRID_BEATS / 2:
            matches += 1
    mean_distance = sum(distances) / max(1, len(distances))
    offset_penalty = abs(offset_beats) * 0.04
    return mean_distance + offset_penalty, matches


def _shift_notes_to_reference_grid(
    notes: list[TrackNote],
    *,
    offset_beats: float,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackNote]:
    beat_seconds = seconds_per_beat(max(1, bpm))
    shifted: list[TrackNote] = []
    for note in notes:
        beat = round(max(1.0, note.beat + offset_beats), 4)
        shifted.append(
            note.model_copy(
                update={
                    "beat": beat,
                    "onset_seconds": round(max(0, (beat - 1) * beat_seconds), 4),
                    "duration_seconds": round(note.duration_beats * beat_seconds, 4),
                    "measure_index": measure_index_from_beat(
                        beat,
                        time_signature_numerator,
                        time_signature_denominator,
                    ),
                    "beat_in_measure": round(
                        beat_in_measure_from_beat(
                            beat,
                            time_signature_numerator,
                            time_signature_denominator,
                        ),
                        4,
                    ),
                    "notation_warnings": _append_warning(
                        note.notation_warnings,
                        "reference_grid_aligned",
                    ),
                }
            )
        )
    if _has_measure_crossing_notes(
        shifted,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        quantization_grid = min(
            (
                note.quantization_grid
                for note in shifted
                if note.quantization_grid is not None and note.quantization_grid > 0
            ),
            default=REFERENCE_ALIGNMENT_GRID_BEATS,
        )
        shifted = normalize_track_notes(
            shifted,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            merge_adjacent_same_pitch=False,
        )
        shifted = [
            note.model_copy(
                update={
                    "notation_warnings": _append_warning(
                        note.notation_warnings,
                        "reference_grid_aligned",
                    )
                }
            )
            for note in shifted
        ]
    return _deduplicate_and_sort(shifted)


def _has_measure_crossing_notes(
    notes: list[TrackNote],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    for note in notes:
        if note.duration_beats <= 0:
            return True
        measure_index = note.measure_index or measure_index_from_beat(
            note.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        measure_end = 1 + measure_index * beats_per_measure
        if note.beat + note.duration_beats > measure_end + 0.001:
            return True
    return False


def _deduplicate_and_sort(notes: list[TrackNote]) -> list[TrackNote]:
    selected: dict[tuple[float, float, int | None, bool], TrackNote] = {}
    for note in notes:
        key = (
            round(note.beat, 4),
            round(note.duration_beats, 4),
            _resolve_pitch_midi(note),
            note.is_rest,
        )
        current = selected.get(key)
        if current is None or _note_weight(note) > _note_weight(current):
            selected[key] = note
    return sorted(selected.values(), key=lambda note: (note.beat, note.is_rest, note.pitch_midi or -1, note.id))


def _registration_diagnostics(
    notes: list[TrackNote],
    *,
    slot_id: int,
    original_count: int,
    source_kind: SourceKind,
    time_signature_numerator: int,
    time_signature_denominator: int,
    actions: list[str],
) -> dict[str, Any]:
    pitched_notes = [note for note in notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    in_range_count = sum(1 for note in pitched_notes if low <= (_resolve_pitch_midi(note) or 0) <= high)
    grid_notes = [
        note
        for note in notes
        if _is_on_grid(note.beat, VOICE_QUANTIZATION_GRID_BEATS)
        and _is_on_grid(note.duration_beats, VOICE_QUANTIZATION_GRID_BEATS)
    ]
    measure_groups = _notes_by_measure(notes)
    max_notes_per_measure = max((sum(1 for note in group if not note.is_rest) for group in measure_groups.values()), default=0)
    cross_measure_count = sum(
        1
        for note in notes
        if _has_measure_crossing_notes(
            [note],
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )
    isolated_short_note_count = count_isolated_short_voice_artifacts(notes)
    short_phrase_gap_count = count_short_voice_phrase_gaps(notes)
    measure_tail_gap_count = count_measure_tail_gaps(
        notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    short_note_cluster_count = count_short_note_clusters(
        notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return {
        "registration_quality_version": "notation_registration_v1",
        "source_kind": source_kind,
        "slot_id": slot_id,
        "original_note_count": original_count,
        "registered_note_count": len(notes),
        "pitched_note_count": len(pitched_notes),
        "measure_count": len(measure_groups),
        "max_notes_per_measure": max_notes_per_measure,
        "range_fit_ratio": round(in_range_count / len(pitched_notes), 4) if pitched_notes else 1.0,
        "timing_grid_ratio": round(len(grid_notes) / len(notes), 4) if notes else 1.0,
        "cross_measure_note_count": cross_measure_count,
        "isolated_short_note_count": isolated_short_note_count,
        "short_phrase_gap_count": short_phrase_gap_count,
        "measure_tail_gap_count": measure_tail_gap_count,
        "short_note_cluster_count": short_note_cluster_count,
        "has_clef_policy": all(note.clef for note in notes),
        "has_key_policy": all(note.key_signature for note in notes),
        "actions": actions,
    }


def _attach_quality_warnings(notes: list[TrackNote], diagnostics: dict[str, Any]) -> list[TrackNote]:
    warnings: list[str] = []
    if diagnostics["range_fit_ratio"] < 0.8:
        warnings.append("registration_range_review")
    if diagnostics["timing_grid_ratio"] < 0.92:
        warnings.append("registration_grid_review")
    if diagnostics["cross_measure_note_count"] > 0:
        warnings.append("registration_measure_boundary_review")
    if diagnostics["isolated_short_note_count"] > 0:
        warnings.append("registration_isolated_artifact_review")
    if diagnostics["short_phrase_gap_count"] > 0:
        warnings.append("registration_phrase_gap_review")
    if diagnostics["measure_tail_gap_count"] > 0:
        warnings.append("registration_measure_tail_review")
    if diagnostics["short_note_cluster_count"] > 0:
        warnings.append("registration_short_cluster_review")
    if not warnings:
        return notes
    return [
        note.model_copy(update={"notation_warnings": _append_warning(note.notation_warnings, *warnings)})
        for note in notes
    ]


def _notes_by_measure(notes: list[TrackNote]) -> dict[int, list[TrackNote]]:
    groups: dict[int, list[TrackNote]] = defaultdict(list)
    for note in notes:
        measure_index = note.measure_index or 1
        groups[measure_index].append(note)
    return groups


def _measure_start_beat(
    measure_index: int,
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    return 1 + max(0, measure_index - 1) * beats_per_measure


def _max_voice_events_per_measure(
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> int:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    return max(4, ceil(beats_per_measure * MAX_VOICE_EVENTS_PER_MEASURE_FACTOR))


def _note_weight(note: TrackNote) -> float:
    return max(0.05, note.duration_beats) * max(0.1, note.confidence)


def _resolve_pitch_midi(note: TrackNote) -> int | None:
    if note.pitch_midi is not None:
        return int(round(note.pitch_midi))
    if note.is_rest:
        return None
    return label_to_midi(note.label)


def _is_on_grid(value: float, grid: float) -> bool:
    return abs(value - quantize(value, grid)) <= 0.001


def _append_warning(existing: list[str], *warnings: str) -> list[str]:
    merged = list(existing)
    for warning in warnings:
        if warning not in merged:
            merged.append(warning)
    return merged


def _coerce_review_instruction(instruction: Mapping[str, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in instruction.items()}


def _instruction_confidence(instruction: Mapping[str, Any]) -> float:
    try:
        return max(0.0, min(1.0, float(instruction.get("confidence", 0))))
    except (TypeError, ValueError):
        return 0.0


def _instruction_grid(instruction: Mapping[str, Any]) -> float | None:
    try:
        grid = float(instruction.get("quantization_grid"))
    except (TypeError, ValueError):
        return None
    if abs(grid - 0.25) <= 0.001:
        return 0.25
    if abs(grid - 0.5) <= 0.001:
        return 0.5
    return None


def _instruction_bool(instruction: Mapping[str, Any], key: str, *, default: bool = False) -> bool:
    value = instruction.get(key)
    if isinstance(value, bool):
        return value
    return default


def _instruction_key_signature(instruction: Mapping[str, Any]) -> str | None:
    value = instruction.get("prefer_key_signature")
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized in KEY_FIFTHS:
        return normalized
    return None


def _has_review_directive(instruction: Mapping[str, Any]) -> bool:
    return any(
        [
            _instruction_grid(instruction) is not None,
            "merge_adjacent_same_pitch" in instruction,
            "simplify_dense_measures" in instruction,
            "suppress_unstable_notes" in instruction,
            "sustain_repeated_notes" in instruction,
            "collapse_pitch_blips" in instruction,
            "remove_isolated_artifacts" in instruction,
            "bridge_short_phrase_gaps" in instruction,
            "bridge_measure_tail_gaps" in instruction,
            "collapse_short_note_clusters" in instruction,
            _instruction_key_signature(instruction) is not None,
            bool(instruction.get("measure_noise_indices")),
        ]
    )


def _should_simplify_after_review(
    notes: list[TrackNote],
    instruction: Mapping[str, Any],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    if _instruction_bool(instruction, "simplify_dense_measures"):
        return True
    if instruction.get("measure_noise_indices"):
        return True
    return _has_dense_voice_measures(
        notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _force_key_signature(notes: list[TrackNote], *, slot_id: int, key_signature: str) -> list[TrackNote]:
    spelling_mode = "flat" if KEY_FIFTHS.get(key_signature, 0) < 0 else "sharp"
    clef = clef_for_slot(slot_id)
    display_octave_shift = display_octave_shift_for_slot(slot_id)
    forced: list[TrackNote] = []
    for note in notes:
        pitch_midi = _resolve_pitch_midi(note)
        spelled_label = note.spelled_label
        accidental = note.accidental
        if not note.is_rest and pitch_midi is not None:
            spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
            accidental = accidental_for_key(spelled_label, key_signature)
        forced.append(
            note.model_copy(
                update={
                    "pitch_midi": pitch_midi,
                    "spelled_label": spelled_label,
                    "accidental": accidental,
                    "clef": clef,
                    "key_signature": key_signature,
                    "display_octave_shift": display_octave_shift,
                }
            )
        )
    return forced


def _with_llm_review_diagnostics(
    result: RegistrationNotationResult,
    instruction: Mapping[str, Any],
    *,
    applied: bool,
    reason: str,
) -> RegistrationNotationResult:
    diagnostics = dict(result.diagnostics)
    diagnostics["llm_notation_review"] = {
        "applied": applied,
        "skipped_reason": reason,
        "confidence": _instruction_confidence(instruction),
        "instruction": _public_review_instruction(instruction),
    }
    actions = list(diagnostics.get("actions", []))
    skip_action = f"llm_notation_review_skipped_{reason}"
    if skip_action not in actions:
        actions.append(skip_action)
    diagnostics["actions"] = actions
    return RegistrationNotationResult(notes=result.notes, diagnostics=diagnostics)


def _public_review_instruction(instruction: Mapping[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "confidence",
        "quantization_grid",
        "merge_adjacent_same_pitch",
        "simplify_dense_measures",
        "suppress_unstable_notes",
        "sustain_repeated_notes",
        "collapse_pitch_blips",
        "remove_isolated_artifacts",
        "bridge_short_phrase_gaps",
        "bridge_measure_tail_gaps",
        "collapse_short_note_clusters",
        "prefer_key_signature",
        "measure_noise_indices",
        "reasons",
        "warnings",
        "provider",
        "model",
        "used",
    }
    return {key: value for key, value in instruction.items() if key in allowed_keys}
