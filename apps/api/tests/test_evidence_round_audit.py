import json
from pathlib import Path

from gigastudy_api.services.evidence_round_audit import inspect_evidence_round
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

RATING_SHEET = """case_id,note_index,rater_id,attack_direction,sustain_direction,acceptability_label,notes
replace-with-real-vocal-case,0,rater-a,sharp,centered,in_tune,"Template label A"
replace-with-real-vocal-case,0,rater-b,sharp,centered,in_tune,"Template label B"
replace-with-real-vocal-case,0,rater-c,sharp,centered,review,"Template label C"
"""

SEEDED_FIXTURE_MANIFEST = {
    "corpus_id": "human-rating-seeded-fixture",
    "description": "Seeded fixture-based human rating corpus for workflow smoke tests. This is not release evidence.",
    "evidence_kind": "synthetic_human_rating_seeded",
    "cases": [
        {
            "case_id": "seeded-sharp-attack",
            "description": "Fixture-backed sharp attack case with human labels.",
            "project_title": "Seeded sharp attack",
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
            "human_ratings": [
                {
                    "note_index": 0,
                    "attack_direction": "sharp",
                    "sustain_direction": "centered",
                    "acceptability_label": "review",
                    "rater_count": 3,
                    "notes": "Seeded workflow label.",
                }
            ],
            "expectation": {
                "note_index": 0,
                "expected_pitch_quality_mode": "NOTE_EVENT_V1",
                "expected_harmony_reference_mode": "KEY_ONLY",
            },
        }
    ],
}

FIXTURE_METADATA = {
    "corpus_id": "human-rating-round",
    "description": "Round metadata backed by named fixtures.",
    "evidence_kind": "human_rating_corpus",
    "cases": [
        {
            "case_id": "fixture-case",
            "description": "Named fixture metadata for audit coverage.",
            "project_title": "Fixture round",
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

ENVIRONMENT_TEMPLATE = """label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at
Native Safari built-in run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,Playback preview stayed disabled.,The first prompt required a reload after denial recovery.,missing_offline_audio_context,Retry after playback fallback review.,Recording path worked but playback stayed limited.,2026-04-09T10:00:00Z
Windows Chrome wired run,QA lead,Focusrite test rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,Recorder and playback both worked as expected.,2026-04-09T10:20:00Z
"""

ENVIRONMENT_READY_TEMPLATE = """label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at
Native Safari built-in run,QA lead,MacBook Air 15,macOS 15.4,Safari 18,Built-in Microphone,Built-in Speakers,PASS,TRUE,prompt,granted,,webkit,unavailable,48000,17,39,legacy_webkit_audio_context_only,TRUE,TRUE,TRUE,,,,Safari built-in path worked.,2026-04-09T10:00:00Z
Windows Chrome wired run,QA lead,Focusrite test rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,Recorder and playback both worked as expected.,2026-04-09T10:20:00Z
Native Safari Bluetooth run,QA lead,MacBook Pro 14,macOS 15.4,Safari 18,Built-in Microphone,AirPods Pro,PASS,TRUE,prompt,granted,audio/mp4,webkit,unavailable,48000,14,52,,TRUE,TRUE,TRUE,,,,Bluetooth output path worked.,2026-04-09T10:40:00Z
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
    (calibration_root / "human_rating_sheet.template.csv").write_text(RATING_SHEET, encoding="utf-8")
    (calibration_root / "human_rating_corpus.template.json").write_text("[]", encoding="utf-8")
    (environment_root / "environment_validation_runs.template.csv").write_text(
        ENVIRONMENT_TEMPLATE,
        encoding="utf-8",
    )


def test_inspect_evidence_round_reports_missing_real_audio_and_generated_outputs(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    _write_seed_templates(api_root)

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )

    report = inspect_evidence_round(scaffold.root)

    assert report.human_rating.metadata_present is True
    assert report.human_rating.generated_corpus_present is False
    assert report.human_rating.metadata_inventory is not None
    assert report.human_rating.metadata_inventory.summary.all_sources_resolved is False
    assert report.environment_validation.row_count == 2
    assert report.environment_validation.generated_requests_present is False
    assert report.environment_validation.preview_packet_summary is not None
    assert report.environment_validation.preview_packet_summary.total_validation_runs == 2
    assert report.environment_validation.release_claim_ready is False
    assert any("Replace placeholder guide/take WAV paths" in action for action in report.next_actions)
    assert any("Build the generated human-rating corpus" in action for action in report.next_actions)
    assert any("Preview or import the environment-validation CSV" in action for action in report.next_actions)


def test_inspect_evidence_round_reports_round_with_support_artifacts_in_place(tmp_path: Path) -> None:
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
    paths.human_rating_generated_corpus_path.write_text(
        json.dumps(SEEDED_FIXTURE_MANIFEST, indent=2),
        encoding="utf-8",
    )
    paths.environment_validation_sheet_path.write_text(ENVIRONMENT_READY_TEMPLATE, encoding="utf-8")
    paths.human_rating_calibration_json_path.parent.mkdir(parents=True, exist_ok=True)
    for artifact_path in (
        paths.human_rating_calibration_json_path,
        paths.human_rating_calibration_markdown_path,
        paths.human_rating_threshold_json_path,
        paths.human_rating_threshold_markdown_path,
        paths.human_rating_claim_gate_json_path,
        paths.human_rating_claim_gate_markdown_path,
    ):
        artifact_path.write_text("{}", encoding="utf-8")
    paths.human_rating_evidence_output_dir.mkdir(parents=True, exist_ok=True)
    (paths.human_rating_evidence_output_dir / "bundle.json").write_text("{}", encoding="utf-8")
    paths.environment_validation_generated_requests_path.write_text("[]", encoding="utf-8")
    paths.environment_validation_packet_json_path.write_text("{}", encoding="utf-8")
    paths.environment_validation_claim_gate_json_path.write_text("{}", encoding="utf-8")
    paths.environment_validation_claim_gate_markdown_path.write_text("# claim gate", encoding="utf-8")

    report = inspect_evidence_round(scaffold.root)

    assert report.human_rating.generated_corpus_present is True
    assert report.human_rating.generated_corpus_inventory is not None
    assert report.human_rating.metadata_inventory is not None
    assert report.human_rating.metadata_inventory.summary.all_sources_resolved is True
    assert report.environment_validation.row_count == 3
    assert report.environment_validation.outcome_counts == {"PASS": 3}
    assert report.environment_validation.packet_present is True
    assert report.environment_validation.claim_gate_json_present is True
    assert report.environment_validation.claim_gate_markdown_present is True
    assert report.environment_validation.release_claim_ready is True
    assert report.next_actions == [
        "This round has its current support artifacts in place; the remaining work is collecting and reviewing real evidence."
    ]
