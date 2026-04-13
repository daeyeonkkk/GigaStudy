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
    database_path = tmp_path / "guides.db"
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


def test_guide_upload_lifecycle(client: TestClient) -> None:
    wav_bytes = build_test_wav_bytes(duration_ms=1200, sample_rate=22050)
    project_response = client.post("/api/projects", json={"title": "Guide Session"})
    project_id = project_response.json()["project_id"]

    init_response = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    )

    assert init_response.status_code == 201
    init_payload = init_response.json()
    assert init_payload["method"] == "PUT"
    assert init_payload["upload_headers"] == {}

    upload_response = client.put(
        init_payload["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert upload_response.status_code == 204

    complete_response = client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={
            "track_id": init_payload["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 12000,
            "actual_sample_rate": 48000,
        },
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["track_status"] == "READY"
    assert complete_response.json()["source_artifact_url"] is not None
    assert complete_response.json()["guide_wav_artifact_url"] is not None
    assert complete_response.json()["actual_sample_rate"] == 22050
    assert complete_response.json()["preview_data"] is not None

    get_response = client.get(f"/api/projects/{project_id}/guide")
    assert get_response.status_code == 200
    assert get_response.json()["guide"]["duration_ms"] >= 1100
    assert get_response.json()["guide"]["preview_data"] is not None

    download_response = client.get(get_response.json()["guide"]["source_artifact_url"])
    assert download_response.status_code == 200
    assert download_response.content == wav_bytes

    wav_response = client.get(get_response.json()["guide"]["guide_wav_artifact_url"])
    assert wav_response.status_code == 200
    assert wav_response.headers["content-type"].startswith("audio/wav")


def test_get_guide_returns_null_when_project_has_no_guide(client: TestClient) -> None:
    project_response = client.post("/api/projects", json={"title": "No Guide Yet"})
    project_id = project_response.json()["project_id"]

    response = client.get(f"/api/projects/{project_id}/guide")

    assert response.status_code == 200
    assert response.json()["guide"] is None
