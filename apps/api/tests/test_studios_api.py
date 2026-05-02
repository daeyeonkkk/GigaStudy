import base64
from pathlib import Path

import fitz
from fastapi.testclient import TestClient

from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.main import create_app
from gigastudy_api.services.engine.omr import OmrUnavailableError
from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.engine.pdf_vector_omr import PdfVectorOmrError
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile, ParsedTrack
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services import studio_repository


MUSICXML_UPLOAD = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""

THREE_FOUR_MUSICXML_UPLOAD = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
"""

MULTI_TRACK_MUSICXML_UPLOAD = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
    <score-part id="P3"><part-name>Bass</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
"""

PDF_UPLOAD_BYTES = b"%PDF-1.4\n% GigaStudy test PDF\n"
OWNER_TOKEN_A = "a" * 32
OWNER_TOKEN_B = "b" * 32


def build_preview_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=320, height=240)
    page.insert_text((40, 70), "GigaStudy preview", fontsize=16)
    page.draw_line((40, 120), (280, 120))
    return document.tobytes()


def fake_audiveris_omr(
    *,
    input_path: Path,
    output_dir: Path,
    audiveris_bin: str | None,
    timeout_seconds: int,
) -> Path:
    assert input_path.suffix.lower() == ".pdf"
    assert timeout_seconds > 0
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "audiveris-output.musicxml"
    output_path.write_text(MUSICXML_UPLOAD, encoding="utf-8")
    return output_path


def fake_multi_track_audiveris_omr(
    *,
    input_path: Path,
    output_dir: Path,
    audiveris_bin: str | None,
    timeout_seconds: int,
) -> Path:
    assert input_path.suffix.lower() == ".pdf"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "audiveris-multi-track.musicxml"
    output_path.write_text(MULTI_TRACK_MUSICXML_UPLOAD, encoding="utf-8")
    return output_path


def fake_pdf_vector_omr(
    path: Path,
    *,
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    max_slot_id: int = 5,
) -> ParsedSymbolicFile:
    mapped_notes: dict[int, list[TrackPitchEvent]] = {}
    tracks: list[ParsedTrack] = []
    for slot_id, label, pitch_midi in [
        (1, "C5", 72),
        (2, "A4", 69),
        (3, "E4", 64),
        (4, "C4", 60),
        (5, "C3", 48),
    ][:max_slot_id]:
        notes = [
            TrackPitchEvent(
                pitch_midi=pitch_midi,
                label=label,
                onset_seconds=0,
                duration_seconds=60 / bpm,
                duration_beats=1,
                beat=1,
                measure_index=1,
                beat_in_measure=1,
                confidence=0.62,
                source="omr",
                extraction_method="pdf_vector_omr_v0",
            )
        ]
        mapped_notes[slot_id] = notes
        tracks.append(ParsedTrack(name=f"Vector {slot_id}", notes=notes, slot_id=slot_id))
    return ParsedSymbolicFile(
        tracks=tracks,
        mapped_notes=mapped_notes,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        has_time_signature=False,
    )


def fake_four_part_pdf_vector_omr(
    path: Path,
    *,
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    max_slot_id: int = 5,
) -> ParsedSymbolicFile:
    parsed = fake_pdf_vector_omr(
        path,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        max_slot_id=4,
    )
    return parsed


def fail_pdf_vector_omr(*args, **kwargs) -> ParsedSymbolicFile:
    raise PdfVectorOmrError("Vector fallback cannot read PDF")


def build_client(tmp_path: Path, monkeypatch, *, studio_access_policy: str = "public") -> TestClient:
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("GIGASTUDY_API_STUDIO_ACCESS_POLICY", studio_access_policy)
    get_settings.cache_clear()
    studio_repository._repository = None
    return TestClient(create_app())


def upload_musicxml_track(
    client: TestClient,
    studio_id: str,
    *,
    slot_id: int = 1,
    xml: str = MUSICXML_UPLOAD,
    filename: str = "soprano.musicxml",
    allow_overwrite: bool = False,
):
    encoded = base64.b64encode(xml.encode("utf-8")).decode("ascii")
    response = client.post(
        f"/api/studios/{studio_id}/tracks/{slot_id}/upload",
        json={
            "source_kind": "document",
            "filename": filename,
            "content_base64": encoded,
            "allow_overwrite": allow_overwrite,
        },
    )
    assert response.status_code == 200
    return response


def _track_notes(payload: dict, slot_id: int) -> list[dict]:
    return [_note_from_pitch_event(event) for event in _track_events(payload, slot_id)]


def _track_events(payload: dict, slot_id: int) -> list[dict]:
    for region in payload["regions"]:
        if region["track_slot_id"] == slot_id:
            return [dict(event) for event in region["pitch_events"]]
    return []


def _candidate_notes(candidate: dict) -> list[dict]:
    return [_note_from_pitch_event(event) for event in candidate["region"]["pitch_events"]]


def _note_from_pitch_event(event: dict) -> dict:
    return {
        "label": event["label"],
        "pitch_midi": event["pitch_midi"],
        "pitch_hz": event["pitch_hz"],
        "onset_seconds": event["start_seconds"],
        "duration_seconds": event["duration_seconds"],
        "beat": event["start_beat"],
        "duration_beats": event["duration_beats"],
        "confidence": event["confidence"],
        "source": event["source"],
        "extraction_method": event["extraction_method"],
        "is_rest": event["is_rest"],
        "measure_index": event["measure_index"],
        "beat_in_measure": event["beat_in_measure"],
        "quality_warnings": event["quality_warnings"],
    }


