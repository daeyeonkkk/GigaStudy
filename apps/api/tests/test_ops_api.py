from collections.abc import Iterator
from datetime import datetime, timezone
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


def save_device_profile(
    client: TestClient,
    *,
    browser: str,
    os: str,
    input_device_hash: str,
    output_route: str,
    diagnostic_flags: list[str],
    microphone_permission: str,
    recording_mime_type: str | None,
    audio_context_mode: str,
    offline_audio_context_mode: str,
) -> None:
    response = client.post(
        "/api/device-profiles",
        json={
            "browser": browser,
            "os": os,
            "input_device_hash": input_device_hash,
            "output_route": output_route,
            "browser_user_agent": f"{browser}/{os} test agent",
            "requested_constraints": {
                "echoCancellation": False,
                "autoGainControl": False,
                "noiseSuppression": False,
                "channelCount": 1,
            },
            "applied_settings": {
                "sampleRate": 48000,
                "channelCount": 1,
            },
            "capabilities": {
                "secure_context": True,
                "media_devices": {
                    "get_user_media": True,
                    "enumerate_devices": True,
                    "get_supported_constraints": True,
                    "supported_constraints": ["channelCount", "echoCancellation"],
                },
                "permissions": {
                    "api_supported": True,
                    "microphone": microphone_permission,
                },
                "web_audio": {
                    "audio_context": True,
                    "audio_context_mode": audio_context_mode,
                    "offline_audio_context": True,
                    "offline_audio_context_mode": offline_audio_context_mode,
                    "output_latency_supported": True,
                },
                "media_recorder": {
                    "supported": True,
                    "supported_mime_types": ["audio/webm"],
                    "selected_mime_type": recording_mime_type,
                },
                "audio_playback": {
                    "wav": "probably",
                    "webm": "probably",
                    "mp4": "maybe",
                    "ogg": "unsupported",
                },
            },
            "diagnostic_flags": diagnostic_flags,
            "actual_sample_rate": 48000,
            "channel_count": 1,
            "base_latency": 0.012,
            "output_latency": 0.024,
        },
    )
    assert response.status_code == 200


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

    save_device_profile(
        client,
        browser="Chrome",
        os="Windows",
        input_device_hash="usb-mic",
        output_route="headphones",
        diagnostic_flags=[],
        microphone_permission="granted",
        recording_mime_type="audio/webm",
        audio_context_mode="standard",
        offline_audio_context_mode="standard",
    )
    save_device_profile(
        client,
        browser="Safari",
        os="macOS",
        input_device_hash="built-in",
        output_route="speakers",
        diagnostic_flags=["legacy_webkit_audio_context_only", "missing_offline_audio_context"],
        microphone_permission="prompt",
        recording_mime_type=None,
        audio_context_mode="webkit",
        offline_audio_context_mode="unavailable",
    )

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
    assert payload["environment_diagnostics"]["summary"]["total_device_profiles"] == 2
    assert payload["environment_diagnostics"]["summary"]["profiles_with_warnings"] == 1
    assert payload["environment_diagnostics"]["summary"]["warning_flag_count"] >= 2
    assert any(
        item["browser"] == "Safari" and item["warning_profile_count"] == 1
        for item in payload["environment_diagnostics"]["browser_matrix"]
    )
    assert any(
        item["flag"] == "missing_offline_audio_context"
        for item in payload["environment_diagnostics"]["warning_flags"]
    )
    assert any(
        item["browser"] == "Safari"
        and item["microphone_permission"] == "prompt"
        and item["audio_context_mode"] == "webkit"
        for item in payload["environment_diagnostics"]["recent_profiles"]
    )
    assert any(item["failure_message"] for item in payload["failed_tracks"])
    assert any(item["status"] == "FAILED" for item in payload["recent_analysis_jobs"])


def test_environment_validation_runs_can_be_created_and_listed(client: TestClient) -> None:
    create_response = client.post(
        "/api/admin/environment-validations",
        json={
            "label": "Native Safari speaker run",
            "tester": "QA lead",
            "device_name": "MacBook Air 15",
            "os": "macOS 15.4",
            "browser": "Safari 18",
            "input_device": "Built-in Microphone",
            "output_route": "Built-in Speakers",
            "outcome": "WARN",
            "secure_context": True,
            "microphone_permission_before": "prompt",
            "microphone_permission_after": "granted",
            "recording_mime_type": None,
            "audio_context_mode": "webkit",
            "offline_audio_context_mode": "unavailable",
            "actual_sample_rate": 48000,
            "base_latency": 0.017,
            "output_latency": 0.039,
            "warning_flags": ["legacy_webkit_audio_context_only", "missing_offline_audio_context"],
            "take_recording_succeeded": True,
            "analysis_succeeded": True,
            "playback_succeeded": False,
            "audible_issues": "Playback preview stayed disabled on this environment.",
            "permission_issues": "The first prompt required a reload after denial recovery.",
            "unexpected_warnings": "missing_offline_audio_context",
            "follow_up": "Validate again on native Safari after playback fallback review.",
            "notes": "Recording path worked, but playback is still environment-limited.",
            "validated_at": datetime(2026, 4, 8, 23, 40, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert create_response.status_code == 200
    created_payload = create_response.json()
    assert created_payload["outcome"] == "WARN"
    assert created_payload["browser"] == "Safari 18"
    assert created_payload["warning_flags"] == [
        "legacy_webkit_audio_context_only",
        "missing_offline_audio_context",
    ]

    list_response = client.get("/api/admin/environment-validations")
    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert len(list_payload["items"]) == 1
    assert list_payload["items"][0]["label"] == "Native Safari speaker run"
    assert list_payload["items"][0]["playback_succeeded"] is False

    overview_response = client.get("/api/admin/ops")
    assert overview_response.status_code == 200
    overview_payload = overview_response.json()
    assert len(overview_payload["recent_environment_validation_runs"]) == 1
    assert overview_payload["recent_environment_validation_runs"][0]["tester"] == "QA lead"
    assert overview_payload["recent_environment_validation_runs"][0]["outcome"] == "WARN"
