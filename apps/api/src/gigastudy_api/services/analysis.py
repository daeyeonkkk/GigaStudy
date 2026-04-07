from dataclasses import dataclass
from datetime import datetime, timezone
from math import log2
from pathlib import Path
from time import perf_counter
import wave
from uuid import UUID

import numpy as np
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.analysis import (
    AnalysisFeedbackItemResponse,
    AnalysisJobResponse,
    TrackAnalysisResponse,
    TrackScoreResponse,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    Artifact,
    ArtifactType,
    Project,
    Score,
    Track,
    TrackRole,
    TrackStatus,
)
from gigastudy_api.services.processing import get_track_preview_data


ANALYSIS_MODEL_VERSION = "heuristic-alignment-v1"
CANONICAL_SAMPLE_RATE = 16000
ENVELOPE_HOP_SAMPLES = 160
ENVELOPE_WINDOW_SAMPLES = 320
MAX_ALIGNMENT_MS = 2000
MIN_ALIGNMENT_OVERLAP_FRAMES = 24
SEGMENT_COUNT = 4

NOTE_TO_PITCH_CLASS = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "DB": 1,
    "D": 2,
    "D#": 3,
    "EB": 3,
    "E": 4,
    "FB": 4,
    "F": 5,
    "E#": 5,
    "F#": 6,
    "GB": 6,
    "G": 7,
    "G#": 8,
    "AB": 8,
    "A": 9,
    "A#": 10,
    "BB": 10,
    "B": 11,
    "CB": 11,
}
MAJOR_SCALE_INTERVALS = {0, 2, 4, 5, 7, 9, 11}


@dataclass
class AlignmentSlices:
    guide_start: int
    take_start: int
    overlap: int


@dataclass
class AnalysisComputation:
    alignment_offset_ms: int
    alignment_confidence: float
    pitch_score: float
    rhythm_score: float
    harmony_fit_score: float
    total_score: float
    feedback_items: list[dict[str, object]]


def _get_track_artifact(track: Track, artifact_type: ArtifactType) -> Artifact | None:
    for artifact in track.artifacts:
        if artifact.artifact_type == artifact_type:
            return artifact

    return None


def _read_canonical_samples(track: Track) -> np.ndarray:
    canonical_artifact = _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)
    if canonical_artifact is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track canonical audio is missing. Re-run upload processing first.",
        )

    canonical_path = Path(canonical_artifact.storage_key)
    if not canonical_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track canonical audio file is missing on disk.",
        )

    with wave.open(canonical_path.as_posix(), "rb") as wav_file:
        raw_frames = wav_file.readframes(wav_file.getnframes())
        samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32767.0

    return samples


def _build_energy_envelope(samples: np.ndarray) -> np.ndarray:
    if samples.size == 0:
        return np.zeros(1, dtype=np.float32)

    frame_count = max(1, int(np.ceil(samples.size / ENVELOPE_HOP_SAMPLES)))
    envelope = np.zeros(frame_count, dtype=np.float32)

    for frame_index in range(frame_count):
        start = frame_index * ENVELOPE_HOP_SAMPLES
        end = min(samples.size, start + ENVELOPE_WINDOW_SAMPLES)
        window_samples = samples[start:end]
        if window_samples.size == 0:
            continue
        envelope[frame_index] = float(np.sqrt(np.mean(np.square(window_samples))))

    peak = float(np.max(envelope)) if envelope.size else 0.0
    if peak > 0:
        envelope /= peak

    return envelope


def _get_overlap_slices(guide_length: int, take_length: int, shift: int) -> AlignmentSlices | None:
    guide_start = max(0, shift)
    take_start = max(0, -shift)
    overlap = min(guide_length - guide_start, take_length - take_start)
    if overlap <= 0:
        return None

    return AlignmentSlices(
        guide_start=guide_start,
        take_start=take_start,
        overlap=overlap,
    )


