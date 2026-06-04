from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

ALLOWED_PROFILE_NAMES = {
    "balanced",
    "lower_support",
    "moving_counterline",
    "upper_blend",
    "open_voicing",
}

KEY_NAME_TO_TONIC = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
}

ALLOWED_FUNCTIONS = {"tonic", "predominant", "dominant", "transition", "unknown"}
ALLOWED_CADENCE_ROLES = {"opening", "build", "cadence", "final", "none"}
ALLOWED_TARGET_MOTIONS = {"stable", "stepwise", "contrary", "active", "unknown"}
ALLOWED_GOALS = {"rehearsal_safe", "counterline", "open_support", "upper_blend", "active_motion"}
ALLOWED_REGISTER_BIASES = {"low", "middle", "high", "open", "auto"}
ALLOWED_MOTION_BIASES = {"stable", "mostly_stepwise", "contrary", "active"}
ALLOWED_RHYTHM_POLICIES = {"follow_context", "simplify", "answer_melody", "sustain_support"}
ALLOWED_TEXTURES = {
    "block_harmony",
    "counterline",
    "pad_sustain",
    "rhythmic_echo",
    "hook_support",
}
ALLOWED_RHYTHM_ROLES = {
    "context_lock",
    "stable_pulse",
    "independent_motion",
    "sustain_with_attacks",
    "hook_or_riff",
}
ALLOWED_CHORD_TONES = {"root", "third", "fifth"}


