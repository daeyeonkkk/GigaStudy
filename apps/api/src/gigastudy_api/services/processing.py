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
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.audio_preview import AudioPreviewResponse
from gigastudy_api.api.schemas.pitch_analysis import (
    FRAME_PITCH_ARTIFACT_VERSION,
    FRAME_PITCH_QUALITY_MODE,
    FramePitchArtifactPayload,
    PitchFrameArtifactFrame,
)
from gigastudy_api.api.schemas.processing import TrackProcessingRetryResponse
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Artifact, ArtifactType, Track, TrackRole, TrackStatus
from gigastudy_api.services.audio_features import (
    PYIN_FRAME_LENGTH,
    PYIN_HOP_LENGTH,
    build_preview_contour,
    extract_pitch_frames,
)


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
    frame_pitch_path: Path
    frame_pitch_payload: FramePitchArtifactPayload
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


def get_track_frame_pitch_artifact(track: Track) -> Artifact | None:
    return _get_track_artifact(track, ArtifactType.FRAME_PITCH)


def _mark_track_failed(session: Session, track: Track, message: str) -> None:
    track.track_status = TrackStatus.FAILED
    track.failure_message = message
    track.updated_at = datetime.now(timezone.utc)
    session.commit()


def _validate_upload_session_window(track: Track) -> None:
    settings = get_settings()
    if settings.upload_session_expiry_minutes <= 0:
        return

    if track.storage_key:
        source_path = _get_storage_root() / track.storage_key
        if source_path.exists():
            return

    window_started_at = track.updated_at or track.created_at
    if window_started_at is None:
        return
    if window_started_at.tzinfo is None:
        window_started_at = window_started_at.replace(tzinfo=timezone.utc)

    age_seconds = (datetime.now(timezone.utc) - window_started_at).total_seconds()
    if age_seconds > settings.upload_session_expiry_minutes * 60:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "Upload session expired. Start a new upload URL before retrying this track."
            ),
        )


def validate_upload_session_window(track: Track) -> None:
    _validate_upload_session_window(track)


def get_track_preview_data(track: Track) -> AudioPreviewResponse | None:
    peaks_artifact = _get_track_artifact(track, ArtifactType.WAVEFORM_PEAKS)
    if peaks_artifact is None or not isinstance(peaks_artifact.meta_json, dict):
        return None

    preview_data = peaks_artifact.meta_json.get("preview_data")
    if not isinstance(preview_data, dict):
        return None

    return AudioPreviewResponse.model_validate(preview_data)


def get_track_frame_pitch_data(track: Track) -> FramePitchArtifactPayload | None:
    frame_pitch_artifact = get_track_frame_pitch_artifact(track)
    if frame_pitch_artifact is None:
        return None

    artifact_path = Path(frame_pitch_artifact.storage_key)
    if artifact_path.exists():
        try:
            return FramePitchArtifactPayload.model_validate_json(artifact_path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, ValueError):
            pass

    if not isinstance(frame_pitch_artifact.meta_json, dict):
        return None

    frame_pitch_data = frame_pitch_artifact.meta_json.get("frame_pitch_data")
    if not isinstance(frame_pitch_data, dict):
        return None

    try:
        return FramePitchArtifactPayload.model_validate(frame_pitch_data)
    except ValidationError:
        return None


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


def _build_pitch_contour(
    samples: np.ndarray,
    sample_rate: int,
    points: int = CONTOUR_POINTS,
) -> list[float | None]:
    return build_preview_contour(samples, sample_rate, points=points)


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


def _write_model_json(path: Path, payload: FramePitchArtifactPayload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        payload.model_dump_json(indent=2),
        encoding="utf-8",
    )


