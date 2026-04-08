from pathlib import Path
from uuid import uuid4

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
    Arrangement,
    Artifact,
    ArtifactType,
    DeviceProfile,
    MelodyDraft,
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
                model_version="librosa-pyin-note-events-v3",
            ),
            Score(
                project=project,
                track=take,
                pitch_score=92.0,
                rhythm_score=87.5,
                harmony_fit_score=84.0,
                total_score=88.6,
                pitch_quality_mode="NOTE_EVENT_V1",
                harmony_reference_mode="KEY_ONLY",
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
    assert take.scores[0].pitch_quality_mode == "NOTE_EVENT_V1"
    assert take.scores[0].harmony_reference_mode == "KEY_ONLY"


def test_track_can_store_editable_melody_draft(session: Session) -> None:
    user = User(nickname="melodist")
    project = Project(user=user, title="Melody Session", bpm=96, base_key="G")
    take = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.READY,
        take_no=1,
    )
    session.add_all(
        [
            user,
            project,
            take,
            MelodyDraft(
                project=project,
                track=take,
                model_version="librosa-pyin-melody-v2",
                key_estimate="G major",
                bpm=96,
                grid_division="1/16",
                phrase_count=1,
                note_count=2,
                notes_json=[
                    {
                        "pitch_midi": 67,
                        "pitch_name": "G4",
                        "start_ms": 0,
                        "end_ms": 500,
                        "duration_ms": 500,
                        "phrase_index": 0,
                        "velocity": 84,
                    },
                    {
                        "pitch_midi": 69,
                        "pitch_name": "A4",
                        "start_ms": 500,
                        "end_ms": 1000,
                        "duration_ms": 500,
                        "phrase_index": 0,
                        "velocity": 84,
                    },
                ],
                midi_storage_key="C:/tmp/test.mid",
                midi_byte_size=128,
            ),
        ]
    )
    session.commit()
    session.refresh(take)

    assert len(take.melody_drafts) == 1
    assert take.melody_drafts[0].key_estimate == "G major"
    assert take.melody_drafts[0].note_count == 2


def test_project_can_store_arrangement_candidates(session: Session) -> None:
    user = User(nickname="arranger")
    project = Project(user=user, title="Arrangement Session", bpm=92, base_key="C")
    take = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.READY,
        take_no=1,
    )
    melody_draft = MelodyDraft(
        project=project,
        track=take,
        model_version="librosa-pyin-melody-v2",
        key_estimate="C major",
        bpm=92,
        grid_division="1/16",
        phrase_count=1,
        note_count=1,
        notes_json=[
            {
                "pitch_midi": 60,
                "pitch_name": "C4",
                "start_ms": 0,
                "end_ms": 500,
                "duration_ms": 500,
                "phrase_index": 0,
                "velocity": 84,
            }
        ],
    )
    arrangement = Arrangement(
        generation_id=uuid4(),
        project=project,
        melody_draft=melody_draft,
        candidate_code="A",
        title="A • Close Stack",
        input_source_type="MELODY_DRAFT",
        style="contemporary",
        difficulty="basic",
        voice_mode="FOUR_PART_CLOSE",
        part_count=4,
        constraint_json={"max_leap": 9},
        parts_json=[
            {
                "part_name": "Lead Melody",
                "role": "MELODY",
                "range_label": "Source melody",
                "notes": [
                    {
                        "pitch_midi": 60,
                        "pitch_name": "C4",
                        "start_ms": 0,
                        "end_ms": 500,
                        "duration_ms": 500,
                        "phrase_index": 0,
                        "velocity": 84,
                    }
                ],
            }
        ],
        midi_storage_key="C:/tmp/arrangement.mid",
        midi_byte_size=256,
    )
    session.add_all([user, project, take, melody_draft, arrangement])
    session.commit()
    session.refresh(project)

    assert len(project.arrangements) == 1
    assert project.arrangements[0].candidate_code == "A"
    assert project.arrangements[0].melody_draft_id == melody_draft.melody_draft_id


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
        "arrangements",
        "artifacts",
        "device_profiles",
        "melody_drafts",
        "projects",
        "scores",
        "tracks",
        "users",
    } <= table_names
