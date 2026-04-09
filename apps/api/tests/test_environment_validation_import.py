from pathlib import Path
from datetime import UTC, datetime

from gigastudy_api.services.environment_validation_import import (
    build_environment_validation_requests,
    load_environment_validation_sheet,
    render_environment_validation_requests_json,
)


def test_load_environment_validation_sheet_reads_template_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "environment-validation.csv"
    csv_path.write_text(
        "\n".join(
            [
                "label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at",
                'Native Safari run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,Playback degraded,Prompt confusing,missing_offline_audio_context,Retry later,Notes here,2026-04-09T10:00:00Z',
            ]
        ),
        encoding="utf-8-sig",
    )

    rows = load_environment_validation_sheet(csv_path)

    assert len(rows) == 1
    assert rows[0].browser == "Safari 18"
    assert rows[0].secure_context is True
    assert rows[0].warning_flags == [
        "legacy_webkit_audio_context_only",
        "missing_offline_audio_context",
    ]
    assert rows[0].base_latency == 0.017
    assert rows[0].playback_succeeded is False


def test_build_environment_validation_requests_maps_to_api_schema() -> None:
    rows = load_environment_validation_sheet(
        Path("environment_validation/environment_validation_runs.template.csv").resolve()
    )

    requests = build_environment_validation_requests(rows)

    assert len(requests) == 2
    assert requests[0].browser == "Safari 18"
    assert requests[0].output_route == "Built-in Speakers"
    assert requests[0].take_recording_succeeded is True
    assert requests[1].outcome == "PASS"
    assert requests[1].recording_mime_type == "audio/webm"
    assert requests[1].follow_up == "Recorder and playback both worked as expected."
    assert requests[1].notes is None
    assert requests[1].validated_at.isoformat().replace("+00:00", "Z") == "2026-04-09T10:20:00Z"


def test_build_environment_validation_requests_fills_missing_validated_at_and_skips_blank_rows(
    tmp_path: Path,
) -> None:
    csv_path = tmp_path / "environment-validation.csv"
    csv_path.write_text(
        "\n".join(
            [
                "label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at",
                "Real hardware Safari run,QA lead,MacBook Pro,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,14,35,missing_offline_audio_context,TRUE,TRUE,FALSE,,,,Needs native playback retest,Left blank intentionally,",
                ",,,,,,,,,,,,,,,,,,,,,,,,,,",
            ]
        ),
        encoding="utf-8-sig",
    )

    rows = load_environment_validation_sheet(csv_path)
    requests = build_environment_validation_requests(rows)

    assert len(rows) == 1
    assert len(requests) == 1
    assert isinstance(requests[0].validated_at, datetime)
    assert requests[0].validated_at.tzinfo == UTC


def test_render_environment_validation_requests_json_includes_runs() -> None:
    rows = load_environment_validation_sheet(
        Path("environment_validation/environment_validation_runs.template.csv").resolve()
    )
    requests = build_environment_validation_requests(rows)

    rendered = render_environment_validation_requests_json(requests)

    assert '"label": "Native Safari built-in run"' in rendered
    assert '"browser": "Chrome 136"' in rendered
