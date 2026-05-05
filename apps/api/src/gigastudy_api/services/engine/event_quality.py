from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from math import ceil, floor
from typing import Any, Mapping

from gigastudy_api.api.schemas.studios import SourceKind
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    beat_in_measure_from_beat,
    label_to_midi,
    measure_index_from_beat,
    midi_to_frequency,
    midi_to_label,
    quarter_beats_per_measure,
    seconds_per_beat,
)
from gigastudy_api.services.engine.event_normalization import (
    KEY_FIFTHS,
    MIN_EVENT_DURATION_BEATS,
    VOICE_QUANTIZATION_GRID_BEATS,
    annotate_track_events_for_slot,
    accidental_for_key,
    enforce_monophonic_vocal_events,
    is_on_rhythm_grid,
    measure_sixteenth_note_beats,
    merge_contiguous_same_pitch_events,
    normalize_track_events,
    pitch_label_octave_shift_for_slot,
    pitch_register_for_slot,
    quantize_beat_to_rhythm_grid,
    quantize_duration_to_rhythm_grid,
    spell_midi_label,
)

VOICE_LIKE_SOURCE_KINDS: set[str] = {"recording", "audio", "music"}
VOICE_LIKE_EVENT_SOURCES: set[str] = {"voice", "recording", "audio"}
EVENT_GENERATION_SOURCE_KINDS: set[str] = {"ai"}
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
VOICE_SHORT_CLUSTER_MIN_EVENTS = 3
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
REFERENCE_ALIGNMENT_MIN_EVENTS = 2
REFERENCE_ALIGNMENT_MIN_MATCH_RATIO = 0.5
REFERENCE_ALIGNMENT_MIN_IMPROVEMENT = 0.12


@dataclass(frozen=True)
class RegistrationQualityResult:
    events: list[TrackPitchEvent]
    diagnostics: dict[str, Any]