def _performance_event_from_note(note: TrackPitchEvent | dict) -> dict:
    payload = note.model_dump(mode="json") if isinstance(note, TrackPitchEvent) else dict(note)
    return {
        "event_id": payload.get("id"),
        "track_slot_id": payload.get("voice_index"),
        "region_id": "test-performance",
        "label": payload["label"],
        "pitch_midi": payload.get("pitch_midi"),
        "pitch_hz": payload.get("pitch_hz"),
        "start_seconds": payload["onset_seconds"],
        "duration_seconds": payload["duration_seconds"],
        "start_beat": payload["beat"],
        "duration_beats": payload["duration_beats"],
        "confidence": payload["confidence"],
        "source": payload["source"],
        "extraction_method": payload["extraction_method"],
        "is_rest": payload.get("is_rest", False),
        "measure_index": payload.get("measure_index"),
        "beat_in_measure": payload.get("beat_in_measure"),
        "quality_warnings": payload.get("quality_warnings", []),
    }


def test_blank_studio_has_six_empty_tracks(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/studios",
        json={
            "title": "월요일 아카펠라",
            "bpm": 92,
            "start_mode": "blank",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "월요일 아카펠라"
    assert payload["bpm"] == 92
    assert payload["time_signature_numerator"] == 4
    assert payload["time_signature_denominator"] == 4
    assert [track["name"] for track in payload["tracks"]] == [
        "Soprano",
        "Alto",
        "Tenor",
        "Baritone",
        "Bass",
        "Percussion",
    ]
    assert all(track["status"] == "empty" for track in payload["tracks"])


def test_studio_list_is_paginated(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    for index in range(4):
        response = client.post(
            "/api/studios",
            json={
                "title": f"List page {index}",
                "bpm": 92,
                "start_mode": "blank",
            },
        )
        assert response.status_code == 200

    response = client.get("/api/studios?limit=2&offset=1")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 2
    assert all("tracks" not in studio for studio in payload)


def test_owner_policy_scopes_studio_list_and_detail_access(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch, studio_access_policy="owner")
    owner_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_A}
    other_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_B}

    create_response = client.post(
        "/api/studios",
        headers=owner_headers,
        json={
            "title": "Private studio",
            "bpm": 92,
            "start_mode": "blank",
        },
    )

    assert create_response.status_code == 200
    payload = create_response.json()
    studio_id = payload["studio_id"]
    assert "owner_token_hash" not in payload
    assert client.get("/api/studios").json() == []
    assert client.get("/api/studios", headers=other_headers).json() == []

    owner_list = client.get("/api/studios", headers=owner_headers)

    assert owner_list.status_code == 200
    assert [studio["studio_id"] for studio in owner_list.json()] == [studio_id]
    assert client.get(f"/api/studios/{studio_id}", headers=owner_headers).status_code == 200
    assert client.get(f"/api/studios/{studio_id}", headers=other_headers).status_code == 404
    assert client.get(f"/api/studios/{studio_id}").status_code == 401


def test_blank_studio_can_start_with_custom_time_signature(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/studios",
        json={
            "title": "Three four",
            "bpm": 92,
            "time_signature_numerator": 3,
            "time_signature_denominator": 4,
            "start_mode": "blank",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["time_signature_numerator"] == 3
    assert payload["time_signature_denominator"] == 4


def test_blank_studio_requires_bpm(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/studios",
        json={
            "title": "Blank without bpm",
            "start_mode": "blank",
        },
    )

    assert response.status_code == 422


def test_legacy_recording_fixture_endpoint_is_not_exposed(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "No fixture route",
            "bpm": 92,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    response = client.post(f"/api/studios/{studio_id}/tracks/1/recording/complete")

    assert response.status_code == 404


def test_upload_start_does_not_require_bpm_and_maps_symbolic_tracks(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "Upload without bpm",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "soprano.musicxml",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["bpm"] == 92
    assert payload["tracks"][0]["status"] == "registered"
    assert "notes" not in payload["tracks"][0]
    assert [note["label"] for note in _track_notes(payload, 1)] == ["C5", "G5"]


def test_register_generate_sync_and_score_track(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "SATB 연습",
            "bpm": 104,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    soprano_response = upload_musicxml_track(client, studio_id)
    assert soprano_response.json()["tracks"][0]["status"] == "registered"

    generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/6/generate",
        json={"context_slot_ids": [1]},
    )
    assert generate_response.status_code == 200
    generated_payload = generate_response.json()
    assert len(
        [
            candidate
            for candidate in generated_payload["candidates"]
            if candidate["suggested_slot_id"] == 6 and candidate["status"] == "pending"
        ]
    ) == 3
    candidate_id = generated_payload["candidates"][0]["candidate_id"]
    approve_response = client.post(f"/api/studios/{studio_id}/candidates/{candidate_id}/approve", json={})
    assert approve_response.status_code == 200
    approve_payload = approve_response.json()
    percussion = approve_payload["tracks"][5]
    percussion_notes = _track_notes(approve_payload, 6)
    assert percussion["status"] == "registered"
    assert percussion["source_kind"] == "ai"
    assert [note["label"] for note in percussion_notes[:4]] == ["Kick", "Hat", "Snare", "Hat"]

    assert [note["beat"] for note in percussion_notes[:4]] == [1, 2, 3, 4]

    sync_response = client.patch(
        f"/api/studios/{studio_id}/tracks/6/sync",
        json={"sync_offset_seconds": 0.025},
    )
    assert sync_response.status_code == 200
    assert sync_response.json()["tracks"][5]["sync_offset_seconds"] == 0.025
    assert sync_response.json()["tracks"][5]["volume_percent"] == 100

    volume_response = client.patch(
        f"/api/studios/{studio_id}/tracks/6/volume",
        json={"volume_percent": 37},
    )
    assert volume_response.status_code == 200
    assert volume_response.json()["tracks"][5]["volume_percent"] == 37

    invalid_volume_response = client.patch(
        f"/api/studios/{studio_id}/tracks/6/volume",
        json={"volume_percent": 101},
    )
    assert invalid_volume_response.status_code == 422

    performance_events = _track_events(soprano_response.json(), 1)
    for event in performance_events:
        event["start_seconds"] = round(event["start_seconds"] + 0.42, 4)

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [6],
            "include_metronome": True,
            "performance_events": performance_events,
        },
    )
    assert score_response.status_code == 200
    reports = score_response.json()["reports"]
    assert len(reports) == 1
    assert reports[0]["score_mode"] == "answer"
    assert reports[0]["target_track_name"] == "Soprano"
    assert reports[0]["reference_slot_ids"] == [6]
    assert reports[0]["alignment_offset_seconds"] == 0.42
    assert reports[0]["overall_score"] == 100


def test_harmony_score_uses_reference_tracks_without_registered_answer(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Harmony scoring",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id, slot_id=1)

    performance_events = [
        _performance_event_from_note(
            note_from_pitch(
                beat=1,
                duration_beats=1,
                bpm=120,
                source="voice",
                extraction_method="test",
                pitch_midi=76,
            )
        ),
        _performance_event_from_note(
            note_from_pitch(
                beat=2,
                duration_beats=1,
                bpm=120,
                source="voice",
                extraction_method="test",
                pitch_midi=71,
            )
        ),
    ]

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/2/score",
        json={
            "score_mode": "harmony",
            "reference_slot_ids": [1],
            "include_metronome": True,
            "performance_events": performance_events,
        },
    )

    assert score_response.status_code == 200
    reports = score_response.json()["reports"]
    assert len(reports) == 1
    assert reports[0]["score_mode"] == "harmony"
    assert reports[0]["target_track_name"] == "Alto"
    assert reports[0]["reference_slot_ids"] == [1]
    assert reports[0]["harmony_score"] is not None
    assert reports[0]["range_score"] is not None
    assert reports[0]["voice_leading_score"] is not None


def test_answer_score_uses_target_track_sync_offset(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Answer sync scoring",
            "bpm": 60,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_response = upload_musicxml_track(client, studio_id)
    assert upload_response.status_code == 200

    sync_response = client.patch(
        f"/api/studios/{studio_id}/tracks/1/sync",
        json={"sync_offset_seconds": 1.0},
    )
    assert sync_response.status_code == 200

    performance_events = []
    for event in _track_events(upload_response.json(), 1):
        performance_event = dict(event)
        performance_event["start_beat"] = round(performance_event["start_beat"] + 1, 4)
        performance_event["start_seconds"] = round(performance_event["start_seconds"] + 1, 4)
        performance_events.append(performance_event)

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "include_metronome": True,
            "performance_events": performance_events,
        },
    )

    assert score_response.status_code == 200
    report = score_response.json()["reports"][0]
    assert report["score_mode"] == "answer"
    assert report["alignment_offset_seconds"] == 0
    assert report["overall_score"] == 100


def test_shift_registered_track_syncs_preserves_relative_offsets(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Ensemble sync shift",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id, slot_id=1)
    upload_musicxml_track(client, studio_id, slot_id=2, filename="alto.musicxml")

    client.patch(
        f"/api/studios/{studio_id}/tracks/1/sync",
        json={"sync_offset_seconds": 0.12},
    )
    client.patch(
        f"/api/studios/{studio_id}/tracks/2/sync",
        json={"sync_offset_seconds": -0.03},
    )

    shift_response = client.patch(
        f"/api/studios/{studio_id}/tracks/sync",
        json={"delta_seconds": 0.05},
    )

    assert shift_response.status_code == 200
    tracks = shift_response.json()["tracks"]
    assert tracks[0]["sync_offset_seconds"] == 0.17
    assert tracks[1]["sync_offset_seconds"] == 0.02
    assert tracks[2]["sync_offset_seconds"] == 0


def test_harmony_score_requires_registered_reference_track(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Harmony scoring needs context",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/2/score",
        json={
            "score_mode": "harmony",
            "reference_slot_ids": [],
            "include_metronome": True,
            "performance_events": [
                _performance_event_from_note(
                    note_from_pitch(
                        beat=1,
                        duration_beats=1,
                        bpm=120,
                        source="voice",
                        extraction_method="test",
                        pitch_midi=64,
                    )
                )
            ],
        },
    )

    assert score_response.status_code == 422
    assert "reference track" in score_response.json()["detail"]


def test_score_track_rejects_empty_performance_input(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Empty score input",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [1],
            "include_metronome": True,
        },
    )

    assert score_response.status_code == 422
    assert "detectable notes" in score_response.json()["detail"]
    studio_response = client.get(f"/api/studios/{studio_id}")
    assert studio_response.json()["reports"] == []


def test_scoring_audio_extraction_uses_context_aware_plan(tmp_path: Path, monkeypatch) -> None:
    captured = {}

    def fake_transcribe_voice_file(*args, **kwargs):
        captured["plan"] = kwargs.get("extraction_plan")
        return [
            TrackPitchEvent(
                pitch_midi=72,
                label="C5",
                onset_seconds=0,
                duration_seconds=1,
                beat=1,
                duration_beats=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_scoring_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fake_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Scoring context plan",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    encoded = base64.b64encode(b"RIFF....WAVEfmt scoring take").decode("ascii")

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [],
            "include_metronome": True,
            "performance_audio_base64": encoded,
            "performance_filename": "scoring-take.wav",
        },
    )

    assert score_response.status_code == 200
    plan = captured["plan"]
    assert plan is not None
    assert plan.slot_id == 1
    assert plan.provider == "deterministic"
    assert any("Existing tracks are present" in reason for reason in plan.reasons)


def test_percussion_generation_respects_studio_time_signature(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Three four percussion",
            "bpm": 120,
            "time_signature_numerator": 3,
            "time_signature_denominator": 4,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(
        client,
        studio_id,
        xml=THREE_FOUR_MUSICXML_UPLOAD,
        filename="three-four.musicxml",
    )

    generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/6/generate",
        json={"context_slot_ids": [1]},
    )

    assert generate_response.status_code == 200
    generated_payload = generate_response.json()
    variant_labels = [candidate["variant_label"] for candidate in generated_payload["candidates"][:3]]
    assert all(label.startswith("Groove ") for label in variant_labels)
    assert all("Candidate " not in label for label in variant_labels)
    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{generated_payload['candidates'][0]['candidate_id']}/approve",
        json={},
    )
    assert approve_response.status_code == 200
    percussion_notes = _track_notes(approve_response.json(), 6)
    assert [note["beat"] for note in percussion_notes[:6]] == [1, 2, 3, 4, 5, 6]
    assert [note["label"] for note in percussion_notes[:6]] == [
        "Kick",
        "Snare",
        "Hat",
        "Kick",
        "Snare",
        "Hat",
    ]
    assert percussion_notes[3]["measure_index"] == 2
    assert percussion_notes[3]["beat_in_measure"] == 1


def test_upload_musicxml_registers_parsed_track_notes(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "MusicXML import",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    payload = upload_response.json()
    soprano = payload["tracks"][0]
    soprano_notes = _track_notes(payload, 1)
    assert soprano["status"] == "registered"
    assert soprano["source_kind"] == "document"
    assert [note["label"] for note in soprano_notes] == ["C5", "G5"]
    assert soprano_notes[0]["source"] == "musicxml"
    assert soprano_notes[0]["pitch_midi"] == 72


def test_legacy_score_source_kind_is_normalized_to_document(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    studio_id = client.post(
        "/api/studios",
        json={
            "title": "Legacy source kind",
            "bpm": 120,
            "start_mode": "blank",
        },
    ).json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "score",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    assert upload_response.json()["tracks"][0]["source_kind"] == "document"


def test_track_registration_stores_ensemble_arrangement_diagnostics(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Ensemble gate",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id, slot_id=1, filename="soprano.musicxml")

    alto_response = upload_musicxml_track(client, studio_id, slot_id=2, filename="alto.musicxml")

    alto_payload = alto_response.json()
    alto = alto_payload["tracks"][1]
    ensemble = alto["diagnostics"]["registration_quality"]["ensemble_arrangement"]
    assert ensemble["evaluated"] is True
    assert ensemble["issue_code_counts"]["voice_crossing"] >= 1
    assert any("ensemble_voice_crossing" in note["quality_warnings"] for note in _track_notes(alto_payload, 2))


def test_track_upload_can_finalize_direct_uploaded_asset(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Direct upload target",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    content = MUSICXML_UPLOAD.encode("utf-8")

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "size_bytes": len(content),
            "content_type": "application/vnd.recordare.musicxml+xml",
        },
    )

    assert target_response.status_code == 200
    target = target_response.json()
    assert target["asset_path"].startswith(f"uploads/{studio_id}/1/")
    assert target["method"] == "PUT"

    put_path = target["upload_url"].removeprefix("http://testserver")
    put_response = client.put(put_path, content=content)
    assert put_response.status_code == 200

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "asset_path": target["asset_path"],
        },
    )

    assert upload_response.status_code == 200
    upload_payload = upload_response.json()
    soprano = upload_payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert [note["label"] for note in _track_notes(upload_payload, 1)] == ["C5", "G5"]


def test_owner_scoped_direct_upload_put_requires_matching_owner_token(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch, studio_access_policy="owner")
    owner_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_A}
    other_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_B}
    create_response = client.post(
        "/api/studios",
        headers=owner_headers,
        json={
            "title": "Owned direct upload target",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    content = MUSICXML_UPLOAD.encode("utf-8")

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        headers=owner_headers,
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "size_bytes": len(content),
            "content_type": "application/vnd.recordare.musicxml+xml",
        },
    )

    assert target_response.status_code == 200
    put_path = target_response.json()["upload_url"].removeprefix("http://testserver")
    assert client.put(put_path, content=content).status_code == 401
    assert client.put(put_path, headers=other_headers, content=content).status_code == 404
    assert client.put(put_path, headers=owner_headers, content=content).status_code == 200


