import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.config import get_settings
from gigastudy_api.main import create_app
from gigastudy_api.services import studio_repository


ADMIN_PASSWORD = "\ub300\uc5f0123"
ADMIN_HEADERS = {
    "X-GigaStudy-Admin-User": "admin",
    "X-GigaStudy-Admin-Password-B64": base64.b64encode(ADMIN_PASSWORD.encode("utf-8")).decode("ascii"),
}
TOKEN_HEADERS = {"X-GigaStudy-Admin-Token": "secret-token"}


def admin_headers(password: str) -> dict[str, str]:
    return {
        "X-GigaStudy-Admin-User": "admin",
        "X-GigaStudy-Admin-Password-B64": base64.b64encode(password.encode("utf-8")).decode("ascii"),
    }


def build_client(tmp_path: Path, monkeypatch, *, admin_token: str | None = None) -> TestClient:
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", str(tmp_path))
    if admin_token is None:
        monkeypatch.delenv("GIGASTUDY_API_ADMIN_TOKEN", raising=False)
    else:
        monkeypatch.setenv("GIGASTUDY_API_ADMIN_TOKEN", admin_token)
    get_settings.cache_clear()
    studio_repository._repository = None
    return TestClient(create_app())


def create_audio_studio(client: TestClient) -> tuple[str, dict]:
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Admin cleanup target",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    assert create_response.status_code == 200
    studio_id = create_response.json()["studio_id"]
    audio_bytes = b"RIFF....WAVEfmt test admin cleanup audio"
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "cleanup.wav",
            "content_base64": encoded,
        },
    )
    assert upload_response.status_code == 200
    return studio_id, upload_response.json()


def test_admin_storage_accepts_default_admin_login(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.get("/api/admin/storage", headers=ADMIN_HEADERS)

    assert response.status_code == 200


def test_admin_storage_accepts_keyboard_alias_for_alpha_login(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.get("/api/admin/storage", headers=admin_headers("eodus123"))

    assert response.status_code == 200


def test_admin_storage_rejects_wrong_login(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.get(
        "/api/admin/storage",
        headers={
            "X-GigaStudy-Admin-User": "admin",
            "X-GigaStudy-Admin-Password": "wrong",
        },
    )

    assert response.status_code == 401


def test_admin_storage_still_accepts_configured_token(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch, admin_token="secret-token")

    response = client.get("/api/admin/storage", headers=TOKEN_HEADERS)

    assert response.status_code == 200


def test_admin_storage_summary_is_paginated(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    for index in range(3):
        response = client.post(
            "/api/studios",
            json={
                "title": f"Paged studio {index}",
                "bpm": 92,
                "start_mode": "blank",
            },
        )
        assert response.status_code == 200

    response = client.get(
        "/api/admin/storage?studio_limit=2&studio_offset=0&asset_limit=0",
        headers=ADMIN_HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["studio_count"] == 3
    assert payload["listed_studio_count"] == 2
    assert payload["studio_limit"] == 2
    assert payload["studio_offset"] == 0
    assert payload["has_more_studios"] is True
    assert len(payload["studios"]) == 2


def test_admin_can_list_and_delete_individual_studio_asset(tmp_path: Path, monkeypatch) -> None:
    def fake_transcribe_voice_file(*args, **kwargs):
        return [
            TrackNote(
                pitch_midi=72,
                pitch_hz=261.63,
                label="C5",
                onset_seconds=0,
                duration_seconds=1,
                beat=1,
                duration_beats=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fake_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    studio_id, studio_payload = create_audio_studio(client)
    relative_audio_path = studio_payload["tracks"][0]["audio_source_path"]
    absolute_audio_path = tmp_path / relative_audio_path
    assert absolute_audio_path.exists()

    summary_response = client.get("/api/admin/storage", headers=ADMIN_HEADERS)

    assert summary_response.status_code == 200
    summary = summary_response.json()
    assert summary["studio_count"] == 1
    assert summary["asset_count"] == 1
    asset = summary["studios"][0]["assets"][0]
    assert asset["relative_path"] == relative_audio_path
    assert asset["kind"] == "upload"
    assert asset["referenced"] is True

    delete_response = client.delete(f"/api/admin/assets/{asset['asset_id']}", headers=ADMIN_HEADERS)

    assert delete_response.status_code == 200
    assert delete_response.json()["deleted_files"] == 1
    assert not absolute_audio_path.exists()
    assert client.get(f"/api/studios/{studio_id}/tracks/1/audio").status_code == 404
    studio_after_delete = client.get(f"/api/studios/{studio_id}").json()
    assert studio_after_delete["tracks"][0]["audio_source_path"] is None
    assert studio_after_delete["tracks"][0]["status"] == "registered"
    assert studio_after_delete["tracks"][0]["notes"][0]["label"] == "C5"


def test_admin_can_delete_studio_and_its_assets(tmp_path: Path, monkeypatch) -> None:
    def fake_transcribe_voice_file(*args, **kwargs):
        return [
            TrackNote(
                pitch_midi=69,
                pitch_hz=440,
                label="A4",
                onset_seconds=0,
                duration_seconds=1,
                beat=1,
                duration_beats=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fake_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    studio_id, studio_payload = create_audio_studio(client)
    assert (tmp_path / studio_payload["tracks"][0]["audio_source_path"]).exists()

    delete_response = client.delete(f"/api/admin/studios/{studio_id}", headers=ADMIN_HEADERS)

    assert delete_response.status_code == 200
    assert delete_response.json()["studio_id"] == studio_id
    assert delete_response.json()["deleted_files"] == 1
    assert client.get(f"/api/studios/{studio_id}").status_code == 404
    assert not (tmp_path / "uploads" / studio_id).exists()
    assert client.get("/api/admin/storage", headers=ADMIN_HEADERS).json()["studio_count"] == 0


def test_scoring_audio_is_temporary_and_not_listed_as_admin_asset(tmp_path: Path, monkeypatch) -> None:
    def fake_transcribe_voice_file(*args, **kwargs):
        return [
            TrackNote(
                pitch_midi=69,
                pitch_hz=440,
                label="A4",
                onset_seconds=0,
                duration_seconds=1,
                beat=1,
                duration_beats=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fake_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    studio_id, _studio_payload = create_audio_studio(client)
    encoded = base64.b64encode(b"RIFF....WAVEfmt scoring take").decode("ascii")

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [],
            "include_metronome": True,
            "performance_audio_base64": encoded,
            "performance_filename": "score-take.wav",
        },
    )

    assert score_response.status_code == 200
    base_payload = json.loads((tmp_path / "six_track_studios.json").read_text(encoding="utf-8"))
    assert base_payload[studio_id]["reports"] == []
    assert (tmp_path / "studio_sidecars" / studio_id / "reports.json").exists()
    summary = client.get("/api/admin/storage", headers=ADMIN_HEADERS).json()
    assert summary["asset_count"] == 1
    assert not (tmp_path / "tmp").exists()
