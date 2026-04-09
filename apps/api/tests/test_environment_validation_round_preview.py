import json
from pathlib import Path

from gigastudy_api.services.environment_validation_round_preview import (
    build_round_environment_validation_preview,
)
from gigastudy_api.services.evidence_rounds import create_evidence_round_scaffold, resolve_evidence_round_paths


PLACEHOLDER_METADATA = {
    "corpus_id": "human-rating-corpus-template",
    "description": "Template metadata.",
    "evidence_kind": "human_rating_corpus",
    "cases": [
        {
            "case_id": "replace-with-real-vocal-case",
            "description": "Template case metadata for a human-recorded pair.",
            "project_title": "Human rating template case",
            "base_key": "C",
            "bpm": 90,
            "guide_source": {
                "source_kind": "wav_path",
                "wav_path": "replace/with/guide.wav",
                "filename": "guide.wav",
            },
            "take_source": {
                "source_kind": "wav_path",
                "wav_path": "replace/with/take.wav",
                "filename": "take.wav",
            },
            "minimum_human_agreement_ratio": 0.67,
            "expectation": {
                "note_index": 0,
                "expected_pitch_quality_mode": "NOTE_EVENT_V1",
                "expected_harmony_reference_mode": "CHORD_AWARE",
            },
        }
    ],
}

PLACEHOLDER_SHEET = """case_id,note_index,rater_id,attack_direction,sustain_direction,acceptability_label,notes
replace-with-real-vocal-case,0,rater-a,sharp,centered,in_tune,"Template label A"
replace-with-real-vocal-case,0,rater-b,sharp,centered,in_tune,"Template label B"
replace-with-real-vocal-case,0,rater-c,sharp,centered,review,"Template label C"
"""

ENVIRONMENT_TWO_ROWS = """label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at
Native Safari built-in run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,Playback preview stayed disabled.,The first prompt required a reload after denial recovery.,missing_offline_audio_context,Retry after playback fallback review.,Recording path worked but playback stayed limited.,2026-04-09T10:00:00Z
Windows Chrome wired run,QA lead,Focusrite test rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,Recorder and playback both worked as expected.,2026-04-09T10:20:00Z
"""

ENVIRONMENT_THREE_ROWS = """label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at
Native Safari built-in run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,PASS,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,legacy_webkit_audio_context_only,TRUE,TRUE,TRUE,,,,Safari built-in path worked.,2026-04-09T10:00:00Z
Windows Chrome wired run,QA lead,Focusrite test rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,Recorder and playback both worked as expected.,2026-04-09T10:20:00Z
Native Safari Bluetooth run,QA lead,MacBook Pro 14,macOS 15.4,Safari 18,Built-in Microphone,AirPods Pro,PASS,TRUE,prompt,granted,audio/mp4,webkit,unavailable,48000,14,52,,TRUE,TRUE,TRUE,,,,Bluetooth output path worked.,2026-04-09T10:40:00Z
"""


def _write_seed_templates(api_root: Path, *, environment_template: str) -> None:
    calibration_root = api_root / "calibration"
    environment_root = api_root / "environment_validation"
    calibration_root.mkdir(parents=True)
    environment_root.mkdir(parents=True)

    (calibration_root / "human_rating_cases.template.json").write_text(
        json.dumps(PLACEHOLDER_METADATA, indent=2),
        encoding="utf-8",
    )
    (calibration_root / "human_rating_sheet.template.csv").write_text(PLACEHOLDER_SHEET, encoding="utf-8")
    (calibration_root / "human_rating_corpus.template.json").write_text("[]", encoding="utf-8")
    (environment_root / "environment_validation_runs.template.csv").write_text(
        environment_template,
        encoding="utf-8",
    )


def test_round_environment_preview_reports_missing_matrix_and_not_ready(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    _write_seed_templates(api_root, environment_template=ENVIRONMENT_TWO_ROWS)

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )

    preview = build_round_environment_validation_preview(scaffold.root)

    assert preview.packet.generated_from == "round_environment_validation_packet"
    assert preview.packet.summary.total_validation_runs == 2
    assert preview.packet.summary.pass_run_count == 1
    assert preview.packet.summary.warn_run_count == 1
    assert preview.packet.summary.native_safari_run_count == 1
    assert preview.packet.summary.real_hardware_recording_success_count == 2
    assert preview.claim_gate.generated_from == "round_environment_validation_claim_gate"
    assert preview.claim_gate.release_claim_ready is False
    assert preview.claim_gate.covered_matrix_count == 2


def test_round_environment_preview_can_reach_claim_ready_state(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    _write_seed_templates(api_root, environment_template=ENVIRONMENT_THREE_ROWS)

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )
    paths = resolve_evidence_round_paths(scaffold.root)

    preview = build_round_environment_validation_preview(paths.root)

    assert preview.packet.summary.total_validation_runs == 3
    assert preview.packet.summary.fail_run_count == 0
    assert preview.packet.summary.native_safari_run_count == 2
    assert preview.packet.summary.real_hardware_recording_success_count == 3
    assert preview.claim_gate.release_claim_ready is True
    assert preview.claim_gate.covered_matrix_count >= 3