def test_upload_start_can_use_staged_direct_uploaded_symbolic_asset(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    content = MUSICXML_UPLOAD.encode("utf-8")

    target_response = client.post(
        "/api/studios/upload-target",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "size_bytes": len(content),
            "content_type": "application/vnd.recordare.musicxml+xml",
        },
    )

    assert target_response.status_code == 200
    target = target_response.json()
    assert target["asset_path"].startswith("staged/")

    put_path = target["upload_url"].removeprefix("http://testserver")
    put_response = client.put(put_path, content=content)
    assert put_response.status_code == 200

    create_response = client.post(
        "/api/studios",
        json={
            "title": "Staged start",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "soprano.musicxml",
            "source_asset_path": target["asset_path"],
        },
    )

    assert create_response.status_code == 200
    payload = create_response.json()
    soprano = payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert [note["label"] for note in _track_notes(payload, 1)] == ["C5", "G5"]
    assert not (tmp_path / "staged").exists()


def test_upload_start_can_use_staged_direct_uploaded_pdf_for_omr(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fake_audiveris_omr)
    client = build_client(tmp_path, monkeypatch)

    target_response = client.post(
        "/api/studios/upload-target",
        json={
            "source_kind": "document",
            "filename": "full-score.pdf",
            "size_bytes": len(PDF_UPLOAD_BYTES),
            "content_type": "application/pdf",
        },
    )

    assert target_response.status_code == 200
    target = target_response.json()
    assert target["asset_path"].startswith("staged/")

    put_path = target["upload_url"].removeprefix("http://testserver")
    put_response = client.put(put_path, content=PDF_UPLOAD_BYTES)
    assert put_response.status_code == 200

    create_response = client.post(
        "/api/studios",
        json={
            "title": "Staged PDF start",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "full-score.pdf",
            "source_asset_path": target["asset_path"],
        },
    )

    assert create_response.status_code == 200
    studio_id = create_response.json()["studio_id"]
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["tracks"][0]["status"] == "needs_review"
    assert len(payload["candidates"]) == 1
    assert _candidate_notes(payload["candidates"][0])[0]["source"] == "omr"
    assert not (tmp_path / "staged").exists()


