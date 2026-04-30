from __future__ import annotations

import json
import logging
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.extraction_plan import (
    VoiceExtractionPlan,
    apply_voice_extraction_instruction,
)
from gigastudy_api.services.engine.music_theory import SLOT_RANGES, midi_to_label, track_name
from gigastudy_api.services.llm.deepseek import (
    _build_json_chat_payload,
    _chat_completion_headers,
    _chat_completion_provider,
    _loads_json_object,
)

LOGGER = logging.getLogger(__name__)

AllowedExtractionGrid = Literal[0.25, 0.5]
AllowedExtractionPolicy = Literal["loose", "normal", "strict"]


class VoiceExtractionPlanInstruction(BaseModel):
    """Bounded LLM instruction for pre-transcription voice extraction.

    The LLM can choose extraction rules, never final notes. Deterministic DSP and
    notation code remain responsible for pitch frames, quantization, and TrackNote
    output.
    """

    model_config = ConfigDict(extra="ignore")

    confidence: float = Field(default=0, ge=0, le=1)
    quantization_grid: AllowedExtractionGrid | None = None
    min_segment_policy: AllowedExtractionPolicy | None = None
    confidence_policy: AllowedExtractionPolicy | None = None
    widen_range_semitones: int = Field(default=0, ge=0, le=2)
    merge_adjacent_same_pitch: bool | None = None
    suppress_unstable_notes: bool | None = None
    reasons: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    used: bool = False

    @field_validator("quantization_grid", mode="before")
    @classmethod
    def _clean_quantization_grid(cls, value: Any) -> AllowedExtractionGrid | None:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"", "none", "null"}:
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

    def apply_to(self, base_plan: VoiceExtractionPlan) -> VoiceExtractionPlan:
        return apply_voice_extraction_instruction(
            base_plan,
            confidence=self.confidence,
            provider=self.provider or "deepseek",
            model=self.model,
            quantization_grid=self.quantization_grid,
            min_segment_policy=self.min_segment_policy,
            confidence_policy=self.confidence_policy,
            widen_range_semitones=self.widen_range_semitones,
            merge_adjacent_same_pitch=self.merge_adjacent_same_pitch,
            suppress_unstable_notes=self.suppress_unstable_notes,
            reasons=self.reasons,
            warnings=self.warnings,
        )


def plan_voice_extraction_with_deepseek(
    *,
    settings: Settings,
    base_plan: VoiceExtractionPlan,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    source_kind: str,
    source_label: str,
    context_tracks_by_slot: dict[int, list[TrackNote]] | None = None,
) -> VoiceExtractionPlan | None:
    if not settings.deepseek_extraction_plan_enabled or not settings.deepseek_api_key:
        return None
    if base_plan.slot_id == 6:
        return None

    endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
    request_body = _build_extraction_plan_payload(
        settings=settings,
        base_plan=base_plan,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        source_kind=source_kind,
        source_label=source_label,
        context_tracks_by_slot=context_tracks_by_slot or {},
    )

    last_error: Exception | None = None
    for attempt_index in range(max(1, settings.deepseek_max_retries + 1)):
        try:
            instruction = _request_extraction_instruction(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            return instruction.apply_to(base_plan)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if attempt_index >= settings.deepseek_max_retries:
                break

    LOGGER.warning("DeepSeek voice extraction planning failed; using deterministic plan: %s", last_error)
    return None


def _request_extraction_instruction(
    *,
    endpoint: str,
    settings: Settings,
    request_body: dict[str, Any],
) -> VoiceExtractionPlanInstruction:
    payload = json.dumps(request_body).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        method="POST",
        headers=_chat_completion_headers(settings),
    )
    with urlopen(request, timeout=settings.deepseek_timeout_seconds) as response:
        response_payload = json.loads(response.read().decode("utf-8"))
    return _parse_deepseek_extraction_response(
        response_payload,
        model=settings.deepseek_model,
        provider=_chat_completion_provider(settings),
    )


