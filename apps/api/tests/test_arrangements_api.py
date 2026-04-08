from collections.abc import Iterator
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi.testclient import TestClient
from music21 import converter
from note_seq import midi_io
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
    database_path = tmp_path / "arrangements.db"
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


def test_generate_arrangements_creates_candidate_batch_and_snapshot(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={"title": "Arrangement Session", "bpm": 96, "base_key": "C"},
    ).json()["project_id"]
    take_id = upload_ready_take(
        client,
        project_id,
        build_test_wav_bytes(duration_ms=1600, frequency_hz=523.25, sample_rate=32000),
    )
    melody = client.post(f"/api/projects/{project_id}/tracks/{take_id}/melody").json()

    response = client.post(
        f"/api/projects/{project_id}/arrangements/generate",
        json={
            "melody_draft_id": melody["melody_draft_id"],
            "style": "contemporary",
            "difficulty": "basic",
            "voice_range_preset": "tenor",
            "beatbox_template": "drive",
            "candidate_count": 3,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 3
    assert {item["candidate_code"] for item in payload["items"]} == {"A", "B", "C"}
    assert any(item["part_count"] >= 5 for item in payload["items"])
    assert payload["items"][0]["midi_artifact_url"] is not None
    assert payload["items"][0]["musicxml_artifact_url"] is not None
    assert payload["items"][0]["voice_range_preset"] == "tenor"
    assert payload["items"][0]["beatbox_template"] == "drive"
    assert payload["items"][0]["comparison_summary"]["beatbox_note_count"] > 0
    assert payload["items"][0]["comparison_summary"]["support_part_count"] >= 3
    assert payload["items"][0]["constraint_json"]["voice_range_preset"] == "tenor"
    assert payload["items"][0]["constraint_json"]["beatbox_template"] == "drive"
    assert any(
        part["role"] == "PERCUSSION" and "Drive" in part["part_name"]
        for part in payload["items"][0]["parts_json"]
    )

    midi_response = client.get(payload["items"][0]["midi_artifact_url"])
    assert midi_response.status_code == 200
    assert midi_response.content[:4] == b"MThd"

    musicxml_response = client.get(payload["items"][0]["musicxml_artifact_url"])
    assert musicxml_response.status_code == 200
    assert b"<score-partwise" in musicxml_response.content
    assert b"<part-list>" in musicxml_response.content

    with NamedTemporaryFile(delete=False, suffix=".mid") as temp_file:
        midi_path = Path(temp_file.name)
    try:
        midi_path.write_bytes(midi_response.content)
        sequence = midi_io.midi_file_to_note_sequence(midi_path.as_posix())
        assert len(sequence.notes) >= 4
    finally:
        if midi_path.exists():
            midi_path.unlink()

    parsed_score = converter.parseData(musicxml_response.content.decode("utf-8"), format="musicxml")
    assert len(parsed_score.parts) >= 4
    assert parsed_score.parts[0].partName is not None

    list_response = client.get(f"/api/projects/{project_id}/arrangements")
    assert list_response.status_code == 200
    assert list_response.json()["generation_id"] == payload["generation_id"]
    assert len(list_response.json()["items"]) == 3

    snapshot_response = client.get(f"/api/projects/{project_id}/studio")
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["arrangement_generation_id"] == payload["generation_id"]
    assert len(snapshot_response.json()["arrangements"]) == 3


def test_update_arrangement_rewrites_candidate_parts(client: TestClient) -> None:
    project_id = client.post(
        "/api/projects",
        json={"title": "Arrangement Edit", "bpm": 92, "base_key": "G"},
    ).json()["project_id"]
    take_id = upload_ready_take(
        client,
        project_id,
        build_test_wav_bytes(duration_ms=1400, frequency_hz=392.0, sample_rate=32000),
    )
    melody = client.post(f"/api/projects/{project_id}/tracks/{take_id}/melody").json()
    generated = client.post(
        f"/api/projects/{project_id}/arrangements/generate",
        json={"melody_draft_id": melody["melody_draft_id"]},
    ).json()
    arrangement_id = generated["items"][0]["arrangement_id"]
    first_candidate = generated["items"][0]
    first_part = first_candidate["parts_json"][0]
    first_note = first_part["notes"][0]

    updated = client.patch(
        f"/api/arrangements/{arrangement_id}",
        json={
            "title": "A • Edited Close Stack",
            "parts_json": [
                {
                    **first_part,
                    "notes": [
                        {
                            **first_note,
                            "pitch_midi": first_note["pitch_midi"] + 2,
                            "pitch_name": "manual-edit",
                        }
                    ],
                }
            ],
        },
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["title"] == "A • Edited Close Stack"
    assert payload["part_count"] == 1
    assert payload["parts_json"][0]["notes"][0]["pitch_midi"] == first_note["pitch_midi"] + 2
    assert payload["musicxml_artifact_url"] is not None
    assert payload["comparison_summary"]["support_part_count"] == 0
    assert payload["voice_range_preset"] == "alto"
