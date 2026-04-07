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
    database_path = tmp_path / "project-history.db"
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


def seed_project_snapshot(client: TestClient) -> str:
    project_id = client.post(
        "/api/projects",
        json={"title": "History Session", "bpm": 96, "base_key": "C"},
    ).json()["project_id"]

    guide_upload = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    ).json()
    client.put(guide_upload["upload_url"], content=build_test_wav_bytes(duration_ms=1800, sample_rate=44100))
    client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={
            "track_id": guide_upload["track_id"],
            "source_format": "audio/wav",
            "duration_ms": 1800,
            "actual_sample_rate": 44100,
        },
    )

    take = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    ).json()
    take_upload = client.post(
        f"/api/tracks/{take['track_id']}/upload-url",
        json={"filename": "take.wav", "content_type": "audio/wav"},
    ).json()
    client.put(take_upload["upload_url"], content=build_test_wav_bytes(duration_ms=1400, sample_rate=32000))
    client.post(
        f"/api/tracks/{take['track_id']}/complete",
        json={
            "source_format": "audio/wav",
            "duration_ms": 1400,
            "actual_sample_rate": 32000,
        },
    )

    return project_id


def test_project_versions_capture_and_list_snapshot_summary(client: TestClient) -> None:
    project_id = seed_project_snapshot(client)

    create_response = client.post(
        f"/api/projects/{project_id}/versions",
        json={"label": "Before external review", "note": "Freeze current studio state."},
    )

    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["label"] == "Before external review"
    assert payload["source_type"] == "MANUAL_SNAPSHOT"
    assert payload["snapshot_summary"]["has_guide"] is True
    assert payload["snapshot_summary"]["take_count"] == 1
    assert payload["snapshot_summary"]["ready_take_count"] == 1

    list_response = client.get(f"/api/projects/{project_id}/versions")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["version_id"] == payload["version_id"]


def test_share_link_creates_snapshot_and_serves_public_read_only_payload(client: TestClient) -> None:
    project_id = seed_project_snapshot(client)

    create_response = client.post(
        f"/api/projects/{project_id}/share-links",
        json={"label": "Coach review", "expires_in_days": 3},
    )

    assert create_response.status_code == 201
    share_link = create_response.json()
    assert share_link["label"] == "Coach review"
    assert share_link["access_scope"] == "READ_ONLY"
    assert share_link["share_url"].endswith(f"/shared/{share_link['share_url'].split('/')[-1]}")

    token = share_link["share_url"].rstrip("/").split("/")[-1]
    public_response = client.get(f"/api/shared/{token}")

    assert public_response.status_code == 200
    payload = public_response.json()
    assert payload["share_link_id"] == share_link["share_link_id"]
    assert payload["project"]["project_id"] == project_id
    assert payload["snapshot_summary"]["take_count"] == 1
    assert len(payload["takes"]) == 1
    assert payload["takes"][0]["storage_key"] is None
    assert "latest_device_profile" not in payload


def test_deactivating_share_link_blocks_further_public_access(client: TestClient) -> None:
    project_id = seed_project_snapshot(client)
    share_link = client.post(
        f"/api/projects/{project_id}/share-links",
        json={"label": "Temporary reviewer", "expires_in_days": 2},
    ).json()
    token = share_link["share_url"].rstrip("/").split("/")[-1]

    deactivate_response = client.post(f"/api/share-links/{share_link['share_link_id']}/deactivate")
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False

    public_response = client.get(f"/api/shared/{token}")
    assert public_response.status_code == 410
