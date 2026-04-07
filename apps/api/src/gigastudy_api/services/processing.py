from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import mimetypes
from pathlib import Path
import wave
from uuid import UUID

import av
import numpy as np
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.audio_preview import AudioPreviewResponse
from gigastudy_api.api.schemas.processing import TrackProcessingRetryResponse
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Artifact, ArtifactType, Track, TrackRole, TrackStatus


CANONICAL_SAMPLE_RATE = 16000
CANONICAL_CHANNEL_LAYOUT = "mono"
WAVEFORM_BINS = 128
CONTOUR_POINTS = 64


@dataclass
class AudioProbeResult:
    byte_size: int
    canonical_path: Path
    channel_count: int
    checksum: str
    container_format: str | None
    duration_ms: int
    peaks_path: Path
    preview_data: AudioPreviewResponse
    sample_rate: int
    source_path: Path


def _get_storage_root() -> Path:
    settings = get_settings()
    return Path(settings.storage_root).resolve()


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.track_id == track_id)
    )
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track


def _get_track_artifact(track: Track, artifact_type: ArtifactType) -> Artifact | None:
    for artifact in track.artifacts:
        if artifact.artifact_type == artifact_type:
            return artifact

    return None


def _get_uploaded_audio_artifact_type(track: Track) -> ArtifactType:
    return ArtifactType.MIXDOWN_AUDIO if track.track_role == TrackRole.MIXDOWN else ArtifactType.SOURCE_AUDIO


def get_track_playback_artifact(track: Track) -> Artifact | None:
    uploaded_artifact = _get_track_artifact(track, _get_uploaded_audio_artifact_type(track))
    if uploaded_artifact is not None:
        return uploaded_artifact

    return _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)


def get_track_canonical_artifact(track: Track) -> Artifact | None:
    return _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)


def get_track_preview_data(track: Track) -> AudioPreviewResponse | None:
    peaks_artifact = _get_track_artifact(track, ArtifactType.WAVEFORM_PEAKS)
    if peaks_artifact is None or not isinstance(peaks_artifact.meta_json, dict):
        return None

    preview_data = peaks_artifact.meta_json.get("preview_data")
    if not isinstance(preview_data, dict):
        return None

    return AudioPreviewResponse.model_validate(preview_data)


def _normalize_sample_array(samples: np.ndarray) -> np.ndarray:
    if np.issubdtype(samples.dtype, np.floating):
        return samples.astype(np.float32)
    if np.issubdtype(samples.dtype, np.signedinteger):
        max_value = max(abs(np.iinfo(samples.dtype).min), np.iinfo(samples.dtype).max)
        return samples.astype(np.float32) / float(max_value)
    if np.issubdtype(samples.dtype, np.unsignedinteger):
        max_value = np.iinfo(samples.dtype).max
        centered = samples.astype(np.float32) - (max_value / 2)
        return centered / float(max_value / 2)

    return samples.astype(np.float32)


