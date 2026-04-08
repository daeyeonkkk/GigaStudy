from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from audio_fixtures import build_test_wav_bytes
from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    database_path = tmp_path / "analysis.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", storage_root.as_posix())
    get_settings.cache_clear()

    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_session() -> Iterator[Session]:
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db_session] = override_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def upload_ready_track(
    client: TestClient,
    project_id: str,
    *,
    role: str,
    wav_bytes: bytes,
    filename: str,
    part_type: str = "LEAD",
) -> str:
    if role == "guide":
        init_response = client.post(
            f"/api/projects/{project_id}/guide/upload-url",
            json={"filename": filename, "content_type": "audio/wav"},
        )
        track_id = init_response.json()["track_id"]
        client.put(init_response.json()["upload_url"], content=wav_bytes)
        complete_response = client.post(
            f"/api/projects/{project_id}/guide/complete",
            json={"track_id": track_id, "source_format": "audio/wav"},
        )
        assert complete_response.status_code == 200
        return track_id

    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": part_type},
    )
    track_id = create_response.json()["track_id"]
    upload_response = client.post(
        f"/api/tracks/{track_id}/upload-url",
        json={"filename": filename, "content_type": "audio/wav"},
    )
    client.put(upload_response.json()["upload_url"], content=wav_bytes)
    complete_response = client.post(
        f"/api/tracks/{track_id}/complete",
        json={"source_format": "audio/wav"},
    )
    assert complete_response.status_code == 200
    return track_id


def test_run_track_analysis_persists_scores_and_snapshot_summary(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1800, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1800, frequency_hz=440.0, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Alignment Session", "base_key": "C", "bpm": 90},
    ).json()["project_id"]

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = upload_ready_track(client, project_id, role="take", wav_bytes=take_bytes, filename="take.wav")

    analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")

    assert analysis_response.status_code == 200
    payload = analysis_response.json()
    assert payload["track_id"] == take_id
    assert payload["latest_job"]["status"] == "SUCCEEDED"
    assert payload["alignment_confidence"] >= 0.6
    assert payload["latest_score"]["pitch_score"] >= 90
    assert payload["latest_score"]["rhythm_score"] >= 90
    assert payload["latest_score"]["total_score"] >= 88
    assert payload["latest_score"]["pitch_quality_mode"] == "NOTE_EVENT_V1"
    assert payload["latest_score"]["harmony_reference_mode"] == "KEY_ONLY"
    assert len(payload["latest_score"]["feedback_json"]) == 4
    assert len(payload["latest_score"]["note_feedback_json"]) >= 1

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")
    assert snapshot_response.status_code == 200
    take_payload = snapshot_response.json()["takes"][0]
    assert take_payload["latest_score"] is not None
    assert take_payload["latest_analysis_job"]["status"] == "SUCCEEDED"
    assert take_payload["alignment_confidence"] == payload["alignment_confidence"]


def test_analysis_distinguishes_matching_and_mismatched_takes(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000)
    matching_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000)
    mismatched_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=659.25, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Compare Session", "base_key": "C"},
    ).json()["project_id"]

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    matching_take_id = upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=matching_bytes,
        filename="matching.wav",
    )
    mismatched_take_id = upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=mismatched_bytes,
        filename="mismatched.wav",
    )

    matching_response = client.post(f"/api/projects/{project_id}/tracks/{matching_take_id}/analysis")
    mismatched_response = client.post(f"/api/projects/{project_id}/tracks/{mismatched_take_id}/analysis")

    assert matching_response.status_code == 200
    assert mismatched_response.status_code == 200

    matching_score = matching_response.json()["latest_score"]
    mismatched_score = mismatched_response.json()["latest_score"]

    assert matching_score["pitch_score"] > mismatched_score["pitch_score"]
    assert matching_score["total_score"] > mismatched_score["total_score"]


def test_get_track_frame_pitch_returns_stored_artifact(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1250, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1250, frequency_hz=493.88, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Frame Pitch Session", "base_key": "C"},
    ).json()["project_id"]

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = upload_ready_track(client, project_id, role="take", wav_bytes=take_bytes, filename="take.wav")

    frame_pitch_response = client.get(f"/api/projects/{project_id}/tracks/{take_id}/frame-pitch")

    assert frame_pitch_response.status_code == 200
    payload = frame_pitch_response.json()
    assert payload["track_id"] == take_id
    assert payload["artifact_type"] == "FRAME_PITCH"
    assert payload["payload"]["quality_mode"] == "FRAME_PITCH_V1"
    assert payload["payload"]["frame_count"] > 0
    assert payload["payload"]["voiced_frame_count"] > 0
    assert any(frame["frequency_hz"] is not None for frame in payload["payload"]["frames"])


