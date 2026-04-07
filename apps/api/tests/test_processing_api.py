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
    database_path = tmp_path / "processing.db"
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


def test_retry_processing_recovers_failed_take_after_upload_arrives(client: TestClient) -> None:
    wav_bytes = build_test_wav_bytes(duration_ms=1100, sample_rate=16000)
    project_response = client.post("/api/projects", json={"title": "Retry Take"})
    project_id = project_response.json()["project_id"]

    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    track = create_response.json()

    init_response = client.post(
        f"/api/tracks/{track['track_id']}/upload-url",
        json={"filename": "retry-take.wav", "content_type": "audio/wav"},
    )
    upload_url = init_response.json()["upload_url"]

    complete_response = client.post(
        f"/api/tracks/{track['track_id']}/complete",
        json={"source_format": "audio/wav"},
    )
    assert complete_response.status_code == 400

    client.put(upload_url, content=wav_bytes, headers={"Content-Type": "audio/wav"})

    retry_response = client.post(f"/api/tracks/{track['track_id']}/retry-processing")

    assert retry_response.status_code == 200
    payload = retry_response.json()
    assert payload["track_role"] == "VOCAL_TAKE"
    assert payload["track_status"] == "READY"
    assert payload["source_artifact_url"] is not None


def test_retry_processing_is_safe_for_ready_mixdown(client: TestClient) -> None:
    wav_bytes = build_test_wav_bytes(duration_ms=1000, sample_rate=44100)
    project_response = client.post("/api/projects", json={"title": "Retry Mixdown"})
    project_id = project_response.json()["project_id"]

    init_response = client.post(
        f"/api/projects/{project_id}/mixdown/upload-url",
        json={"filename": "retry-mix.wav", "content_type": "audio/wav"},
    )
    client.put(
        init_response.json()["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    client.post(
        f"/api/projects/{project_id}/mixdown/complete",
        json={
            "track_id": init_response.json()["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 1000,
            "actual_sample_rate": 44100,
        },
    )

    retry_response = client.post(
        f"/api/tracks/{init_response.json()['track_id']}/retry-processing"
    )

    assert retry_response.status_code == 200
    payload = retry_response.json()
    assert payload["track_role"] == "MIXDOWN"
    assert payload["track_status"] == "READY"
    assert payload["source_artifact_url"] is not None