def test_audio_upload_keeps_source_file_for_track_playback(tmp_path: Path, monkeypatch) -> None:
    def fake_transcribe_voice_file(*args, **kwargs):
        return [
            TrackPitchEvent(
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
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Audio playback source",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    audio_bytes = b"RIFF....WAVEfmt test audio"
    encoded = base64.b64encode(audio_bytes).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    queued_job = upload_response.json()["jobs"][0]
    assert queued_job["job_type"] == "voice"
    assert queued_job["status"] == "queued"
    payload = client.get(f"/api/studios/{studio_id}").json()
    soprano = payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert soprano["source_kind"] == "audio"
    assert soprano["audio_source_path"].startswith("uploads/")
    assert soprano["audio_source_label"] == "voice.wav"
    assert soprano["audio_mime_type"] == "audio/wav"

    audio_response = client.get(f"/api/studios/{studio_id}/tracks/1/audio")

    assert audio_response.status_code == 200
    assert audio_response.headers["content-type"].startswith("audio/wav")
    assert audio_response.content == audio_bytes


def test_upload_musicxml_updates_studio_time_signature(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "MusicXML 3/4 import",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(THREE_FOUR_MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "three-four.musicxml",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    payload = upload_response.json()
    assert payload["time_signature_numerator"] == 3
    assert payload["time_signature_denominator"] == 4
    soprano_notes = _track_notes(payload, 1)
    assert soprano_notes[3]["label"] == "F5"
    assert soprano_notes[3]["measure_index"] == 2
    assert soprano_notes[3]["beat"] == 4
    assert soprano_notes[3]["beat_in_measure"] == 1


def test_direct_upload_requires_overwrite_confirmation(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Direct upload overwrite",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    blocked_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
        },
    )
    assert blocked_response.status_code == 409

    overwrite_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
            "allow_overwrite": True,
        },
    )
    assert overwrite_response.status_code == 200
    assert [note["label"] for note in _track_notes(overwrite_response.json(), 1)] == ["C5", "G5"]


def test_upload_requires_file_content_instead_of_fixture_fallback(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Upload content required",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
        },
    )

    assert response.status_code == 422