def _build_frame_pitch_payload(samples: np.ndarray, sample_rate: int) -> FramePitchArtifactPayload:
    frames = extract_pitch_frames(
        samples,
        sample_rate,
        frame_length=PYIN_FRAME_LENGTH,
        hop_length=PYIN_HOP_LENGTH,
    )
    voiced_probs = [frame.voiced_prob for frame in frames if frame.voiced_prob is not None and frame.voiced]
    rms_values = [frame.rms for frame in frames if frame.rms is not None]

    return FramePitchArtifactPayload(
        version=FRAME_PITCH_ARTIFACT_VERSION,
        quality_mode=FRAME_PITCH_QUALITY_MODE,
        sample_rate=sample_rate,
        frame_length=PYIN_FRAME_LENGTH,
        hop_length=PYIN_HOP_LENGTH,
        frame_count=len(frames),
        voiced_frame_count=sum(1 for frame in frames if frame.voiced and frame.frequency_hz is not None),
        mean_voiced_prob=(
            round(float(np.mean(voiced_probs)), 4)
            if voiced_probs
            else None
        ),
        mean_rms=round(float(np.mean(rms_values)), 6) if rms_values else None,
        frames=[
            PitchFrameArtifactFrame(
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                frequency_hz=frame.frequency_hz,
                pitch_midi=frame.pitch_midi,
                voiced=frame.voiced,
                voiced_prob=frame.voiced_prob,
                rms=frame.rms,
            )
            for frame in frames
        ],
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
        frame_pitch_payload = _build_frame_pitch_payload(mono_samples, CANONICAL_SAMPLE_RATE)
        preview_data = AudioPreviewResponse(
            waveform=waveform,
            contour=contour,
            duration_ms=duration_ms,
            source="remote",
        )

        derived_root = _get_storage_root() / "projects" / str(track.project_id) / "derived"
        canonical_path = derived_root / f"{track.track_id}-canonical.wav"
        peaks_path = derived_root / f"{track.track_id}-preview.json"
        frame_pitch_path = derived_root / f"{track.track_id}-frame-pitch.json"

        _write_canonical_wav(canonical_path, mono_samples, CANONICAL_SAMPLE_RATE)
        _write_preview_json(peaks_path, preview_data)
        _write_model_json(frame_pitch_path, frame_pitch_payload)

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
            frame_pitch_path=frame_pitch_path,
            frame_pitch_payload=frame_pitch_payload,
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
        _validate_upload_session_window(track)
        probe = _probe_audio_file(track)
    except HTTPException as error:
        _mark_track_failed(
            session,
            track,
            error.detail if isinstance(error.detail, str) else "Track processing failed",
        )
        raise
    except Exception as error:
        _mark_track_failed(session, track, str(error))
        raise

    mime_type = track.source_format or mimetypes.guess_type(probe.source_path.name)[0] or "application/octet-stream"
    uploaded_artifact_type = _get_uploaded_audio_artifact_type(track)

    track.track_status = TrackStatus.READY
    track.failure_message = None
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

    frame_pitch_artifact = _get_track_artifact(track, ArtifactType.FRAME_PITCH)
    if frame_pitch_artifact is None:
        frame_pitch_artifact = Artifact(
            project_id=track.project_id,
            track=track,
            artifact_type=ArtifactType.FRAME_PITCH,
            storage_key=str(probe.frame_pitch_path),
            created_at=now,
            updated_at=now,
        )
        session.add(frame_pitch_artifact)

    frame_pitch_artifact.storage_key = str(probe.frame_pitch_path)
    frame_pitch_artifact.mime_type = "application/json"
    frame_pitch_artifact.byte_size = probe.frame_pitch_path.stat().st_size
    frame_pitch_artifact.updated_at = now
    frame_pitch_artifact.meta_json = {
        "artifact_version": probe.frame_pitch_payload.version,
        "quality_mode": probe.frame_pitch_payload.quality_mode,
        "sample_rate": probe.frame_pitch_payload.sample_rate,
        "frame_length": probe.frame_pitch_payload.frame_length,
        "hop_length": probe.frame_pitch_payload.hop_length,
        "frame_count": probe.frame_pitch_payload.frame_count,
        "voiced_frame_count": probe.frame_pitch_payload.voiced_frame_count,
        "mean_voiced_prob": probe.frame_pitch_payload.mean_voiced_prob,
        "mean_rms": probe.frame_pitch_payload.mean_rms,
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
        failure_message=track.failure_message,
        source_artifact_url=download_url,
        updated_at=track.updated_at,
    )