def _parse_deepseek_extraction_response(
    payload: dict[str, Any],
    *,
    model: str,
    provider: str = "deepseek",
) -> VoiceExtractionPlanInstruction:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response did not include choices.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("DeepSeek response content was empty.")
    decoded = _loads_json_object(content)
    instruction = VoiceExtractionPlanInstruction.model_validate(decoded)
    instruction.provider = provider
    instruction.model = model
    instruction.used = True
    return instruction


def _build_extraction_plan_payload(
    *,
    settings: Settings,
    base_plan: VoiceExtractionPlan,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    source_kind: str,
    source_label: str,
    context_tracks_by_slot: dict[int, list[TrackNote]],
) -> dict[str, Any]:
    low, high = SLOT_RANGES.get(base_plan.slot_id, (base_plan.low_midi, base_plan.high_midi))
    context = {
        "product_rule": (
            "Plan extraction parameters only. Do not output TrackNotes, MIDI sequences, beats, "
            "durations, prose, or markdown. The studio BPM and meter are absolute."
        ),
        "studio": {
            "title": title,
            "bpm_is_absolute": True,
            "bpm": bpm,
            "time_signature": f"{time_signature_numerator}/{time_signature_denominator}",
        },
        "source": {
            "kind": source_kind,
            "label": source_label,
        },
        "target_track": {
            "slot_id": base_plan.slot_id,
            "name": track_name(base_plan.slot_id),
            "allowed_range": f"{midi_to_label(low)}-{midi_to_label(high)}",
        },
        "current_default_plan": base_plan.diagnostics(),
        "existing_tracks": [
            _summarize_track(slot_id, notes)
            for slot_id, notes in sorted(context_tracks_by_slot.items())
            if notes and slot_id != base_plan.slot_id
        ],
        "allowed_outputs": {
            "confidence": "0.0..1.0, use at least 0.45 only when the instruction is worth applying",
            "quantization_grid": [0.25, 0.5],
            "min_segment_policy": ["loose", "normal", "strict"],
            "confidence_policy": ["loose", "normal", "strict"],
            "widen_range_semitones": [0, 1, 2],
            "merge_adjacent_same_pitch": True,
            "suppress_unstable_notes": True,
            "reasons": ["short Korean or English reason"],
            "warnings": ["short warning"],
        },
        "decision_rules": [
            "Use a coarser grid when the performance is likely slow, noisy, or should read like sustained singing.",
            "Use stricter confidence when source is likely room noise or non-singing; use loose only for quiet but stable singing.",
            "Widen range only slightly for real tenor/bass/soprano edge notes; do not change the assigned track.",
            "Respect existing tracks as one a cappella score; extraction should stay on the shared beat grid.",
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are GigaStudy's pre-transcription planning layer. Return JSON only. "
                "You choose bounded extraction parameters before DSP/ML pitch extraction. "
                "Never invent notes. Never estimate a new tempo. "
                "Prefer practical, score-readable a cappella notation."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        },
    ]
    return _build_json_chat_payload(settings=settings, messages=messages)


def _summarize_track(slot_id: int, notes: list[TrackNote]) -> dict[str, Any]:
    pitched = [note for note in notes if note.pitch_midi is not None and not note.is_rest]
    pitches = [note.pitch_midi for note in pitched if note.pitch_midi is not None]
    return {
        "slot_id": slot_id,
        "name": track_name(slot_id),
        "note_count": len(pitched),
        "range": _range_label(pitches),
        "first_events": [
            {
                "beat": note.beat,
                "duration_beats": note.duration_beats,
                "label": note.spelled_label or note.label,
                "measure": note.measure_index,
            }
            for note in pitched[:24]
        ],
    }


def _range_label(pitches: list[int]) -> str:
    if not pitches:
        return "-"
    return f"{midi_to_label(min(pitches))}-{midi_to_label(max(pitches))}"
