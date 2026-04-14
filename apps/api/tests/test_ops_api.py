from collections.abc import Iterator
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

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
    assert "basic-pitch-ts-v1.0.1" in payload["model_versions"]["melody"]
    assert "librosa-pyin-melody-v2-fallback" in payload["model_versions"]["melody"]
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
    assert payload["environment_claim_gate"]["release_claim_ready"] is False
    assert payload["environment_claim_gate"]["checks"]
    assert any(
        check["key"] == "native_safari_run_count" and check["passed"] is False
        for check in payload["environment_claim_gate"]["checks"]
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
    assert overview_payload["environment_claim_gate"]["summary_message"]


def test_environment_validation_template_download_returns_starter_pack_zip(
    client: TestClient,
) -> None:
    response = client.get("/api/admin/environment-validations/template")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="gigastudy-environment-validation-starter-pack.zip"'
    )

    archive = ZipFile(BytesIO(response.content))
    names = set(archive.namelist())
    assert "README.md" in names
    assert "environment_validation_runs.template.csv" in names

    readme_text = archive.read("README.md").decode("utf-8")
    csv_text = archive.read("environment_validation_runs.template.csv").decode("utf-8")

    assert "GigaStudy 환경 검증 시작 묶음" in readme_text
    assert "가져오기 입력" in readme_text
    assert csv_text.startswith(
        "label,tester,device_name,os,browser,input_device,output_route,outcome,"
    )


def test_environment_validation_packet_reports_matrix_and_guardrails(client: TestClient) -> None:
    save_device_profile(
        client,
        browser="Safari",
        os="macOS",
        input_device_hash="built-in",
        output_route="Bluetooth output",
        diagnostic_flags=["legacy_webkit_audio_context_only", "missing_offline_audio_context"],
        microphone_permission="prompt",
        recording_mime_type=None,
        audio_context_mode="webkit",
        offline_audio_context_mode="unavailable",
    )
    save_device_profile(
        client,
        browser="Chrome",
        os="Windows",
        input_device_hash="usb-mic",
        output_route="wired headphones",
        diagnostic_flags=[],
        microphone_permission="granted",
        recording_mime_type="audio/webm",
        audio_context_mode="standard",
        offline_audio_context_mode="standard",
    )

    create_payloads = [
        {
            "label": "Native Safari Bluetooth run",
            "tester": "QA lead",
            "device_name": "MacBook Air 15",
            "os": "macOS 15.4",
            "browser": "Safari 18",
            "input_device": "Built-in Microphone",
            "output_route": "AirPods Bluetooth",
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
            "follow_up": "Playback still needs native Safari review.",
            "validated_at": datetime(2026, 4, 9, 8, 40, tzinfo=timezone.utc).isoformat(),
        },
        {
            "label": "Windows Chrome wired run",
            "tester": "QA lead",
            "device_name": "Focusrite test rig",
            "os": "Windows 11",
            "browser": "Chrome 136",
            "input_device": "USB microphone",
            "output_route": "Wired headphones",
            "outcome": "PASS",
            "secure_context": True,
            "microphone_permission_before": "prompt",
            "microphone_permission_after": "granted",
            "recording_mime_type": "audio/webm",
            "audio_context_mode": "standard",
            "offline_audio_context_mode": "standard",
            "actual_sample_rate": 48000,
            "base_latency": 0.012,
            "output_latency": 0.021,
            "warning_flags": [],
            "take_recording_succeeded": True,
            "analysis_succeeded": True,
            "playback_succeeded": True,
            "validated_at": datetime(2026, 4, 9, 9, 0, tzinfo=timezone.utc).isoformat(),
        },
    ]

    for payload in create_payloads:
        response = client.post("/api/admin/environment-validations", json=payload)
        assert response.status_code == 200

    packet_response = client.get("/api/admin/environment-validation-packet")
    assert packet_response.status_code == 200
    packet_payload = packet_response.json()

    assert packet_payload["generated_from"] == "ops_environment_validation_packet"
    assert packet_payload["summary"]["total_validation_runs"] == 2
    assert packet_payload["summary"]["pass_run_count"] == 1
    assert packet_payload["summary"]["warn_run_count"] == 1
    assert packet_payload["summary"]["native_safari_run_count"] == 1
    assert packet_payload["summary"]["real_hardware_recording_success_count"] == 2
    assert any(
        item["label"] == "macOS + Safari + Bluetooth output" and item["covered"] is True
        for item in packet_payload["required_matrix"]
    )
    assert any(
        item["label"] == "Windows + Chrome + USB microphone + wired headphones" and item["covered"] is True
        for item in packet_payload["required_matrix"]
    )
    assert any(
        "native Safari or Safari-like validation run" in item or "Warning flags still exist" in item
        for item in packet_payload["claim_guardrails"]
    )
    assert any(
        "legacy WebKit audio contexts" in item or "playback failure or degradation" in item
        for item in packet_payload["compatibility_notes"]
    )
    assert packet_payload["environment_diagnostics"]["summary"]["total_device_profiles"] == 2
    assert len(packet_payload["recent_validation_runs"]) == 2


