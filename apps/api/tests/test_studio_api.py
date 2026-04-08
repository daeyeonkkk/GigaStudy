from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app
from audio_fixtures import build_test_wav_bytes


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    database_path = tmp_path / "studio.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", storage_root.as_posix())
    get_settings.cache_clear()

    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_session() -> Iterator[Session]:
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db_session] = override_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_studio_snapshot_returns_project_guide_takes_and_latest_profile(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=2000, sample_rate=48000)
    take_bytes = build_test_wav_bytes(duration_ms=1500, sample_rate=32000)
    project_response = client.post("/api/projects", json={"title": "Snapshot Session", "bpm": 96})
    project_id = project_response.json()["project_id"]

    client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "mic-a",
            "output_route": "headphones",
            "browser_user_agent": "Mozilla/5.0 Chrome/136.0",
            "requested_constraints": {"audio": {"echoCancellation": True}},
            "applied_settings": {"sampleRate": 48000},
            "capabilities": {"media_recorder": {"supported": True}},
            "diagnostic_flags": [],
            "actual_sample_rate": 48000,
            "channel_count": 1,
        },
    )

    client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "mic-b",
            "output_route": "headphones",
            "browser_user_agent": "Mozilla/5.0 Safari/617.1",
            "requested_constraints": {"audio": {"noiseSuppression": True}},
            "applied_settings": {"sampleRate": 44100},
            "capabilities": {"web_audio": {"audio_context_mode": "webkit"}},
            "diagnostic_flags": ["legacy_webkit_audio_context_only"],
            "actual_sample_rate": 44100,
            "channel_count": 1,
        },
    )

    guide_init = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    ).json()
    client.put(guide_init["upload_url"], content=guide_bytes)
    client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={
            "track_id": guide_init["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 2000,
            "actual_sample_rate": 48000,
        },
    )

    first_take = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    ).json()
    first_take_upload = client.post(
        f"/api/tracks/{first_take['track_id']}/upload-url",
        json={"filename": "take-1.wav", "content_type": "audio/wav"},
    ).json()
    client.put(first_take_upload["upload_url"], content=take_bytes)
    client.post(
        f"/api/tracks/{first_take['track_id']}/complete",
        json={"source_format": "audio/wav", "duration_ms": 1500, "actual_sample_rate": 48000},
    )

    second_take = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    ).json()

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")

    assert snapshot_response.status_code == 200
    payload = snapshot_response.json()
    assert payload["project"]["project_id"] == project_id
    assert payload["guide"]["track_role"] == "GUIDE"
    assert [item["take_no"] for item in payload["takes"]] == [2, 1]
    assert payload["takes"][0]["track_status"] == second_take["track_status"]
    assert payload["takes"][1]["track_status"] == "READY"
    assert payload["takes"][1]["preview_data"] is not None
    assert payload["latest_device_profile"]["input_device_hash"] == "mic-b"
    assert payload["latest_device_profile"]["browser_user_agent"] == "Mozilla/5.0 Safari/617.1"
    assert payload["latest_device_profile"]["capabilities_json"]["web_audio"]["audio_context_mode"] == "webkit"
    assert payload["latest_device_profile"]["diagnostic_flags_json"] == [
        "legacy_webkit_audio_context_only"
    ]
    assert payload["mixdown"] is None
    assert payload["arrangement_generation_id"] is None
    assert payload["arrangements"] == []


def test_studio_snapshot_includes_latest_mixdown_details(client: TestClient) -> None:
    first_mix_bytes = build_test_wav_bytes(duration_ms=1200, sample_rate=44100)
    second_mix_bytes = build_test_wav_bytes(duration_ms=2400, sample_rate=48000)
    project_response = client.post("/api/projects", json={"title": "Snapshot Mixdown"})
    project_id = project_response.json()["project_id"]

    first_mixdown = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "mix-a.wav", "content_type": "audio/wav"},
    ).json()
    client.put(first_mixdown["upload_url"], content=first_mix_bytes)
    client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": first_mixdown["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 1200,
            "actual_sample_rate": 44100,
        },
    )

    second_mixdown = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "mix-b.wav", "content_type": "audio/wav"},
    ).json()
    client.put(second_mixdown["upload_url"], content=second_mix_bytes)
    complete_response = client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": second_mixdown["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 2400,
            "actual_sample_rate": 48000,
        },
    )

    assert complete_response.status_code == 200

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")

    assert snapshot_response.status_code == 200
    mixdown = snapshot_response.json()["mixdown"]
    assert mixdown["track_id"] == second_mixdown["track_id"]
    assert mixdown["track_status"] == "READY"
    assert mixdown["duration_ms"] == 2400
    assert mixdown["actual_sample_rate"] == 48000
    assert mixdown["source_artifact_url"] is not None
    assert mixdown["preview_data"] is not None
    assert snapshot_response.json()["arrangements"] == []


def test_studio_snapshot_returns_404_for_missing_project(client: TestClient) -> None:
    response = client.get("/api/projects/00000000-0000-0000-0000-000000000001/studio")

    assert response.status_code == 404
