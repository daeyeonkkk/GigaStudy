import json
from pathlib import Path

from gigastudy_api.services.evidence_round_refresh import refresh_evidence_round
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

FIXTURE_METADATA = {
    "corpus_id": "human-rating-refresh-fixture",
    "description": "Fixture-backed metadata.",
    "evidence_kind": "human_rating_corpus",
    "cases": [
        {
            "case_id": "fixture-case",
            "description": "Named fixture metadata for refresh coverage.",
            "project_title": "Fixture refresh case",
            "base_key": "C",
            "bpm": 90,
            "guide_source": {
                "source_kind": "named_fixture",
                "fixture_name": "guide_centered_vocalish",
                "filename": "guide.wav",
            },
            "take_source": {
                "source_kind": "named_fixture",
                "fixture_name": "take_sharp_attack_vocalish",
                "filename": "take.wav",
            },
            "minimum_human_agreement_ratio": 0.67,
            "expectation": {
                "note_index": 0,
                "expected_pitch_quality_mode": "NOTE_EVENT_V1",
                "expected_harmony_reference_mode": "KEY_ONLY",
            },
        }
    ],
}

FIXTURE_SHEET = """case_id,note_index,rater_id,attack_direction,sustain_direction,acceptability_label,notes
fixture-case,0,rater-a,sharp,centered,review,"Fixture label A"
fixture-case,0,rater-b,sharp,centered,review,"Fixture label B"
fixture-case,0,rater-c,sharp,centered,review,"Fixture label C"
"""

ENVIRONMENT_TEMPLATE = """label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at
Native Safari built-in run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,Playback preview stayed disabled.,The first prompt required a reload after denial recovery.,missing_offline_audio_context,Retry after playback fallback review.,Recording path worked but playback stayed limited.,2026-04-09T10:00:00Z
"""


def _write_seed_templates(api_root: Path) -> None:
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
        ENVIRONMENT_TEMPLATE,
        encoding="utf-8",
    )


def test_refresh_evidence_round_skips_human_reports_until_audio_is_resolved(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    _write_seed_templates(api_root)

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )
    paths = resolve_evidence_round_paths(scaffold.root)

    result = refresh_evidence_round(scaffold.root)

    assert result.generated_corpus_written is True
    assert result.environment_preview_written is True
    assert result.environment_packet_written is True
    assert result.environment_claim_gate_written is True
    assert result.human_reports_written is False
    assert result.human_reports_skip_reason == "generated_corpus_has_unresolved_audio_sources"
    assert paths.human_rating_generated_corpus_path.exists()
    assert paths.environment_validation_generated_requests_path.exists()
    assert paths.environment_validation_packet_json_path.exists()
    assert paths.environment_validation_claim_gate_json_path.exists()
    assert paths.environment_validation_claim_gate_markdown_path.exists()
    assert paths.audit_json_path.exists()
    assert paths.audit_markdown_path.exists()
    assert not paths.human_rating_calibration_json_path.exists()


def test_refresh_evidence_round_builds_support_artifacts_for_fixture_backed_round(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    _write_seed_templates(api_root)

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )
    paths = resolve_evidence_round_paths(scaffold.root)
    paths.human_rating_cases_path.write_text(json.dumps(FIXTURE_METADATA, indent=2), encoding="utf-8")
    paths.human_rating_sheet_path.write_text(FIXTURE_SHEET, encoding="utf-8")

    result = refresh_evidence_round(scaffold.root)

    assert result.generated_corpus_written is True
    assert result.environment_preview_written is True
    assert result.environment_packet_written is True
    assert result.environment_claim_gate_written is True
    assert result.human_reports_written is True
    assert result.human_reports_skip_reason is None
    assert paths.human_rating_generated_corpus_path.exists()
    assert paths.human_rating_calibration_json_path.exists()
    assert paths.human_rating_calibration_markdown_path.exists()
    assert paths.human_rating_threshold_json_path.exists()
    assert paths.human_rating_threshold_markdown_path.exists()
    assert paths.human_rating_claim_gate_json_path.exists()
    assert paths.human_rating_claim_gate_markdown_path.exists()
    assert paths.environment_validation_generated_requests_path.exists()
    assert paths.environment_validation_packet_json_path.exists()
    assert paths.environment_validation_claim_gate_json_path.exists()
    assert paths.environment_validation_claim_gate_markdown_path.exists()
    assert paths.audit_json_path.exists()
    assert paths.audit_markdown_path.exists()
    assert any(paths.human_rating_evidence_output_dir.iterdir())