def test_upload_musicxml_can_wait_for_candidate_approval(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Candidate approval",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )

    assert upload_response.status_code == 200
    payload = upload_response.json()
    assert payload["tracks"][0]["status"] == "needs_review"
    assert _track_notes(payload, 1) == []
    assert len(payload["candidates"]) == 1
    candidate = payload["candidates"][0]
    assert candidate["status"] == "pending"
    assert candidate["suggested_slot_id"] == 1
    assert [note["label"] for note in _candidate_notes(candidate)] == ["C5", "G5"]

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate['candidate_id']}/approve",
        json={},
    )

    assert approve_response.status_code == 200
    approved_payload = approve_response.json()
    assert approved_payload["tracks"][0]["status"] == "registered"
    assert [note["label"] for note in _track_notes(approved_payload, 1)] == ["C5", "G5"]
    assert approved_payload["candidates"][0]["status"] == "approved"


def test_upload_pdf_queues_omr_job_and_creates_omr_candidate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fake_audiveris_omr)
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "PDF OMR upload",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(build_preview_pdf_bytes()).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.pdf",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )

    assert upload_response.status_code == 200
    assert upload_response.json()["jobs"][0]["source_label"] == "soprano.pdf"

    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["jobs"][0]["output_path"].endswith("audiveris-output.musicxml")
    assert payload["tracks"][0]["status"] == "needs_review"
    assert len(payload["candidates"]) == 1
    candidate = payload["candidates"][0]
    assert candidate["job_id"] == payload["jobs"][0]["job_id"]
    assert candidate["method"] == "audiveris_omr_review"
    assert candidate["diagnostics"]["candidate_method"] == "audiveris_omr_review"
    assert candidate["diagnostics"]["track"] == "Soprano"
    assert candidate["diagnostics"]["event_count"] == 2
    assert "note_count" not in candidate["diagnostics"]
    assert candidate["diagnostics"]["measure_count"] == 1
    assert candidate["diagnostics"]["review_hint"] == "few_events"
    candidate_notes = _candidate_notes(candidate)
    assert candidate_notes[0]["source"] == "omr"
    assert candidate_notes[0]["extraction_method"] == "audiveris_omr_v0"

    preview_response = client.get(
        f"/api/studios/{studio_id}/jobs/{payload['jobs'][0]['job_id']}/source-preview"
    )
    assert preview_response.status_code == 200
    assert preview_response.headers["content-type"] == "image/png"
    assert preview_response.content.startswith(b"\x89PNG\r\n\x1a\n")

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate['candidate_id']}/approve",
        json={},
    )

    assert approve_response.status_code == 200
    approve_payload = approve_response.json()
    soprano = approve_payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert [note["label"] for note in _track_notes(approve_payload, 1)] == ["C5", "G5"]


