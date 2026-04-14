from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

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


def _upload_ready_track(
    client: TestClient,
    project_id: str,
    *,
    role: str,
    wav_bytes: bytes,
    filename: str,
    part_type: str = "LEAD",
) -> str:
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
        json={"part_type": part_type},
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


def test_take_human_rating_packet_download_returns_zip_with_review_assets(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=466.16, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Human Rating Packet Session", "base_key": "C", "bpm": 96},
    ).json()["project_id"]

    _upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = _upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=take_bytes,
        filename="take.wav",
    )

    analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")
    assert analysis_response.status_code == 200

    packet_response = client.get(f"/api/projects/{project_id}/tracks/{take_id}/human-rating-packet")
    assert packet_response.status_code == 200
    assert packet_response.headers["content-type"] == "application/zip"
    assert "human-rating-packet.zip" in packet_response.headers["content-disposition"]

    with ZipFile(BytesIO(packet_response.content)) as archive:
        names = archive.namelist()
        assert "README.md" in names
        assert "human-rating/human_rating_cases.json" in names
        assert "human-rating/human_rating_sheet.csv" in names
        assert any(name.startswith("human-rating/audio/guides/") for name in names)
        assert any(name.startswith("human-rating/audio/takes/") for name in names)
        assert any(name.startswith("human-rating/references/") for name in names)
        assert any(name.startswith("human-rating/review-packets/") for name in names)

        review_packet_name = next(
            name for name in names if name.startswith("human-rating/review-packets/") and name.endswith(".html")
        )
        review_packet_html = archive.read(review_packet_name).decode("utf-8")
        assert '<html lang="ko">' in review_packet_html
        assert "시작음 / 지속음 / 허용도 / 메모" in review_packet_html


def test_take_real_evidence_batch_download_returns_full_round_zip(client: TestClient) -> None:
    guide_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000)
    take_bytes = build_test_wav_bytes(duration_ms=1600, frequency_hz=466.16, sample_rate=32000)
    project_id = client.post(
        "/api/projects",
        json={"title": "Real Evidence Batch Session", "base_key": "C", "bpm": 96},
    ).json()["project_id"]

    _upload_ready_track(client, project_id, role="guide", wav_bytes=guide_bytes, filename="guide.wav")
    take_id = _upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=take_bytes,
        filename="take.wav",
    )

    analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")
    assert analysis_response.status_code == 200

    batch_response = client.get(f"/api/projects/{project_id}/tracks/{take_id}/real-evidence-batch")
    assert batch_response.status_code == 200
    assert batch_response.headers["content-type"] == "application/zip"
    assert "real-evidence-batch.zip" in batch_response.headers["content-disposition"]

    with ZipFile(BytesIO(batch_response.content)) as archive:
        names = archive.namelist()
        assert "README.md" in names
        assert "REAL_EVIDENCE_PLAN.md" in names
        assert "REAL_EVIDENCE_CHECKLIST.md" in names
        assert "environment-validation/environment_validation_runs.csv" in names
        assert "human-rating/human_rating_cases.json" in names
        assert "human-rating/human_rating_sheet.csv" in names
        assert any(name.startswith("human-rating/audio/guides/") for name in names)
        assert any(name.startswith("human-rating/audio/takes/") for name in names)
        assert any(name.startswith("human-rating/references/") for name in names)
        assert any(name.startswith("human-rating/review-packets/") for name in names)

        plan_text = archive.read("REAL_EVIDENCE_PLAN.md").decode("utf-8")
        checklist_text = archive.read("REAL_EVIDENCE_CHECKLIST.md").decode("utf-8")
        assert "one coordinated batch" in plan_text
        assert "Human-rating claim gate reviewed" in checklist_text
