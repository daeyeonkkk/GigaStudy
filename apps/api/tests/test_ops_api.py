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
    database_path = tmp_path / "ops.db"
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


def upload_ready_track(client: TestClient, project_id: str, *, role: str, wav_bytes: bytes, filename: str) -> str:
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
        json={"part_type": "LEAD"},
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


def test_ops_overview_reports_failures_and_model_versions(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={"title": "Ops Session", "base_key": "C", "bpm": 96},
    ).json()["project_id"]

    failed_take = client.post(f"/api/projects/{project_id}/tracks", json={"part_type": "LEAD"}).json()
    client.post(
        f"/api/tracks/{failed_take['track_id']}/upload-url",
        json={"filename": "broken.wav", "content_type": "audio/wav"},
    )
    failed_complete = client.post(
        f"/api/tracks/{failed_take['track_id']}/complete",
        json={"source_format": "audio/wav"},
    )
    assert failed_complete.status_code == 400

    guide_id = upload_ready_track(
        client,
        project_id,
        role="guide",
        wav_bytes=build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000),
        filename="guide.wav",
    )
    take_id = upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000),
        filename="take.wav",
    )

    storage_root = Path(get_settings().storage_root).resolve()
    canonical_path = storage_root / "projects" / project_id / "derived" / f"{guide_id}-canonical.wav"
    canonical_path.unlink()

    failed_analysis = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")
    assert failed_analysis.status_code == 400

    ops_response = client.get("/api/admin/ops")
    assert ops_response.status_code == 200
    payload = ops_response.json()

    assert payload["summary"]["project_count"] == 1
    assert payload["summary"]["failed_track_count"] >= 1
    assert payload["summary"]["failed_analysis_job_count"] >= 1
    assert payload["policies"]["analysis_timeout_seconds"] >= 0
    assert payload["policies"]["upload_session_expiry_minutes"] >= 0
    assert "librosa-pyin-note-events-v4" in payload["model_versions"]["analysis"]
    assert "librosa-pyin-melody-v2" in payload["model_versions"]["melody"]
    assert "rule-stack-v1" in payload["model_versions"]["arrangement_engine"]
    assert any(item["failure_message"] for item in payload["failed_tracks"])
    assert any(item["status"] == "FAILED" for item in payload["recent_analysis_jobs"])
