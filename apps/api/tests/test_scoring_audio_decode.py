from pathlib import Path
from typing import Any
import wave

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine import audio_decode
from gigastudy_api.services.engine.audio_decode import VoiceAnalysisAudio, prepare_voice_analysis_wav
from gigastudy_api.services.studio_scoring_commands import StudioScoringCommands


class _FakeAssets:
    def __init__(self, source_path: Path) -> None:
        self.source_path = source_path
        self.deleted_asset_path: str | None = None

    def normalize_reference(self, asset_path: str) -> str:
        return asset_path

    def resolve_existing_upload_asset(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        asset_path: str,
    ) -> Path:
        assert studio_id == "studio-1"
        assert slot_id == 5
        assert filename == "bass-score-take.webm"
        assert asset_path.endswith(".webm")
        return self.source_path

    def delete_asset_file(self, relative_path: str) -> None:
        self.deleted_asset_path = relative_path


class _FakeRepository:
    def __init__(self) -> None:
        self.transcribed_path: Path | None = None

    def _transcribe_voice_file(self, path: Path, **kwargs: Any) -> list[TrackPitchEvent]:
        self.transcribed_path = path
        assert kwargs["slot_id"] == 5
        assert kwargs["time_signature_numerator"] == 4
        assert kwargs["time_signature_denominator"] == 4
        return [
            TrackPitchEvent(
                label="C3",
                pitch_midi=48,
                beat=1,
                duration_beats=1,
                source="recording",
                extraction_method="test",
            )
        ]


def test_scoring_asset_uses_shared_wav_decode_path(monkeypatch, tmp_path: Path) -> None:
    source_path = tmp_path / "bass-score-take.webm"
    analysis_path = tmp_path / "analysis.wav"
    source_path.write_bytes(b"fake webm")
    analysis_path.write_bytes(b"fake wav")
    assets = _FakeAssets(source_path)
    repository = _FakeRepository()
    prepared_sources: list[Path] = []
    cleaned: list[VoiceAnalysisAudio] = []

    def fake_prepare(source: Path, *, timeout_seconds: int) -> VoiceAnalysisAudio:
        prepared_sources.append(source)
        assert timeout_seconds > 0
        return VoiceAnalysisAudio(path=analysis_path, converted=True, original_suffix=source.suffix)

    monkeypatch.setattr(
        "gigastudy_api.services.studio_scoring_commands.prepare_voice_analysis_wav",
        fake_prepare,
    )
    monkeypatch.setattr(
        "gigastudy_api.services.studio_scoring_commands.cleanup_voice_analysis_audio",
        cleaned.append,
    )

    commands = StudioScoringCommands(
        assets=assets,
        now=lambda: "2026-05-10T00:00:00Z",
        repository=repository,
    )

    events = commands.extract_scoring_audio_from_asset(
        studio_id="studio-1",
        slot_id=5,
        filename="bass-score-take.webm",
        asset_path="uploads/studio-1/5/bass-score-take.webm",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert len(events) == 1
    assert prepared_sources == [source_path]
    assert repository.transcribed_path == analysis_path
    assert cleaned == [VoiceAnalysisAudio(path=analysis_path, converted=True, original_suffix=".webm")]
    assert assets.deleted_asset_path == "uploads/studio-1/5/bass-score-take.webm"


def test_voice_analysis_keeps_wav_that_already_matches_contract(tmp_path: Path) -> None:
    source_path = tmp_path / "voice.wav"
    _write_silence_wav(source_path, channels=1, sample_width=2, sample_rate=44_100, frame_count=256)

    prepared = prepare_voice_analysis_wav(source_path)

    assert prepared == VoiceAnalysisAudio(path=source_path, converted=False, original_suffix=".wav")


def test_voice_analysis_normalizes_stereo_wav_before_extraction(monkeypatch, tmp_path: Path) -> None:
    source_path = tmp_path / "voice.wav"
    _write_silence_wav(source_path, channels=2, sample_width=2, sample_rate=48_000, frame_count=256)
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs: Any) -> Any:
        commands.append(command)
        output_path = Path(command[-1])
        _write_silence_wav(output_path, channels=1, sample_width=2, sample_rate=44_100, frame_count=128)

        class _Completed:
            returncode = 0
            stderr = ""
            stdout = ""

        return _Completed()

    monkeypatch.setattr(audio_decode.subprocess, "run", fake_run)

    prepared = prepare_voice_analysis_wav(source_path)

    assert prepared.converted is True
    assert prepared.original_suffix == ".wav"
    assert prepared.path != source_path
    assert commands
    assert "-ac" in commands[0]
    assert "1" in commands[0]


def _write_silence_wav(
    path: Path,
    *,
    channels: int,
    sample_width: int,
    sample_rate: int,
    frame_count: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00" * frame_count * channels * sample_width)