def test_upload_pdf_can_register_omr_candidates_into_each_suggested_track(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_omr",
        fake_multi_track_audiveris_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Full score OMR",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "satb.pdf",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    job_id = payload["jobs"][0]["job_id"]
    assert payload["jobs"][0]["status"] == "needs_review"
    assert [
        (candidate["suggested_slot_id"], _candidate_notes(candidate)[0]["label"])
        for candidate in payload["candidates"]
    ] == [
        (1, "C5"),
        (2, "A4"),
        (5, "C3"),
    ]

    approve_response = client.post(
        f"/api/studios/{studio_id}/jobs/{job_id}/approve-candidates",
        json={},
    )

    assert approve_response.status_code == 200
    approved_payload = approve_response.json()
    assert approved_payload["jobs"][0]["status"] == "completed"
    assert approved_payload["tracks"][0]["status"] == "registered"
    assert approved_payload["tracks"][1]["status"] == "registered"
    assert approved_payload["tracks"][4]["status"] == "registered"
    assert _track_notes(approved_payload, 1)[0]["source"] == "omr"
    assert _track_notes(approved_payload, 2)[0]["label"] == "A4"
    assert _track_notes(approved_payload, 5)[0]["label"] == "C3"
    assert all(candidate["status"] == "approved" for candidate in approved_payload["candidates"])


def test_upload_pdf_falls_back_to_vector_omr_and_attempts_all_vocal_tracks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_omr(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise OmrUnavailableError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fail_omr)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_score",
        fake_pdf_vector_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Vector PDF fallback",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "phonecert.pdf",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["jobs"][0]["output_path"].endswith("pdf-vector-omr-summary.json")
    assert [candidate["suggested_slot_id"] for candidate in payload["candidates"]] == [1, 2, 3, 4, 5]
    assert all(candidate["method"] == "pdf_vector_omr_review" for candidate in payload["candidates"])
    assert all(
        _candidate_notes(candidate)[0]["extraction_method"] == "pdf_vector_omr_v0"
        for candidate in payload["candidates"]
    )
    first_candidate = payload["candidates"][0]
    assert first_candidate["diagnostics"]["candidate_method"] == "pdf_vector_omr_review"
    assert first_candidate["diagnostics"]["track"] == "Soprano"
    assert first_candidate["diagnostics"]["event_count"] == 1
    assert "note_count" not in first_candidate["diagnostics"]
    assert first_candidate["diagnostics"]["measure_count"] == 1
    assert first_candidate["diagnostics"]["review_hint"] == "few_events"
    assert first_candidate["confidence"] > 0.46
    assert "Soprano" in first_candidate["message"]
    assert [track["status"] for track in payload["tracks"][:5]] == ["needs_review"] * 5
    assert payload["tracks"][5]["status"] == "empty"


def test_vector_omr_four_part_score_clears_unmapped_bass_placeholder(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_omr(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise OmrUnavailableError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fail_omr)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_score",
        fake_four_part_pdf_vector_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Four part vector PDF",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "four-part.pdf",
            "content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert [candidate["suggested_slot_id"] for candidate in payload["candidates"]] == [1, 2, 3, 4]
    assert [track["status"] for track in payload["tracks"][:4]] == ["needs_review"] * 4
    assert payload["tracks"][4]["status"] == "empty"


def test_omr_job_bulk_approval_requires_overwrite_confirmation(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_omr",
        fake_multi_track_audiveris_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Full score OMR overwrite",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "satb.pdf",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )

    assert upload_response.status_code == 200
    job_id = client.get(f"/api/studios/{studio_id}").json()["jobs"][0]["job_id"]

    blocked_response = client.post(
        f"/api/studios/{studio_id}/jobs/{job_id}/approve-candidates",
        json={},
    )
    assert blocked_response.status_code == 409

    overwrite_response = client.post(
        f"/api/studios/{studio_id}/jobs/{job_id}/approve-candidates",
        json={"allow_overwrite": True},
    )
    assert overwrite_response.status_code == 200
    assert _track_notes(overwrite_response.json(), 1)[0]["label"] == "C5"


def test_create_studio_with_pdf_starts_omr_without_fixture_registration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fake_audiveris_omr)
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    create_response = client.post(
        "/api/studios",
        json={
            "title": "PDF start",
            "bpm": 120,
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "full-score.pdf",
            "source_content_base64": encoded,
        },
    )

    assert create_response.status_code == 200
    studio_id = create_response.json()["studio_id"]
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["tracks"][0]["status"] == "needs_review"
    assert all(track["status"] != "registered" for track in payload["tracks"])
    assert len(payload["candidates"]) == 1
    assert _candidate_notes(payload["candidates"][0])[0]["source"] == "omr"


def test_upload_pdf_marks_omr_job_failed_when_audiveris_unavailable(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_omr(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise OmrUnavailableError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fail_omr)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_score",
        fail_pdf_vector_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "PDF OMR failure",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "broken.pdf",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "failed"
    assert "Audiveris missing" in payload["jobs"][0]["message"]
    assert "PDF vector fallback failed" in payload["jobs"][0]["message"]
    assert [track["status"] for track in payload["tracks"][:5]] == ["failed"] * 5
    assert payload["candidates"] == []


def test_failed_omr_job_can_be_retried_from_durable_queue(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_omr(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise OmrUnavailableError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fail_omr)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_score",
        fail_pdf_vector_omr,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Retryable PDF OMR",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(PDF_UPLOAD_BYTES).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "retry.pdf",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 200
    failed_payload = client.get(f"/api/studios/{studio_id}").json()
    job = failed_payload["jobs"][0]
    assert job["job_type"] == "omr"
    assert job["status"] == "failed"
    assert job["attempt_count"] == 1

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_omr", fake_audiveris_omr)
    retry_response = client.post(f"/api/studios/{studio_id}/jobs/{job['job_id']}/retry")

    assert retry_response.status_code == 200
    retry_payload = client.get(f"/api/studios/{studio_id}").json()
    assert retry_payload["jobs"][0]["status"] == "needs_review"
    assert retry_payload["jobs"][0]["attempt_count"] == 1
    assert _candidate_notes(retry_payload["candidates"][0])[0]["source"] == "omr"
    assert retry_payload["tracks"][0]["status"] == "needs_review"
    assert [track["status"] for track in retry_payload["tracks"][1:5]] == ["empty"] * 4


def test_voice_retry_rehydrates_direct_register_mode_without_queue_record(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_transcribe_voice_file(*args, **kwargs):
        raise VoiceTranscriptionError("No stable voiced note detected")

    def pass_transcribe_voice_file(*args, **kwargs):
        return [
            TrackPitchEvent(
                pitch_midi=72,
                label="C5",
                onset_seconds=0,
                duration_seconds=1,
                duration_beats=1,
                beat=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fail_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Retryable voice",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(b"RIFF\x24\x00\x00\x00WAVEfmt ").decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "content_base64": encoded,
            "review_before_register": False,
        },
    )

    assert upload_response.status_code == 200
    failed_payload = client.get(f"/api/studios/{studio_id}").json()
    job = failed_payload["jobs"][0]
    assert job["job_type"] == "voice"
    assert job["status"] == "failed"
    assert job["review_before_register"] is False
    assert job["audio_mime_type"] == "audio/wav"

    queue_path = tmp_path / "engine_queue.json"
    assert queue_path.exists()
    queue_path.unlink()

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        pass_transcribe_voice_file,
    )
    retry_response = client.post(f"/api/studios/{studio_id}/jobs/{job['job_id']}/retry")

    assert retry_response.status_code == 200
    retry_payload = client.get(f"/api/studios/{studio_id}").json()
    assert retry_payload["jobs"][0]["status"] == "completed"
    assert retry_payload["tracks"][0]["status"] == "registered"
    assert _track_notes(retry_payload, 1)[0]["label"] == "C5"
    assert retry_payload["candidates"] == []


def test_studio_poll_does_not_wake_queued_engine_job(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def pass_transcribe_voice_file(*args, **kwargs):
        return [
            TrackPitchEvent(
                pitch_midi=72,
                label="C5",
                onset_seconds=0,
                duration_seconds=1,
                duration_beats=1,
                beat=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        pass_transcribe_voice_file,
    )
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Queued poll does not process",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(b"RIFF\x24\x00\x00\x00WAVEfmt ").decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "content_base64": encoded,
            "review_before_register": False,
        },
    )

    assert upload_response.status_code == 200
    queued_payload = upload_response.json()
    assert queued_payload["jobs"][0]["status"] == "queued"
    assert queued_payload["tracks"][0]["status"] == "extracting"

    polled_payload = client.get(f"/api/studios/{studio_id}").json()

    assert polled_payload["jobs"][0]["status"] == "queued"
    assert polled_payload["tracks"][0]["status"] == "extracting"


def test_engine_queue_rehydrates_studio_job_lost_to_concurrent_save(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def pass_transcribe_voice_file(*args, **kwargs):
        return [
            TrackPitchEvent(
                pitch_midi=43,
                label="G2",
                onset_seconds=0,
                duration_seconds=1,
                duration_beats=1,
                beat=1,
                confidence=0.9,
                source="voice",
                extraction_method="test_voice",
            )
        ]

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        pass_transcribe_voice_file,
    )
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Recovered voice queue",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(b"RIFF\x24\x00\x00\x00WAVEfmt ").decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/5/upload",
        json={
            "source_kind": "audio",
            "filename": "bass.wav",
            "content_base64": encoded,
            "review_before_register": False,
        },
    )

    assert upload_response.status_code == 200
    job_id = upload_response.json()["jobs"][0]["job_id"]
    repository = studio_repository.get_studio_repository()
    with repository._lock:
        studio = repository._load_studio(studio_id)
        assert studio is not None
        bass = repository._find_track(studio, 5)
        bass.status = "empty"
        bass.source_kind = None
        bass.source_label = None
        bass.updated_at = studio.created_at
        studio.jobs = []
        repository._save_studio(studio)

    processed = repository.process_engine_queue_once()

    assert processed is not None
    assert processed.job_id == job_id
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["job_id"] == job_id
    assert payload["jobs"][0]["status"] == "completed"
    assert payload["tracks"][4]["status"] == "registered"
    assert _track_notes(payload, 5)[0]["label"] == "G2"


def test_candidate_can_be_approved_into_different_empty_track(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Candidate retarget",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )
    candidate_id = upload_response.json()["candidates"][0]["candidate_id"]

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate_id}/approve",
        json={"target_slot_id": 2},
    )

    assert approve_response.status_code == 200
    payload = approve_response.json()
    assert payload["tracks"][0]["status"] == "empty"
    assert payload["tracks"][1]["status"] == "registered"
    assert [note["label"] for note in _track_notes(payload, 2)] == ["C5", "G5"]


def test_candidate_approval_requires_overwrite_confirmation(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Candidate overwrite",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")
    upload_musicxml_track(client, studio_id, slot_id=2, filename="alto-seed.musicxml")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )
    candidate_id = upload_response.json()["candidates"][0]["candidate_id"]

    blocked_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate_id}/approve",
        json={"target_slot_id": 2},
    )
    assert blocked_response.status_code == 409

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate_id}/approve",
        json={"target_slot_id": 2, "allow_overwrite": True},
    )

    assert approve_response.status_code == 200
    payload = approve_response.json()
    assert payload["tracks"][0]["status"] == "empty"
    assert payload["tracks"][1]["status"] == "registered"
    assert [note["label"] for note in _track_notes(payload, 2)] == ["C5", "G5"]
    assert payload["candidates"][0]["status"] == "approved"


