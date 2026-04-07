from pydantic import BaseModel, Field


class AudioPreviewResponse(BaseModel):
    waveform: list[float] = Field(default_factory=list)
    contour: list[float | None] = Field(default_factory=list)
    duration_ms: int | None = None
    source: str = "remote"
