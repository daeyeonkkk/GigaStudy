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
    project_response = client.post("/api/projects", json={"title": "Snapshot Session", "bpm": 96})
    project_id = project_response.json()["project_id"]

    client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "mic-a",
            "output_route": "headphones",
            "requested_constraints": {"audio": {"echoCancellation": True}},
            "applied_settings": {"sampleRate": 48000},
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
            "requested_constraints": {"audio": {"noiseSuppression": True}},
            "applied_settings": {"sampleRate": 44100},
            "actual_sample_rate": 44100,
            "channel_count": 1,
        },
    )

    guide_init = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    ).json()
    client.put(guide_init["upload_url"], content=b"guide-audio")
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
        json={"filename": "take-1.webm", "content_type": "audio/webm"},
    ).json()
    client.put(first_take_upload["upload_url"], content=b"take-one")
    client.post(
        f"/api/tracks/{first_take['track_id']}/complete",
        json={"source_format": "audio/webm", "duration_ms": 1500, "actual_sample_rate": 48000},
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
    assert payload["latest_device_profile"]["input_device_hash"] == "mic-b"
    assert payload["mixdown"] is None


def test_studio_snapshot_returns_404_for_missing_project(client: TestClient) -> None:
    response = client.get("/api/projects/00000000-0000-0000-0000-000000000001/studio")

    assert response.status_code == 404
