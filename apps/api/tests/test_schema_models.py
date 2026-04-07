from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from gigastudy_api.db.base import Base
from gigastudy_api.db.models import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    Artifact,
    ArtifactType,
    DeviceProfile,
    Project,
    Score,
    Track,
    TrackRole,
    TrackStatus,
    User,
)


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db_session:
        yield db_session


def test_project_can_link_guide_takes_and_mixdown(session: Session) -> None:
    user = User(nickname="founder")
    project = Project(
        user=user,
        title="Warmup Session",
        bpm=92,
        base_key="C",
        time_signature="4/4",
        mode="practice",
    )
    guide = Track(project=project, track_role=TrackRole.GUIDE, track_status=TrackStatus.READY)
    take_1 = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.READY,
        take_no=1,
        part_type="S",
    )
    take_2 = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.READY,
        take_no=2,
        part_type="S",
    )
    mixdown = Track(project=project, track_role=TrackRole.MIXDOWN, track_status=TrackStatus.READY)

    session.add_all(
        [
            user,
            project,
            guide,
            take_1,
            take_2,
            mixdown,
            Artifact(
                project=project,
                track=guide,
                artifact_type=ArtifactType.SOURCE_AUDIO,
                storage_key="guides/warmup.wav",
            ),
            Artifact(
                project=project,
                track=mixdown,
                artifact_type=ArtifactType.MIXDOWN_AUDIO,
                storage_key="mixdowns/warmup.wav",
            ),
        ]
    )
    session.commit()
    session.refresh(project)

    roles = sorted(track.track_role.value for track in project.tracks)

    assert roles == ["GUIDE", "MIXDOWN", "VOCAL_TAKE", "VOCAL_TAKE"]
    assert len(project.artifacts) == 2


def test_device_profile_unique_key_is_enforced(session: Session) -> None:
    user = User(nickname="device-owner")
    session.add(user)
    session.commit()

    profile = DeviceProfile(
        user=user,
        browser="Chrome",
        os="Windows",
        input_device_hash="mic-123",
        output_route="wired-headphones",
        requested_constraints_json={"channelCount": 1},
        applied_settings_json={"sampleRate": 48000},
        actual_sample_rate=48000,
        channel_count=1,
    )
    session.add(profile)
    session.commit()

    duplicate = DeviceProfile(
        user=user,
        browser="Chrome",
        os="Windows",
        input_device_hash="mic-123",
        output_route="wired-headphones",
    )
    session.add(duplicate)

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()

    another_route = DeviceProfile(
        user=user,
        browser="Chrome",
        os="Windows",
        input_device_hash="mic-123",
        output_route="bluetooth-headphones",
    )
    session.add(another_route)
    session.commit()

    assert session.query(DeviceProfile).count() == 2


def test_track_can_store_alignment_scores_and_analysis_jobs(session: Session) -> None:
    user = User(nickname="analyst")
    project = Project(user=user, title="Analysis Session", base_key="C")
    take = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.READY,
        take_no=1,
        alignment_offset_ms=35,
        alignment_confidence=0.91,
    )
    session.add_all(
        [
            user,
            project,
            take,
            AnalysisJob(
                project=project,
                track=take,
                job_type=AnalysisJobType.POST_RECORDING_SCORE,
                status=AnalysisJobStatus.SUCCEEDED,
                model_version="heuristic-alignment-v1",
            ),
            Score(
                project=project,
                track=take,
                pitch_score=92.0,
                rhythm_score=87.5,
                harmony_fit_score=84.0,
                total_score=88.6,
                feedback_json=[
                    {
                        "segment_index": 0,
                        "start_ms": 0,
                        "end_ms": 500,
                        "pitch_score": 92.0,
                        "rhythm_score": 87.5,
                        "harmony_fit_score": 84.0,
                        "message": "Stable phrase",
                    }
                ],
            ),
        ]
    )
    session.commit()
    session.refresh(take)

    assert take.alignment_offset_ms == 35
    assert take.alignment_confidence == pytest.approx(0.91)
    assert len(take.analysis_jobs) == 1
    assert len(take.scores) == 1


def test_alembic_upgrade_creates_phase1_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "phase1.db"
    api_dir = Path(__file__).resolve().parents[1]

    config = Config(str(api_dir / "alembic.ini"))
    config.set_main_option("script_location", str(api_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    table_names = set(inspect(engine).get_table_names())

    assert {
        "analysis_jobs",
        "artifacts",
        "device_profiles",
        "projects",
        "scores",
        "tracks",
        "users",
    } <= table_names