def _calculate_alignment(guide_envelope: np.ndarray, take_envelope: np.ndarray) -> tuple[int, float]:
    if guide_envelope.size == 0 or take_envelope.size == 0:
        return 0, 0.0

    max_shift_frames = max(1, MAX_ALIGNMENT_MS // 10)
    best_shift = 0
    best_score = -1.0
    best_coverage = 0.0

    for shift in range(-max_shift_frames, max_shift_frames + 1):
        overlap_slices = _get_overlap_slices(len(guide_envelope), len(take_envelope), shift)
        if overlap_slices is None or overlap_slices.overlap < MIN_ALIGNMENT_OVERLAP_FRAMES:
            continue

        guide_slice = guide_envelope[
            overlap_slices.guide_start : overlap_slices.guide_start + overlap_slices.overlap
        ]
        take_slice = take_envelope[
            overlap_slices.take_start : overlap_slices.take_start + overlap_slices.overlap
        ]
        centered_guide = guide_slice - np.mean(guide_slice)
        centered_take = take_slice - np.mean(take_slice)
        denominator = float(np.linalg.norm(centered_guide) * np.linalg.norm(centered_take))
        if denominator <= 1e-9:
            continue

        similarity = float(np.dot(centered_guide, centered_take) / denominator)
        coverage = overlap_slices.overlap / max(len(guide_envelope), len(take_envelope))
        weighted_similarity = similarity * coverage
        if weighted_similarity > best_score:
            best_score = weighted_similarity
            best_shift = shift
            best_coverage = coverage

    if best_score < 0:
        return 0, 0.0

    confidence = float(np.clip(best_score * (0.6 + (0.4 * best_coverage)), 0.0, 1.0))
    return best_shift * 10, round(confidence, 4)


def _align_numeric_arrays(
    guide_values: np.ndarray,
    take_values: np.ndarray,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> tuple[np.ndarray, np.ndarray]:
    guide_length = len(guide_values)
    take_length = len(take_values)
    if guide_length == 0 or take_length == 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    guide_step_ms = max(1.0, guide_duration_ms / guide_length)
    take_step_ms = max(1.0, take_duration_ms / take_length)
    shift = int(round(offset_ms / min(guide_step_ms, take_step_ms)))
    overlap_slices = _get_overlap_slices(guide_length, take_length, shift)
    if overlap_slices is None:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    return (
        guide_values[overlap_slices.guide_start : overlap_slices.guide_start + overlap_slices.overlap],
        take_values[overlap_slices.take_start : overlap_slices.take_start + overlap_slices.overlap],
    )


def _align_pitch_contours(
    guide_contour: list[float | None],
    take_contour: list[float | None],
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> list[tuple[float, float]]:
    guide_values = np.array([value if value is not None else np.nan for value in guide_contour], dtype=np.float32)
    take_values = np.array([value if value is not None else np.nan for value in take_contour], dtype=np.float32)
    aligned_guide, aligned_take = _align_numeric_arrays(
        guide_values,
        take_values,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    if aligned_guide.size == 0 or aligned_take.size == 0:
        return []

    pairs: list[tuple[float, float]] = []
    for guide_value, take_value in zip(aligned_guide, aligned_take, strict=False):
        if np.isnan(guide_value) or np.isnan(take_value):
            continue
        if guide_value <= 0 or take_value <= 0:
            continue
        pairs.append((float(guide_value), float(take_value)))

    return pairs


def _score_pitch_pairs(pairs: list[tuple[float, float]]) -> float:
    if not pairs:
        return 0.0

    scores: list[float] = []
    for guide_frequency, take_frequency in pairs:
        cents_difference = abs(1200 * log2(take_frequency / guide_frequency))
        scores.append(float(np.exp(-((cents_difference / 70) ** 2)) * 100))

    return round(float(np.mean(scores)), 2)


def _score_rhythm(
    guide_envelope: np.ndarray,
    take_envelope: np.ndarray,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> float:
    aligned_guide, aligned_take = _align_numeric_arrays(
        guide_envelope,
        take_envelope,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    if aligned_guide.size == 0 or aligned_take.size == 0:
        return 0.0

    mean_difference = float(np.mean(np.abs(aligned_guide - aligned_take)))
    return round(float(np.clip((1 - mean_difference) * 100, 0, 100)), 2)


def _normalize_key_name(value: str | None) -> str | None:
    if not value:
        return None

    cleaned = value.strip().upper().replace(" ", "")
    if not cleaned:
        return None

    if len(cleaned) >= 2 and cleaned[1] in {"B", "#"}:
        return cleaned[:2]

    return cleaned[:1]


def _score_harmony_fit(project: Project, take_contour: list[float | None]) -> float:
    key_name = _normalize_key_name(project.base_key)
    if key_name is None or key_name not in NOTE_TO_PITCH_CLASS:
        return 0.0

    tonic_pitch_class = NOTE_TO_PITCH_CLASS[key_name]
    voiced_pitch_classes: list[int] = []
    for frequency in take_contour:
        if frequency is None or frequency <= 0:
            continue

        midi_value = int(round(69 + (12 * log2(frequency / 440.0))))
        voiced_pitch_classes.append(midi_value % 12)

    if not voiced_pitch_classes:
        return 0.0

    in_key_count = sum(
        1
        for pitch_class in voiced_pitch_classes
        if ((pitch_class - tonic_pitch_class) % 12) in MAJOR_SCALE_INTERVALS
    )
    return round((in_key_count / len(voiced_pitch_classes)) * 100, 2)


def _blend_harmony_score(project: Project, raw_harmony_score: float, pitch_score: float, rhythm_score: float) -> float:
    if raw_harmony_score > 0:
        return raw_harmony_score

    return round(((pitch_score * 0.65) + (rhythm_score * 0.35)), 2)


def _score_segment_message(pitch_score: float, rhythm_score: float, harmony_score: float) -> str:
    if pitch_score < 55 and rhythm_score < 55:
        return "Pitch center and timing both drift in this phrase. Re-enter from the guide count and narrow the note target."
    if pitch_score < 60:
        return "Pitch wanders away from the guide here. Hold the center tone longer before moving to the next note."
    if rhythm_score < 60:
        return "Timing slips in this phrase. Aim the consonant and note attack closer to the guide pulse."
    if harmony_score < 60:
        return "The line leaves the project key here. Check the target note before the next entrance."

    return "This phrase stays close to the guide in pitch and timing."


def _build_feedback_items(
    pitch_pairs: list[tuple[float, float]],
    guide_envelope: np.ndarray,
    take_envelope: np.ndarray,
    take_contour: list[float | None],
    project: Project,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
    alignment_confidence: float,
) -> list[dict[str, object]]:
    aligned_guide_envelope, aligned_take_envelope = _align_numeric_arrays(
        guide_envelope,
        take_envelope,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    segment_length = max(1, len(aligned_guide_envelope) // SEGMENT_COUNT) if aligned_guide_envelope.size else 1
    segment_duration_ms = max(1, take_duration_ms // SEGMENT_COUNT)
    feedback_items: list[dict[str, object]] = []

    guide_contour = [pair[0] for pair in pitch_pairs]
    take_contour_aligned = [pair[1] for pair in pitch_pairs]
    pitch_segment_length = max(1, len(pitch_pairs) // SEGMENT_COUNT) if pitch_pairs else 1

    for segment_index in range(SEGMENT_COUNT):
        pitch_start = segment_index * pitch_segment_length
        pitch_end = len(pitch_pairs) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * pitch_segment_length
        segment_pitch_pairs = list(zip(guide_contour[pitch_start:pitch_end], take_contour_aligned[pitch_start:pitch_end], strict=False))
        segment_pitch_score = _score_pitch_pairs(segment_pitch_pairs)

        envelope_start = segment_index * segment_length
        envelope_end = len(aligned_guide_envelope) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * segment_length
        segment_rhythm_score = _score_rhythm(
            aligned_guide_envelope[envelope_start:envelope_end],
            aligned_take_envelope[envelope_start:envelope_end],
            0,
            guide_duration_ms,
            take_duration_ms,
        )

        contour_start = segment_index * max(1, len(take_contour) // SEGMENT_COUNT)
        contour_end = len(take_contour) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * max(1, len(take_contour) // SEGMENT_COUNT)
        segment_harmony_raw = _score_harmony_fit(project, take_contour[contour_start:contour_end])
        segment_harmony_score = _blend_harmony_score(
            project,
            segment_harmony_raw,
            segment_pitch_score,
            segment_rhythm_score,
        )

        message = _score_segment_message(segment_pitch_score, segment_rhythm_score, segment_harmony_score)
        if segment_index == 0 and alignment_confidence < 0.45:
            message = "Alignment confidence is low, so treat this phrase as a coarse guide and verify the attack timing manually."

        feedback_items.append(
            {
                "segment_index": segment_index,
                "start_ms": segment_index * segment_duration_ms,
                "end_ms": take_duration_ms if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * segment_duration_ms,
                "pitch_score": round(segment_pitch_score, 2),
                "rhythm_score": round(segment_rhythm_score, 2),
                "harmony_fit_score": round(segment_harmony_score, 2),
                "message": message,
            }
        )

    return feedback_items


def _calculate_total_score(pitch_score: float, rhythm_score: float, harmony_fit_score: float) -> float:
    total = (pitch_score * 0.45) + (rhythm_score * 0.35) + (harmony_fit_score * 0.20)
    return round(total, 2)


def _compute_analysis(project: Project, guide_track: Track, take_track: Track) -> AnalysisComputation:
    guide_preview = get_track_preview_data(guide_track)
    take_preview = get_track_preview_data(take_track)
    if guide_preview is None or take_preview is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Guide and take previews must exist before running analysis.",
        )

    guide_samples = _read_canonical_samples(guide_track)
    take_samples = _read_canonical_samples(take_track)
    guide_envelope = _build_energy_envelope(guide_samples)
    take_envelope = _build_energy_envelope(take_samples)
    alignment_offset_ms, alignment_confidence = _calculate_alignment(guide_envelope, take_envelope)

    pitch_pairs = _align_pitch_contours(
        guide_preview.contour,
        take_preview.contour,
        alignment_offset_ms,
        guide_preview.duration_ms or guide_track.duration_ms or 0,
        take_preview.duration_ms or take_track.duration_ms or 0,
    )
    pitch_score = _score_pitch_pairs(pitch_pairs)
    rhythm_score = _score_rhythm(
        guide_envelope,
        take_envelope,
        alignment_offset_ms,
        guide_preview.duration_ms or guide_track.duration_ms or 0,
        take_preview.duration_ms or take_track.duration_ms or 0,
    )
    harmony_raw = _score_harmony_fit(project, take_preview.contour)
    harmony_fit_score = _blend_harmony_score(project, harmony_raw, pitch_score, rhythm_score)
    feedback_items = _build_feedback_items(
        pitch_pairs,
        guide_envelope,
        take_envelope,
        take_preview.contour,
        project,
        alignment_offset_ms,
        guide_preview.duration_ms or guide_track.duration_ms or 0,
        take_preview.duration_ms or take_track.duration_ms or 0,
        alignment_confidence,
    )

    return AnalysisComputation(
        alignment_offset_ms=alignment_offset_ms,
        alignment_confidence=alignment_confidence,
        pitch_score=pitch_score,
        rhythm_score=rhythm_score,
        harmony_fit_score=harmony_fit_score,
        total_score=_calculate_total_score(pitch_score, rhythm_score, harmony_fit_score),
        feedback_items=feedback_items,
    )


def _get_track_with_analysis(session: Session, track_id: UUID) -> Track | None:
    result = session.execute(
        select(Track)
        .execution_options(populate_existing=True)
        .options(
            joinedload(Track.artifacts),
            joinedload(Track.analysis_jobs),
            joinedload(Track.scores),
        )
        .where(Track.track_id == track_id)
    )
    return result.unique().scalars().first()


def _get_project_or_404(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = _get_track_with_analysis(session, track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track


def _get_analysis_job_or_404(session: Session, job_id: UUID) -> AnalysisJob:
    job = session.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis job not found")

    return job


def _get_latest_guide_track(session: Session, project_id: UUID) -> Track:
    guide_track = (
        session.execute(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(
            Track.project_id == project_id,
            Track.track_role == TrackRole.GUIDE,
            Track.track_status == TrackStatus.READY,
        )
        .order_by(Track.updated_at.desc())
        .limit(1)
        )
        .unique()
        .scalars()
        .first()
    )
    if guide_track is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A READY guide track is required before analysis can run.",
        )

    return guide_track


def get_latest_analysis_job(track: Track) -> AnalysisJob | None:
    if not track.analysis_jobs:
        return None

    return max(track.analysis_jobs, key=lambda item: item.requested_at)


def get_latest_score(track: Track) -> Score | None:
    if not track.scores:
        return None

    return max(track.scores, key=lambda item: item.created_at)


def build_analysis_job_response(job: AnalysisJob) -> AnalysisJobResponse:
    return AnalysisJobResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        track_id=job.track_id,
        job_type=job.job_type.value,
        status=job.status.value,
        model_version=job.model_version,
        requested_at=job.requested_at,
        finished_at=job.finished_at,
        error_message=job.error_message,
    )


def build_track_score_response(score: Score) -> TrackScoreResponse:
    raw_feedback = score.feedback_json if isinstance(score.feedback_json, list) else []
    feedback_items = [AnalysisFeedbackItemResponse.model_validate(item) for item in raw_feedback]

    return TrackScoreResponse(
        score_id=score.score_id,
        project_id=score.project_id,
        track_id=score.track_id,
        pitch_score=round(score.pitch_score, 2),
        rhythm_score=round(score.rhythm_score, 2),
        harmony_fit_score=round(score.harmony_fit_score, 2),
        total_score=round(score.total_score, 2),
        feedback_json=feedback_items,
        created_at=score.created_at,
        updated_at=score.updated_at,
    )


def build_track_analysis_response(track: Track, guide_track_id: UUID) -> TrackAnalysisResponse:
    latest_job = get_latest_analysis_job(track)
    latest_score = get_latest_score(track)
    if latest_job is None or latest_score is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track analysis has not been created yet.",
        )

    return TrackAnalysisResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        guide_track_id=guide_track_id,
        alignment_offset_ms=track.alignment_offset_ms,
        alignment_confidence=track.alignment_confidence,
        latest_job=build_analysis_job_response(latest_job),
        latest_score=build_track_score_response(latest_score),
    )


def run_track_analysis(session: Session, project_id: UUID, track_id: UUID) -> TrackAnalysisResponse:
    settings = get_settings()
    project = _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project.project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")
    if track.track_role != TrackRole.VOCAL_TAKE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only vocal takes can be analyzed")
    if track.track_status != TrackStatus.READY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track must be READY before analysis")

    guide_track = _get_latest_guide_track(session, project_id)
    requested_at = datetime.now(timezone.utc)
    job = AnalysisJob(
        project_id=project.project_id,
        track_id=track.track_id,
        job_type=AnalysisJobType.POST_RECORDING_SCORE,
        status=AnalysisJobStatus.RUNNING,
        model_version=ANALYSIS_MODEL_VERSION,
        requested_at=requested_at,
    )
    session.add(job)
    session.commit()

    try:
        started_at = perf_counter()
        track = _get_track_or_404(session, track_id)
        guide_track = _get_latest_guide_track(session, project_id)
        computation = _compute_analysis(project, guide_track, track)
        if settings.analysis_timeout_seconds > 0:
            elapsed_seconds = perf_counter() - started_at
            if elapsed_seconds > settings.analysis_timeout_seconds:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=(
                        "Analysis exceeded the timeout policy. Retry the job or reduce the input length."
                    ),
                )
        finished_at = datetime.now(timezone.utc)

        track.alignment_offset_ms = computation.alignment_offset_ms
        track.alignment_confidence = computation.alignment_confidence
        track.updated_at = finished_at

        score = Score(
            project_id=track.project_id,
            track_id=track.track_id,
            pitch_score=computation.pitch_score,
            rhythm_score=computation.rhythm_score,
            harmony_fit_score=computation.harmony_fit_score,
            total_score=computation.total_score,
            feedback_json=computation.feedback_items,
            created_at=finished_at,
            updated_at=finished_at,
        )
        session.add(score)

        job = session.get(AnalysisJob, job.job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Analysis job was lost")

        job.status = AnalysisJobStatus.SUCCEEDED
        job.finished_at = finished_at
        job.error_message = None

        session.commit()
    except HTTPException as error:
        failed_job = session.get(AnalysisJob, job.job_id)
        if failed_job is not None:
            failed_job.status = AnalysisJobStatus.FAILED
            failed_job.finished_at = datetime.now(timezone.utc)
            failed_job.error_message = error.detail if isinstance(error.detail, str) else "Analysis failed"
            session.commit()
        raise
    except Exception as error:
        failed_job = session.get(AnalysisJob, job.job_id)
        if failed_job is not None:
            failed_job.status = AnalysisJobStatus.FAILED
            failed_job.finished_at = datetime.now(timezone.utc)
            failed_job.error_message = str(error)
            session.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected analysis failure",
        ) from error

    refreshed_track = _get_track_or_404(session, track_id)
    return build_track_analysis_response(refreshed_track, guide_track.track_id)


def get_track_analysis(session: Session, project_id: UUID, track_id: UUID) -> TrackAnalysisResponse:
    _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")

    guide_track = _get_latest_guide_track(session, project_id)
    return build_track_analysis_response(track, guide_track.track_id)


def retry_analysis_job(session: Session, job_id: UUID) -> TrackAnalysisResponse:
    job = _get_analysis_job_or_404(session, job_id)
    if job.status != AnalysisJobStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only FAILED analysis jobs can be retried.",
        )

    return run_track_analysis(session, job.project_id, job.track_id)