def _build_waveform(samples: np.ndarray, bins: int = WAVEFORM_BINS) -> list[float]:
    if samples.size == 0:
        return [0.0] * bins

    window_size = max(1, samples.size // bins)
    waveform: list[float] = []

    for bin_index in range(bins):
        start = bin_index * window_size
        end = min(samples.size, start + window_size)
        if start >= samples.size:
            waveform.append(0.0)
            continue

        peak = float(np.max(np.abs(samples[start:end]))) if end > start else 0.0
        waveform.append(round(peak, 6))

    return waveform


def _estimate_window_pitch(
    samples: np.ndarray,
    sample_rate: int,
    start: int,
    end: int,
) -> float | None:
    window = samples[start:end]
    if window.size == 0:
        return None

    rms = float(np.sqrt(np.mean(np.square(window))))
    if rms < 0.01:
        return None

    crossings = int(np.count_nonzero(np.diff(np.signbit(window))))
    estimated_frequency = (crossings * sample_rate) / (2 * window.size)
    if estimated_frequency < 60 or estimated_frequency > 1200:
        return None

    return round(float(estimated_frequency), 3)


def _build_pitch_contour(
    samples: np.ndarray,
    sample_rate: int,
    points: int = CONTOUR_POINTS,
) -> list[float | None]:
    if samples.size == 0:
        return [None] * points

    window_size = max(2048, samples.size // points)
    contour: list[float | None] = []

    for point in range(points):
        start = point * window_size
        end = min(samples.size, start + window_size)
        contour.append(_estimate_window_pitch(samples, sample_rate, start, end))

    return contour


def _compute_duration_ms(
    container: av.container.InputContainer,
    audio_stream: av.audio.stream.AudioStream,
    fallback_sample_count: int,
) -> int:
    if audio_stream.duration is not None and audio_stream.time_base is not None:
        return max(1, round(float(audio_stream.duration * audio_stream.time_base) * 1000))

    if container.duration is not None:
        return max(1, round(float(container.duration / av.time_base) * 1000))

    sample_rate = int(audio_stream.sample_rate or CANONICAL_SAMPLE_RATE)
    return max(1, round((fallback_sample_count / sample_rate) * 1000))


def _write_canonical_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = np.round(pcm * np.int16(32767)).astype(np.int16)

    with wave.open(path.as_posix(), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


def _write_preview_json(path: Path, preview_data: AudioPreviewResponse) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(preview_data.model_dump(mode="json"), ensure_ascii=True),
        encoding="utf-8",
    )


def _probe_audio_file(track: Track) -> AudioProbeResult:
    if not track.storage_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track storage key is missing")

    source_path = _get_storage_root() / track.storage_key
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file not found")

    file_bytes = source_path.read_bytes()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    try:
        container = av.open(source_path.as_posix())
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded audio could not be parsed: {error}",
        ) from error

    try:
        audio_stream = next((stream for stream in container.streams if stream.type == "audio"), None)
        if audio_stream is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file does not contain an audio stream",
            )

        resampler = av.audio.resampler.AudioResampler(
            format="flt",
            layout=CANONICAL_CHANNEL_LAYOUT,
            rate=CANONICAL_SAMPLE_RATE,
        )
        chunks: list[np.ndarray] = []

        for frame in container.decode(audio=0):
            resampled_frames = resampler.resample(frame)
            if resampled_frames is None:
                continue
            if not isinstance(resampled_frames, list):
                resampled_frames = [resampled_frames]

            for item in resampled_frames:
                chunks.append(_normalize_sample_array(item.to_ndarray()).reshape(-1))

        flushed_frames = resampler.resample(None)
        if flushed_frames is not None:
            if not isinstance(flushed_frames, list):
                flushed_frames = [flushed_frames]

            for item in flushed_frames:
                chunks.append(_normalize_sample_array(item.to_ndarray()).reshape(-1))

        if not chunks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded audio does not contain decodable samples",
            )

        mono_samples = np.concatenate(chunks)
        duration_ms = _compute_duration_ms(container, audio_stream, mono_samples.size)
        waveform = _build_waveform(mono_samples)
        contour = _build_pitch_contour(mono_samples, CANONICAL_SAMPLE_RATE)
        preview_data = AudioPreviewResponse(
            waveform=waveform,
            contour=contour,
            duration_ms=duration_ms,
            source="remote",
        )

        derived_root = _get_storage_root() / "projects" / str(track.project_id) / "derived"
        canonical_path = derived_root / f"{track.track_id}-canonical.wav"
        peaks_path = derived_root / f"{track.track_id}-preview.json"

        _write_canonical_wav(canonical_path, mono_samples, CANONICAL_SAMPLE_RATE)
        _write_preview_json(peaks_path, preview_data)

        channel_count = int(
            getattr(audio_stream, "channels", 0)
            or getattr(getattr(audio_stream, "layout", None), "nb_channels", 0)
            or 1
        )
        sample_rate = int(audio_stream.sample_rate or CANONICAL_SAMPLE_RATE)

        return AudioProbeResult(
            byte_size=len(file_bytes),
            canonical_path=canonical_path,
            channel_count=channel_count,
            checksum=sha256(file_bytes).hexdigest(),
            container_format=container.format.name if container.format else None,
            duration_ms=duration_ms,
            peaks_path=peaks_path,
            preview_data=preview_data,
            sample_rate=sample_rate,
            source_path=source_path,
        )
    finally:
        container.close()


