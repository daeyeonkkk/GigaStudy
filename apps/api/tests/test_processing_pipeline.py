from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.guides import GuideCompleteRequest, GuideUploadInitRequest
from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.models import ArtifactType, Project, User
from gigastudy_api.services.guides import create_guide_upload_session, complete_guide_upload, store_track_upload
from audio_fixtures import build_test_wav_bytes


@pytest.fixture
def session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Session:
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", (tmp_path / "storage").as_posix())
    get_settings.cache_clear()

    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db_session:
        yield db_session

    get_settings.cache_clear()


def test_complete_guide_upload_generates_canonical_and_preview_artifacts(session: Session) -> None:
    user = User(nickname="processor")
    session.add(user)
    session.commit()

    project = Project(user_id=user.user_id, title="Processing Guide")
    session.add(project)
    session.commit()

    guide = create_guide_upload_session(
        session,
        project.project_id,
        GuideUploadInitRequest(filename="guide.wav", content_type="audio/wav"),
    )
    wav_bytes = build_test_wav_bytes(duration_ms=1350, sample_rate=32000)
    store_track_upload(session, guide.track_id, wav_bytes)

    completed = complete_guide_upload(
        session,
        project.project_id,
        GuideCompleteRequest(track_id=guide.track_id, source_format="audio/wav"),
    )

    artifact_types = {artifact.artifact_type for artifact in completed.artifacts}
    assert ArtifactType.SOURCE_AUDIO in artifact_types
    assert ArtifactType.CANONICAL_AUDIO in artifact_types
    assert ArtifactType.WAVEFORM_PEAKS in artifact_types
    assert ArtifactType.FRAME_PITCH in artifact_types

    canonical_artifact = next(
        artifact for artifact in completed.artifacts if artifact.artifact_type == ArtifactType.CANONICAL_AUDIO
    )
    peaks_artifact = next(
        artifact for artifact in completed.artifacts if artifact.artifact_type == ArtifactType.WAVEFORM_PEAKS
    )
    frame_pitch_artifact = next(
        artifact for artifact in completed.artifacts if artifact.artifact_type == ArtifactType.FRAME_PITCH
    )

    assert completed.actual_sample_rate == 32000
    assert completed.duration_ms is not None and completed.duration_ms >= 1300
    assert Path(canonical_artifact.storage_key).exists()
    assert Path(peaks_artifact.storage_key).exists()
    assert Path(frame_pitch_artifact.storage_key).exists()
    assert isinstance(peaks_artifact.meta_json, dict)
    assert "preview_data" in peaks_artifact.meta_json
    assert isinstance(frame_pitch_artifact.meta_json, dict)
    assert frame_pitch_artifact.meta_json["quality_mode"] == "FRAME_PITCH_V1"
    assert frame_pitch_artifact.meta_json["frame_count"] > 0