def test_environment_validation_release_notes_render_markdown(client: TestClient) -> None:
    response = client.post(
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
            "validated_at": datetime(2026, 4, 9, 10, 0, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert response.status_code == 200

    notes_response = client.get("/api/admin/environment-validation-release-notes")
    assert notes_response.status_code == 200
    assert notes_response.headers["content-type"].startswith("text/plain")

    markdown = notes_response.text
    assert "# Browser Environment Release Notes Draft" in markdown
    assert "## Covered Matrix Cells" in markdown
    assert "## Compatibility Notes" in markdown
    assert "## Claim Guardrails" in markdown
    assert "Native Safari speaker run" in markdown


def test_environment_validation_claim_gate_reports_not_ready_when_matrix_is_thin(client: TestClient) -> None:
    response = client.post(
        "/api/admin/environment-validations",
        json={
            "label": "Native Safari Bluetooth run",
            "tester": "QA lead",
            "device_name": "MacBook Air 15",
            "os": "macOS 15.4",
            "browser": "Safari 18",
            "input_device": "Built-in Microphone",
            "output_route": "AirPods Bluetooth",
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
            "validated_at": datetime(2026, 4, 9, 11, 0, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert response.status_code == 200

    gate_response = client.get("/api/admin/environment-validation-claim-gate")
    assert gate_response.status_code == 200
    gate_payload = gate_response.json()

    assert gate_payload["generated_from"] == "ops_environment_validation_claim_gate"
    assert gate_payload["release_claim_ready"] is False
    assert any(
        check["key"] == "required_matrix_labels" and check["passed"] is False
        for check in gate_payload["checks"]
    )
    assert any("native Safari" in action or "matrix" in action.lower() for action in gate_payload["next_actions"])

    markdown_response = client.get("/api/admin/environment-validation-claim-gate.md")
    assert markdown_response.status_code == 200
    assert "# Browser Environment Claim Gate" in markdown_response.text
    assert "Release claim ready: no" in markdown_response.text


def test_environment_validation_claim_gate_can_mark_review_ready(client: TestClient) -> None:
    create_payloads = [
        {
            "label": "Windows Chrome wired run",
            "tester": "QA lead",
            "device_name": "Focusrite test rig",
            "os": "Windows 11",
            "browser": "Chrome 136",
            "input_device": "USB microphone",
            "output_route": "Wired headphones",
            "outcome": "PASS",
            "secure_context": True,
            "microphone_permission_before": "prompt",
            "microphone_permission_after": "granted",
            "recording_mime_type": "audio/webm",
            "audio_context_mode": "standard",
            "offline_audio_context_mode": "standard",
            "actual_sample_rate": 48000,
            "base_latency": 0.012,
            "output_latency": 0.021,
            "warning_flags": [],
            "take_recording_succeeded": True,
            "analysis_succeeded": True,
            "playback_succeeded": True,
            "validated_at": datetime(2026, 4, 9, 11, 10, tzinfo=timezone.utc).isoformat(),
        },
        {
            "label": "Native Safari speaker run",
            "tester": "QA lead",
            "device_name": "MacBook Pro 14",
            "os": "macOS 15.4",
            "browser": "Safari 18",
            "input_device": "Built-in Microphone",
            "output_route": "Built-in Speakers",
            "outcome": "PASS",
            "secure_context": True,
            "microphone_permission_before": "prompt",
            "microphone_permission_after": "granted",
            "recording_mime_type": "audio/mp4",
            "audio_context_mode": "webkit",
            "offline_audio_context_mode": "unavailable",
            "actual_sample_rate": 48000,
            "base_latency": 0.018,
            "output_latency": 0.041,
            "warning_flags": [],
            "take_recording_succeeded": True,
            "analysis_succeeded": True,
            "playback_succeeded": True,
            "validated_at": datetime(2026, 4, 9, 11, 20, tzinfo=timezone.utc).isoformat(),
        },
        {
            "label": "Native Safari Bluetooth run",
            "tester": "QA lead",
            "device_name": "MacBook Air 15",
            "os": "macOS 15.4",
            "browser": "Safari 18",
            "input_device": "Built-in Microphone",
            "output_route": "AirPods Bluetooth",
            "outcome": "PASS",
            "secure_context": True,
            "microphone_permission_before": "prompt",
            "microphone_permission_after": "granted",
            "recording_mime_type": "audio/mp4",
            "audio_context_mode": "webkit",
            "offline_audio_context_mode": "unavailable",
            "actual_sample_rate": 48000,
            "base_latency": 0.019,
            "output_latency": 0.042,
            "warning_flags": [],
            "take_recording_succeeded": True,
            "analysis_succeeded": True,
            "playback_succeeded": True,
            "validated_at": datetime(2026, 4, 9, 11, 30, tzinfo=timezone.utc).isoformat(),
        },
    ]

    for payload in create_payloads:
        response = client.post("/api/admin/environment-validations", json=payload)
        assert response.status_code == 200

    gate_response = client.get("/api/admin/environment-validation-claim-gate")
    assert gate_response.status_code == 200
    gate_payload = gate_response.json()

    assert gate_payload["release_claim_ready"] is True
    assert gate_payload["covered_matrix_count"] >= 3
    assert all(check["passed"] for check in gate_payload["checks"])


def test_environment_validation_import_preview_and_submit(client: TestClient) -> None:
    csv_text = "\n".join(
        [
            "label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at",
            'Imported Safari run,QA lead,MacBook Pro 14,macOS 15.4,Safari 18,Built-in Microphone,AirPods Bluetooth,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,18,41,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,Playback degraded,Prompt recovery required,missing_offline_audio_context,Retry on native Safari,Imported from spreadsheet,2026-04-09T12:10:00Z',
            "Imported Chrome run,QA lead,USB rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,,2026-04-09T12:20:00Z",
        ]
    )

    preview_response = client.post(
        "/api/admin/environment-validations/import-preview",
        json={"csv_text": csv_text},
    )
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["item_count"] == 2
    assert preview_payload["items"][0]["browser"] == "Safari 18"
    assert preview_payload["items"][1]["outcome"] == "PASS"

    import_response = client.post(
        "/api/admin/environment-validations/import",
        json={"csv_text": csv_text},
    )
    assert import_response.status_code == 200
    import_payload = import_response.json()
    assert import_payload["imported_count"] == 2
    assert import_payload["items"][0]["label"] == "Imported Safari run"
    assert import_payload["items"][1]["device_name"] == "USB rig"

    runs_response = client.get("/api/admin/environment-validations")
    assert runs_response.status_code == 200
    runs_payload = runs_response.json()
    assert len(runs_payload["items"]) == 2