def test_reject_candidate_keeps_track_empty(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Candidate rejection",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
            "review_before_register": True,
        },
    )
    candidate_id = upload_response.json()["candidates"][0]["candidate_id"]

    reject_response = client.post(f"/api/studios/{studio_id}/candidates/{candidate_id}/reject")

    assert reject_response.status_code == 200
    payload = reject_response.json()
    assert payload["tracks"][0]["status"] == "empty"
    assert _track_notes(payload, 1) == []
    assert payload["candidates"][0]["status"] == "rejected"


def test_ai_generation_creates_candidates_and_approval_requires_overwrite_confirmation(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "AI overwrite",
            "bpm": 104,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    first_generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/2/generate",
        json={"context_slot_ids": [1]},
    )
    assert first_generate_response.status_code == 200
    first_payload = first_generate_response.json()
    alto_candidates = [
        candidate
        for candidate in first_payload["candidates"]
        if candidate["suggested_slot_id"] == 2 and candidate["status"] == "pending"
    ]
    assert len(alto_candidates) == 3
    assert all("Candidate " not in candidate["variant_label"] for candidate in alto_candidates)
    assert all("avg " in candidate["variant_label"] for candidate in alto_candidates)
    first_group_id = alto_candidates[0]["candidate_group_id"]
    assert first_group_id is not None
    approve_first_response = client.post(
        f"/api/studios/{studio_id}/candidates/{alto_candidates[0]['candidate_id']}/approve",
        json={},
    )
    assert approve_first_response.status_code == 200
    first_approved_payload = approve_first_response.json()
    assert first_approved_payload["tracks"][1]["status"] == "registered"
    assert all(
        candidate["status"] != "pending"
        for candidate in first_approved_payload["candidates"]
        if candidate["candidate_group_id"] == first_group_id
    )

    second_generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/2/generate",
        json={"context_slot_ids": [1]},
    )
    assert second_generate_response.status_code == 200
    second_candidates = [
        candidate
        for candidate in second_generate_response.json()["candidates"]
        if candidate["suggested_slot_id"] == 2 and candidate["status"] == "pending"
    ]
    assert len(second_candidates) == 3

    blocked_response = client.post(
        f"/api/studios/{studio_id}/candidates/{second_candidates[0]['candidate_id']}/approve",
        json={},
    )
    assert blocked_response.status_code == 409

    overwrite_response = client.post(
        f"/api/studios/{studio_id}/candidates/{second_candidates[0]['candidate_id']}/approve",
        json={"allow_overwrite": True},
    )
    assert overwrite_response.status_code == 200
    assert overwrite_response.json()["tracks"][1]["status"] == "registered"


