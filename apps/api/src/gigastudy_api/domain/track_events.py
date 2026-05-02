from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

NoteSource = Literal["musicxml", "midi", "omr", "voice", "ai", "recording", "audio"]


class TrackNote(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    pitch_midi: int | None = None
    pitch_hz: float | None = None
    label: str
    spelled_label: str | None = None
    accidental: str | None = None
    clef: str | None = None
    key_signature: str | None = None
    display_octave_shift: int = 0
    onset_seconds: float = 0
    duration_seconds: float = 0
    beat: float
    duration_beats: float
    measure_index: int | None = None
    beat_in_measure: float | None = None
    confidence: float = Field(default=1, ge=0, le=1)
    source: NoteSource
    extraction_method: str = "unknown"
    is_rest: bool = False
    is_tied: bool = False
    voice_index: int | None = None
    staff_index: int | None = None
    quantization_grid: float | None = None
    notation_warnings: list[str] = Field(default_factory=list)
