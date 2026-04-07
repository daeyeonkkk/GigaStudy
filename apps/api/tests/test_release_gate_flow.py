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
    database_path = tmp_path / "release-gate.db"
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


def test_release_gate_flow_covers_foundation_mvp_line(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1800, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1800, frequency_hz=440.0, sample_rate=32000)
    mixdown_bytes = build_test_wav_bytes(duration_ms=1800, frequency_hz=440.0, sample_rate=32000)

    project_response = client.post(
        "/api/projects",
        json={
            "title": "Release Gate Session",
            "bpm": 96,
            "base_key": "A",
            "time_signature": "4/4",
            "mode": "major",
        },
    )
    assert project_response.status_code == 201
    project_id = project_response.json()["project_id"]

    device_profile_response = client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "release-gate-mic",
            "output_route": "headphones",
            "requested_constraints": {
                "audio": {
                    "echoCancellation": True,
                    "autoGainControl": True,
                    "noiseSuppression": True,
                    "channelCount": 1,
                }
            },
            "applied_settings": {
                "sampleRate": 48000,
                "channelCount": 1,
                "echoCancellation": True,
            },
            "actual_sample_rate": 48000,
            "channel_count": 1,
            "base_latency": 0.02,
            "output_latency": 0.01,
        },
    )
    assert device_profile_response.status_code == 200

    guide_init = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    )
    assert guide_init.status_code == 201
    guide_track_id = guide_init.json()["track_id"]
    client.put(guide_init.json()["upload_url"], content=guide_bytes)
    guide_complete = client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={
            "track_id": guide_track_id,
            "source_format": "audio/wav",
            "duration_ms": 1800,
            "actual_sample_rate": 32000,
        },
    )
    assert guide_complete.status_code == 200

    take_create = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    assert take_create.status_code == 201
    take_track_id = take_create.json()["track_id"]
    take_upload = client.post(
        f"/api/tracks/{take_track_id}/upload-url",
        json={"filename": "take.wav", "content_type": "audio/wav"},
    )
    assert take_upload.status_code in {200, 201}
    client.put(take_upload.json()["upload_url"], content=take_bytes)
    take_complete = client.post(
        f"/api/tracks/{take_track_id}/complete",
        json={
            "source_format": "audio/wav",
            "duration_ms": 1800,
            "actual_sample_rate": 32000,
        },
    )
    assert take_complete.status_code == 200

    analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_track_id}/analysis")
    assert analysis_response.status_code == 200
    assert analysis_response.json()["latest_score"]["total_score"] >= 80

    melody_response = client.post(f"/api/projects/{project_id}/tracks/{take_track_id}/melody")
    assert melody_response.status_code == 200
    melody_draft_id = melody_response.json()["melody_draft_id"]
    assert melody_response.json()["note_count"] >= 1

    arrangement_response = client.post(
        f"/api/projects/{project_id}/arrangements/generate",
        json={
            "melody_draft_id": melody_draft_id,
            "style": "contemporary",
            "difficulty": "basic",
            "voice_range_preset": "alto",
            "beatbox_template": "pulse",
            "candidate_count": 3,
        },
    )
    assert arrangement_response.status_code == 200
    arrangement_payload = arrangement_response.json()
    assert len(arrangement_payload["items"]) >= 2
    assert arrangement_payload["items"][0]["musicxml_artifact_url"] is not None
    assert arrangement_payload["items"][0]["midi_artifact_url"] is not None

    mixdown_init = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "mixdown.wav", "content_type": "audio/wav"},
    )
    assert mixdown_init.status_code in {200, 201}
    mixdown_track_id = mixdown_init.json()["track_id"]
    client.put(mixdown_init.json()["upload_url"], content=mixdown_bytes)
    mixdown_complete = client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": mixdown_track_id,
            "source_format": "audio/wav",
            "duration_ms": 1800,
            "actual_sample_rate": 32000,
        },
    )
    assert mixdown_complete.status_code == 200

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")
    assert snapshot_response.status_code == 200
    snapshot_payload = snapshot_response.json()
    assert snapshot_payload["guide"]["guide_wav_artifact_url"] is not None
    assert snapshot_payload["takes"][0]["latest_score"] is not None
    assert len(snapshot_payload["arrangements"]) >= 2
    assert snapshot_payload["mixdown"] is not None

    version_response = client.post(
        f"/api/projects/{project_id}/versions",
        json={"label": "Release gate snapshot"},
    )
    assert version_response.status_code == 201

    share_response = client.post(
        f"/api/projects/{project_id}/share-links",
        json={"label": "Release gate review", "expires_in_days": 7},
    )
    assert share_response.status_code == 201
    share_url = share_response.json()["share_url"]
    share_token = share_url.rstrip("/").split("/")[-1]

    shared_project_response = client.get(f"/api/shared/{share_token}")
    assert shared_project_response.status_code == 200
    assert shared_project_response.json()["snapshot_summary"]["take_count"] >= 1
    assert shared_project_response.json()["snapshot_summary"]["arrangement_count"] >= 2