def test_ai_generation_uses_sync_adjusted_context_timing(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "AI sync context",
            "bpm": 60,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)

    sync_response = client.patch(
        f"/api/studios/{studio_id}/tracks/1/sync",
        json={"sync_offset_seconds": 1.0},
    )
    assert sync_response.status_code == 200

    generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/2/generate",
        json={"context_slot_ids": [1]},
    )

    assert generate_response.status_code == 200
    alto_candidates = [
        candidate
        for candidate in generate_response.json()["candidates"]
        if candidate["suggested_slot_id"] == 2 and candidate["status"] == "pending"
    ]
    assert len(alto_candidates) == 3
    alto_notes = _candidate_notes(alto_candidates[0])
    assert [note["beat"] for note in alto_notes[:2]] == [2, 3]
    assert [note["onset_seconds"] for note in alto_notes[:2]] == [1, 2]


def test_ai_generation_handles_close_tenor_bass_neighbor_gap(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Close neighbor generation",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    tenor_xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Tenor</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration></note></measure></part>
</score-partwise>
"""
    bass_xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>D</step><alter>1</alter><octave>3</octave></pitch><duration>1</duration></note></measure></part>
</score-partwise>
"""
    upload_musicxml_track(client, studio_id, slot_id=3, filename="tenor.musicxml", xml=tenor_xml)
    upload_musicxml_track(client, studio_id, slot_id=5, filename="bass.musicxml", xml=bass_xml)

    def fail_ai_registration_review(*args, **kwargs):
        raise AssertionError("AI candidate generation should not block on registration-review LLM calls.")

    monkeypatch.setattr(
        "gigastudy_api.services.track_registration.review_track_registration_with_deepseek",
        fail_ai_registration_review,
    )
    monkeypatch.setattr(
        "gigastudy_api.services.track_registration.review_ensemble_registration_with_deepseek",
        fail_ai_registration_review,
    )

    generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/4/generate",
        json={"context_slot_ids": [3, 5]},
    )

    assert generate_response.status_code == 200
    baritone_candidates = [
        candidate
        for candidate in generate_response.json()["candidates"]
        if candidate["suggested_slot_id"] == 4 and candidate["status"] == "pending"
    ]
    assert len(baritone_candidates) == 3
    assert _candidate_notes(baritone_candidates[0])[0]["label"] == "E3"

    regenerate_response = client.post(
        f"/api/studios/{studio_id}/tracks/4/generate",
        json={"context_slot_ids": [3, 5]},
    )

    assert regenerate_response.status_code == 200
    regenerate_payload = regenerate_response.json()
    pending_baritone_candidates = [
        candidate
        for candidate in regenerate_payload["candidates"]
        if candidate["suggested_slot_id"] == 4 and candidate["status"] == "pending"
    ]
    superseded_baritone_candidates = [
        candidate
        for candidate in regenerate_payload["candidates"]
        if candidate["suggested_slot_id"] == 4 and candidate["status"] == "rejected"
    ]
    assert len(pending_baritone_candidates) == 3
    assert superseded_baritone_candidates == []
