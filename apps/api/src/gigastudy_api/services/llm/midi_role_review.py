from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from gigastudy_api.config import Settings
from gigastudy_api.services.engine.music_theory import track_name
from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    ParsedTrack,
    rebuild_mapped_events_from_track_slots,
)
from gigastudy_api.services.llm.deepseek import (
    _build_json_chat_payload,
    _chat_completion_headers,
    _chat_completion_provider,
    _loads_json_object,
)

LOGGER = logging.getLogger(__name__)

MIDI_ROLE_REVIEW_MIN_CONFIDENCE = 0.6
MIDI_ROLE_REVIEW_MAX_TRACKS = 12
MIDI_ROLE_REVIEW_EVENT_SAMPLE_LIMIT = 24


class MidiRoleAssignment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_track_index: int = Field(ge=1)
    midi_channels: list[int] = Field(default_factory=list)
    assigned_slot_id: int = Field(ge=1, le=6)
    review_required: bool = False
    reason: str | None = None

    @field_validator("midi_channels", mode="before")
    @classmethod
    def _clean_channels(cls, value: Any) -> list[int]:
        if not isinstance(value, list):
            return []
        cleaned: list[int] = []
        for item in value[:4]:
            try:
                channel = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= channel <= 16 and channel not in cleaned:
                cleaned.append(channel)
        return cleaned

    @field_validator("reason", mode="before")
    @classmethod
    def _clean_reason(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text[:180] if text else None


class MidiRoleReviewInstruction(BaseModel):
    """Bounded MIDI role assignment review returned by the LLM.

    The model may only choose visible slots and review flags for existing MIDI
    parts. It cannot author pitch events, change BPM/meter, or create tracks.
    """

    model_config = ConfigDict(extra="ignore")

    confidence: float = Field(default=0, ge=0, le=1)
    assignments: list[MidiRoleAssignment] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    used: bool = False

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


def review_midi_roles_with_deepseek(
    *,
    settings: Settings,
    title: str,
    source_label: str,
    parsed_symbolic: ParsedSymbolicFile,
) -> MidiRoleReviewInstruction | None:
    if not settings.deepseek_midi_role_review_enabled or not settings.deepseek_api_key:
        return None
    if not _should_review_midi_roles(parsed_symbolic):
        return None

    endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
    request_body = _build_midi_role_review_payload(
        settings=settings,
        title=title,
        source_label=source_label,
        parsed_symbolic=parsed_symbolic,
    )

    last_error: Exception | None = None
    for attempt_index in range(max(1, settings.deepseek_max_retries + 1)):
        try:
            instruction = _request_midi_role_instruction(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            if instruction.confidence < MIDI_ROLE_REVIEW_MIN_CONFIDENCE or not instruction.assignments:
                return None
            return instruction
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if attempt_index >= settings.deepseek_max_retries:
                break

    LOGGER.warning("DeepSeek MIDI role review failed; keeping deterministic MIDI assignment: %s", last_error)
    return None


def apply_midi_role_review_instruction(
    *,
    parsed_symbolic: ParsedSymbolicFile,
    instruction: MidiRoleReviewInstruction | None,
    bpm: int,
) -> bool:
    if instruction is None or instruction.confidence < MIDI_ROLE_REVIEW_MIN_CONFIDENCE:
        return False

    mapped_tracks = [
        track
        for track in parsed_symbolic.tracks
        if track.events and track.slot_id in parsed_symbolic.mapped_events
    ]
    if not mapped_tracks:
        return False

    track_by_key = {_midi_track_key(track): track for track in mapped_tracks}
    assignment_by_key: dict[tuple[int, tuple[int, ...]], MidiRoleAssignment] = {}
    for assignment in instruction.assignments:
        key = (assignment.source_track_index, tuple(sorted(assignment.midi_channels)))
        if key not in track_by_key:
            return False
        assignment_by_key[key] = assignment

    if set(assignment_by_key) != set(track_by_key):
        return False

    assigned_slots = [assignment.assigned_slot_id for assignment in assignment_by_key.values()]
    if len(assigned_slots) != len(set(assigned_slots)):
        return False

    for key, assignment in assignment_by_key.items():
        track = track_by_key[key]
        track.slot_id = assignment.assigned_slot_id
        track.diagnostics.update(
            {
                "llm_midi_role_review": {
                    "applied": True,
                    "confidence": round(instruction.confidence, 3),
                    "provider": instruction.provider,
                    "model": instruction.model,
                    "reasons": instruction.reasons,
                    "warnings": instruction.warnings,
                    "assigned_slot_id": assignment.assigned_slot_id,
                    "assigned_track_name": track_name(assignment.assigned_slot_id),
                    "reason": assignment.reason,
                },
                "midi_seed_review_required": assignment.review_required,
                "midi_seed_review_reason": assignment.reason if assignment.review_required else None,
            }
        )

    parsed_symbolic.mapped_events = rebuild_mapped_events_from_track_slots(
        parsed_symbolic.tracks,
        bpm=bpm,
        time_signature_numerator=parsed_symbolic.time_signature_numerator,
        time_signature_denominator=parsed_symbolic.time_signature_denominator,
    )
    return True


def _should_review_midi_roles(parsed_symbolic: ParsedSymbolicFile) -> bool:
    mapped_tracks = [
        track
        for track in parsed_symbolic.tracks
        if track.events and track.slot_id in parsed_symbolic.mapped_events
    ]
    if len(mapped_tracks) < 2:
        return False
    if any(track.diagnostics.get("midi_seed_review_required") is True for track in mapped_tracks):
        return True
    if any(track.diagnostics.get("midi_role_inferred_from_register") is True for track in mapped_tracks):
        return True
    assigned_name_slots = [
        track.diagnostics.get("assigned_slot_id")
        for track in mapped_tracks
        if track.diagnostics.get("slot_name_match") is True
    ]
    return len(assigned_name_slots) != len(set(assigned_name_slots))


def _request_midi_role_instruction(
    *,
    endpoint: str,
    settings: Settings,
    request_body: dict[str, Any],
) -> MidiRoleReviewInstruction:
    payload = json.dumps(request_body).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        method="POST",
        headers=_chat_completion_headers(settings),
    )
    with urlopen(request, timeout=settings.deepseek_timeout_seconds) as response:
        response_payload = json.loads(response.read().decode("utf-8"))
    return _parse_deepseek_midi_role_response(
        response_payload,
        model=settings.deepseek_model,
        provider=_chat_completion_provider(settings),
    )


def _parse_deepseek_midi_role_response(
    payload: dict[str, Any],
    *,
    model: str,
    provider: str = "deepseek",
) -> MidiRoleReviewInstruction:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response did not include choices.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("DeepSeek response content was empty.")
    decoded = _loads_json_object(content)
    instruction = MidiRoleReviewInstruction.model_validate(decoded)
    instruction.provider = provider
    instruction.model = model
    instruction.used = True
    return instruction


def _build_midi_role_review_payload(
    *,
    settings: Settings,
    title: str,
    source_label: str,
    parsed_symbolic: ParsedSymbolicFile,
) -> dict[str, Any]:
    mapped_tracks = [
        track
        for track in parsed_symbolic.tracks
        if track.events and track.slot_id in parsed_symbolic.mapped_events
    ][:MIDI_ROLE_REVIEW_MAX_TRACKS]
    context = {
        "review_scope": "midi_singer_role_assignment",
        "studio_title": title,
        "source_label": source_label,
        "time_signature": [
            parsed_symbolic.time_signature_numerator,
            parsed_symbolic.time_signature_denominator,
        ],
        "allowed_slots": [
            {"slot_id": slot_id, "name": track_name(slot_id)}
            for slot_id in range(1, 7)
        ],
        "rules": [
            "Return JSON only.",
            "Do not create, delete, or rewrite pitch events.",
            "Use names, programs, and channel numbers only as hints.",
            "For pitched singer-like parts, prefer relative register: highest suitable line is soprano, lowest suitable line is bass.",
            "Missing roles are allowed. Duplicated middle roles should use neighboring visible slots instead of overwriting.",
            "Channel 10 or clearly rhythmic/special unpitched material belongs in percussion.",
            "If a part looks like accompaniment, piano reduction, or too-polyphonic material, keep its slot but set review_required true.",
        ],
        "tracks": [_summarize_midi_role_track(track) for track in mapped_tracks],
        "response_schema": {
            "confidence": "0..1",
            "assignments": [
                {
                    "source_track_index": "integer from input",
                    "midi_channels": "same channel list from input",
                    "assigned_slot_id": "1..6",
                    "review_required": "boolean",
                    "reason": "short reason, Korean or English",
                }
            ],
            "reasons": "short review-level reasons",
            "warnings": "short warnings",
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are GigaStudy's internal MIDI a cappella role reviewer. "
                "Return JSON only. You may only choose visible track slots and review flags "
                "for existing MIDI parts; deterministic code owns all pitch events."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        },
    ]
    return _build_json_chat_payload(settings=settings, messages=messages)


def _summarize_midi_role_track(track: ParsedTrack) -> dict[str, Any]:
    pitched_events = [event for event in track.events if event.pitch_midi is not None and not event.is_rest]
    pitches = [int(event.pitch_midi) for event in pitched_events if event.pitch_midi is not None]
    diagnostics = track.diagnostics
    return {
        "source_track_index": diagnostics.get("midi_source_track_index"),
        "midi_channels": diagnostics.get("midi_channels") or [],
        "midi_programs": diagnostics.get("midi_programs") or [],
        "name": track.name,
        "deterministic_slot_id": track.slot_id,
        "deterministic_slot_name": track_name(track.slot_id) if track.slot_id else None,
        "role_assignment_strategy": diagnostics.get("role_assignment_strategy"),
        "named_voice_role": diagnostics.get("midi_named_voice_role"),
        "vocal_program_hint": diagnostics.get("midi_vocal_program_hint"),
        "generic_track_name": diagnostics.get("midi_generic_track_name"),
        "event_count": len(pitched_events),
        "range": [min(pitches), max(pitches)] if pitches else None,
        "median_pitch": diagnostics.get("role_assignment_median_pitch")
        or diagnostics.get("slot_median_pitch"),
        "pitch_span": diagnostics.get("role_assignment_pitch_span"),
        "polyphonic_onset_ratio": diagnostics.get("role_assignment_polyphonic_onset_ratio"),
        "review_required": diagnostics.get("midi_seed_review_required"),
        "review_reason": diagnostics.get("midi_seed_review_reason"),
        "events": [
            {
                "beat": event.beat,
                "duration_beats": event.duration_beats,
                "label": event.label,
                "pitch_midi": event.pitch_midi,
            }
            for event in pitched_events[:MIDI_ROLE_REVIEW_EVENT_SAMPLE_LIMIT]
        ],
    }


def _midi_track_key(track: ParsedTrack) -> tuple[int, tuple[int, ...]]:
    source_track_index = track.diagnostics.get("midi_source_track_index")
    channels = track.diagnostics.get("midi_channels") or []
    if not isinstance(source_track_index, int):
        return (-1, ())
    return (source_track_index, tuple(sorted(int(channel) for channel in channels)))