def process_uploaded_track(session: Session, track_id: UUID) -> Track:
    track = _get_track_or_404(session, track_id)
    now = datetime.now(timezone.utc)

    try:
        probe = _probe_audio_file(track)
    except HTTPException:
        track.track_status = TrackStatus.FAILED
        track.updated_at = now
        session.commit()
        raise

    mime_type = track.source_format or mimetypes.guess_type(probe.source_path.name)[0] or "application/octet-stream"
    uploaded_artifact_type = _get_uploaded_audio_artifact_type(track)

    track.track_status = TrackStatus.READY
    track.source_format = mime_type
    track.duration_ms = probe.duration_ms
    track.actual_sample_rate = probe.sample_rate
    track.checksum = probe.checksum
    track.updated_at = now

    uploaded_artifact = _get_track_artifact(track, uploaded_artifact_type)
    if uploaded_artifact is None:
        uploaded_artifact = Artifact(
            project_id=track.project_id,
            track=track,
            artifact_type=uploaded_artifact_type,
            storage_key=str(probe.source_path),
            created_at=now,
            updated_at=now,
        )
        session.add(uploaded_artifact)

    uploaded_artifact.storage_key = str(probe.source_path)
    uploaded_artifact.mime_type = mime_type
    uploaded_artifact.byte_size = probe.byte_size
    uploaded_artifact.updated_at = now
    uploaded_artifact.meta_json = {
        "channel_count": probe.channel_count,
        "checksum": probe.checksum,
        "container_format": probe.container_format,
        "duration_ms": probe.duration_ms,
        "project_storage_key": track.storage_key,
        "sample_rate": probe.sample_rate,
        **({"take_no": track.take_no} if track.take_no is not None else {}),
    }

    canonical_artifact = _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)
    if canonical_artifact is None:
        canonical_artifact = Artifact(
            project_id=track.project_id,
            track=track,
            artifact_type=ArtifactType.CANONICAL_AUDIO,
            storage_key=str(probe.canonical_path),
            created_at=now,
            updated_at=now,
        )
        session.add(canonical_artifact)

    canonical_artifact.storage_key = str(probe.canonical_path)
    canonical_artifact.mime_type = "audio/wav"
    canonical_artifact.byte_size = probe.canonical_path.stat().st_size
    canonical_artifact.updated_at = now
    canonical_artifact.meta_json = {
        "channel_count": 1,
        "duration_ms": probe.duration_ms,
        "sample_rate": CANONICAL_SAMPLE_RATE,
        "source_artifact_type": uploaded_artifact_type.value,
    }

    peaks_artifact = _get_track_artifact(track, ArtifactType.WAVEFORM_PEAKS)
    if peaks_artifact is None:
        peaks_artifact = Artifact(
            project_id=track.project_id,
            track=track,
            artifact_type=ArtifactType.WAVEFORM_PEAKS,
            storage_key=str(probe.peaks_path),
            created_at=now,
            updated_at=now,
        )
        session.add(peaks_artifact)

    peaks_artifact.storage_key = str(probe.peaks_path)
    peaks_artifact.mime_type = "application/json"
    peaks_artifact.byte_size = probe.peaks_path.stat().st_size
    peaks_artifact.updated_at = now
    peaks_artifact.meta_json = {
        "bins": WAVEFORM_BINS,
        "points": CONTOUR_POINTS,
        "preview_data": probe.preview_data.model_dump(mode="json"),
    }

    session.commit()
    refreshed_track = _get_track_or_404(session, track.track_id)
    return refreshed_track


def retry_track_processing(session: Session, track_id: UUID) -> Track:
    return process_uploaded_track(session, track_id)


def build_processing_retry_response(
    track: Track,
    request: Request,
) -> TrackProcessingRetryResponse:
    playback_artifact = get_track_playback_artifact(track)
    download_url = (
        str(request.url_for("download_track_source_audio", track_id=str(track.track_id)))
        if playback_artifact is not None
        else None
    )

    return TrackProcessingRetryResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        track_role=track.track_role.value,
        track_status=track.track_status.value,
        source_artifact_url=download_url,
        updated_at=track.updated_at,
    )
