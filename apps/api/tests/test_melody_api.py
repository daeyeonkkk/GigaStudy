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
    database_path = tmp_path / "melody.db"
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


def upload_ready_take(client: TestClient, project_id: str, wav_bytes: bytes) -> str:
    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    track_id = create_response.json()["track_id"]
    upload_response = client.post(
        f"/api/tracks/{track_id}/upload-url",
        json={"filename": "take.wav", "content_type": "audio/wav"},
    )
    client.put(upload_response.json()["upload_url"], content=wav_bytes)
    complete_response = client.post(
        f"/api/tracks/{track_id}/complete",
        json={"source_format": "audio/wav"},
    )
    assert complete_response.status_code == 200
    return track_id


def test_extract_melody_draft_returns_notes_and_midi(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={"title": "Melody Session", "bpm": 100, "base_key": "A"},
    ).json()["project_id"]
    take_id = upload_ready_take(
        client,
        project_id,
        build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000),
    )

    response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/melody")

    assert response.status_code == 200
    payload = response.json()
    assert payload["track_id"] == take_id
    assert payload["model_version"] == "heuristic-melody-v1"
    assert payload["note_count"] >= 1
    assert payload["notes_json"][0]["pitch_midi"] == 69
    assert payload["midi_artifact_url"] is not None

    midi_response = client.get(payload["midi_artifact_url"])
    assert midi_response.status_code == 200
    assert midi_response.content[:4] == b"MThd"

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["takes"][0]["latest_melody"] is not None


def test_update_melody_draft_rewrites_notes_and_midi(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={"title": "Edit Melody", "bpm": 96, "base_key": "C"},
    ).json()["project_id"]
    take_id = upload_ready_take(
        client,
        project_id,
        build_test_wav_bytes(duration_ms=1200, frequency_hz=523.25, sample_rate=32000),
    )

    extracted = client.post(f"/api/projects/{project_id}/tracks/{take_id}/melody").json()
    melody_draft_id = extracted["melody_draft_id"]
    updated = client.patch(
        f"/api/melody-drafts/{melody_draft_id}",
        json={
            "key_estimate": "D major",
            "notes": [
                {
                    "pitch_midi": 62,
                    "pitch_name": "D4",
                    "start_ms": 0,
                    "end_ms": 500,
                    "duration_ms": 500,
                    "phrase_index": 0,
                    "velocity": 88,
                },
                {
                    "pitch_midi": 64,
                    "pitch_name": "E4",
                    "start_ms": 500,
                    "end_ms": 1000,
                    "duration_ms": 500,
                    "phrase_index": 0,
                    "velocity": 88,
                },
            ],
        },
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["key_estimate"] == "D major"
    assert payload["note_count"] == 2
    assert [note["pitch_midi"] for note in payload["notes_json"]] == [62, 64]

    fetched = client.get(f"/api/projects/{project_id}/tracks/{take_id}/melody")
    assert fetched.status_code == 200
    assert fetched.json()["melody_draft_id"] == melody_draft_id
    assert fetched.json()["notes_json"][0]["pitch_name"] == "D4"
