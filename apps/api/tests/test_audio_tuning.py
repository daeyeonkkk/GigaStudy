from __future__ import annotations

from array import array
import math
from pathlib import Path

from gigastudy_api.api.schemas.studios import ArrangementRegion, PitchEvent
from gigastudy_api.services.engine.audio_mix_export import (
    SAMPLE_RATE,
    _decode_audio_to_float_samples,
    _seconds_to_sample,
    _write_wav,
)
from gigastudy_api.services.engine.audio_tuning import render_tuned_track_wav


def test_tuning_render_uses_source_anchor_when_event_was_moved(tmp_path: Path) -> None:
    source_samples = array("f", [0.0]) * _seconds_to_sample(0.2)
    source_samples.extend(_sine_wave(440.0, 0.22))
    source_path = tmp_path / "voice.wav"
    _write_wav(source_path, source_samples)

    event = PitchEvent(
        event_id="track-1-region-1-e1",
        track_slot_id=1,
        region_id="track-1-region-1",
        label="A4",
        pitch_midi=69,
        pitch_hz=440.0,
        start_seconds=0.0,
        duration_seconds=0.2,
        start_beat=1,
        duration_beats=1,
        source="voice",
    )
    region = ArrangementRegion(
        region_id="track-1-region-1",
        track_slot_id=1,
        track_name="Soprano",
        source_kind="recording",
        source_label="take.wav",
        audio_source_path="uploads/studio/take.wav",
        audio_mime_type="audio/wav",
        start_seconds=0.0,
        duration_seconds=0.5,
        pitch_events=[event],
        diagnostics={
            "audio_source_anchors": {
                event.event_id: {
                    "source_event_id": event.event_id,
                    "source_start_seconds": 0.2,
                    "source_duration_seconds": 0.2,
                    "source_pitch_hz": 440.0,
                    "voiced_start_offset": 0.0,
                    "voiced_duration_seconds": 0.2,
                    "confidence": 0.9,
                }
            }
        },
    )

    result = render_tuned_track_wav(
        output_dir=tmp_path / "out",
        regions=[region],
        resolve_asset_path=lambda _asset_path: source_path,
    )

    rendered = _decode_audio_to_float_samples(result.wav_path)
    head = rendered[: _seconds_to_sample(0.18)]
    assert _rms(head) > 0.05
    assert result.anchored_event_count == 1
    assert result.fallback_anchored_event_count == 0


def test_tuning_render_allows_large_pitch_and_time_changes_with_fallback(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source_samples = _sine_wave(220.0, 0.15)
    source_path = tmp_path / "voice.wav"
    _write_wav(source_path, source_samples)
    monkeypatch.setattr(
        "gigastudy_api.services.engine.audio_tuning._process_segment_with_rubberband",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("rubberband unavailable")),
    )

    event = PitchEvent(
        event_id="track-1-region-1-e1",
        track_slot_id=1,
        region_id="track-1-region-1",
        label="C6",
        pitch_midi=84,
        pitch_hz=1046.5,
        start_seconds=0.0,
        duration_seconds=0.45,
        start_beat=1,
        duration_beats=3,
        source="voice",
    )
    region = ArrangementRegion(
        region_id="track-1-region-1",
        track_slot_id=1,
        track_name="Soprano",
        source_kind="recording",
        source_label="take.wav",
        audio_source_path="uploads/studio/take.wav",
        audio_mime_type="audio/wav",
        start_seconds=0.0,
        duration_seconds=0.5,
        pitch_events=[event],
        diagnostics={
            "audio_source_anchors": {
                event.event_id: {
                    "source_event_id": event.event_id,
                    "source_start_seconds": 0.0,
                    "source_duration_seconds": 0.15,
                    "source_pitch_hz": 220.0,
                }
            }
        },
    )

    result = render_tuned_track_wav(
        output_dir=tmp_path / "out",
        regions=[region],
        resolve_asset_path=lambda _asset_path: source_path,
    )

    assert result.wav_path.exists()
    assert result.render_backend == "librosa_fallback"
    assert result.pitch_shifted_event_count == 1
    assert result.time_stretched_event_count == 1
    assert result.max_pitch_shift_semitones > 20
    assert result.max_time_stretch_ratio >= 3


def _sine_wave(frequency: float, duration_seconds: float) -> array:
    sample_count = _seconds_to_sample(duration_seconds)
    return array(
        "f",
        (
            0.35 * math.sin(2.0 * math.pi * frequency * sample_index / SAMPLE_RATE)
            for sample_index in range(sample_count)
        ),
    )


def _rms(samples: array) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(float(sample) ** 2 for sample in samples) / len(samples))