def enforce_registration_event_contract(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    diagnostics: dict[str, Any] | None = None,
) -> RegistrationQualityResult:
    """Final shared contract for all registered track material.

    Every source path, including recording, audio upload, PDF/MusicXML, MIDI,
    and AI generation, must end here before material becomes user-visible track
    data.
    """

    contract_events, contract_actions, event_contract = _enforce_registration_event_contract(
        events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    next_diagnostics = dict(diagnostics or {})
    actions = list(next_diagnostics.get("actions", []))
    for action in contract_actions:
        if action not in actions:
            actions.append(action)
    next_diagnostics["actions"] = actions
    next_diagnostics["event_contract"] = event_contract
    return RegistrationQualityResult(
        events=_attach_quality_warnings(contract_events, next_diagnostics),
        diagnostics=next_diagnostics,
    )


def prepare_events_for_track_registration(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    reference_tracks: list[list[TrackPitchEvent]] | None = None,
) -> RegistrationQualityResult:
    """Prepare pitch-event material for final region-event registration.

    This is the single cleanup gate for user-visible track registration. Audio,
    generated, MIDI, and document material is rewritten onto the studio's fixed
    BPM/meter rhythm grid before it can become registered track data.
    """

    original_count = len(events)
    minimum_note_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    actions: list[str] = []
    if not events:
        return RegistrationQualityResult(
            events=[],
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

    if _requires_grid_rewrite(source_kind, events):
        working_events = events
        if _requires_noise_filter(source_kind, events):
            working_events, filter_actions = _filter_voice_noise(events)
            actions.extend(filter_actions)
        merge_same_pitch_on_grid = _allows_voice_sustain_rewrite(source_kind, working_events)
        normalized_events = normalize_track_events(
            working_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=VOICE_QUANTIZATION_GRID_BEATS,
            merge_adjacent_same_pitch=merge_same_pitch_on_grid,
        )
        actions.append("fixed_bpm_grid_normalization")
        if _has_dense_voice_measures(
            normalized_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            simplified_events = _simplify_dense_voice_measures(
                normalized_events,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            normalized_events = normalize_track_events(
                simplified_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
                merge_adjacent_same_pitch=merge_same_pitch_on_grid,
            )
            actions.append("dense_voice_measure_simplification")
        normalized_events, polish_actions = _polish_voice_events(
            normalized_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=normalized_events[0].quantization_grid or VOICE_QUANTIZATION_GRID_BEATS
            if normalized_events
            else VOICE_QUANTIZATION_GRID_BEATS,
            collapse_pitch_blips=merge_same_pitch_on_grid,
            remove_isolated_artifacts=merge_same_pitch_on_grid,
            bridge_short_phrase_gaps=merge_same_pitch_on_grid,
            bridge_measure_tail_gaps=merge_same_pitch_on_grid,
            collapse_short_event_clusters=merge_same_pitch_on_grid,
            sustain_repetitions=merge_same_pitch_on_grid,
        )
        actions.extend(polish_actions)
        if merge_same_pitch_on_grid:
            normalized_events, optimizer_actions = _choose_readable_voice_candidate(
                working_events,
                current_events=normalized_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            actions.extend(optimizer_actions)
        prepared_events = normalized_events
    else:
        repaired_events = _repair_symbolic_timing_metadata(
            events,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            minimum_duration_beats=minimum_note_beats,
        )
        prepared_events = annotate_track_events_for_slot(repaired_events, slot_id=slot_id)
        actions.append("symbolic_event_metadata_annotation")
        if _has_measure_crossing_events(
            prepared_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_events = normalize_track_events(
                prepared_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=minimum_note_beats,
                merge_adjacent_same_pitch=False,
            )
            actions.append("symbolic_measure_boundary_split")
        merged_events = merge_contiguous_same_pitch_events(
            prepared_events,
            bpm=bpm,
            merge_policy="tied_contiguous",
        )
        if _event_identity(merged_events) != _event_identity(prepared_events):
            prepared_events = merged_events
            actions.append("symbolic_same_pitch_tie_merge")

    prepared_events = _deduplicate_and_sort(prepared_events)
    alignment = _align_to_reference_tracks(
        prepared_events,
        reference_tracks or [],
        bpm=bpm,
        slot_id=slot_id,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if alignment["applied"]:
        prepared_events = alignment["events"]
        actions.append("reference_track_grid_alignment")
    prepared_events, contract_actions, event_contract = _enforce_registration_event_contract(
        prepared_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    actions.extend(contract_actions)
    diagnostics = _registration_diagnostics(
        prepared_events,
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
            if key != "events"
        }
    diagnostics["event_contract"] = event_contract
    prepared_events = _attach_quality_warnings(prepared_events, diagnostics)
    return RegistrationQualityResult(events=prepared_events, diagnostics=diagnostics)


def apply_registration_review_instruction(
    events: list[TrackPitchEvent],
    *,
    instruction: Mapping[str, Any],
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    baseline_result: RegistrationQualityResult | None = None,
    reference_tracks: list[list[TrackPitchEvent]] | None = None,
) -> RegistrationQualityResult:
    """Apply a bounded LLM registration cleanup plan through deterministic code.

    The LLM never writes pitch-event records. It can only request a small set of repairs
    such as coarser quantization, sustain merging, dense-measure simplification,
    voice-noise filtering, and key-spelling preference. This function validates
    those requests and re-runs the local registration engine against the studio's
    fixed BPM/meter.
    """

    baseline = baseline_result or prepare_events_for_track_registration(
        events,
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

    if not events:
        return _with_llm_review_diagnostics(
            baseline,
            instruction_data,
            applied=False,
            reason="empty_input",
        )

    actions = ["llm_registration_review_applied"]
    minimum_note_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    quantization_grid = max(
        _instruction_grid(instruction_data) or VOICE_QUANTIZATION_GRID_BEATS,
        minimum_note_beats,
    )
    if _instruction_bool(instruction_data, "simplify_dense_measures"):
        quantization_grid = max(quantization_grid, VOICE_DENSITY_SIMPLIFICATION_GRID)
    allow_same_pitch_sustain = _allows_voice_sustain_rewrite(source_kind, events)
    merge_adjacent_same_pitch = allow_same_pitch_sustain and (
        _instruction_bool(
            instruction_data,
            "merge_adjacent_same_pitch",
            default=True,
        )
        or _instruction_bool(instruction_data, "sustain_repeated_events")
    )
    preferred_key = _instruction_key_signature(instruction_data)

    if _requires_grid_rewrite(source_kind, events):
        working_events = events
        if _instruction_bool(instruction_data, "suppress_unstable_events") and _requires_noise_filter(source_kind, events):
            working_events, filter_actions = _filter_voice_noise(events)
            actions.extend(f"llm_{action}" for action in filter_actions)

        prepared_events = normalize_track_events(
            working_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            merge_adjacent_same_pitch=merge_adjacent_same_pitch,
        )
        actions.append(f"llm_fixed_bpm_grid_{quantization_grid:g}")

        if _should_simplify_after_review(
            prepared_events,
            instruction_data,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            simplified_events = _simplify_dense_voice_measures(
                prepared_events,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            prepared_events = normalize_track_events(
                simplified_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
                merge_adjacent_same_pitch=merge_adjacent_same_pitch,
            )
            actions.append("llm_dense_voice_measure_simplification")
        prepared_events, polish_actions = _polish_voice_events(
            prepared_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            collapse_pitch_blips=_instruction_bool(
                instruction_data,
                "collapse_pitch_blips",
                default=allow_same_pitch_sustain,
            ),
            remove_isolated_artifacts=_instruction_bool(
                instruction_data,
                "remove_isolated_artifacts",
                default=allow_same_pitch_sustain,
            ),
            bridge_short_phrase_gaps=_instruction_bool(
                instruction_data,
                "bridge_short_phrase_gaps",
                default=allow_same_pitch_sustain,
            ),
            bridge_measure_tail_gaps=_instruction_bool(
                instruction_data,
                "bridge_measure_tail_gaps",
                default=allow_same_pitch_sustain,
            ),
            collapse_short_event_clusters=_instruction_bool(
                instruction_data,
                "collapse_short_event_clusters",
                default=allow_same_pitch_sustain,
            ),
            sustain_repetitions=merge_adjacent_same_pitch,
        )
        actions.extend(f"llm_{action}" for action in polish_actions)
        if allow_same_pitch_sustain:
            prepared_events, optimizer_actions = _choose_readable_voice_candidate(
                working_events,
                current_events=prepared_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
            actions.extend(f"llm_{action}" for action in optimizer_actions)
    else:
        repaired_events = _repair_symbolic_timing_metadata(
            events,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            minimum_duration_beats=minimum_note_beats,
        )
        prepared_events = annotate_track_events_for_slot(repaired_events, slot_id=slot_id)
        actions.append("llm_symbolic_event_review_annotation")
        if _instruction_bool(instruction_data, "simplify_dense_measures") and _has_dense_voice_measures(
            prepared_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_events = normalize_track_events(
                prepared_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=quantization_grid,
                merge_adjacent_same_pitch=merge_adjacent_same_pitch,
            )
            actions.append("llm_symbolic_dense_measure_rewrite")
        elif _has_measure_crossing_events(
            prepared_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ):
            prepared_events = normalize_track_events(
                prepared_events,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                quantization_grid=minimum_note_beats,
                merge_adjacent_same_pitch=False,
            )
            actions.append("llm_symbolic_measure_boundary_split")

    if preferred_key is not None:
        prepared_events = _force_key_signature(prepared_events, slot_id=slot_id, key_signature=preferred_key)
        actions.append(f"llm_prefer_key_{preferred_key}")

    prepared_events = _deduplicate_and_sort(prepared_events)
    alignment = _align_to_reference_tracks(
        prepared_events,
        reference_tracks or [],
        bpm=bpm,
        slot_id=slot_id,
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if alignment["applied"]:
        prepared_events = alignment["events"]
        actions.append("llm_reference_track_grid_alignment")
    prepared_events, contract_actions, event_contract = _enforce_registration_event_contract(
        prepared_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    actions.extend(f"llm_{action}" for action in contract_actions)
    diagnostics = _registration_diagnostics(
        prepared_events,
        slot_id=slot_id,
        original_count=len(events),
        source_kind=source_kind,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        actions=actions,
    )
    diagnostics["llm_registration_review"] = {
        "applied": True,
        "confidence": confidence,
        "instruction": _public_review_instruction(instruction_data),
    }
    if alignment["evaluated"]:
        diagnostics["reference_alignment"] = {
            key: value
            for key, value in alignment.items()
            if key != "events"
        }
    diagnostics["event_contract"] = event_contract
    diagnostics["pre_llm_registration_quality"] = baseline.diagnostics
    prepared_events = _attach_quality_warnings(prepared_events, diagnostics)
    return RegistrationQualityResult(events=prepared_events, diagnostics=diagnostics)


def _requires_grid_rewrite(source_kind: SourceKind, events: list[TrackPitchEvent]) -> bool:
    if source_kind in VOICE_LIKE_SOURCE_KINDS or source_kind in EVENT_GENERATION_SOURCE_KINDS:
        return True
    return any(event.source in VOICE_LIKE_EVENT_SOURCES or event.source == "ai" for event in events)


def _requires_noise_filter(source_kind: SourceKind, events: list[TrackPitchEvent]) -> bool:
    if source_kind in EVENT_GENERATION_SOURCE_KINDS:
        return False
    return source_kind in VOICE_LIKE_SOURCE_KINDS or any(event.source in VOICE_LIKE_EVENT_SOURCES for event in events)


def _allows_voice_sustain_rewrite(source_kind: SourceKind, events: list[TrackPitchEvent]) -> bool:
    return source_kind in VOICE_LIKE_SOURCE_KINDS or any(event.source in VOICE_LIKE_EVENT_SOURCES for event in events)


def _filter_voice_noise(events: list[TrackPitchEvent]) -> tuple[list[TrackPitchEvent], list[str]]:
    pitched_events = [event for event in events if not event.is_rest and _resolve_pitch_midi(event) is not None]
    if not pitched_events:
        return events, []

    keep_threshold = MIN_VOICE_CONFIDENCE
    strong_events = [event for event in pitched_events if event.confidence >= 0.48]
    if len(strong_events) < 2:
        keep_threshold = min(0.22, min(event.confidence for event in pitched_events))

    filtered: list[TrackPitchEvent] = []
    removed_count = 0
    for event in events:
        if event.is_rest:
            if event.duration_beats >= MIN_EVENT_DURATION_BEATS:
                filtered.append(event)
            else:
                removed_count += 1
            continue
        if _resolve_pitch_midi(event) is None:
            removed_count += 1
            continue
        if event.duration_beats < MIN_VOICE_DURATION_BEATS:
            removed_count += 1
            continue
        if event.confidence < keep_threshold:
            removed_count += 1
            continue
        filtered.append(event)

    if not filtered:
        filtered = [max(pitched_events, key=lambda event: (event.confidence, event.duration_beats))]
        removed_count = max(0, len(events) - 1)

    actions = [f"voice_noise_filter_removed_{removed_count}"] if removed_count else []
    return filtered, actions


def _has_dense_voice_measures(
    events: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    for measure_events in _events_by_measure(events).values():
        pitched_count = sum(1 for event in measure_events if not event.is_rest)
        if pitched_count > max_events:
            return True
    return False


def _simplify_dense_voice_measures(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackPitchEvent]:
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    simplified: list[TrackPitchEvent] = []
    for measure_index, measure_events in sorted(_events_by_measure(events).items()):
        pitched_events = [event for event in measure_events if not event.is_rest]
        if len(pitched_events) <= max_events:
            simplified.extend(measure_events)
            continue

        cells: dict[int, TrackPitchEvent] = {}
        measure_start = _measure_start_beat(
            measure_index,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        for event in pitched_events:
            cell_index = max(0, floor((event.beat - measure_start) / VOICE_DENSITY_SIMPLIFICATION_GRID))
            current = cells.get(cell_index)
            if current is None or _event_weight(event) > _event_weight(current):
                cell_start = measure_start + cell_index * VOICE_DENSITY_SIMPLIFICATION_GRID
                cells[cell_index] = event.model_copy(
                    update={
                        "beat": round(cell_start, 4),
                        "duration_beats": VOICE_DENSITY_SIMPLIFICATION_GRID,
                        "onset_seconds": round(max(0, (cell_start - 1) * seconds_per_beat(bpm)), 4),
                        "duration_seconds": round(VOICE_DENSITY_SIMPLIFICATION_GRID * seconds_per_beat(bpm), 4),
                        "quality_warnings": _append_warning(event.quality_warnings, "dense_measure_simplified"),
                    }
                )
        simplified.extend(cells[index] for index in sorted(cells))
    return simplified


def _polish_voice_events(
    events: list[TrackPitchEvent],
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
    collapse_short_event_clusters: bool = True,
    sustain_repetitions: bool = True,
) -> tuple[list[TrackPitchEvent], list[str]]:
    """Make voice-like event records behave like sung pitch events, not frame artifacts."""

    if len(events) < 2:
        return events, []

    polished_events = events
    actions: list[str] = []
    if remove_isolated_artifacts:
        polished_events, removed_count = _remove_isolated_short_artifacts(polished_events)
        if removed_count:
            actions.append(f"voice_isolated_artifact_removed_{removed_count}")
    if collapse_pitch_blips:
        polished_events, collapsed_count = _collapse_neighbor_pitch_blips(polished_events, bpm=bpm)
        if collapsed_count:
            actions.append(f"voice_pitch_blip_collapse_{collapsed_count}")
    if collapse_short_event_clusters:
        polished_events, cluster_count = _collapse_short_event_clusters(
            polished_events,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if cluster_count:
            actions.append(f"voice_short_cluster_collapse_{cluster_count}")
    if bridge_measure_tail_gaps:
        polished_events, tail_count = _bridge_measure_tail_gaps(
            polished_events,
            bpm=bpm,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if tail_count:
            actions.append(f"voice_measure_tail_bridge_{tail_count}")
    if bridge_short_phrase_gaps:
        polished_events, bridged_count = _bridge_short_voice_phrase_gaps(polished_events, bpm=bpm)
        if bridged_count:
            actions.append(f"voice_phrase_gap_bridge_{bridged_count}")
    if sustain_repetitions:
        polished_events, merged_count = _merge_voice_sustain_repetitions(polished_events, bpm=bpm)
        if merged_count:
            actions.append(f"voice_sustain_merge_{merged_count}")

    if not actions:
        return events, []

    normalized = normalize_track_events(
        polished_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=quantization_grid,
        merge_adjacent_same_pitch=sustain_repetitions,
    )
    return normalized, actions


def count_isolated_short_voice_artifacts(events: list[TrackPitchEvent]) -> int:
    """Count short, low-confidence events that are isolated from nearby singing."""

    return len(_isolated_short_artifact_indices(_deduplicate_and_sort(events)))


def count_short_voice_phrase_gaps(events: list[TrackPitchEvent]) -> int:
    """Count tiny detector dropouts between confident adjacent sung events."""

    return len(_short_voice_phrase_gap_targets(_deduplicate_and_sort(events)))


def count_measure_tail_gaps(
    events: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> int:
    """Count tiny missing tails before barlines in otherwise connected singing."""

    return len(
        _measure_tail_gap_targets(
            _deduplicate_and_sort(events),
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )


def count_short_event_clusters(
    events: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> int:
    """Count low-confidence short-event clusters that read like tracker chatter."""

    ordered_events = _deduplicate_and_sort(events)
    cluster_count = 0
    index = 0
    while index < len(ordered_events):
        cluster_indices = _short_event_cluster_at(
            ordered_events,
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


def _remove_isolated_short_artifacts(events: list[TrackPitchEvent]) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    remove_indices = _isolated_short_artifact_indices(ordered_events)
    if not remove_indices:
        return ordered_events, 0

    pitched_indices = [
        index
        for index, event in enumerate(ordered_events)
        if not event.is_rest and _resolve_pitch_midi(event) is not None
    ]
    if len(pitched_indices) - len(remove_indices) <= 0:
        return ordered_events, 0

    filtered_events = [event for index, event in enumerate(ordered_events) if index not in remove_indices]
    return filtered_events, len(remove_indices)


def _isolated_short_artifact_indices(ordered_events: list[TrackPitchEvent]) -> set[int]:
    pitched_indices = [
        index
        for index, event in enumerate(ordered_events)
        if not event.is_rest and _resolve_pitch_midi(event) is not None
    ]
    if len(pitched_indices) <= 1:
        return set()

    artifact_indices: set[int] = set()
    for position, event_index in enumerate(pitched_indices):
        event = ordered_events[event_index]
        if event.duration_beats > VOICE_ISOLATED_ARTIFACT_MAX_DURATION_BEATS:
            continue
        if event.confidence > VOICE_ISOLATED_ARTIFACT_MAX_CONFIDENCE:
            continue

        previous_event = ordered_events[pitched_indices[position - 1]] if position > 0 else None
        next_event = ordered_events[pitched_indices[position + 1]] if position < len(pitched_indices) - 1 else None
        left_gap = _gap_between(previous_event, event) if previous_event is not None else VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        right_gap = _gap_between(event, next_event) if next_event is not None else VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        if (
            left_gap >= VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
            and right_gap >= VOICE_ISOLATED_ARTIFACT_MIN_GAP_BEATS
        ):
            artifact_indices.add(event_index)

    return artifact_indices


def _bridge_short_voice_phrase_gaps(events: list[TrackPitchEvent], *, bpm: int) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    bridge_targets = _short_voice_phrase_gap_targets(ordered_events)
    if not bridge_targets:
        return ordered_events, 0

    bridged_events: list[TrackPitchEvent] = []
    for index, event in enumerate(ordered_events):
        next_event = bridge_targets.get(index)
        if next_event is None:
            bridged_events.append(event)
            continue
        bridged_events.append(
            _extend_event_to_beat(
                event,
                end_beat=next_event.beat,
                bpm=bpm,
                warning="voice_phrase_gap_bridged",
            )
        )
    return bridged_events, len(bridge_targets)


def _short_voice_phrase_gap_targets(ordered_events: list[TrackPitchEvent]) -> dict[int, TrackPitchEvent]:
    pitched_indices = [
        index
        for index, event in enumerate(ordered_events)
        if not event.is_rest and _resolve_pitch_midi(event) is not None
    ]
    if len(pitched_indices) < 2:
        return {}

    bridge_targets: dict[int, TrackPitchEvent] = {}
    for left_index, right_index in zip(pitched_indices, pitched_indices[1:], strict=False):
        left_event = ordered_events[left_index]
        right_event = ordered_events[right_index]
        gap = _gap_between(left_event, right_event)
        if gap <= 0 or gap > VOICE_PHRASE_GAP_MAX_BEATS:
            continue
        if left_event.confidence < VOICE_PHRASE_GAP_MIN_CONFIDENCE:
            continue
        if right_event.confidence < VOICE_PHRASE_GAP_MIN_CONFIDENCE:
            continue
        if left_event.duration_beats < MIN_EVENT_DURATION_BEATS or right_event.duration_beats < MIN_EVENT_DURATION_BEATS:
            continue
        left_pitch = _resolve_pitch_midi(left_event)
        right_pitch = _resolve_pitch_midi(right_event)
        if left_pitch is None or right_pitch is None:
            continue
        if left_pitch == right_pitch:
            continue
        if abs(left_pitch - right_pitch) > VOICE_PHRASE_GAP_MAX_INTERVAL:
            continue
        if any(event.is_rest for event in ordered_events[left_index + 1 : right_index]):
            continue
        bridge_targets[left_index] = right_event
    return bridge_targets


def _bridge_measure_tail_gaps(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    bridge_targets = _measure_tail_gap_targets(
        ordered_events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if not bridge_targets:
        return ordered_events, 0

    bridged_events: list[TrackPitchEvent] = []
    for index, event in enumerate(ordered_events):
        measure_end = bridge_targets.get(index)
        if measure_end is None:
            bridged_events.append(event)
            continue
        bridged_events.append(
            _extend_event_to_beat(
                event,
                end_beat=measure_end,
                bpm=bpm,
                warning="voice_measure_tail_bridged",
            )
        )
    return bridged_events, len(bridge_targets)


def _measure_tail_gap_targets(
    ordered_events: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[int, float]:
    pitched_indices = [
        index
        for index, event in enumerate(ordered_events)
        if not event.is_rest and _resolve_pitch_midi(event) is not None
    ]
    if len(pitched_indices) < 2:
        return {}

    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    bridge_targets: dict[int, float] = {}
    for position, event_index in enumerate(pitched_indices[:-1]):
        event = ordered_events[event_index]
        if event.confidence < VOICE_MEASURE_TAIL_MIN_CONFIDENCE:
            continue
        if event.duration_beats < VOICE_MEASURE_TAIL_MIN_DURATION_BEATS:
            continue

        event_end = event.beat + event.duration_beats
        measure_index = measure_index_from_beat(
            event.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        measure_end = 1 + measure_index * beats_per_measure
        tail_gap = round(measure_end - event_end, 4)
        if tail_gap <= 0 or tail_gap > VOICE_MEASURE_TAIL_GAP_MAX_BEATS:
            continue

        next_event = ordered_events[pitched_indices[position + 1]]
        if next_event.beat < measure_end - 0.001:
            continue
        if next_event.beat - measure_end > VOICE_MEASURE_TAIL_FOLLOWUP_MAX_BEATS:
            continue
        if any(
            candidate.is_rest and candidate.beat < measure_end
            for candidate in ordered_events[event_index + 1 : pitched_indices[position + 1]]
        ):
            continue
        bridge_targets[event_index] = measure_end
    return bridge_targets


def _collapse_short_event_clusters(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    collapsed_events: list[TrackPitchEvent] = []
    collapse_count = 0
    index = 0
    while index < len(ordered_events):
        cluster_indices = _short_event_cluster_at(
            ordered_events,
            start_index=index,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if not cluster_indices:
            collapsed_events.append(ordered_events[index])
            index += 1
            continue

        cluster_events = [ordered_events[cluster_index] for cluster_index in cluster_indices]
        representative = max(cluster_events, key=_event_weight)
        representative_pitch = _resolve_pitch_midi(representative)
        if representative_pitch is None:
            collapsed_events.extend(cluster_events)
            index = cluster_indices[-1] + 1
            continue

        collapsed_events.append(
            _merge_event_span(
                cluster_events[0],
                cluster_events[-1],
                bpm=bpm,
                pitch_midi=representative_pitch,
                warning="voice_short_cluster_collapsed",
                confidence=max(event.confidence for event in cluster_events),
            )
        )
        collapse_count += 1
        index = cluster_indices[-1] + 1
    return collapsed_events, collapse_count


def _short_event_cluster_at(
    ordered_events: list[TrackPitchEvent],
    *,
    start_index: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[int]:
    if start_index >= len(ordered_events):
        return []

    first_event = ordered_events[start_index]
    first_pitch = _resolve_pitch_midi(first_event)
    if first_event.is_rest or first_pitch is None:
        return []
    if first_event.duration_beats > VOICE_SHORT_CLUSTER_MAX_DURATION_BEATS:
        return []

    measure_index = measure_index_from_beat(
        first_event.beat,
        time_signature_numerator,
        time_signature_denominator,
    )
    cluster_indices = [start_index]
    previous_event = first_event
    for candidate_index in range(start_index + 1, len(ordered_events)):
        candidate = ordered_events[candidate_index]
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
        gap = _gap_between(previous_event, candidate)
        if gap < -0.001 or gap > VOICE_SHORT_CLUSTER_MAX_GAP_BEATS:
            break
        cluster_span = candidate.beat + candidate.duration_beats - first_event.beat
        if cluster_span > VOICE_SHORT_CLUSTER_MAX_SPAN_BEATS + 0.001:
            break
        cluster_indices.append(candidate_index)
        previous_event = candidate

    if len(cluster_indices) < VOICE_SHORT_CLUSTER_MIN_EVENTS:
        return []

    cluster_events = [ordered_events[index] for index in cluster_indices]
    average_confidence = sum(event.confidence for event in cluster_events) / len(cluster_events)
    pitches = [_resolve_pitch_midi(event) for event in cluster_events]
    resolved_pitches = [pitch for pitch in pitches if pitch is not None]
    pitch_span = max(resolved_pitches) - min(resolved_pitches) if resolved_pitches else 999
    if average_confidence > VOICE_SHORT_CLUSTER_MAX_AVERAGE_CONFIDENCE:
        return []
    if pitch_span > VOICE_SHORT_CLUSTER_MAX_PITCH_SPAN:
        return []
    return cluster_indices


def _collapse_neighbor_pitch_blips(events: list[TrackPitchEvent], *, bpm: int) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    collapsed: list[TrackPitchEvent] = []
    collapse_count = 0
    index = 0
    while index < len(ordered_events):
        if index <= len(ordered_events) - 3:
            previous_event = ordered_events[index]
            current_event = ordered_events[index + 1]
            next_event = ordered_events[index + 2]
            previous_pitch = _resolve_pitch_midi(previous_event)
            current_pitch = _resolve_pitch_midi(current_event)
            next_pitch = _resolve_pitch_midi(next_event)
            if (
                previous_pitch is not None
                and current_pitch is not None
                and next_pitch is not None
                and previous_pitch == next_pitch
                and current_pitch != previous_pitch
                and abs(current_pitch - previous_pitch) <= VOICE_NEIGHBOR_BLIP_MAX_INTERVAL
                and current_event.duration_beats <= VOICE_NEIGHBOR_BLIP_MAX_DURATION_BEATS
                and current_event.confidence <= max(previous_event.confidence, next_event.confidence) + 0.04
                and _gap_between(previous_event, current_event) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
                and _gap_between(current_event, next_event) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
            ):
                merged_event = _merge_event_span(
                    previous_event,
                    next_event,
                    bpm=bpm,
                    pitch_midi=previous_pitch,
                    warning="voice_pitch_blip_collapsed",
                    confidence=max(previous_event.confidence, next_event.confidence, current_event.confidence * 0.94),
                )
                collapsed.append(merged_event)
                collapse_count += 1
                index += 3
                continue
        collapsed.append(ordered_events[index])
        index += 1
    return collapsed, collapse_count


def _merge_voice_sustain_repetitions(events: list[TrackPitchEvent], *, bpm: int) -> tuple[list[TrackPitchEvent], int]:
    ordered_events = _deduplicate_and_sort(events)
    if len(ordered_events) < 2:
        return ordered_events, 0

    merged: list[TrackPitchEvent] = []
    merge_count = 0
    current = ordered_events[0]
    for next_event in ordered_events[1:]:
        current_pitch = _resolve_pitch_midi(current)
        next_pitch = _resolve_pitch_midi(next_event)
        if (
            current_pitch is not None
            and next_pitch == current_pitch
            and not current.is_rest
            and not next_event.is_rest
            and _gap_between(current, next_event) <= VOICE_SUSTAIN_MERGE_GAP_BEATS
        ):
            current = _merge_event_span(
                current,
                next_event,
                bpm=bpm,
                pitch_midi=current_pitch,
                warning="voice_sustain_merged",
                confidence=max(current.confidence, next_event.confidence),
            )
            merge_count += 1
            continue
        merged.append(current)
        current = next_event
    merged.append(current)
    return merged, merge_count


def _choose_readable_voice_candidate(
    source_events: list[TrackPitchEvent],
    *,
    current_events: list[TrackPitchEvent],
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], list[str]]:
    if not current_events:
        return current_events, []

    coarse_events = normalize_track_events(
        source_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
        merge_adjacent_same_pitch=True,
    )
    coarse_events, polish_actions = _polish_voice_events(
        coarse_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        quantization_grid=VOICE_DENSITY_SIMPLIFICATION_GRID,
    )

    current_score = _voice_readability_score(
        current_events,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    coarse_score = _voice_readability_score(
        coarse_events,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )

    if coarse_score + 0.75 < current_score:
        return coarse_events, ["readability_grid_0.5", *polish_actions]
    return current_events, []


def _voice_readability_score(
    events: list[TrackPitchEvent],
    *,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    if not events:
        return 999.0

    pitched_events = [event for event in events if not event.is_rest and _resolve_pitch_midi(event) is not None]
    if not pitched_events:
        return 999.0
    measure_groups = _events_by_measure(pitched_events)
    max_events = _max_voice_events_per_measure(
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    max_events_per_measure = max((len(group) for group in measure_groups.values()), default=0)
    short_ratio = sum(1 for event in pitched_events if event.duration_beats <= 0.25) / len(pitched_events)
    isolated_artifact_ratio = count_isolated_short_voice_artifacts(pitched_events) / len(pitched_events)
    short_gap_ratio = count_short_voice_phrase_gaps(pitched_events) / len(pitched_events)
    measure_tail_ratio = count_measure_tail_gaps(
        pitched_events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ) / len(pitched_events)
    short_cluster_ratio = count_short_event_clusters(
        pitched_events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ) / len(pitched_events)
    tie_ratio = sum(1 for event in pitched_events if event.is_tied) / len(pitched_events)
    accidental_ratio = sum(1 for event in pitched_events if event.accidental) / len(pitched_events)
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    out_of_range_ratio = sum(
        1 for event in pitched_events if not low <= (_resolve_pitch_midi(event) or 0) <= high
    ) / len(pitched_events)
    density_penalty = max(0, max_events_per_measure - max_events) * 1.25
    return (
        density_penalty
        + max_events_per_measure * 0.35
        + short_ratio * 4.0
        + isolated_artifact_ratio * 3.5
        + short_gap_ratio * 2.5
        + measure_tail_ratio * 2.0
        + short_cluster_ratio * 3.0
        + tie_ratio * 0.8
        + accidental_ratio * 0.7
        + out_of_range_ratio * 5.0
    )


def _gap_between(left: TrackPitchEvent, right: TrackPitchEvent) -> float:
    return round(right.beat - (left.beat + left.duration_beats), 4)


def _merge_event_span(
    first_event: TrackPitchEvent,
    last_event: TrackPitchEvent,
    *,
    bpm: int,
    pitch_midi: int,
    warning: str,
    confidence: float,
) -> TrackPitchEvent:
    start_beat = first_event.beat
    end_beat = max(start_beat + MIN_EVENT_DURATION_BEATS, last_event.beat + last_event.duration_beats)
    duration_beats = round(end_beat - start_beat, 4)
    return first_event.model_copy(
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
            "is_tied": first_event.is_tied or last_event.is_tied,
            "quality_warnings": _append_warning(first_event.quality_warnings, warning),
        }
    )


def _extend_event_to_beat(event: TrackPitchEvent, *, end_beat: float, bpm: int, warning: str) -> TrackPitchEvent:
    duration_beats = round(max(event.duration_beats, end_beat - event.beat), 4)
    return event.model_copy(
        update={
            "duration_beats": duration_beats,
            "duration_seconds": round(duration_beats * seconds_per_beat(bpm), 4),
            "quality_warnings": _append_warning(event.quality_warnings, warning),
        }
    )


def _repair_symbolic_timing_metadata(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    minimum_duration_beats: float,
) -> list[TrackPitchEvent]:
    beat_seconds = seconds_per_beat(max(1, bpm))
    minimum_note_beats = max(0.0001, minimum_duration_beats)
    repaired: list[TrackPitchEvent] = []
    for event in events:
        beat = quantize_beat_to_rhythm_grid(event.beat, minimum_note_beats)
        duration_beats = quantize_duration_to_rhythm_grid(event.duration_beats, minimum_note_beats)
        pitch_midi = event.pitch_midi
        if pitch_midi is None and not event.is_rest:
            pitch_midi = label_to_midi(event.label)
        repaired.append(
            event.model_copy(
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


def _fill_subdivision_gaps(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    minimum_gap_beats: float,
) -> tuple[list[TrackPitchEvent], int]:
    if len(events) < 2:
        return events, 0

    filled: list[TrackPitchEvent] = []
    fill_count = 0
    for event in sorted(events, key=lambda item: (item.beat, item.id)):
        if not filled:
            filled.append(event)
            continue

        previous = filled[-1]
        previous_end = previous.beat + previous.duration_beats
        gap_beats = round(event.beat - previous_end, 4)
        if 0 < gap_beats < minimum_gap_beats - 0.0001:
            filled[-1] = _extend_event_to_beat(
                previous,
                end_beat=event.beat,
                bpm=bpm,
                warning="subdivision_gap_absorbed",
            )
            fill_count += 1
        filled.append(event)
    return filled, fill_count


def _retime_events_to_registration_grid(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    rhythm_grid_beats: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], int]:
    beat_seconds = seconds_per_beat(max(1, bpm))
    retimed: list[TrackPitchEvent] = []
    changed_count = 0
    for event in events:
        beat = quantize_beat_to_rhythm_grid(event.beat, rhythm_grid_beats)
        duration_beats = quantize_duration_to_rhythm_grid(event.duration_beats, rhythm_grid_beats)
        quantization_grid = max(event.quantization_grid or rhythm_grid_beats, rhythm_grid_beats)
        changed = (
            round(event.beat, 4) != beat
            or round(event.duration_beats, 4) != duration_beats
            or event.quantization_grid != quantization_grid
        )
        warnings = (
            _append_warning(event.quality_warnings, "registration_rhythm_grid_quantized")
            if changed
            else event.quality_warnings
        )
        if changed:
            changed_count += 1
        retimed.append(
            event.model_copy(
                update={
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
                    "quantization_grid": quantization_grid,
                    "quality_warnings": warnings,
                }
            )
        )
    return _deduplicate_and_sort(retimed), changed_count


def _enforce_registration_event_contract(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[list[TrackPitchEvent], list[str], dict[str, Any]]:
    """Force final pitch events onto the studio region-event clock.

    Earlier stages may transcribe, import, simplify, align, or review events.
    Registration must end with one canonical event contract: the studio BPM and
    meter define seconds, measures, track voice identity, pitch register, and key spelling.
    """

    if not events:
        return [], [], _event_contract_diagnostics(
            [],
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )

    minimum_note_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    contract_events = events
    actions: list[str] = []
    contract_events, rhythm_quantized_count = _retime_events_to_registration_grid(
        contract_events,
        bpm=bpm,
        rhythm_grid_beats=minimum_note_beats,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if rhythm_quantized_count:
        actions.append(f"event_contract_rhythm_grid_quantized_{rhythm_quantized_count}")
    monophonic_events = enforce_monophonic_vocal_events(
        contract_events,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        minimum_duration_beats=minimum_note_beats,
    )
    if _event_identity(monophonic_events) != _event_identity(contract_events):
        actions.append("event_contract_monophonic_vocal_line")
    contract_events = monophonic_events
    merged_events = merge_contiguous_same_pitch_events(
        contract_events,
        bpm=bpm,
        gap_epsilon_beats=minimum_note_beats - 0.0001,
        merge_policy="tied_contiguous",
    )
    if _event_identity(merged_events) != _event_identity(contract_events):
        actions.append("event_contract_same_pitch_tie_merge")
    contract_events = merged_events
    if _has_measure_crossing_events(
        contract_events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        contract_events = normalize_track_events(
            contract_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=minimum_note_beats,
            merge_adjacent_same_pitch=False,
        )
        actions.append("event_contract_measure_split")
        contract_events, rhythm_quantized_count = _retime_events_to_registration_grid(
            contract_events,
            bpm=bpm,
            rhythm_grid_beats=minimum_note_beats,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        if rhythm_quantized_count:
            actions.append(f"event_contract_rhythm_grid_quantized_{rhythm_quantized_count}")
        merged_events = merge_contiguous_same_pitch_events(
            contract_events,
            bpm=bpm,
            gap_epsilon_beats=minimum_note_beats - 0.0001,
            merge_policy="tied_contiguous",
        )
        if _event_identity(merged_events) != _event_identity(contract_events):
            actions.append("event_contract_same_pitch_tie_merge")
    contract_events = merged_events
    gap_filled_events, gap_fill_count = _fill_subdivision_gaps(
        contract_events,
        bpm=bpm,
        minimum_gap_beats=minimum_note_beats,
    )
    if gap_fill_count:
        actions.append(f"event_contract_subdivision_gap_absorbed_{gap_fill_count}")
    contract_events = gap_filled_events
    contract_events, rhythm_quantized_count = _retime_events_to_registration_grid(
        contract_events,
        bpm=bpm,
        rhythm_grid_beats=minimum_note_beats,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if rhythm_quantized_count:
        actions.append(f"event_contract_rhythm_grid_quantized_{rhythm_quantized_count}")

    shared_key_signature = _shared_key_signature(contract_events)
    annotated_events = annotate_track_events_for_slot(
        contract_events,
        slot_id=slot_id,
        key_signature=shared_key_signature,
    )
    pitch_register = pitch_register_for_slot(slot_id)
    pitch_label_octave_shift = pitch_label_octave_shift_for_slot(slot_id)
    key_signature = shared_key_signature or _shared_key_signature(annotated_events) or "C"
    spelling_mode = "flat" if KEY_FIFTHS.get(key_signature, 0) < 0 else "sharp"
    beat_seconds = seconds_per_beat(max(1, bpm))

    enforced: list[TrackPitchEvent] = []
    changed_count = 0
    for event in annotated_events:
        beat = quantize_beat_to_rhythm_grid(event.beat, minimum_note_beats)
        duration_beats = quantize_duration_to_rhythm_grid(event.duration_beats, minimum_note_beats)
        pitch_midi = _resolve_pitch_midi(event)
        spelled_label = event.spelled_label
        accidental = event.accidental
        label = event.label
        if not event.is_rest and pitch_midi is not None:
            spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
            accidental = accidental_for_key(spelled_label, key_signature)
            label = spelled_label

        update = {
            "pitch_midi": pitch_midi,
            "pitch_hz": midi_to_frequency(pitch_midi) if pitch_midi is not None else None,
            "label": label,
            "spelled_label": spelled_label,
            "accidental": accidental,
            "pitch_register": pitch_register,
            "key_signature": key_signature,
            "pitch_label_octave_shift": pitch_label_octave_shift,
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
        if any(getattr(event, key) != value for key, value in update.items()):
            changed_count += 1
        enforced.append(event.model_copy(update=update))

    if changed_count:
        actions.append(f"event_contract_enforced_{changed_count}")
    return enforced, actions, _event_contract_diagnostics(
        enforced,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _shared_key_signature(events: list[TrackPitchEvent]) -> str | None:
    key_counts = Counter(event.key_signature for event in events if event.key_signature in KEY_FIFTHS)
    if not key_counts:
        return None
    return key_counts.most_common(1)[0][0]


def _event_identity(events: list[TrackPitchEvent]) -> list[tuple[str, int | None, float, float]]:
    return [
        (
            event.id,
            event.pitch_midi,
            round(event.beat, 4),
            round(event.duration_beats, 4),
        )
        for event in events
    ]


def _event_contract_diagnostics(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    minimum_note_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    if not events:
        return {
            "version": "event_contract_v1",
            "event_count": 0,
            "minimum_note_beats": minimum_note_beats,
            "rhythm_grid_beats": minimum_note_beats,
            "rhythm_grid_aligned": True,
            "rhythm_gaps_aligned": True,
            "non_overlapping": True,
            "single_voice_index": True,
            "single_key_signature": True,
            "seconds_follow_beat_grid": True,
            "measure_metadata_consistent": True,
            "pitch_register_policy_consistent": True,
        }

    voice_indices = {event.voice_index for event in events}
    key_signatures = {event.key_signature for event in events}
    pitch_registers = {event.pitch_register for event in events}
    beat_seconds = seconds_per_beat(max(1, bpm))
    expected_pitch_register = pitch_register_for_slot(slot_id)
    ordered_events = sorted(events, key=lambda event: (event.beat, event.id))
    gaps = [
        round(right.beat - (left.beat + left.duration_beats), 4)
        for left, right in zip(ordered_events, ordered_events[1:], strict=False)
        if right.beat - (left.beat + left.duration_beats) > 0.0001
    ]
    rhythm_grid_aligned = all(
        is_on_rhythm_grid(event.beat, minimum_note_beats)
        and is_on_rhythm_grid(event.duration_beats, minimum_note_beats)
        for event in events
    )
    rhythm_gaps_aligned = all(is_on_rhythm_grid(gap, minimum_note_beats) for gap in gaps)
    non_overlapping = all(
        right.beat >= left.beat + left.duration_beats - 0.0001
        for left, right in zip(ordered_events, ordered_events[1:], strict=False)
    )
    seconds_follow_beat_grid = all(
        abs(event.onset_seconds - round(max(0, (event.beat - 1) * beat_seconds), 4)) <= 0.0001
        and abs(event.duration_seconds - round(event.duration_beats * beat_seconds, 4)) <= 0.0001
        for event in events
    )
    measure_metadata_consistent = all(
        event.measure_index == measure_index_from_beat(
            event.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        and abs(
            (event.beat_in_measure or 0)
            - round(
                beat_in_measure_from_beat(
                    event.beat,
                    time_signature_numerator,
                    time_signature_denominator,
                ),
                4,
            )
        )
        <= 0.0001
        for event in events
    )
    return {
        "version": "event_contract_v1",
        "event_count": len(events),
        "minimum_note_beats": minimum_note_beats,
        "rhythm_grid_beats": minimum_note_beats,
        "rhythm_grid_aligned": rhythm_grid_aligned,
        "rhythm_gaps_aligned": rhythm_gaps_aligned,
        "non_overlapping": non_overlapping,
        "single_voice_index": len(voice_indices) == 1 and slot_id in voice_indices,
        "single_key_signature": len(key_signatures) == 1 and None not in key_signatures,
        "seconds_follow_beat_grid": seconds_follow_beat_grid,
        "measure_metadata_consistent": measure_metadata_consistent,
        "pitch_register_policy_consistent": pitch_registers == {expected_pitch_register},
        "voice_index": next(iter(voice_indices)) if len(voice_indices) == 1 else None,
        "key_signature": next(iter(key_signatures)) if len(key_signatures) == 1 else None,
        "pitch_register": next(iter(pitch_registers)) if len(pitch_registers) == 1 else None,
    }


def _align_to_reference_tracks(
    events: list[TrackPitchEvent],
    reference_tracks: list[list[TrackPitchEvent]],
    *,
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    base_result: dict[str, Any] = {
        "events": events,
        "evaluated": False,
        "applied": False,
        "offset_beats": 0.0,
        "zero_score": None,
        "best_score": None,
        "matched_event_count": 0,
        "reference_event_count": 0,
        "candidate_event_count": len([event for event in events if not event.is_rest]),
        "reason": "not_evaluated",
    }
    if not _is_reference_alignable(source_kind, events):
        return {**base_result, "reason": "source_not_reference_alignable"}

    reference_events = [
        event
        for track_events in reference_tracks
        for event in track_events
        if not event.is_rest
    ]
    candidate_events = [event for event in events if not event.is_rest]
    base_result["reference_event_count"] = len(reference_events)
    if len(candidate_events) < REFERENCE_ALIGNMENT_MIN_EVENTS:
        return {**base_result, "reason": "too_few_candidate_events"}
    if len(reference_events) < REFERENCE_ALIGNMENT_MIN_EVENTS:
        return {**base_result, "reason": "too_few_reference_events"}

    reference_beats = sorted({round(event.beat, 4) for event in reference_events})
    candidate_beats = [round(event.beat, 4) for event in candidate_events]
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
        "matched_event_count": best_matches,
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

    shifted_events = _shift_events_to_reference_grid(
        events,
        offset_beats=best_offset,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return {
        **evaluation,
        "events": shifted_events,
        "applied": True,
        "reason": "applied_reference_grid_alignment",
    }


def _is_reference_alignable(source_kind: SourceKind, events: list[TrackPitchEvent]) -> bool:
    if source_kind in VOICE_LIKE_SOURCE_KINDS:
        return True
    return any(event.source in {"voice", "recording", "audio", "document"} for event in events)


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


def _shift_events_to_reference_grid(
    events: list[TrackPitchEvent],
    *,
    offset_beats: float,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackPitchEvent]:
    beat_seconds = seconds_per_beat(max(1, bpm))
    shifted: list[TrackPitchEvent] = []
    for event in events:
        beat = round(max(1.0, event.beat + offset_beats), 4)
        shifted.append(
            event.model_copy(
                update={
                    "beat": beat,
                    "onset_seconds": round(max(0, (beat - 1) * beat_seconds), 4),
                    "duration_seconds": round(event.duration_beats * beat_seconds, 4),
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
                    "quality_warnings": _append_warning(
                        event.quality_warnings,
                        "reference_grid_aligned",
                    ),
                }
            )
        )
    if _has_measure_crossing_events(
        shifted,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    ):
        quantization_grid = min(
            (
                event.quantization_grid
                for event in shifted
                if event.quantization_grid is not None and event.quantization_grid > 0
            ),
            default=REFERENCE_ALIGNMENT_GRID_BEATS,
        )
        shifted = normalize_track_events(
            shifted,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=quantization_grid,
            merge_adjacent_same_pitch=False,
        )
        shifted = [
            event.model_copy(
                update={
                    "quality_warnings": _append_warning(
                        event.quality_warnings,
                        "reference_grid_aligned",
                    )
                }
            )
            for event in shifted
        ]
    return _deduplicate_and_sort(shifted)


def _has_measure_crossing_events(
    events: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> bool:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    for event in events:
        if event.duration_beats <= 0:
            return True
        measure_index = event.measure_index or measure_index_from_beat(
            event.beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        measure_end = 1 + measure_index * beats_per_measure
        if event.beat + event.duration_beats > measure_end + 0.001:
            return True
    return False


def _deduplicate_and_sort(events: list[TrackPitchEvent]) -> list[TrackPitchEvent]:
    selected: dict[tuple[float, float, int | None, bool], TrackPitchEvent] = {}
    for event in events:
        key = (
            round(event.beat, 4),
            round(event.duration_beats, 4),
            _resolve_pitch_midi(event),
            event.is_rest,
        )
        current = selected.get(key)
        if current is None or _event_weight(event) > _event_weight(current):
            selected[key] = event
    return sorted(selected.values(), key=lambda event: (event.beat, event.is_rest, event.pitch_midi or -1, event.id))


def _registration_diagnostics(
    events: list[TrackPitchEvent],
    *,
    slot_id: int,
    original_count: int,
    source_kind: SourceKind,
    time_signature_numerator: int,
    time_signature_denominator: int,
    actions: list[str],
) -> dict[str, Any]:
    pitched_events = [event for event in events if not event.is_rest and _resolve_pitch_midi(event) is not None]
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    in_range_count = sum(1 for event in pitched_events if low <= (_resolve_pitch_midi(event) or 0) <= high)
    rhythm_grid_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    grid_events = [
        event
        for event in events
        if is_on_rhythm_grid(event.beat, rhythm_grid_beats)
        and is_on_rhythm_grid(event.duration_beats, rhythm_grid_beats)
    ]
    measure_groups = _events_by_measure(events)
    max_events_per_measure = max((sum(1 for event in group if not event.is_rest) for group in measure_groups.values()), default=0)
    cross_measure_count = sum(
        1
        for event in events
        if _has_measure_crossing_events(
            [event],
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    )
    isolated_short_event_count = count_isolated_short_voice_artifacts(events)
    short_phrase_gap_count = count_short_voice_phrase_gaps(events)
    measure_tail_gap_count = count_measure_tail_gaps(
        events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    short_event_cluster_count = count_short_event_clusters(
        events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return {
        "registration_quality_version": "event_registration_v1",
        "source_kind": source_kind,
        "slot_id": slot_id,
        "original_event_count": original_count,
        "registered_event_count": len(events),
        "pitched_event_count": len(pitched_events),
        "measure_count": len(measure_groups),
        "max_events_per_measure": max_events_per_measure,
        "rhythm_grid_beats": rhythm_grid_beats,
        "range_fit_ratio": round(in_range_count / len(pitched_events), 4) if pitched_events else 1.0,
        "timing_grid_ratio": round(len(grid_events) / len(events), 4) if events else 1.0,
        "rhythmic_grid_ratio": round(len(grid_events) / len(events), 4) if events else 1.0,
        "cross_measure_event_count": cross_measure_count,
        "isolated_short_event_count": isolated_short_event_count,
        "short_phrase_gap_count": short_phrase_gap_count,
        "measure_tail_gap_count": measure_tail_gap_count,
        "short_event_cluster_count": short_event_cluster_count,
        "has_pitch_register_policy": all(event.pitch_register for event in events),
        "has_key_policy": all(event.key_signature for event in events),
        "actions": actions,
    }


def _attach_quality_warnings(events: list[TrackPitchEvent], diagnostics: dict[str, Any]) -> list[TrackPitchEvent]:
    warnings: list[str] = []
    if "range_fit_ratio" not in diagnostics:
        return events
    if diagnostics["range_fit_ratio"] < 0.8:
        warnings.append("registration_range_review")
    if diagnostics["timing_grid_ratio"] < 0.92:
        warnings.append("registration_grid_review")
    if diagnostics["cross_measure_event_count"] > 0:
        warnings.append("registration_measure_boundary_review")
    if diagnostics["isolated_short_event_count"] > 0:
        warnings.append("registration_isolated_artifact_review")
    if diagnostics["short_phrase_gap_count"] > 0:
        warnings.append("registration_phrase_gap_review")
    if diagnostics["measure_tail_gap_count"] > 0:
        warnings.append("registration_measure_tail_review")
    if diagnostics["short_event_cluster_count"] > 0:
        warnings.append("registration_short_cluster_review")
    if not warnings:
        return events
    return [
        event.model_copy(update={"quality_warnings": _append_warning(event.quality_warnings, *warnings)})
        for event in events
    ]


def _events_by_measure(events: list[TrackPitchEvent]) -> dict[int, list[TrackPitchEvent]]:
    groups: dict[int, list[TrackPitchEvent]] = defaultdict(list)
    for event in events:
        measure_index = event.measure_index or 1
        groups[measure_index].append(event)
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


def _event_weight(event: TrackPitchEvent) -> float:
    return max(0.05, event.duration_beats) * max(0.1, event.confidence)


def _resolve_pitch_midi(event: TrackPitchEvent) -> int | None:
    if event.pitch_midi is not None:
        return int(round(event.pitch_midi))
    if event.is_rest:
        return None
    return label_to_midi(event.label)


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
            "suppress_unstable_events" in instruction,
            "sustain_repeated_events" in instruction,
            "collapse_pitch_blips" in instruction,
            "remove_isolated_artifacts" in instruction,
            "bridge_short_phrase_gaps" in instruction,
            "bridge_measure_tail_gaps" in instruction,
            "collapse_short_event_clusters" in instruction,
            _instruction_key_signature(instruction) is not None,
            bool(instruction.get("measure_noise_indices")),
        ]
    )


def _should_simplify_after_review(
    events: list[TrackPitchEvent],
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
        events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _force_key_signature(events: list[TrackPitchEvent], *, slot_id: int, key_signature: str) -> list[TrackPitchEvent]:
    spelling_mode = "flat" if KEY_FIFTHS.get(key_signature, 0) < 0 else "sharp"
    pitch_register = pitch_register_for_slot(slot_id)
    pitch_label_octave_shift = pitch_label_octave_shift_for_slot(slot_id)
    forced: list[TrackPitchEvent] = []
    for event in events:
        pitch_midi = _resolve_pitch_midi(event)
        spelled_label = event.spelled_label
        accidental = event.accidental
        if not event.is_rest and pitch_midi is not None:
            spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
            accidental = accidental_for_key(spelled_label, key_signature)
        forced.append(
            event.model_copy(
                update={
                    "pitch_midi": pitch_midi,
                    "spelled_label": spelled_label,
                    "accidental": accidental,
                    "pitch_register": pitch_register,
                    "key_signature": key_signature,
                    "pitch_label_octave_shift": pitch_label_octave_shift,
                }
            )
        )
    return forced


def _with_llm_review_diagnostics(
    result: RegistrationQualityResult,
    instruction: Mapping[str, Any],
    *,
    applied: bool,
    reason: str,
) -> RegistrationQualityResult:
    diagnostics = dict(result.diagnostics)
    diagnostics["llm_registration_review"] = {
        "applied": applied,
        "skipped_reason": reason,
        "confidence": _instruction_confidence(instruction),
        "instruction": _public_review_instruction(instruction),
    }
    actions = list(diagnostics.get("actions", []))
    skip_action = f"llm_registration_review_skipped_{reason}"
    if skip_action not in actions:
        actions.append(skip_action)
    diagnostics["actions"] = actions
    return RegistrationQualityResult(events=result.events, diagnostics=diagnostics)


def _public_review_instruction(instruction: Mapping[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "confidence",
        "quantization_grid",
        "merge_adjacent_same_pitch",
        "simplify_dense_measures",
        "suppress_unstable_events",
        "sustain_repeated_events",
        "collapse_pitch_blips",
        "remove_isolated_artifacts",
        "bridge_short_phrase_gaps",
        "bridge_measure_tail_gaps",
        "collapse_short_event_clusters",
        "prefer_key_signature",
        "measure_noise_indices",
        "reasons",
        "warnings",
        "provider",
        "model",
        "used",
    }
    return {key: value for key, value in instruction.items() if key in allowed_keys}