def test_analysis_returns_signed_note_feedback_and_note_events_artifact(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, sample_rate=32000)
    sharp_take_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=466.16, sample_rate=32000)
    flat_take_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=415.3, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Signed Note Feedback", "base_key": "C"},
    ).json()["project_id"]

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    sharp_take_id = upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=sharp_take_bytes,
        filename="sharp.wav",
    )
    flat_take_id = upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=flat_take_bytes,
        filename="flat.wav",
    )

    sharp_response = client.post(f"/api/projects/{project_id}/tracks/{sharp_take_id}/analysis")
    flat_response = client.post(f"/api/projects/{project_id}/tracks/{flat_take_id}/analysis")

    assert sharp_response.status_code == 200
    assert flat_response.status_code == 200

    sharp_note = sharp_response.json()["latest_score"]["note_feedback_json"][0]
    flat_note = flat_response.json()["latest_score"]["note_feedback_json"][0]

    assert sharp_note["attack_signed_cents"] > 0
    assert sharp_note["max_sharp_cents"] > 0
    assert flat_note["attack_signed_cents"] < 0
    assert flat_note["max_flat_cents"] < 0
    assert sharp_response.json()["latest_score"]["pitch_quality_mode"] == "NOTE_EVENT_V1"

    note_events_response = client.get(f"/api/projects/{project_id}/tracks/{sharp_take_id}/note-events")
    assert note_events_response.status_code == 200
    note_events_payload = note_events_response.json()
    assert note_events_payload["artifact_type"] == "NOTE_EVENTS"
    assert note_events_payload["payload"]["quality_mode"] == "NOTE_EVENT_V1"
    assert note_events_payload["payload"]["note_count"] >= 1


def test_analysis_marks_low_confidence_note_for_quiet_take(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1400, frequency_hz=440.0, amplitude=0.2, sample_rate=32000)
    quiet_take_bytes = build_test_wav_bytes(duration_ms=1400, frequency_hz=440.0, amplitude=0.002, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Quiet Confidence", "base_key": "C"},
    ).json()["project_id"]

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = upload_ready_track(client, project_id, role="take", wav_bytes=quiet_take_bytes, filename="quiet.wav")

    response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")

    assert response.status_code == 200
    note = response.json()["latest_score"]["note_feedback_json"][0]
    assert note["confidence"] < 0.45
    assert "low confidence" in note["message"].lower()


def test_analysis_uses_chord_aware_harmony_when_project_has_chord_timeline(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={
            "title": "Chord Aware",
            "base_key": "C",
            "chord_timeline_json": [
                {
                    "start_ms": 0,
                    "end_ms": 2000,
                    "label": "A",
                    "root": "A",
                    "quality": "major",
                }
            ],
        },
    ).json()["project_id"]
    guide_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, sample_rate=32000)
    in_chord_take = build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, sample_rate=32000)
    out_of_chord_take = build_test_wav_bytes(duration_ms=1500, frequency_hz=392.0, sample_rate=32000)

    upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    in_take_id = upload_ready_track(client, project_id, role="take", wav_bytes=in_chord_take, filename="in.wav")
    out_take_id = upload_ready_track(client, project_id, role="take", wav_bytes=out_of_chord_take, filename="out.wav")

    in_response = client.post(f"/api/projects/{project_id}/tracks/{in_take_id}/analysis")
    out_response = client.post(f"/api/projects/{project_id}/tracks/{out_take_id}/analysis")

    assert in_response.status_code == 200
    assert out_response.status_code == 200
    assert in_response.json()["latest_score"]["harmony_reference_mode"] == "CHORD_AWARE"
    assert out_response.json()["latest_score"]["harmony_reference_mode"] == "CHORD_AWARE"
    assert in_response.json()["latest_score"]["harmony_fit_score"] > out_response.json()["latest_score"]["harmony_fit_score"]


def test_retry_failed_analysis_job_after_reprocessing(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Retry Analysis", "base_key": "C", "bpm": 92},
    ).json()["project_id"]

    guide_id = upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = upload_ready_track(client, project_id, role="take", wav_bytes=take_bytes, filename="take.wav")

    storage_root = Path(get_settings().storage_root).resolve()
    canonical_path = storage_root / "projects" / project_id / "derived" / f"{guide_id}-canonical.wav"
    canonical_path.unlink()

    failed_response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")
    assert failed_response.status_code == 400

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")
    assert snapshot_response.status_code == 200
    latest_job = snapshot_response.json()["takes"][0]["latest_analysis_job"]
    assert latest_job["status"] == "FAILED"
    assert latest_job["error_message"] is not None

    guide_retry = client.post(f"/api/tracks/{guide_id}/retry-processing")
    assert guide_retry.status_code == 200

    retry_response = client.post(f"/api/analysis-jobs/{latest_job['job_id']}/retry")
    assert retry_response.status_code == 200
    assert retry_response.json()["latest_job"]["status"] == "SUCCEEDED"