class MeasureHarmonyIntent(BaseModel):
    measure_index: int = Field(ge=1, le=512)
    function: str = "unknown"
    preferred_degrees: list[int] = Field(default_factory=list, max_length=4)
    cadence_role: str = "none"
    target_motion: str = "unknown"
    allowed_tensions: list[str] = Field(default_factory=list, max_length=5)
    avoid: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("function")
    @classmethod
    def validate_function(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_FUNCTIONS else "unknown"

    @field_validator("cadence_role")
    @classmethod
    def validate_cadence_role(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_CADENCE_ROLES else "none"

    @field_validator("target_motion")
    @classmethod
    def validate_target_motion(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_TARGET_MOTIONS else "unknown"

    @field_validator("preferred_degrees")
    @classmethod
    def validate_preferred_degrees(cls, value: list[int]) -> list[int]:
        normalized: list[int] = []
        for degree in value:
            if 1 <= degree <= 7 and degree not in normalized:
                normalized.append(degree)
        return normalized


class DeepSeekCandidateDirection(BaseModel):
    candidate_index: int = Field(ge=1, le=5)
    profile_name: str
    title: str = Field(min_length=1, max_length=48)
    goal: str = "rehearsal_safe"
    register_bias: str = "auto"
    motion_bias: str = "mostly_stepwise"
    rhythm_policy: str = "follow_context"
    texture: str = "block_harmony"
    rhythm_role: str = "context_lock"
    chord_tone_priority: list[str] = Field(default_factory=lambda: ["third", "root", "fifth"], max_length=3)
    role: str = Field(default="", max_length=160)
    selection_hint: str = Field(default="", max_length=180)
    risk_tags: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("profile_name")
    @classmethod
    def validate_profile_name(cls, value: str) -> str:
        normalized = value.strip()
        if normalized not in ALLOWED_PROFILE_NAMES:
            raise ValueError(f"Unsupported voice-leading profile: {value}")
        return normalized

    @field_validator("goal")
    @classmethod
    def validate_goal(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_GOALS else "rehearsal_safe"

    @field_validator("register_bias")
    @classmethod
    def validate_register_bias(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_REGISTER_BIASES else "auto"

    @field_validator("motion_bias")
    @classmethod
    def validate_motion_bias(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_MOTION_BIASES else "mostly_stepwise"

    @field_validator("rhythm_policy")
    @classmethod
    def validate_rhythm_policy(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_RHYTHM_POLICIES else "follow_context"

    @field_validator("texture")
    @classmethod
    def validate_texture(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_TEXTURES else "block_harmony"

    @field_validator("rhythm_role")
    @classmethod
    def validate_rhythm_role(cls, value: str) -> str:
        normalized = value.strip().lower()
        return normalized if normalized in ALLOWED_RHYTHM_ROLES else "context_lock"

    @field_validator("chord_tone_priority")
    @classmethod
    def validate_chord_tone_priority(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for tone in value:
            name = tone.strip().lower()
            if name in ALLOWED_CHORD_TONES and name not in normalized:
                normalized.append(name)
        return normalized or ["third", "root", "fifth"]


class DeepSeekHarmonyPlan(BaseModel):
    key: str | None = Field(default=None, max_length=12)
    mode: str | None = Field(default=None, max_length=12)
    confidence: float = Field(default=0.5, ge=0, le=1)
    phrase_summary: str = Field(default="", max_length=220)
    measures: list[MeasureHarmonyIntent] = Field(default_factory=list, max_length=512)
    candidate_directions: list[DeepSeekCandidateDirection] = Field(default_factory=list, max_length=5)
    warnings: list[str] = Field(default_factory=list, max_length=5)
    revision_cycles: int = Field(default=0, ge=0, le=3)
    critique_summary: str = Field(default="", max_length=220)
    provider: str = "deepseek"
    model: str = "deepseek-v4-flash"
    used: bool = True

    def profile_names(self) -> list[str]:
        return [direction.profile_name for direction in self.candidate_directions]

    def direction_for_index(self, index: int) -> DeepSeekCandidateDirection | None:
        for direction in self.candidate_directions:
            if direction.candidate_index == index:
                return direction
        return None

    def measure_intent_for_index(self, measure_index: int | None) -> MeasureHarmonyIntent | None:
        if measure_index is None:
            return None
        for intent in self.measures:
            if intent.measure_index == measure_index:
                return intent
        return None


def complete_harmony_plan(
    plan: DeepSeekHarmonyPlan,
    *,
    candidate_count: int,
    model: str,
    target_slot_id: int,
) -> DeepSeekHarmonyPlan:
    plan.candidate_directions = _complete_candidate_directions(
        plan.candidate_directions,
        candidate_count=candidate_count,
        target_slot_id=target_slot_id,
    )
    plan.measures = sorted(_dedupe_measures(plan.measures), key=lambda measure: measure.measure_index)
    plan.model = model
    return plan


def fallback_candidate_direction(index: int, profile_name: str, target_slot_id: int) -> DeepSeekCandidateDirection:
    goal = _fallback_goal(profile_name, target_slot_id)
    return DeepSeekCandidateDirection(
        candidate_index=index,
        profile_name=profile_name,
        title=_fallback_title(profile_name, target_slot_id),
        goal=goal,
        register_bias=_fallback_register_bias(goal, target_slot_id),
        motion_bias=_fallback_motion_bias(goal),
        rhythm_policy=_fallback_rhythm_policy(goal),
        texture=_fallback_texture(goal),
        rhythm_role=_fallback_rhythm_role(goal),
        chord_tone_priority=_fallback_chord_tone_priority(goal, target_slot_id),
        role=_fallback_role(goal, target_slot_id),
        selection_hint=_fallback_selection_hint(goal),
        risk_tags=[],
    )


def key_tonic_from_name(key_name: str | None) -> int | None:
    if not key_name:
        return None
    return KEY_NAME_TO_TONIC.get(key_name.strip())


def _complete_candidate_directions(
    directions: list[DeepSeekCandidateDirection],
    *,
    candidate_count: int,
    target_slot_id: int,
) -> list[DeepSeekCandidateDirection]:
    completed = sorted(directions, key=lambda direction: direction.candidate_index)
    used_profiles = {direction.profile_name for direction in completed}
    next_index = 1
    for profile_name in ("balanced", "moving_counterline", "lower_support", "upper_blend", "open_voicing"):
        if len(completed) >= candidate_count:
            break
        if profile_name in used_profiles:
            continue
        while any(direction.candidate_index == next_index for direction in completed):
            next_index += 1
        completed.append(fallback_candidate_direction(next_index, profile_name, target_slot_id))
        used_profiles.add(profile_name)
    return sorted(completed[:candidate_count], key=lambda direction: direction.candidate_index)


def _dedupe_measures(measures: list[MeasureHarmonyIntent]) -> list[MeasureHarmonyIntent]:
    by_measure: dict[int, MeasureHarmonyIntent] = {}
    for measure in measures:
        by_measure[measure.measure_index] = measure
    return list(by_measure.values())


def _fallback_goal(profile_name: str, target_slot_id: int) -> str:
    if profile_name == "moving_counterline":
        return "counterline"
    if profile_name in {"lower_support", "open_voicing"} and target_slot_id in {4, 5}:
        return "open_support"
    if profile_name in {"upper_blend", "open_voicing"} and target_slot_id in {1, 2}:
        return "upper_blend"
    if profile_name == "open_voicing":
        return "open_support"
    return "rehearsal_safe"


def _fallback_title(profile_name: str, target_slot_id: int) -> str:
    goal = _fallback_goal(profile_name, target_slot_id)
    return {
        "rehearsal_safe": "Stable blend",
        "counterline": "Moving counterline",
        "open_support": "Open lower support",
        "upper_blend": "Upper blend",
        "active_motion": "Active motion",
    }.get(goal, "Balanced candidate")


def _fallback_register_bias(goal: str, target_slot_id: int) -> str:
    if goal == "open_support":
        return "low" if target_slot_id in {4, 5} else "open"
    if goal == "upper_blend":
        return "high"
    return "middle"


def _fallback_motion_bias(goal: str) -> str:
    if goal == "counterline":
        return "contrary"
    if goal == "active_motion":
        return "active"
    if goal == "open_support":
        return "stable"
    return "mostly_stepwise"


def _fallback_rhythm_policy(goal: str) -> str:
    if goal == "open_support":
        return "sustain_support"
    if goal == "rehearsal_safe":
        return "follow_context"
    if goal == "active_motion":
        return "answer_melody"
    return "follow_context"


def _fallback_texture(goal: str) -> str:
    if goal == "counterline":
        return "counterline"
    if goal == "open_support":
        return "pad_sustain"
    if goal == "active_motion":
        return "hook_support"
    if goal == "upper_blend":
        return "block_harmony"
    return "rhythmic_echo"


def _fallback_rhythm_role(goal: str) -> str:
    if goal == "counterline":
        return "independent_motion"
    if goal == "open_support":
        return "sustain_with_attacks"
    if goal == "active_motion":
        return "hook_or_riff"
    return "context_lock"


def _fallback_chord_tone_priority(goal: str, target_slot_id: int) -> list[str]:
    if goal == "open_support" or target_slot_id in {4, 5}:
        return ["root", "fifth", "third"]
    if goal == "counterline":
        return ["third", "fifth", "root"]
    return ["third", "root", "fifth"]


def _fallback_role(goal: str, target_slot_id: int) -> str:
    if goal == "counterline":
        return "Adds independent motion against the existing melody."
    if goal == "open_support":
        return "Supports the harmony from a lower or lower-middle register."
    if goal == "upper_blend":
        return "Blends near the upper voices with a brighter contour."
    return "Creates a safe harmony line for first rehearsal."


def _fallback_selection_hint(goal: str) -> str:
    if goal == "counterline":
        return "Choose this when the part needs more independent motion."
    if goal == "open_support":
        return "Choose this when the ensemble needs weight or lower support."
    if goal == "upper_blend":
        return "Choose this when the upper texture feels empty or dull."
    return "Choose this when you need the most neutral candidate."
