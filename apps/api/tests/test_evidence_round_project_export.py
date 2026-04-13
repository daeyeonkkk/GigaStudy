from __future__ import annotations

from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
import wave
from uuid import UUID

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from audio_fixtures import build_test_wav_bytes
from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app
from gigastudy_api.services.evidence_round_project_export import export_project_take_to_evidence_round
from gigastudy_api.services.evidence_rounds import create_evidence_round_scaffold
from gigastudy_api.services.human_rating_builder import load_human_rating_metadata


@pytest.fixture
def client_and_session_factory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[TestClient, sessionmaker[Session]]]:
    database_path = tmp_path / "evidence-export.db"
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
        yield test_client, session_local

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


def test_export_project_take_to_evidence_round_replaces_seeded_template_and_writes_wavs(
    client_and_session_factory: tuple[TestClient, sessionmaker[Session]],
    tmp_path: Path,
) -> None:
    client, session_factory = client_and_session_factory
    project_id = client.post(
        "/api/projects",
        json={"title": "Real Round Seed", "base_key": "A", "bpm": 92},
    ).json()["project_id"]
    guide_track_id = _upload_ready_track(
        client,
        project_id,
        role="guide",
        wav_bytes=build_test_wav_bytes(duration_ms=1600, frequency_hz=440.0, sample_rate=32000),
        filename="guide.wav",
    )
    take_track_id = _upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=build_test_wav_bytes(duration_ms=1600, frequency_hz=466.16, sample_rate=32000),
        filename="take.wav",
    )
    analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_track_id}/analysis")
    assert analysis_response.status_code == 200

    round_paths = create_evidence_round_scaffold(
        round_id="round-export",
        output_root=tmp_path / "rounds",
    )

    with session_factory() as session:
        result = export_project_take_to_evidence_round(
            session,
            round_root=round_paths.root,
            project_id=UUID(project_id),
            take_track_id=UUID(take_track_id),
        )

    metadata = load_human_rating_metadata(round_paths.human_rating_cases_path)
    assert metadata.corpus_id == "human-rating-round-export"
    assert len(metadata.cases) == 1
    exported_case = metadata.cases[0]
    assert exported_case.case_id == result.case_id
    assert exported_case.expectation is not None
    assert exported_case.expectation.expected_pitch_quality_mode == "NOTE_EVENT_V1"
    assert exported_case.expectation.expected_harmony_reference_mode == "KEY_ONLY"
    assert exported_case.guide_source.wav_path == f"audio/guides/{result.case_id}-guide.wav"
    assert exported_case.take_source.wav_path == f"audio/takes/{result.case_id}-take.wav"
    assert result.guide_track_id == UUID(guide_track_id)
    assert result.template_case_removed is True
    assert result.template_sheet_rows_removed == 3
    assert result.expectation_seeded is True

    rating_sheet_lines = round_paths.human_rating_sheet_path.read_text(encoding="utf-8").splitlines()
    assert rating_sheet_lines == [
        "case_id,note_index,rater_id,attack_direction,sustain_direction,acceptability_label,notes"
    ]

    for exported_audio_path in (result.guide_output_path, result.take_output_path):
        assert exported_audio_path.exists()
        with wave.open(BytesIO(exported_audio_path.read_bytes()), "rb") as handle:
            assert handle.getframerate() == 16000
            assert handle.getnchannels() == 1
            assert handle.getnframes() > 0


def test_export_project_take_to_evidence_round_rejects_duplicate_case_without_overwrite(
    client_and_session_factory: tuple[TestClient, sessionmaker[Session]],
    tmp_path: Path,
) -> None:
    client, session_factory = client_and_session_factory
    project_id = client.post("/api/projects", json={"title": "Duplicate Check"}).json()["project_id"]
    _upload_ready_track(
        client,
        project_id,
        role="guide",
        wav_bytes=build_test_wav_bytes(duration_ms=1250, frequency_hz=440.0, sample_rate=32000),
        filename="guide.wav",
    )
    take_track_id = _upload_ready_track(
        client,
        project_id,
        role="take",
        wav_bytes=build_test_wav_bytes(duration_ms=1250, frequency_hz=440.0, sample_rate=32000),
        filename="take.wav",
    )

    round_paths = create_evidence_round_scaffold(
        round_id="round-duplicate",
        output_root=tmp_path / "rounds",
    )

    with session_factory() as session:
        first = export_project_take_to_evidence_round(
            session,
            round_root=round_paths.root,
            project_id=UUID(project_id),
            take_track_id=UUID(take_track_id),
        )

    with session_factory() as session:
        with pytest.raises(FileExistsError, match=first.case_id):
            export_project_take_to_evidence_round(
                session,
                round_root=round_paths.root,
                project_id=UUID(project_id),
                take_track_id=UUID(take_track_id),
            )
