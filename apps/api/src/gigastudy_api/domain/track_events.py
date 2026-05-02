from typing import Literal
from uuid import uuid4

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

PitchEventSource = Literal["musicxml", "midi", "omr", "voice", "ai", "recording", "audio"]
_LEGACY_PITCH_REGISTER_ALIASES = {
    "treble": "upper_voice",
    "treble_8vb": "tenor_voice",
    "bass": "lower_voice",
}


class TrackPitchEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: uuid4().hex)
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    label: str
    spelled_label: str | None = None
    accidental: str | None = None
    pitch_register: str | None = Field(
        default=None,
        validation_alias=AliasChoices("pitch_register", "clef"),
    )
    key_signature: str | None = None
    pitch_label_octave_shift: int = Field(
        default=0,
        validation_alias=AliasChoices("pitch_label_octave_shift", "display_octave_shift"),
    )
    onset_seconds: float = 0
    duration_seconds: float = 0
    beat: float
    duration_beats: float
    measure_index: int | None = None
    beat_in_measure: float | None = None
    confidence: float = Field(default=1, ge=0, le=1)
    source: PitchEventSource
    extraction_method: str = "unknown"
    is_rest: bool = False
    is_tied: bool = False
    voice_index: int | None = None
    source_staff_index: int | None = Field(
        default=None,
        validation_alias=AliasChoices("source_staff_index", "staff_index"),
    )
    quantization_grid: float | None = None
    quality_warnings: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("quality_warnings", "notation_warnings"),
    )

    @field_validator("pitch_register", mode="before")
    @classmethod
    def coerce_pitch_register(cls, value: object) -> object:
        if isinstance(value, str):
            return _LEGACY_PITCH_REGISTER_ALIASES.get(value, value)
        return value
