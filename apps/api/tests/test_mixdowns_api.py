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
    database_path = tmp_path / "mixdowns.db"
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


def test_mixdown_upload_lifecycle_updates_studio_snapshot(client: TestClient) -> None:
    wav_bytes = build_test_wav_bytes(duration_ms=2800, sample_rate=44100)
    project_response = client.post("/api/projects", json={"title": "Mixdown Session", "bpm": 104})
    project_id = project_response.json()["project_id"]

    init_response = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "practice-mix.wav", "content_type": "audio/wav"},
    )
    assert init_response.status_code == 201

    upload_response = client.put(
        init_response.json()["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert upload_response.status_code == 204

    complete_response = client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": init_response.json()["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 2800,
            "actual_sample_rate": 44100,
        },
    )
    assert complete_response.status_code == 200
    mixdown = complete_response.json()
    assert mixdown["track_role"] == "MIXDOWN"
    assert mixdown["track_status"] == "READY"
    assert mixdown["source_artifact_url"] is not None
    assert mixdown["preview_data"] is not None

    studio_response = client.get(f"/api/projects/{project_id}/studio")
    assert studio_response.status_code == 200
    assert studio_response.json()["mixdown"]["track_id"] == mixdown["track_id"]
    assert studio_response.json()["mixdown"]["source_artifact_url"] == mixdown["source_artifact_url"]
    assert studio_response.json()["mixdown"]["preview_data"] is not None

    download_response = client.get(mixdown["source_artifact_url"])
    assert download_response.status_code == 200
    assert download_response.content == wav_bytes


def test_mixdown_complete_marks_track_failed_when_upload_is_missing(client: TestClient) -> None:
    project_response = client.post("/api/projects", json={"title": "Missing Mixdown"})
    project_id = project_response.json()["project_id"]

    init_response = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "missing.wav", "content_type": "audio/wav"},
    )
    track_id = init_response.json()["track_id"]

    complete_response = client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": track_id,
            "source_format": "audio/wav",
        },
    )
    assert complete_response.status_code == 400

    studio_response = client.get(f"/api/projects/{project_id}/studio")
    assert studio_response.status_code == 200
    assert studio_response.json()["mixdown"]["track_status"] == "FAILED"
