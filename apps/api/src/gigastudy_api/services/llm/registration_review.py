from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from gigastudy_api.api.schemas.studios import SourceKind
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.music_theory import label_to_midi, quarter_beats_per_measure, track_name
from gigastudy_api.services.engine.event_normalization import KEY_FIFTHS, normalize_track_events
from gigastudy_api.services.engine.event_quality import (
    count_isolated_short_voice_artifacts,
    count_measure_tail_gaps,
    count_short_note_clusters,
    count_short_voice_phrase_gaps,
)
from gigastudy_api.services.llm.deepseek import (
    _build_json_chat_payload,
    _chat_completion_headers,
    _chat_completion_provider,
    _loads_json_object,
)

LOGGER = logging.getLogger(__name__)

AllowedReviewGrid = Literal[0.25, 0.5]
AllowedKeySignature = Literal["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"]


class RegistrationReviewInstruction(BaseModel):
    """Bounded registration cleanup plan returned by the LLM.

    The LLM is intentionally not allowed to write pitch-event records. It may only pick
    small, deterministic post-processing directives that the local registration
    engine can validate and apply before the notes become pitch events.
    """

    model_config = ConfigDict(extra="ignore")

    confidence: float = Field(default=0, ge=0, le=1)
    quantization_grid: AllowedReviewGrid | None = None
    merge_adjacent_same_pitch: bool | None = None
    simplify_dense_measures: bool | None = None
    suppress_unstable_notes: bool | None = None
    sustain_repeated_notes: bool | None = None
    collapse_pitch_blips: bool | None = None
    remove_isolated_artifacts: bool | None = None
    bridge_short_phrase_gaps: bool | None = None
    bridge_measure_tail_gaps: bool | None = None
    collapse_short_note_clusters: bool | None = None
    prefer_key_signature: AllowedKeySignature | None = None
    measure_noise_indices: list[int] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    used: bool = False

    @field_validator("measure_noise_indices", mode="before")
    @classmethod
    def _clean_measure_indices(cls, value: Any) -> list[int]:
        if not isinstance(value, list):
            return []
        cleaned: list[int] = []
        for item in value[:16]:
            try:
                index = int(item)
            except (TypeError, ValueError):
                continue
            if index > 0 and index not in cleaned:
                cleaned.append(index)
        return cleaned

    @field_validator("quantization_grid", mode="before")
    @classmethod
    def _clean_quantization_grid(cls, value: Any) -> AllowedReviewGrid | None:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"", "null", "none"}:
                return None
            try:
                value = float(normalized)
            except ValueError:
                return value
        if value == 0.25:
            return 0.25
        if value == 0.5:
            return 0.5
        return value

    @field_validator("reasons", "warnings", mode="before")
    @classmethod
    def _clean_text_list(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        cleaned: list[str] = []
        for item in value[:8]:
            text = str(item).strip()
            if text:
                cleaned.append(text[:180])
        return cleaned

    def has_repair_directive(self) -> bool:
        return any(
            [
                self.quantization_grid is not None,
                self.merge_adjacent_same_pitch is not None,
                self.simplify_dense_measures is not None,
                self.suppress_unstable_notes is not None,
                self.sustain_repeated_notes is not None,
                self.collapse_pitch_blips is not None,
                self.remove_isolated_artifacts is not None,
                self.bridge_short_phrase_gaps is not None,
                self.bridge_measure_tail_gaps is not None,
                self.collapse_short_note_clusters is not None,
                self.prefer_key_signature is not None,
                bool(self.measure_noise_indices),
            ]
        )


def review_track_registration_with_deepseek(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    slot_id: int,
    source_kind: SourceKind,
    original_events: list[TrackPitchEvent],
    prepared_events: list[TrackPitchEvent],
    diagnostics: dict[str, Any],
    context_tracks_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
) -> RegistrationReviewInstruction | None:
    if not settings.deepseek_registration_review_enabled or not settings.deepseek_api_key:
        return None
    if not original_events and not prepared_events:
        return None

    endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
    request_body = _build_registration_review_payload(
        settings=settings,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        slot_id=slot_id,
        source_kind=source_kind,
        original_events=original_events,
        prepared_events=prepared_events,
        diagnostics=diagnostics,
        review_scope="single_track_registration_plan",
        context_tracks_by_slot=context_tracks_by_slot,
    )

    last_error: Exception | None = None
    for attempt_index in range(max(1, settings.deepseek_max_retries + 1)):
        try:
            instruction = _request_registration_instruction(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            if not instruction.has_repair_directive():
                return None
            return instruction
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if attempt_index >= settings.deepseek_max_retries:
                break

    LOGGER.warning("DeepSeek registration review failed; keeping deterministic registration result: %s", last_error)
    return None


def review_ensemble_registration_with_deepseek(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    slot_id: int,
    source_kind: SourceKind,
    original_events: list[TrackPitchEvent],
    prepared_events: list[TrackPitchEvent],
    diagnostics: dict[str, Any],
    context_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    proposed_tracks_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
) -> RegistrationReviewInstruction | None:
    if not settings.deepseek_ensemble_review_enabled or not settings.deepseek_api_key:
        return None
    if not prepared_events:
        return None
    if not context_tracks_by_slot and not proposed_tracks_by_slot:
        return None

    endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
    request_body = _build_registration_review_payload(
        settings=settings,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        slot_id=slot_id,
        source_kind=source_kind,
        original_events=original_events,
        prepared_events=prepared_events,
        diagnostics=diagnostics,
        review_scope="a_cappella_ensemble_registration",
        context_tracks_by_slot=context_tracks_by_slot,
        proposed_tracks_by_slot=proposed_tracks_by_slot,
    )

    last_error: Exception | None = None
    for attempt_index in range(max(1, settings.deepseek_max_retries + 1)):
        try:
            instruction = _request_registration_instruction(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            if not instruction.has_repair_directive():
                return None
            return instruction
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if attempt_index >= settings.deepseek_max_retries:
                break

    LOGGER.warning("DeepSeek ensemble review failed; keeping deterministic arrangement result: %s", last_error)
    return None


def _request_registration_instruction(
    *,
    endpoint: str,
    settings: Settings,
    request_body: dict[str, Any],
) -> RegistrationReviewInstruction:
    payload = json.dumps(request_body).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        method="POST",
        headers=_chat_completion_headers(settings),
    )
    with urlopen(request, timeout=settings.deepseek_timeout_seconds) as response:
        response_payload = json.loads(response.read().decode("utf-8"))
    return _parse_deepseek_registration_response(
        response_payload,
        model=settings.deepseek_model,
        provider=_chat_completion_provider(settings),
    )


def _build_registration_review_payload(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    slot_id: int,
    source_kind: SourceKind,
    original_events: list[TrackPitchEvent],
    prepared_events: list[TrackPitchEvent],
    diagnostics: dict[str, Any],
    review_scope: str = "single_track_registration_plan",
    context_tracks_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
    proposed_tracks_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
) -> dict[str, Any]:
    review_checklist = [
        "BPM and time signature are immutable.",
        "Plan registration cleanup before final commit; the deterministic engine will apply and validate the plan.",
        "Find unnatural event density, fragmented timing, excessive accidentals, and noise-like micro events.",
        "Prefer 0.25-beat grid for expressive but readable singing, 0.5-beat grid for noisy or too-dense input.",
        "Prefer sustain/merge for repeated same-pitch fragments that look like one held vocal tone.",
        "Use collapse_pitch_blips when a short neighbor tone is likely vibrato, scoop, or tracker jitter rather than melody.",
        "Use remove_isolated_artifacts when short low-confidence notes are separated from surrounding sung material.",
        "Use bridge_short_phrase_gaps when tiny detector dropouts split otherwise connected sung phrases.",
        "Use bridge_measure_tail_gaps when a confident sung note ends just before a barline and the phrase continues after it.",
        "Use collapse_short_note_clusters when several low-confidence sixteenth notes in one beat look like pitch-tracker chatter.",
        "Suggest a key signature only when it reduces accidental clutter.",
        "For symbolic document imports, avoid rhythm rewrites unless the extracted events clearly look like noise.",
    ]
    if review_scope == "single_track_registration_plan":
        review_checklist.extend(
            [
                "Use sibling-track context when available to choose cleanup direction, key spelling, octave warnings, and readability risk.",
                "Do not copy sibling rhythms into the target; only align unreadable extracted material to the fixed studio BPM/meter grid.",
                "If sibling context is absent, enforce standalone track event quality without inventing ensemble assumptions.",
            ]
        )
    if review_scope == "a_cappella_ensemble_registration":
        review_checklist.extend(
            [
                "Review this target as one part inside a six-track a cappella region arrangement, not as an isolated solo line.",
                "Use sibling-track context to detect likely extraction octave errors, awkward density, or event choices that make the ensemble hard to follow.",
                "Do not request a repair for intentional unison, open spacing, counterpoint, syncopation, or dissonance unless it also looks like extraction noise.",
                "Prefer no repair directive when the deterministic ensemble diagnostics are warnings about plausible artistic choices.",
            ]
        )
    context = {
        "product_rule": (
            "The LLM must not generate pitch-event arrays or change BPM/meter. "
            "It may only choose bounded registration-plan directives for the deterministic region-event engine."
        ),
        "review_scope": review_scope,
        "studio": {
            "title": title,
            "bpm_is_absolute": True,
            "bpm": bpm,
            "time_signature": f"{time_signature_numerator}/{time_signature_denominator}",
        },
        "target_track": {
            "slot_id": slot_id,
            "name": track_name(slot_id),
        },
        "source_kind": source_kind,
        "allowed_quantization_grids": [0.25, 0.5],
        "allowed_key_signatures": sorted(KEY_FIFTHS, key=lambda key: KEY_FIFTHS[key]),
        "current_diagnostics": diagnostics,
        "original_summary": _summarize_notes(
            original_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "prepared_summary": _summarize_notes(
            prepared_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "deterministic_quality_options": _build_quality_options(
            original_events=original_events,
            prepared_events=prepared_events,
            bpm=bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "ensemble_context": _build_ensemble_context(
            context_tracks_by_slot=context_tracks_by_slot or {},
            proposed_tracks_by_slot=proposed_tracks_by_slot or {},
            target_slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "review_checklist": review_checklist,
        "required_json_shape": {
            "confidence": 0.0,
            "quantization_grid": "0.25|0.5|null",
            "merge_adjacent_same_pitch": "true|false|null",
            "simplify_dense_measures": "true|false|null",
            "suppress_unstable_notes": "true|false|null",
            "sustain_repeated_notes": "true|false|null",
            "collapse_pitch_blips": "true|false|null",
            "remove_isolated_artifacts": "true|false|null",
            "bridge_short_phrase_gaps": "true|false|null",
            "bridge_measure_tail_gaps": "true|false|null",
            "collapse_short_note_clusters": "true|false|null",
            "prefer_key_signature": "Cb|Gb|Db|Ab|Eb|Bb|F|C|G|D|A|E|B|F#|C#|null",
            "measure_noise_indices": [1],
            "reasons": ["Korean short reason"],
            "warnings": ["Korean short caution"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are GigaStudy's region-event registration reviewer. Return JSON only. "
                "You plan whether extracted material will become stable pitch events at registration time, then choose "
                "bounded repair directives for the deterministic engine. Never output notes, melodies, markdown, or prose. "
                "Do not change BPM or meter. Write reasons and warnings in Korean."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        },
    ]
    return _build_json_chat_payload(settings=settings, messages=messages)


def _parse_deepseek_registration_response(
    payload: dict[str, Any],
    *,
    model: str,
    provider: str,
) -> RegistrationReviewInstruction:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response did not include choices.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("DeepSeek response content was empty.")
    decoded = _loads_json_object(content)
    instruction = RegistrationReviewInstruction.model_validate(decoded)
    instruction.provider = provider
    instruction.model = model
    instruction.used = True
    return instruction


def _build_ensemble_context(
    *,
    context_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    proposed_tracks_by_slot: dict[int, list[TrackPitchEvent]],
    target_slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    if not context_tracks_by_slot and not proposed_tracks_by_slot:
        return {"available": False}
    context_summaries = [
        _slot_summary(
            slot_id,
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        for slot_id, notes in sorted(context_tracks_by_slot.items())
        if slot_id != target_slot_id and notes
    ]
    proposed_summaries = [
        _slot_summary(
            slot_id,
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
        for slot_id, notes in sorted(proposed_tracks_by_slot.items())
        if notes
    ]
    return {
        "available": True,
        "target_slot_id": target_slot_id,
        "registered_or_reference_tracks": context_summaries,
        "proposed_batch_tracks": proposed_summaries,
        "vertical_snapshots": _vertical_snapshots(
            {
                **context_tracks_by_slot,
                **proposed_tracks_by_slot,
            },
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
    }


def _slot_summary(
    slot_id: int,
    notes: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    summary = _summarize_notes(
        notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    return {
        "slot_id": slot_id,
        "name": track_name(slot_id),
        **summary,
    }


def _vertical_snapshots(
    tracks_by_slot: dict[int, list[TrackPitchEvent]],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    beats = sorted(
        {
            round(note.beat, 4)
            for notes in tracks_by_slot.values()
            for note in notes
            if not note.is_rest and _resolve_pitch_midi(note) is not None
        }
    )
    snapshots: list[dict[str, Any]] = []
    for beat in beats[:96]:
        active: list[dict[str, Any]] = []
        for slot_id, notes in sorted(tracks_by_slot.items()):
            note = _active_note_at(notes, beat)
            if note is None:
                continue
            active.append(
                {
                    "slot_id": slot_id,
                    "name": track_name(slot_id),
                    "label": note.spelled_label or note.label,
                    "pitch_midi": _resolve_pitch_midi(note),
                }
            )
        if len(active) >= 2:
            snapshots.append(
                {
                    "beat": beat,
                    "measure": int((max(beat, 1) - 1) // quarter_beats_per_measure(
                        time_signature_numerator,
                        time_signature_denominator,
                    ))
                    + 1,
                    "active": active,
                }
            )
    return snapshots[:48]


def _active_note_at(notes: list[TrackPitchEvent], beat: float) -> TrackPitchEvent | None:
    candidates = [
        note
        for note in notes
        if not note.is_rest
        and _resolve_pitch_midi(note) is not None
        and note.beat <= beat + 0.001
        and beat < note.beat + max(0.001, note.duration_beats) - 0.001
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda note: (note.confidence, note.duration_beats))


def _summarize_notes(
    notes: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    pitched_notes = [note for note in notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
    pitches = [_resolve_pitch_midi(note) for note in pitched_notes]
    durations = [round(note.duration_beats, 4) for note in notes]
    accidentals = sum(1 for note in notes if note.accidental)
    ties = sum(1 for note in notes if note.is_tied)
    low_confidence = sum(1 for note in notes if note.confidence < 0.45)
    return {
        "event_count": len(notes),
        "pitched_event_count": len(pitched_notes),
        "rest_event_count": len(notes) - len(pitched_notes),
        "range_midi": _range_label([pitch for pitch in pitches if pitch is not None]),
        "duration_values": sorted(set(durations))[:12],
        "accidental_count": accidentals,
        "tie_count": ties,
        "low_confidence_count": low_confidence,
        "isolated_short_event_count": count_isolated_short_voice_artifacts(notes),
        "short_phrase_gap_count": count_short_voice_phrase_gaps(notes),
        "measure_tail_gap_count": count_measure_tail_gaps(
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "short_note_cluster_count": count_short_note_clusters(
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "measure_summaries": _summarize_measures(
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
    }


def _build_quality_options(
    *,
    original_events: list[TrackPitchEvent],
    prepared_events: list[TrackPitchEvent],
    bpm: int,
    slot_id: int,
    source_kind: SourceKind,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    options = [
        _quality_option_summary(
            "current_prepared_result",
            prepared_events,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        )
    ]
    if source_kind in {"recording", "audio", "music", "ai"} and original_events:
        coarse_notes = normalize_track_events(
            original_events,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=0.5,
            merge_adjacent_same_pitch=True,
        )
        options.append(
            _quality_option_summary(
                "coarse_0_5_beat_grid_candidate",
                coarse_notes,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
        )
    return options


def _quality_option_summary(
    option_name: str,
    notes: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> dict[str, Any]:
    pitched_notes = [note for note in notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
    measure_summaries = _summarize_measures(
        notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    max_events_per_measure = max((summary["pitched_event_count"] for summary in measure_summaries), default=0)
    return {
        "option": option_name,
        "event_count": len(notes),
        "pitched_event_count": len(pitched_notes),
        "max_events_per_measure": max_events_per_measure,
        "short_note_ratio": round(
            sum(1 for note in pitched_notes if note.duration_beats <= 0.25) / len(pitched_notes),
            4,
        )
        if pitched_notes
        else 0,
        "tie_count": sum(1 for note in notes if note.is_tied),
        "accidental_count": sum(1 for note in notes if note.accidental),
        "isolated_short_event_count": count_isolated_short_voice_artifacts(notes),
        "short_phrase_gap_count": count_short_voice_phrase_gaps(notes),
        "measure_tail_gap_count": count_measure_tail_gaps(
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "short_note_cluster_count": count_short_note_clusters(
            notes,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "duration_values": sorted({round(note.duration_beats, 4) for note in notes})[:12],
    }


def _summarize_measures(
    notes: list[TrackPitchEvent],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    groups: dict[int, list[TrackPitchEvent]] = defaultdict(list)
    for note in notes:
        measure_index = note.measure_index
        if measure_index is None:
            measure_index = int((max(note.beat, 1.0) - 1) // beats_per_measure) + 1
        groups[measure_index].append(note)

    summaries: list[dict[str, Any]] = []
    for measure_index in sorted(groups)[:32]:
        measure_notes = groups[measure_index]
        pitched = [note for note in measure_notes if not note.is_rest and _resolve_pitch_midi(note) is not None]
        summaries.append(
            {
                "measure_index": measure_index,
                "event_count": len(measure_notes),
                "pitched_event_count": len(pitched),
                "rest_event_count": len(measure_notes) - len(pitched),
                "shortest_duration": min((round(note.duration_beats, 4) for note in measure_notes), default=0),
                "low_confidence_count": sum(1 for note in measure_notes if note.confidence < 0.45),
                "tie_count": sum(1 for note in measure_notes if note.is_tied),
                "accidental_count": sum(1 for note in measure_notes if note.accidental),
                "events": [
                    {
                        "beat": round(note.beat, 4),
                        "beat_in_measure": note.beat_in_measure,
                        "duration": round(note.duration_beats, 4),
                        "label": note.spelled_label or note.label,
                        "confidence": round(note.confidence, 3),
                    }
                    for note in measure_notes[:16]
                ],
            }
        )
    return summaries


def _range_label(pitches: list[int]) -> str:
    if not pitches:
        return "-"
    return f"{min(pitches)}-{max(pitches)}"


def _resolve_pitch_midi(note: TrackPitchEvent) -> int | None:
    if note.pitch_midi is not None:
        return int(round(note.pitch_midi))
    if note.is_rest:
        return None
    return label_to_midi(note.label)
