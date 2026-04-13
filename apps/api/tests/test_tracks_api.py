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
    database_path = tmp_path / "tracks.db"
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


def test_take_upload_lifecycle_and_list(client: TestClient) -> None:
    wav_bytes = build_test_wav_bytes(duration_ms=900, sample_rate=24000)
    project_response = client.post("/api/projects", json={"title": "Take Session"})
    project_id = project_response.json()["project_id"]

    first_take_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={
            "part_type": "LEAD",
            "recording_started_at": "2026-04-07T10:00:00Z",
            "recording_finished_at": "2026-04-07T10:00:04Z",
        },
    )
    assert first_take_response.status_code == 201
    first_take = first_take_response.json()
    assert first_take["take_no"] == 1
    assert first_take["track_status"] == "PENDING_UPLOAD"

    init_response = client.post(
        f"/api/tracks/{first_take['track_id']}/upload-url",
        json={"filename": "take-one.wav", "content_type": "audio/wav"},
    )
    assert init_response.status_code == 200
    assert init_response.json()["upload_headers"] == {}

    upload_response = client.put(
        init_response.json()["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert upload_response.status_code == 204

    complete_response = client.post(
        f"/api/tracks/{first_take['track_id']}/complete",
        json={
            "source_format": "audio/wav",
            "duration_ms": 4100,
            "actual_sample_rate": 48000,
        },
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["track_status"] == "READY"
    assert complete_response.json()["source_artifact_url"] is not None
    assert complete_response.json()["actual_sample_rate"] == 24000
    assert complete_response.json()["preview_data"] is not None

    second_take_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={
            "part_type": "LEAD",
            "recording_started_at": "2026-04-07T10:05:00Z",
            "recording_finished_at": "2026-04-07T10:05:03Z",
        },
    )
    assert second_take_response.status_code == 201
    assert second_take_response.json()["take_no"] == 2

    list_response = client.get(f"/api/projects/{project_id}/tracks")
    assert list_response.status_code == 200
    items = list_response.json()["items"]

    assert [item["take_no"] for item in items] == [2, 1]
    assert items[0]["track_status"] == "PENDING_UPLOAD"
    assert items[1]["track_status"] == "READY"


def test_take_complete_marks_failed_when_upload_is_missing(client: TestClient) -> None:
    project_response = client.post("/api/projects", json={"title": "Broken Upload"})
    project_id = project_response.json()["project_id"]

    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    track_id = create_response.json()["track_id"]

    client.post(
        f"/api/tracks/{track_id}/upload-url",
        json={"filename": "missing.wav", "content_type": "audio/wav"},
    )

    complete_response = client.post(
        f"/api/tracks/{track_id}/complete",
        json={"source_format": "audio/wav"},
    )

    assert complete_response.status_code == 400

    list_response = client.get(f"/api/projects/{project_id}/tracks")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["track_status"] == "FAILED"
    assert list_response.json()["items"][0]["failure_message"] is not None
