import base64
from pathlib import Path

import fitz
from fastapi.testclient import TestClient

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    PitchEvent,
    Studio,
    TrackMaterialArchive,
    TrackSlot,
    build_studio_response,
)
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.audio_decode import VoiceAnalysisAudio
from gigastudy_api.main import create_app
from gigastudy_api.services.engine.audiveris_document import AudiverisDocumentError
from gigastudy_api.services.engine.candidate_diagnostics import track_duration_seconds
from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.pdf_vector_document import PdfVectorDocumentError
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile, ParsedTrack, parse_symbolic_file_with_metadata
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services import studio_repository
from gigastudy_api.services.llm.midi_role_review import MidiRoleAssignment, MidiRoleReviewInstruction
from gigastudy_api.services.studio_documents import register_track_material
from gigastudy_api.services.studio_jobs import create_document_extraction_job


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


class FixtureResponse:
    status_code = 200

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> dict:
        return self._payload


def musicxml_upload_with_pitches(first: tuple[str, int], second: tuple[str, int]) -> str:
    first_step, first_octave = first
    second_step, second_octave = second
    return f"""<?xml version="1.0" encoding="UTF-8"?>
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
        <pitch><step>{first_step}</step><octave>{first_octave}</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>{second_step}</step><octave>{second_octave}</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def build_preview_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=320, height=240)
    page.insert_text((40, 70), "GigaStudy preview", fontsize=16)
    for offset in range(5):
        y = 120 + offset * 5
        page.draw_line((40, y), (280, y))
    return document.tobytes()


def build_lyrics_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=320, height=240)
    page.insert_text((40, 70), "Love me like this lyrics only", fontsize=16)
    page.insert_text((40, 100), "No staff lines or notes are present on this page.", fontsize=11)
    return document.tobytes()


def build_image_only_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=320, height=240)
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 32, 24), False)
    page.insert_image(page.rect, pixmap=pixmap)
    return document.tobytes()


def fake_audiveris_document_extraction(
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


def fake_multi_track_audiveris_document_extraction(
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


def fake_pdf_vector_document(
    path: Path,
    *,
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    max_slot_id: int = 5,
) -> ParsedSymbolicFile:
    mapped_events: dict[int, list[TrackPitchEvent]] = {}
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
                source="document",
                extraction_method="pdf_vector_document_v1",
            )
        ]
        mapped_events[slot_id] = notes
        tracks.append(ParsedTrack(name=f"Vector {slot_id}", events=notes, slot_id=slot_id))
    return ParsedSymbolicFile(
        tracks=tracks,
        mapped_events=mapped_events,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        has_time_signature=False,
    )


def fake_four_part_pdf_vector_document(
    path: Path,
    *,
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    max_slot_id: int = 5,
) -> ParsedSymbolicFile:
    parsed = fake_pdf_vector_document(
        path,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        max_slot_id=4,
    )
    return parsed


def fail_pdf_vector_document(*args, **kwargs) -> ParsedSymbolicFile:
    raise PdfVectorDocumentError("Vector fallback cannot read PDF")


def build_client(tmp_path: Path, monkeypatch, *, studio_access_policy: str = "public") -> TestClient:
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("GIGASTUDY_API_STUDIO_ACCESS_POLICY", studio_access_policy)
    get_settings.cache_clear()
    studio_repository._repository = None
    return TestClient(create_app())


def _process_engine_queue_and_get_studio(client: TestClient, studio_id: str) -> dict:
    repository = studio_repository.get_studio_repository()
    for _ in range(10):
        if repository.process_engine_queue_once() is None:
            break
    return client.get(f"/api/studios/{studio_id}").json()


def _created_studio_payload(client: TestClient, response) -> dict:
    studio_id = response.json()["studio_id"]
    payload = client.get(f"/api/studios/{studio_id}").json()
    tempo_job = next(
        (job for job in payload["jobs"] if job["status"] == "tempo_review_required"),
        None,
    )
    if tempo_job is not None:
        approve_response = _approve_pending_tempo_job(client, payload, tempo_job)
        assert approve_response.status_code == 200
    return client.get(f"/api/studios/{studio_id}").json()


def _approve_pending_tempo_job(
    client: TestClient,
    studio_payload: dict,
    job: dict,
    *,
    bpm: int | None = None,
    numerator: int | None = None,
    denominator: int | None = None,
):
    diagnostics = job.get("diagnostics") or {}
    return client.post(
        f"/api/studios/{studio_payload['studio_id']}/jobs/{job['job_id']}/approve-tempo",
        json={
            "bpm": bpm or diagnostics.get("suggested_bpm") or studio_payload["bpm"],
            "time_signature_numerator": (
                numerator
                or diagnostics.get("suggested_time_signature_numerator")
                or studio_payload["time_signature_numerator"]
            ),
            "time_signature_denominator": (
                denominator
                or diagnostics.get("suggested_time_signature_denominator")
                or studio_payload["time_signature_denominator"]
            ),
        },
    )


def test_track_archive_migrates_legacy_single_region_snapshot() -> None:
    archive = TrackMaterialArchive.model_validate(
        {
            "archive_id": "legacy",
            "track_slot_id": 1,
            "track_name": "Soprano",
            "source_kind": "document",
            "source_label": "legacy.musicxml",
            "archived_at": "2026-05-01T00:00:00+00:00",
            "reason": "original_score",
            "pinned": True,
            "region_snapshot": {
                "region_id": "track-1-region-1",
                "track_slot_id": 1,
                "track_name": "Soprano",
                "source_kind": "document",
                "source_label": "legacy.musicxml",
                "start_seconds": 0,
                "duration_seconds": 1,
                "pitch_events": [],
            },
        }
    )

    assert len(archive.region_snapshots) == 1
    assert archive.region_snapshots[0].region_id == "track-1-region-1"


def upload_musicxml_track(
    client: TestClient,
    studio_id: str,
    *,
    slot_id: int = 1,
    xml: str = MUSICXML_UPLOAD,
    filename: str = "soprano.musicxml",
    allow_overwrite: bool = False,
):
    del client
    repository = studio_repository.get_studio_repository()
    upload_dir = Path(get_settings().storage_root) / "_test_symbolic_uploads" / studio_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    source_path = upload_dir / Path(filename).name
    source_path.write_text(xml, encoding="utf-8")

    with repository._lock:
        studio = repository._load_studio(studio_id)
        assert studio is not None
        parsed_symbolic = parse_symbolic_file_with_metadata(
            source_path,
            bpm=studio.bpm,
            target_slot_id=slot_id,
        )
        if parsed_symbolic.has_time_signature:
            studio.time_signature_numerator = parsed_symbolic.time_signature_numerator
            studio.time_signature_denominator = parsed_symbolic.time_signature_denominator
        assert allow_overwrite or not repository._mapped_events_would_overwrite(studio, parsed_symbolic.mapped_events)
        timestamp = studio_repository._now()
        registrations = repository._prepare_registration_batch(
            studio,
            parsed_symbolic.mapped_events,
            source_kind="document",
        )
        for mapped_slot_id, registration in registrations.items():
            track = repository._find_track(studio, mapped_slot_id)
            register_track_material(
                studio,
                track,
                timestamp=timestamp,
                source_kind="document",
                source_label=filename,
                events=registration.events,
                duration_seconds=track_duration_seconds(registration.events),
                registration_diagnostics=registration.diagnostics,
            )
        studio.updated_at = timestamp
        repository._save_studio(studio)
        payload = build_studio_response(studio).model_dump(mode="json")
    return FixtureResponse(payload)


def create_musicxml_candidate(
    client: TestClient,
    studio_id: str,
    *,
    slot_id: int = 1,
    xml: str = MUSICXML_UPLOAD,
    filename: str = "soprano.musicxml",
) -> FixtureResponse:
    del client
    repository = studio_repository.get_studio_repository()
    upload_dir = Path(get_settings().storage_root) / "_test_symbolic_candidates" / studio_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    source_path = upload_dir / Path(filename).name
    source_path.write_text(xml, encoding="utf-8")
    studio = repository.get_studio(studio_id)
    parsed_symbolic = parse_symbolic_file_with_metadata(
        source_path,
        bpm=studio.bpm,
        target_slot_id=slot_id,
    )
    candidate_studio = repository._add_extraction_candidates(
        studio_id,
        parsed_symbolic.mapped_events,
        source_kind="document",
        source_label=filename,
        method="symbolic_import_review",
        confidence=0.92,
        message="Symbolic import is waiting for user approval.",
    )
    return FixtureResponse(build_studio_response(candidate_studio).model_dump(mode="json"))


def enqueue_document_fixture(
    client: TestClient,
    studio_id: str,
    *,
    filename: str,
    content: bytes,
) -> FixtureResponse:
    del client
    repository = studio_repository.get_studio_repository()
    upload_dir = Path(get_settings().storage_root) / "_test_document_uploads" / studio_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    source_path = upload_dir / Path(filename).name
    source_path.write_bytes(content)
    studio = repository._enqueue_document_job(
        studio_id,
        1,
        source_kind="document",
        source_label=filename,
        source_path=source_path,
        background_tasks=None,
        parse_all_parts=True,
    )
    return FixtureResponse(build_studio_response(studio).model_dump(mode="json"))


def test_create_studio_client_request_id_returns_existing_blank_studio_on_retry(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = build_client(tmp_path, monkeypatch)
    payload = {
        "title": "Retry blank",
        "client_request_id": "retry-blank-001",
        "bpm": 120,
        "start_mode": "blank",
    }

    first_response = client.post("/api/studios", json=payload)
    retry_response = client.post("/api/studios", json=payload)

    assert first_response.status_code == 200
    assert retry_response.status_code == 200
    assert retry_response.json()["studio_id"] == first_response.json()["studio_id"]
    assert len(client.get("/api/studios").json()) == 1


def test_create_studio_client_request_id_returns_existing_queued_upload_on_retry(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_single_note_midi_bytes(bpm=113)).decode("ascii")
    payload = {
        "title": "Retry MIDI seed",
        "client_request_id": "retry-midi-001",
        "start_mode": "upload",
        "source_kind": "document",
        "source_filename": "source.mid",
        "source_content_base64": encoded,
    }

    first_response = client.post("/api/studios", json=payload)
    retry_response = client.post("/api/studios", json=payload)

    assert first_response.status_code == 200
    assert retry_response.status_code == 200
    assert retry_response.json()["studio_id"] == first_response.json()["studio_id"]
    retry_payload = retry_response.json()
    assert retry_payload["jobs"][0]["status"] == "tempo_review_required"
    assert retry_payload["jobs"][0]["diagnostics"]["suggested_bpm"] == 113
    assert len(client.get("/api/studios").json()) == 1


def test_create_studio_retry_repairs_missing_queue_record_for_existing_upload(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_single_note_midi_bytes(bpm=113)).decode("ascii")
    payload = {
        "title": "Retry repair MIDI seed",
        "client_request_id": "retry-midi-repair-001",
        "start_mode": "upload",
        "source_kind": "document",
        "source_filename": "source.mid",
        "source_content_base64": encoded,
    }

    first_response = client.post("/api/studios", json=payload)
    studio_id = first_response.json()["studio_id"]
    repository = studio_repository.get_studio_repository()
    approve_response = _approve_pending_tempo_job(
        client,
        first_response.json(),
        first_response.json()["jobs"][0],
    )
    assert approve_response.status_code == 200
    assert repository._engine_queue.delete_studio_jobs(studio_id) == 1
    assert repository._engine_queue.has_runnable(studio_id=studio_id) is False

    retry_response = client.post("/api/studios", json=payload)

    assert retry_response.status_code == 200
    assert retry_response.json()["studio_id"] == studio_id
    assert repository._engine_queue.has_runnable(studio_id=studio_id) is True


def test_create_studio_rejects_reused_client_request_id_for_different_start_data(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = build_client(tmp_path, monkeypatch)
    first_response = client.post(
        "/api/studios",
        json={
            "title": "First start",
            "client_request_id": "retry-conflict-001",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    conflict_response = client.post(
        "/api/studios",
        json={
            "title": "Different start",
            "client_request_id": "retry-conflict-001",
            "bpm": 120,
            "start_mode": "blank",
        },
    )

    assert first_response.status_code == 200
    assert conflict_response.status_code == 409
    assert len(client.get("/api/studios").json()) == 1


def build_single_note_midi_bytes(*, bpm: int = 113, pitch: int = 72, duration_ticks: int = 480) -> bytes:
    tempo_microseconds = int(round(60_000_000 / bpm))
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\xff\x51\x03" + tempo_microseconds.to_bytes(3, "big"),
            b"\x00\x90" + bytes([pitch, 100]),
            _vlq(duration_ticks) + b"\x80" + bytes([pitch, 64]),
            b"\x00\xff\x2f\x00",
        ]
    )
    return b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )


def build_midi_with_named_empty_bass_bytes(*, bpm: int = 113) -> bytes:
    tempo_microseconds = int(round(60_000_000 / bpm))
    soprano_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\xff\x51\x03" + tempo_microseconds.to_bytes(3, "big"),
            b"\x00\x90\x48\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    bass_events = b"".join(
        [
            b"\x00\xff\x03\x04Bass",
            b"\x00\xff\x2f\x00",
        ]
    )
    return b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (2).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(soprano_events).to_bytes(4, "big"),
            soprano_events,
            b"MTrk",
            len(bass_events).to_bytes(4, "big"),
            bass_events,
        ]
    )


def build_polyphonic_vocal_midi_bytes(*, bpm: int = 113) -> bytes:
    tempo_microseconds = int(round(60_000_000 / bpm))
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\xff\x51\x03" + tempo_microseconds.to_bytes(3, "big"),
            b"\x00\x90\x48\x64",
            b"\x00\x90\x4c\x64",
            _vlq(240) + b"\x90\x4f\x64",
            _vlq(240) + b"\x80\x48\x40",
            b"\x00\x80\x4c\x40",
            _vlq(480) + b"\x80\x4f\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    return b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )


def build_generic_channel_packed_midi_bytes(*, bpm: int = 113) -> bytes:
    tempo_microseconds = int(round(60_000_000 / bpm))
    track_events = b"".join(
        [
            b"\x00\xff\x03\x0cMIDI track 1",
            b"\x00\xff\x51\x03" + tempo_microseconds.to_bytes(3, "big"),
            b"\x00\xc0\x00",
            b"\x00\xc1\x00",
            b"\x00\x90\x48\x64",
            b"\x00\x91\x30\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\x81\x30\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    return b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (0).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )


def _vlq(value: int) -> bytes:
    values = [value & 0x7F]
    value >>= 7
    while value:
        values.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(values)


def _track_region_events(payload: dict, slot_id: int) -> list[dict]:
    return [_event_from_pitch_event(event) for event in _track_events(payload, slot_id)]


def _track_events(payload: dict, slot_id: int) -> list[dict]:
    for region in payload["regions"]:
        if region["track_slot_id"] == slot_id:
            return [dict(event) for event in region["pitch_events"]]
    return []


def _candidate_events(candidate: dict) -> list[dict]:
    return [_event_from_pitch_event(event) for event in candidate["region"]["pitch_events"]]


def _event_from_pitch_event(event: dict) -> dict:
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


def _performance_event_from_track_event(event: TrackPitchEvent | dict) -> dict:
    payload = event.model_dump(mode="json") if isinstance(event, TrackPitchEvent) else dict(event)
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
            "title": "?붿슂???꾩뭅?좊씪",
            "bpm": 92,
            "start_mode": "blank",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "?붿슂???꾩뭅?좊씪"
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


def test_public_studio_password_protects_detail_and_soft_delete(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    owner_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_A}
    other_headers = {"X-GigaStudy-Owner-Token": OWNER_TOKEN_B}

    create_response = client.post(
        "/api/studios",
        headers=owner_headers,
        json={
            "title": "Password studio",
            "bpm": 92,
            "start_mode": "blank",
        },
    )

    assert create_response.status_code == 200
    studio_id = create_response.json()["studio_id"]
    listed = client.get("/api/studios").json()
    assert [studio["studio_id"] for studio in listed] == [studio_id]
    assert client.get(f"/api/studios/{studio_id}").status_code == 404
    assert client.get(f"/api/studios/{studio_id}", headers=other_headers).status_code == 404
    assert client.get(f"/api/studios/{studio_id}", headers=owner_headers).status_code == 200
    assert client.delete(f"/api/studios/{studio_id}", headers=other_headers).status_code == 404

    delete_response = client.delete(f"/api/studios/{studio_id}", headers=owner_headers)

    assert delete_response.status_code == 200
    assert delete_response.json()["is_active"] is False
    assert client.get("/api/studios").json() == []
    assert client.get(f"/api/studios/{studio_id}", headers=owner_headers).status_code == 404


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


def test_recording_fixture_endpoint_is_not_exposed(tmp_path: Path, monkeypatch) -> None:
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
    payload = _created_studio_payload(client, response)
    assert payload["bpm"] == 92
    assert payload["tracks"][0]["status"] == "registered"
    assert "notes" not in payload["tracks"][0]
    assert [note["label"] for note in _track_region_events(payload, 1)] == ["C5", "G5"]


def test_upload_start_uses_source_midi_tempo_when_bpm_is_not_provided(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_single_note_midi_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "MIDI source tempo",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "source.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = _created_studio_payload(client, response)
    assert payload["bpm"] == 113
    assert _track_events(payload, 1)[0]["duration_seconds"] == 0.531


def test_upload_start_symbolic_seed_is_queued_before_track_registration(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_single_note_midi_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "Queued MIDI seed",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "source.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["jobs"][0]["status"] == "tempo_review_required"
    assert payload["jobs"][0]["diagnostics"]["suggested_bpm"] == 113
    assert payload["tracks"][0]["status"] == "empty"
    assert sum(1 for track in payload["tracks"] if track["status"] == "registered") == 0


def test_score_file_registration_uses_user_approved_bpm_and_meter(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_single_note_midi_bytes(bpm=113, duration_ticks=480)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "User approved tempo",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "source.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    tempo_job = payload["jobs"][0]
    assert tempo_job["status"] == "tempo_review_required"
    assert tempo_job["diagnostics"]["suggested_bpm"] == 113

    approve_response = _approve_pending_tempo_job(
        client,
        payload,
        tempo_job,
        bpm=101,
        numerator=3,
        denominator=4,
    )

    assert approve_response.status_code == 200
    approved_payload = client.get(f"/api/studios/{payload['studio_id']}").json()
    assert approved_payload["bpm"] == 101
    assert approved_payload["time_signature_numerator"] == 3
    assert approved_payload["time_signature_denominator"] == 4
    assert _track_region_events(approved_payload, 1)[0]["duration_seconds"] == 0.5941


def test_upload_start_applies_shared_monophonic_contract_to_midi_tracks(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_polyphonic_vocal_midi_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "Poly MIDI contract",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "poly.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = _created_studio_payload(client, response)
    events = _track_region_events(payload, 1)
    assert [event["label"] for event in events] == ["E5", "G5"]
    assert events[0]["beat"] == 1
    assert events[0]["duration_beats"] == 0.5
    assert events[0]["onset_seconds"] + events[0]["duration_seconds"] <= events[1]["onset_seconds"]
    assert "polyphonic_onset_collapsed" in events[0]["quality_warnings"]


def test_upload_start_registers_generic_midi_parts_when_register_order_is_clear(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_generic_channel_packed_midi_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "Generic MIDI register order",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "generic.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = _created_studio_payload(client, response)
    pending_candidates = [candidate for candidate in payload["candidates"] if candidate["status"] == "pending"]
    assert pending_candidates == []
    assert sum(1 for track in payload["tracks"] if track["status"] == "registered") == 2
    assert [event["label"] for event in _track_region_events(payload, 1)] == ["C5"]
    assert [event["label"] for event in _track_region_events(payload, 5)] == ["C3"]


def test_upload_start_midi_review_reports_named_empty_parts(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_midi_with_named_empty_bass_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "Named empty MIDI part",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "named-empty.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = _created_studio_payload(client, response)
    pending_candidates = [candidate for candidate in payload["candidates"] if candidate["status"] == "pending"]
    assert len(pending_candidates) == 1
    candidate = pending_candidates[0]
    assert candidate["suggested_slot_id"] == 1
    assert candidate["diagnostics"]["seed_review_reasons"] == ["midi_named_part_unmapped"]
    assert candidate["diagnostics"]["midi_named_empty_parts"] == [
        {
            "slot_id": 5,
            "track_name": "Bass",
            "source_label": "Bass",
            "source_track_index": 2,
            "midi_channels": [],
        }
    ]
    assert _track_region_events(payload, 5) == []


def test_upload_start_applies_llm_midi_role_review_when_enabled(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []

    def fake_midi_role_review(*args, **kwargs):  # noqa: ANN002, ANN003
        calls.append(kwargs["source_label"])
        return MidiRoleReviewInstruction(
            confidence=0.82,
            assignments=[
                MidiRoleAssignment(source_track_index=1, midi_channels=[1], assigned_slot_id=2),
                MidiRoleAssignment(source_track_index=1, midi_channels=[2], assigned_slot_id=5),
            ],
            reasons=["Generic MIDI role reviewer adjusted the upper part."],
            used=True,
            provider="test",
            model="test-model",
        )

    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_MIDI_ROLE_REVIEW_ENABLED", "true")
    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setattr(
        "gigastudy_api.services.studio_engine_job_handlers.review_midi_roles",
        fake_midi_role_review,
    )
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(build_generic_channel_packed_midi_bytes(bpm=113)).decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "LLM MIDI role review",
            "start_mode": "upload",
            "source_kind": "document",
            "source_filename": "generic.mid",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 200
    payload = _created_studio_payload(client, response)
    assert calls == ["generic.mid"]
    assert _track_region_events(payload, 1) == []
    assert [event["label"] for event in _track_region_events(payload, 2)] == ["C5"]
    assert [event["label"] for event in _track_region_events(payload, 5)] == ["C3"]


def test_studio_response_preserves_explicit_region_events_without_query_cleanup() -> None:
    timestamp = "2026-05-04T00:00:00+00:00"
    studio = Studio(
        studio_id="legacy-poly",
        title="Legacy poly",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="legacy.mid",
                updated_at=timestamp,
            ),
            *[
                TrackSlot(slot_id=slot_id, name=name, status="empty", updated_at=timestamp)
                for slot_id, name in [
                    (2, "Alto"),
                    (3, "Tenor"),
                    (4, "Baritone"),
                    (5, "Bass"),
                    (6, "Percussion"),
                ]
            ],
        ],
        regions=[
            ArrangementRegion(
                region_id="track-1-region-1",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="legacy.mid",
                start_seconds=0,
                duration_seconds=2,
                pitch_events=[
                    PitchEvent(
                        event_id="low",
                        track_slot_id=1,
                        region_id="track-1-region-1",
                        label="C5",
                        pitch_midi=72,
                        pitch_hz=523.2511,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        confidence=1,
                        source="midi",
                    ),
                    PitchEvent(
                        event_id="high",
                        track_slot_id=1,
                        region_id="track-1-region-1",
                        label="E5",
                        pitch_midi=76,
                        pitch_hz=659.2551,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        confidence=1,
                        source="midi",
                    ),
                    PitchEvent(
                        event_id="next",
                        track_slot_id=1,
                        region_id="track-1-region-1",
                        label="G5",
                        pitch_midi=79,
                        pitch_hz=783.9909,
                        start_seconds=0.25,
                        duration_seconds=0.5,
                        start_beat=1.5,
                        duration_beats=1,
                        confidence=1,
                        source="midi",
                    ),
                ],
            )
        ],
        reports=[],
        created_at=timestamp,
        updated_at=timestamp,
    )

    response = build_studio_response(studio)
    events = response.regions[0].pitch_events

    assert [event.label for event in events] == ["C5", "E5", "G5"]
    assert response.regions[0].diagnostics == {}


def test_studio_bpm_change_endpoint_is_not_exposed(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Fixed BPM",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    response = client.patch(
        f"/api/studios/{studio_id}/timing",
        json={"bpm": 60},
    )

    assert response.status_code == 404


def test_register_generate_sync_and_score_track(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "SATB ?곗뒿",
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
    assert any(
        job["job_type"] == "generation" and job["status"] == "queued"
        for job in generate_response.json()["jobs"]
    )
    generated_payload = _process_engine_queue_and_get_studio(client, studio_id)
    assert len(
        [
            candidate
            for candidate in generated_payload["candidates"]
            if candidate["suggested_slot_id"] == 6 and candidate["status"] == "pending"
        ]
    ) == 3
    candidate_id = generated_payload["candidates"][0]["candidate_id"]
    studio_view_payload = client.get(f"/api/studios/{studio_id}?view=studio").json()
    studio_view_candidate = next(
        candidate
        for candidate in studio_view_payload["candidates"]
        if candidate["candidate_id"] == candidate_id
    )
    assert studio_view_candidate["region"]["pitch_events"] == []
    candidate_detail = client.get(f"/api/studios/{studio_id}/candidates/{candidate_id}").json()
    assert candidate_detail["region"]["pitch_events"]
    approve_response = client.post(f"/api/studios/{studio_id}/candidates/{candidate_id}/approve", json={})
    assert approve_response.status_code == 200
    approve_payload = approve_response.json()
    percussion = approve_payload["tracks"][5]
    percussion_events = _track_region_events(approve_payload, 6)
    assert percussion["status"] == "registered"
    assert percussion["source_kind"] == "ai"
    assert percussion_events[0]["label"] == "Kick"
    assert percussion_events[0]["beat"] == 1
    assert all(note["duration_beats"] == 0.25 for note in percussion_events)
    assert any(note["label"] == "Snare" for note in percussion_events)

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
    assert any(
        job["job_type"] == "scoring" and job["status"] == "queued"
        for job in score_response.json()["jobs"]
    )
    reports = _process_engine_queue_and_get_studio(client, studio_id)["reports"]
    assert len(reports) == 1
    assert reports[0]["score_mode"] == "answer"
    assert reports[0]["target_track_name"] == "Soprano"
    assert reports[0]["reference_slot_ids"] == [6]
    assert reports[0]["alignment_offset_seconds"] == 0.42
    assert reports[0]["overall_score"] == 100
    report_detail = client.get(f"/api/studios/{studio_id}/reports/{reports[0]['report_id']}").json()
    assert report_detail["report_id"] == reports[0]["report_id"]


def test_studio_activity_and_minimal_volume_response_are_lightweight(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Lightweight status",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    repository = studio_repository.get_studio_repository()

    def fail_if_activity_recovers_jobs(*args, **kwargs):
        raise AssertionError("activity must not recover or schedule jobs")

    original_recover = repository._recover_existing_creation_jobs
    monkeypatch.setattr(repository, "_recover_existing_creation_jobs", fail_if_activity_recovers_jobs)

    activity_response = client.get(f"/api/studios/{studio_id}/activity")
    monkeypatch.setattr(repository, "_recover_existing_creation_jobs", original_recover)

    assert activity_response.status_code == 200
    activity_payload = activity_response.json()
    assert activity_payload["studio_id"] == studio_id
    assert activity_payload["registered_track_count"] == 1
    assert activity_payload["pending_candidate_count"] == 0
    assert "regions" not in activity_payload
    assert "candidates" not in activity_payload
    assert "reports" not in activity_payload

    volume_response = client.patch(
        f"/api/studios/{studio_id}/tracks/1/volume?response=minimal",
        json={"volume_percent": 41},
    )

    assert volume_response.status_code == 200
    volume_payload = volume_response.json()
    assert volume_payload["studio_id"] == studio_id
    assert volume_payload["track"] == {"slot_id": 1, "volume_percent": 41}
    assert volume_payload["affected_region_ids"] == ["track-1-region-1"]
    assert "regions" not in volume_payload
    assert client.get(f"/api/studios/{studio_id}").json()["tracks"][0]["volume_percent"] == 41


def test_job_progress_uses_real_units_only(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Job progress",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [],
            "include_metronome": True,
            "performance_events": [
                _performance_event_from_track_event(
                    event_from_pitch(
                        beat=1,
                        duration_beats=1,
                        bpm=120,
                        source="voice",
                        extraction_method="test",
                        pitch_midi=60,
                    )
                )
            ],
        },
    )
    assert score_response.status_code == 200
    scoring_job = next(job for job in score_response.json()["jobs"] if job["job_type"] == "scoring")
    assert scoring_job["progress"]["stage"] == "queued"
    assert scoring_job["progress"]["completed_units"] is None
    assert scoring_job["progress"]["total_units"] is None

    response = client.post(
        f"/api/studios/{studio_id}/tracks/2/generate",
        json={
            "context_slot_ids": [1],
            "review_before_register": True,
        },
    )
    assert response.status_code == 200
    generation_job = next(job for job in response.json()["jobs"] if job["job_type"] == "generation")
    assert generation_job["progress"]["stage"] == "queued"
    assert generation_job["progress"]["completed_units"] is None
    assert generation_job["progress"]["total_units"] is None


def test_region_and_piano_roll_mutation_api_uses_explicit_regions(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Region mutation",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_payload = upload_musicxml_track(client, studio_id).json()
    source_region = upload_payload["regions"][0]
    source_region_id = source_region["region_id"]

    copy_response = client.post(
        f"/api/studios/{studio_id}/regions/{source_region_id}/copy",
        json={"start_seconds": 4.0},
    )

    assert copy_response.status_code == 200
    copied_payload = copy_response.json()
    slot_one_regions = [
        region
        for region in copied_payload["regions"]
        if region["track_slot_id"] == 1
    ]
    assert len(slot_one_regions) == 2
    copied_region = next(region for region in slot_one_regions if region["region_id"] != source_region_id)
    copied_event = copied_region["pitch_events"][0]

    event_response = client.patch(
        f"/api/studios/{studio_id}/regions/{copied_region['region_id']}/events/{copied_event['event_id']}",
        json={"pitch_midi": 73},
    )

    assert event_response.status_code == 200
    edited_region = next(
        region
        for region in event_response.json()["regions"]
        if region["region_id"] == copied_region["region_id"]
    )
    assert edited_region["pitch_events"][0]["label"] == "C#5"
    assert edited_region["pitch_events"][0]["pitch_midi"] == 73
    assert event_response.json()["tracks"][0]["status"] == "registered"

    split_seconds = copied_region["start_seconds"] + 0.5
    split_response = client.post(
        f"/api/studios/{studio_id}/regions/{copied_region['region_id']}/split",
        json={"split_seconds": split_seconds},
    )

    assert split_response.status_code == 200
    split_payload = split_response.json()
    assert len([region for region in split_payload["regions"] if region["track_slot_id"] == 1]) == 3
    right_region = next(
        region
        for region in split_payload["regions"]
        if region["track_slot_id"] == 1 and region["start_seconds"] == split_seconds
    )

    move_response = client.patch(
        f"/api/studios/{studio_id}/regions/{right_region['region_id']}",
        json={"target_track_slot_id": 2, "start_seconds": 6.0},
    )

    assert move_response.status_code == 200
    moved_payload = move_response.json()
    moved_region = next(
        region
        for region in moved_payload["regions"]
        if region["region_id"] == right_region["region_id"]
    )
    assert moved_region["track_slot_id"] == 2
    assert moved_region["track_name"] == "Alto"
    assert moved_payload["tracks"][1]["status"] == "registered"

    delete_response = client.delete(f"/api/studios/{studio_id}/regions/{source_region_id}")

    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert all(region["region_id"] != source_region_id for region in delete_payload["regions"])
    assert delete_payload["tracks"][0]["status"] == "registered"


def test_region_revision_save_batches_precise_edits_and_can_restore(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Region revision",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_payload = upload_musicxml_track(client, studio_id).json()
    source_region = upload_payload["regions"][0]
    first_event = source_region["pitch_events"][0]
    second_event = source_region["pitch_events"][1]

    save_response = client.patch(
        f"/api/studios/{studio_id}/regions/{source_region['region_id']}/revision",
        json={
            "target_track_slot_id": 2,
            "start_seconds": 1.25,
            "duration_seconds": 3.5,
            "revision_label": "before detailed edit",
            "events": [
                {
                    "event_id": first_event["event_id"],
                    "pitch_midi": 73,
                    "start_seconds": 1.25,
                    "duration_seconds": 0.75,
                },
                {
                    "event_id": second_event["event_id"],
                    "start_seconds": 2.0,
                    "duration_seconds": 0.5,
                },
            ],
        },
    )

    assert save_response.status_code == 200
    saved_payload = save_response.json()
    saved_region = next(region for region in saved_payload["regions"] if region["region_id"] == source_region["region_id"])
    assert saved_region["track_slot_id"] == 2
    assert saved_region["track_name"] == "Alto"
    assert saved_region["start_seconds"] == 1.25
    assert saved_region["duration_seconds"] == 3.5
    assert saved_region["pitch_events"][0]["label"] == "C#5"
    assert saved_region["pitch_events"][0]["start_seconds"] == 1.25
    assert saved_region["pitch_events"][0]["duration_seconds"] == 0.75
    assert saved_payload["tracks"][0]["status"] == "empty"
    assert saved_payload["tracks"][1]["status"] == "registered"
    revision_history = saved_region["diagnostics"]["region_editor"]["revision_history"]
    assert len(revision_history) == 1
    assert revision_history[0]["label"] == "before detailed edit"
    assert revision_history[0]["region"]["track_slot_id"] == 1
    assert revision_history[0]["region"]["pitch_events"][0]["label"] == "C5"

    restore_response = client.post(
        f"/api/studios/{studio_id}/regions/{saved_region['region_id']}/revision-history/{revision_history[0]['revision_id']}/restore"
    )

    assert restore_response.status_code == 200
    restored_region = next(
        region
        for region in restore_response.json()["regions"]
        if region["region_id"] == source_region["region_id"]
    )
    assert restored_region["track_slot_id"] == 1
    assert restored_region["track_name"] == "Soprano"
    assert restored_region["start_seconds"] == source_region["start_seconds"]
    assert [event["label"] for event in restored_region["pitch_events"]] == ["C5", "G5"]
    assert len(restored_region["diagnostics"]["region_editor"]["revision_history"]) == 2


def test_region_editor_preserves_adjacent_same_pitch_fragments(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Region editor fragments",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_payload = upload_musicxml_track(client, studio_id).json()
    source_region = upload_payload["regions"][0]
    first_event = source_region["pitch_events"][0]
    second_event = source_region["pitch_events"][1]

    save_response = client.patch(
        f"/api/studios/{studio_id}/regions/{source_region['region_id']}/revision",
        json={
            "revision_label": "keep adjacent fragments",
            "events": [
                {
                    "event_id": second_event["event_id"],
                    "pitch_midi": first_event["pitch_midi"],
                    "start_seconds": round(first_event["start_seconds"] + first_event["duration_seconds"], 4),
                    "duration_seconds": second_event["duration_seconds"],
                    "start_beat": round(first_event["start_beat"] + first_event["duration_beats"], 4),
                    "duration_beats": second_event["duration_beats"],
                },
            ],
        },
    )

    assert save_response.status_code == 200
    saved_region = next(
        region
        for region in save_response.json()["regions"]
        if region["region_id"] == source_region["region_id"]
    )
    assert [event["label"] for event in saved_region["pitch_events"]] == ["C5", "C5"]
    assert [event["event_id"] for event in saved_region["pitch_events"]] == [
        first_event["event_id"],
        second_event["event_id"],
    ]


def test_active_extraction_job_blocks_conflicting_track_mutations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        studio_repository.StudioRepository,
        "_schedule_engine_queue_processing",
        lambda self, background_tasks: None,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Active job lock",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_payload = upload_musicxml_track(client, studio_id).json()
    source_region = upload_payload["regions"][0]
    encoded_audio = base64.b64encode(b"RIFF\x24\x00\x00\x00WAVEfmt ").decode("ascii")

    queued_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "queued.wav",
            "content_base64": encoded_audio,
            "review_before_register": True,
        },
    )

    assert queued_response.status_code == 200
    assert queued_response.json()["jobs"][0]["status"] == "queued"

    edit_response = client.patch(
        f"/api/studios/{studio_id}/regions/{source_region['region_id']}",
        json={"start_seconds": 1.0},
    )
    assert edit_response.status_code == 409
    assert "extraction is queued or running" in edit_response.json()["detail"]

    upload_target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        json={
            "source_kind": "audio",
            "filename": "another.wav",
            "size_bytes": 8,
            "content_type": "audio/wav",
        },
    )
    assert upload_target_response.status_code == 409


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
        _performance_event_from_track_event(
            event_from_pitch(
                beat=1,
                duration_beats=1,
                bpm=120,
                source="voice",
                extraction_method="test",
                pitch_midi=76,
            )
        ),
        _performance_event_from_track_event(
            event_from_pitch(
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
    reports = _process_engine_queue_and_get_studio(client, studio_id)["reports"]
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
    report = _process_engine_queue_and_get_studio(client, studio_id)["reports"][0]
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
                _performance_event_from_track_event(
                    event_from_pitch(
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
    assert "detectable pitch events" in score_response.json()["detail"]
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


def test_scoring_can_use_direct_uploaded_performance_audio(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Path] = {}

    def fake_transcribe_voice_file(path: Path, *args, **kwargs):
        captured["path"] = path
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
                extraction_method="test_scoring_direct_upload",
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
            "title": "Scoring direct upload",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    content = b"RIFF....WAVEfmt scoring direct upload"

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/scoring-upload-target",
        json={
            "source_kind": "audio",
            "filename": "score-take.wav",
            "size_bytes": len(content),
            "content_type": "audio/wav",
        },
    )
    assert target_response.status_code == 200
    target = target_response.json()
    put_response = client.put(target["upload_url"].removeprefix("http://testserver"), content=content)
    assert put_response.status_code == 200

    score_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/score",
        json={
            "reference_slot_ids": [],
            "include_metronome": True,
            "performance_asset_path": target["asset_path"],
            "performance_filename": "score-take.wav",
        },
    )

    assert score_response.status_code == 200
    score_payload = _process_engine_queue_and_get_studio(client, studio_id)
    assert score_payload["reports"][0]["performance_event_count"] == 1
    assert captured["path"].name.endswith("score-take.wav")
    assert not (Path(get_settings().storage_root) / target["asset_path"]).exists()


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
    generated_payload = _process_engine_queue_and_get_studio(client, studio_id)
    variant_labels = [candidate["variant_label"] for candidate in generated_payload["candidates"][:3]]
    assert variant_labels[0].startswith("기본 박")
    assert variant_labels[1].startswith("백비트")
    assert variant_labels[2].startswith("촘촘한 리듬")
    assert all("후보 " not in label for label in variant_labels)
    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{generated_payload['candidates'][0]['candidate_id']}/approve",
        json={},
    )
    assert approve_response.status_code == 200
    percussion_events = _track_region_events(approve_response.json(), 6)
    assert percussion_events[0]["beat"] == 1
    assert percussion_events[0]["label"] == "Kick"
    assert all(note["duration_beats"] == 0.25 for note in percussion_events)
    second_measure_downbeat = next(
        note
        for note in percussion_events
        if note["measure_index"] == 2 and note["beat_in_measure"] == 1
    )
    assert second_measure_downbeat["beat"] == 4
    assert second_measure_downbeat["label"] == "Kick"
    assert any(note["label"] == "Snare" for note in percussion_events)


def test_track_upload_rejects_symbolic_score_files(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Track score upload rejected",
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

    assert upload_response.status_code == 422


def test_track_direct_upload_target_rejects_symbolic_score_files(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    studio_id = client.post(
        "/api/studios",
        json={
            "title": "Track direct score upload rejected",
            "bpm": 120,
            "start_mode": "blank",
        },
    ).json()["studio_id"]

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        json={
            "source_kind": "document",
            "filename": "soprano.musicxml",
            "size_bytes": len(MUSICXML_UPLOAD),
            "content_type": "application/vnd.recordare.musicxml+xml",
        },
    )

    assert target_response.status_code == 422


def test_track_overwrite_archives_original_score_and_restore_recovers_it(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Archive restore",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    original_payload = upload_musicxml_track(
        client,
        studio_id,
        filename="original.musicxml",
    ).json()
    assert [event["label"] for event in _track_region_events(original_payload, 1)] == ["C5", "G5"]

    replacement_xml = musicxml_upload_with_pitches(("D", 5), ("A", 5))
    overwrite_payload = upload_musicxml_track(
        client,
        studio_id,
        xml=replacement_xml,
        filename="recorded-take.musicxml",
        allow_overwrite=True,
    ).json()

    assert [event["label"] for event in _track_region_events(overwrite_payload, 1)] == ["D5", "A5"]
    archives = overwrite_payload["track_material_archives"]
    assert len(archives) == 1
    original_archive = archives[0]
    assert "region_snapshot" not in original_archive
    assert original_archive["track_slot_id"] == 1
    assert original_archive["source_label"] == "original.musicxml"
    assert original_archive["reason"] == "original_score"
    assert original_archive["pinned"] is True
    assert original_archive["event_count"] == 2

    restore_response = client.post(
        f"/api/studios/{studio_id}/track-archives/{original_archive['archive_id']}/restore"
    )

    assert restore_response.status_code == 200
    restored_payload = restore_response.json()
    assert [event["label"] for event in _track_region_events(restored_payload, 1)] == ["C5", "G5"]
    assert restored_payload["tracks"][0]["source_label"] == "original.musicxml"
    restored_archives = restored_payload["track_material_archives"]
    assert any(
        archive["reason"] == "original_score"
        and archive["pinned"] is True
        and archive["source_label"] == "original.musicxml"
        for archive in restored_archives
    )
    assert any(
        archive["reason"] == "before_overwrite"
        and archive["pinned"] is False
        and archive["source_label"] == "recorded-take.musicxml"
        for archive in restored_archives
    )


def test_track_archive_keeps_pinned_original_while_pruning_previous_versions(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Archive pruning",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id, filename="original.musicxml")

    payload = {}
    steps = ["C", "D", "E", "F", "G", "A", "B"]
    for index in range(8):
        first_step = steps[index % len(steps)]
        second_step = steps[(index + 2) % len(steps)]
        payload = upload_musicxml_track(
            client,
            studio_id,
            xml=musicxml_upload_with_pitches((first_step, 5), (second_step, 5)),
            filename=f"version-{index}.musicxml",
            allow_overwrite=True,
        ).json()

    archives = payload["track_material_archives"]
    pinned_archives = [
        archive
        for archive in archives
        if archive["track_slot_id"] == 1 and archive["pinned"]
    ]
    non_pinned_archives = [
        archive
        for archive in archives
        if archive["track_slot_id"] == 1 and not archive["pinned"]
    ]
    assert [archive["source_label"] for archive in pinned_archives] == ["original.musicxml"]
    assert len(non_pinned_archives) == 3
    assert {"version-0.musicxml", "version-1.musicxml", "version-2.musicxml", "version-3.musicxml"}.isdisjoint(
        {archive["source_label"] for archive in non_pinned_archives}
    )


def test_track_archive_restores_multiple_regions_without_flattening(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Multi-region archive",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    original_payload = upload_musicxml_track(client, studio_id, filename="original.musicxml").json()
    source_region = original_payload["regions"][0]

    copy_response = client.post(
        f"/api/studios/{studio_id}/regions/{source_region['region_id']}/copy",
        json={"start_seconds": 4.0},
    )

    assert copy_response.status_code == 200
    assert len([region for region in copy_response.json()["regions"] if region["track_slot_id"] == 1]) == 2

    replacement_xml = musicxml_upload_with_pitches(("D", 5), ("A", 5))
    overwrite_payload = upload_musicxml_track(
        client,
        studio_id,
        xml=replacement_xml,
        filename="replacement.musicxml",
        allow_overwrite=True,
    ).json()
    original_archive = next(
        archive
        for archive in overwrite_payload["track_material_archives"]
        if archive["reason"] == "original_score"
    )
    assert original_archive["event_count"] == 4

    restore_response = client.post(
        f"/api/studios/{studio_id}/track-archives/{original_archive['archive_id']}/restore"
    )

    assert restore_response.status_code == 200
    restored_slot_regions = [
        region
        for region in restore_response.json()["regions"]
        if region["track_slot_id"] == 1
    ]
    assert len(restored_slot_regions) == 2
    assert sorted(region["start_seconds"] for region in restored_slot_regions) == [0.0, 4.0]
    assert all([event["label"] for event in region["pitch_events"]] == ["C5", "G5"] for region in restored_slot_regions)


def test_studio_midi_export_uses_registered_region_events(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "MIDI export",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)

    export_response = client.get(f"/api/studios/{studio_id}/exports/midi")

    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == "audio/midi"
    assert export_response.headers["content-disposition"] == 'attachment; filename="MIDI-export.mid"'
    assert export_response.content.startswith(b"MThd")
    assert export_response.content.count(b"MTrk") == 7
    assert b"Soprano" in export_response.content
    assert bytes([0x90, 72]) in export_response.content


def test_unsupported_source_kind_is_rejected(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    studio_id = client.post(
        "/api/studios",
        json={
            "title": "Rejected source kind",
            "bpm": 120,
            "start_mode": "blank",
        },
    ).json()["studio_id"]
    encoded = base64.b64encode(MUSICXML_UPLOAD.encode("utf-8")).decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "unsupported",
            "filename": "soprano.musicxml",
            "content_base64": encoded,
        },
    )

    assert upload_response.status_code == 422


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
    assert any("ensemble_voice_crossing" in note["quality_warnings"] for note in _track_region_events(alto_payload, 2))


def test_track_upload_can_finalize_direct_uploaded_asset(tmp_path: Path, monkeypatch) -> None:
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
            "title": "Direct upload target",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    content = b"RIFF....WAVEfmt direct upload audio"

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "size_bytes": len(content),
            "content_type": "audio/wav",
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
            "source_kind": "audio",
            "filename": "voice.wav",
            "asset_path": target["asset_path"],
        },
    )

    assert upload_response.status_code == 200
    upload_payload = client.get(f"/api/studios/{studio_id}").json()
    soprano = upload_payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert [note["label"] for note in _track_region_events(upload_payload, 1)] == ["C5"]


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
    content = b"RIFF....WAVEfmt owner scoped audio"

    target_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload-target",
        headers=owner_headers,
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "size_bytes": len(content),
            "content_type": "audio/wav",
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
    payload = _created_studio_payload(client, create_response)
    soprano = payload["tracks"][0]
    assert soprano["status"] == "registered"
    assert [note["label"] for note in _track_region_events(payload, 1)] == ["C5", "G5"]
    assert not (tmp_path / "staged").exists()


def test_upload_start_can_use_staged_direct_uploaded_pdf_for_document_extraction(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fake_audiveris_document_extraction)
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
    assert payload["jobs"][0]["status"] == "tempo_review_required"
    approve_response = _approve_pending_tempo_job(client, payload, payload["jobs"][0])
    assert approve_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["tracks"][0]["status"] == "needs_review"
    assert len(payload["candidates"]) == 1
    assert _candidate_events(payload["candidates"][0])[0]["source"] == "document"
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


def test_audio_upload_normalizes_non_wav_for_analysis_and_playback(tmp_path: Path, monkeypatch) -> None:
    decoded_bytes = b"RIFF....WAVEfmt decoded audio"
    transcribed_paths: list[Path] = []

    def fake_prepare_voice_analysis_wav(source_path: Path, *, timeout_seconds: int):
        assert source_path.suffix == ".mp3"
        assert timeout_seconds > 0
        decoded_path = source_path.with_suffix(".decoded.wav")
        decoded_path.write_bytes(decoded_bytes)
        return VoiceAnalysisAudio(path=decoded_path, converted=True, original_suffix=".mp3")

    def fake_transcribe_voice_file(path: Path, *args, **kwargs):
        transcribed_paths.append(path)
        assert path.suffix == ".wav"
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
        "gigastudy_api.services.voice_pipeline.prepare_voice_analysis_wav",
        fake_prepare_voice_analysis_wav,
    )
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.transcribe_voice_file",
        fake_transcribe_voice_file,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "MP3 voice upload",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    encoded = base64.b64encode(b"fake mp3 bytes").decode("ascii")

    upload_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.mp3",
            "content_base64": encoded,
            "review_before_register": False,
        },
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    soprano = payload["tracks"][0]
    assert transcribed_paths and transcribed_paths[0].suffix == ".wav"
    assert soprano["status"] == "registered"
    assert soprano["audio_source_path"].endswith("-normalized.wav")
    assert soprano["audio_source_label"] == "voice.mp3"
    assert soprano["audio_mime_type"] == "audio/wav"
    assert soprano["diagnostics"]["registration_quality"]["source_extraction"]["audio_decode"] == {
        "converted_to_wav": True,
        "source_suffix": ".mp3",
    }

    audio_response = client.get(f"/api/studios/{studio_id}/tracks/1/audio")

    assert audio_response.status_code == 200
    assert audio_response.headers["content-type"].startswith("audio/wav")
    assert audio_response.content == decoded_bytes


def test_upload_start_rejects_music_audio_source_kind(tmp_path: Path, monkeypatch) -> None:
    client = build_client(tmp_path, monkeypatch)
    encoded = base64.b64encode(b"fake mp3 bytes").decode("ascii")

    response = client.post(
        "/api/studios",
        json={
            "title": "MP3 seeded studio",
            "start_mode": "upload",
            "source_kind": "music",
            "source_filename": "lead.mp3",
            "source_content_base64": encoded,
        },
    )

    assert response.status_code == 422
    assert "source_kind" in response.text


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

    payload = upload_musicxml_track(
        client,
        studio_id,
        xml=THREE_FOUR_MUSICXML_UPLOAD,
        filename="three-four.musicxml",
    )

    payload = payload.json()
    assert payload["time_signature_numerator"] == 3
    assert payload["time_signature_denominator"] == 4
    soprano_events = _track_region_events(payload, 1)
    assert soprano_events[3]["label"] == "F5"
    assert soprano_events[3]["measure_index"] == 2
    assert soprano_events[3]["beat"] == 4
    assert soprano_events[3]["beat_in_measure"] == 1


def test_audio_upload_requires_overwrite_confirmation_for_explicit_region(tmp_path: Path, monkeypatch) -> None:
    def fake_transcribe_voice_file(*args, **kwargs):
        return [
            TrackPitchEvent(
                pitch_midi=74,
                pitch_hz=293.66,
                label="D5",
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
            "title": "Direct upload overwrite",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)
    encoded = base64.b64encode(b"RIFF....WAVEfmt replacement audio").decode("ascii")

    blocked_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "content_base64": encoded,
        },
    )
    assert blocked_response.status_code == 409

    overwrite_response = client.post(
        f"/api/studios/{studio_id}/tracks/1/upload",
        json={
            "source_kind": "audio",
            "filename": "voice.wav",
            "content_base64": encoded,
            "allow_overwrite": True,
        },
    )
    assert overwrite_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert [note["label"] for note in _track_region_events(payload, 1)] == ["D5"]


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
            "source_kind": "audio",
            "filename": "voice.wav",
        },
    )

    assert response.status_code == 422


def test_symbolic_candidate_can_wait_for_candidate_approval(tmp_path: Path, monkeypatch) -> None:
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

    upload_response = create_musicxml_candidate(client, studio_id)

    assert upload_response.status_code == 200
    payload = upload_response.json()
    assert payload["tracks"][0]["status"] == "needs_review"
    assert _track_region_events(payload, 1) == []
    assert len(payload["candidates"]) == 1
    candidate = payload["candidates"][0]
    assert candidate["status"] == "pending"
    assert candidate["suggested_slot_id"] == 1
    assert [note["label"] for note in _candidate_events(candidate)] == ["C5", "G5"]

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate['candidate_id']}/approve",
        json={},
    )

    assert approve_response.status_code == 200
    approved_payload = approve_response.json()
    assert approved_payload["tracks"][0]["status"] == "registered"
    assert [note["label"] for note in _track_region_events(approved_payload, 1)] == ["C5", "G5"]
    assert approved_payload["candidates"][0]["status"] == "approved"


def test_upload_pdf_queues_document_extraction_job_and_creates_document_extraction_candidate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fake_audiveris_document_extraction)
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "PDF document extraction upload",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="soprano.pdf",
        content=build_preview_pdf_bytes(),
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
    assert candidate["method"] == "audiveris_document_review"
    assert candidate["diagnostics"]["candidate_method"] == "audiveris_document_review"
    assert candidate["diagnostics"]["track"] == "Soprano"
    assert candidate["diagnostics"]["event_count"] == 2
    assert "note_count" not in candidate["diagnostics"]
    assert candidate["diagnostics"]["measure_count"] == 1
    assert candidate["diagnostics"]["review_hint"] == "few_events"
    candidate_events = _candidate_events(candidate)
    assert candidate_events[0]["source"] == "document"
    assert candidate_events[0]["extraction_method"] == "audiveris_document_v1"

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
    assert [note["label"] for note in _track_region_events(approve_payload, 1)] == ["C5", "G5"]


def test_upload_pdf_can_register_document_extraction_candidates_into_each_suggested_track(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_document_extraction",
        fake_multi_track_audiveris_document_extraction,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Full document extraction",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="satb.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    job_id = payload["jobs"][0]["job_id"]
    assert payload["jobs"][0]["status"] == "needs_review"
    assert [
        (candidate["suggested_slot_id"], _candidate_events(candidate)[0]["label"])
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
    assert _track_region_events(approved_payload, 1)[0]["source"] == "document"
    assert _track_region_events(approved_payload, 2)[0]["label"] == "A4"
    assert _track_region_events(approved_payload, 5)[0]["label"] == "C3"
    assert all(candidate["status"] == "approved" for candidate in approved_payload["candidates"])


def test_upload_pdf_falls_back_to_vector_document_extraction_and_attempts_all_vocal_tracks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_document_extraction(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise AudiverisDocumentError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fail_document_extraction)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_document",
        fake_pdf_vector_document,
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

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="phonecert.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["jobs"][0]["output_path"].endswith("pdf-vector-document-summary.json")
    assert [candidate["suggested_slot_id"] for candidate in payload["candidates"]] == [1, 2, 3, 4, 5]
    assert all(candidate["method"] == "pdf_vector_document_review" for candidate in payload["candidates"])
    assert all(
        _candidate_events(candidate)[0]["extraction_method"] == "pdf_vector_document_v1"
        for candidate in payload["candidates"]
    )
    first_candidate = payload["candidates"][0]
    assert first_candidate["diagnostics"]["candidate_method"] == "pdf_vector_document_review"
    assert first_candidate["diagnostics"]["track"] == "Soprano"
    assert first_candidate["diagnostics"]["event_count"] == 1
    assert "note_count" not in first_candidate["diagnostics"]
    assert first_candidate["diagnostics"]["measure_count"] == 1
    assert first_candidate["diagnostics"]["review_hint"] == "few_events"
    assert first_candidate["confidence"] > 0.46
    assert "Soprano" in first_candidate["message"]
    assert [track["status"] for track in payload["tracks"][:5]] == ["needs_review"] * 5
    assert payload["tracks"][5]["status"] == "empty"


def test_vector_document_extraction_four_part_score_clears_unmapped_bass_placeholder(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_document_extraction(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise AudiverisDocumentError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fail_document_extraction)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_document",
        fake_four_part_pdf_vector_document,
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

    response = enqueue_document_fixture(
        client,
        studio_id,
        filename="four-part.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert [candidate["suggested_slot_id"] for candidate in payload["candidates"]] == [1, 2, 3, 4]
    assert [track["status"] for track in payload["tracks"][:4]] == ["needs_review"] * 4
    assert payload["tracks"][4]["status"] == "empty"


def test_document_extraction_job_bulk_approval_registers_open_tracks_before_overwrite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_document_extraction",
        fake_multi_track_audiveris_document_extraction,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Full document extraction overwrite",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    upload_musicxml_track(client, studio_id)

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="satb.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert upload_response.status_code == 200
    job_id = client.get(f"/api/studios/{studio_id}").json()["jobs"][0]["job_id"]

    blocked_response = client.post(
        f"/api/studios/{studio_id}/jobs/{job_id}/approve-candidates",
        json={},
    )
    assert blocked_response.status_code == 200
    partial_payload = blocked_response.json()
    assert partial_payload["jobs"][0]["status"] == "needs_review"
    assert _track_region_events(partial_payload, 1)[0]["label"] == "C5"
    assert _track_region_events(partial_payload, 2)[0]["label"] == "A4"
    assert _track_region_events(partial_payload, 5)[0]["label"] == "C3"
    assert [
        (candidate["suggested_slot_id"], candidate["status"])
        for candidate in partial_payload["candidates"]
    ] == [
        (1, "pending"),
        (2, "approved"),
        (5, "approved"),
    ]

    overwrite_response = client.post(
        f"/api/studios/{studio_id}/jobs/{job_id}/approve-candidates",
        json={"allow_overwrite": True},
    )
    assert overwrite_response.status_code == 200
    assert overwrite_response.json()["jobs"][0]["status"] == "completed"
    assert _track_region_events(overwrite_response.json(), 1)[0]["label"] == "C5"


def test_create_studio_with_pdf_starts_document_extraction_without_fixture_registration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fake_audiveris_document_extraction)
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
    assert payload["jobs"][0]["status"] == "tempo_review_required"
    approve_response = _approve_pending_tempo_job(client, payload, payload["jobs"][0])
    assert approve_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"
    assert payload["tracks"][0]["status"] == "needs_review"
    assert all(track["status"] != "registered" for track in payload["tracks"])
    assert len(payload["candidates"]) == 1
    assert _candidate_events(payload["candidates"][0])[0]["source"] == "document"


def test_upload_pdf_marks_document_extraction_job_failed_when_audiveris_unavailable(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_document_extraction(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise AudiverisDocumentError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fail_document_extraction)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_document",
        fail_pdf_vector_document,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "PDF document extraction failure",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="broken.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "failed"
    assert payload["jobs"][0]["message"] == "PDF 악보를 인식하지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요."
    assert [track["status"] for track in payload["tracks"][:5]] == ["failed"] * 5
    assert payload["candidates"] == []


def test_text_only_pdf_fails_preflight_without_running_audiveris(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def unexpected_document_extraction(**kwargs) -> Path:
        raise AssertionError("text-only PDF should fail before document extraction")

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_document_extraction",
        unexpected_document_extraction,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Lyrics PDF",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="love me lyrics.pdf",
        content=build_lyrics_pdf_bytes(),
    )

    assert upload_response.status_code == 200
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "failed"
    assert payload["jobs"][0]["message"] == (
        "악보로 읽을 수 있는 오선이나 음표를 찾지 못했습니다. "
        "가사/일반 문서 PDF 대신 악보 PDF, MIDI, MusicXML을 사용해 주세요."
    )
    assert payload["candidates"] == []


def test_image_only_pdf_is_allowed_to_reach_document_extraction(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls = 0

    def fake_image_pdf_extraction(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        nonlocal calls
        calls += 1
        return fake_audiveris_document_extraction(
            input_path=input_path,
            output_dir=output_dir,
            audiveris_bin=audiveris_bin,
            timeout_seconds=timeout_seconds,
        )

    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.run_audiveris_document_extraction",
        fake_image_pdf_extraction,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Scanned PDF",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="scan.pdf",
        content=build_image_only_pdf_bytes(),
    )

    assert upload_response.status_code == 200
    assert calls == 1
    payload = client.get(f"/api/studios/{studio_id}").json()
    assert payload["jobs"][0]["status"] == "needs_review"


def test_failed_document_extraction_job_can_be_retried_from_durable_queue(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_document_extraction(
        *,
        input_path: Path,
        output_dir: Path,
        audiveris_bin: str | None,
        timeout_seconds: int,
    ) -> Path:
        raise AudiverisDocumentError("Audiveris missing")

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fail_document_extraction)
    monkeypatch.setattr(
        "gigastudy_api.services.studio_repository.parse_born_digital_pdf_document",
        fail_pdf_vector_document,
    )
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Retryable PDF document extraction",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]

    upload_response = enqueue_document_fixture(
        client,
        studio_id,
        filename="retry.pdf",
        content=PDF_UPLOAD_BYTES,
    )

    assert upload_response.status_code == 200
    failed_payload = client.get(f"/api/studios/{studio_id}").json()
    job = failed_payload["jobs"][0]
    assert job["job_type"] == "document"
    assert job["status"] == "failed"
    assert job["attempt_count"] == 1

    monkeypatch.setattr("gigastudy_api.services.studio_repository.run_audiveris_document_extraction", fake_audiveris_document_extraction)
    retry_response = client.post(f"/api/studios/{studio_id}/jobs/{job['job_id']}/retry")

    assert retry_response.status_code == 200
    retry_payload = client.get(f"/api/studios/{studio_id}").json()
    assert retry_payload["jobs"][0]["status"] == "needs_review"
    assert retry_payload["jobs"][0]["attempt_count"] == 1
    assert _candidate_events(retry_payload["candidates"][0])[0]["source"] == "document"
    assert retry_payload["tracks"][0]["status"] == "needs_review"
    assert [track["status"] for track in retry_payload["tracks"][1:5]] == ["empty"] * 4


def test_stale_running_document_job_recovers_to_failed_without_activity_side_effect(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = build_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/api/studios",
        json={
            "title": "Stale PDF job",
            "bpm": 120,
            "start_mode": "blank",
        },
    )
    studio_id = create_response.json()["studio_id"]
    repository = studio_repository.get_studio_repository()
    stale_timestamp = "2026-05-01T00:00:00+00:00"

    with repository._lock:
        studio = repository._load_studio(studio_id)
        assert studio is not None
        job = create_document_extraction_job(
            input_path=f"uploads/{studio_id}/stale.pdf",
            max_attempts=3,
            parse_all_parts=True,
            slot_id=1,
            source_kind="document",
            source_label="stale.pdf",
            status="running",
            timestamp=stale_timestamp,
        )
        job.updated_at = stale_timestamp
        studio.jobs.append(job)
        for track in studio.tracks[:5]:
            track.status = "extracting"
            track.source_kind = "document"
            track.source_label = "stale.pdf"
            track.updated_at = stale_timestamp
        repository._save_studio(studio)

    activity_response = client.get(f"/api/studios/{studio_id}/activity")
    assert activity_response.status_code == 200
    assert activity_response.json()["jobs"][0]["status"] == "running"

    recover_response = client.post(f"/api/studios/{studio_id}/jobs/recover-stale")

    assert recover_response.status_code == 200
    payload = recover_response.json()
    assert payload["jobs"][0]["status"] == "failed"
    assert payload["jobs"][0]["message"] == (
        "작업이 오래 멈춰 실패 처리했습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
    )
    assert payload["jobs"][0]["diagnostics"]["stale_recovered"] is True
    assert [track["status"] for track in payload["tracks"][:5]] == ["failed"] * 5


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
    assert _track_region_events(retry_payload, 1)[0]["label"] == "C5"
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
    assert _track_region_events(payload, 5)[0]["label"] == "G2"


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

    upload_response = create_musicxml_candidate(client, studio_id)
    candidate_id = upload_response.json()["candidates"][0]["candidate_id"]

    approve_response = client.post(
        f"/api/studios/{studio_id}/candidates/{candidate_id}/approve",
        json={"target_slot_id": 2},
    )

    assert approve_response.status_code == 200
    payload = approve_response.json()
    assert payload["tracks"][0]["status"] == "empty"
    assert payload["tracks"][1]["status"] == "registered"
    assert [note["label"] for note in _track_region_events(payload, 2)] == ["C5", "G5"]


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
    upload_musicxml_track(client, studio_id, slot_id=2, filename="alto-seed.musicxml")

    upload_response = create_musicxml_candidate(client, studio_id)
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
    assert [note["label"] for note in _track_region_events(payload, 2)] == ["C5", "G5"]
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

    upload_response = create_musicxml_candidate(client, studio_id)
    candidate_id = upload_response.json()["candidates"][0]["candidate_id"]

    reject_response = client.post(f"/api/studios/{studio_id}/candidates/{candidate_id}/reject")

    assert reject_response.status_code == 200
    payload = reject_response.json()
    assert payload["tracks"][0]["status"] == "empty"
    assert _track_region_events(payload, 1) == []
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
    first_payload = _process_engine_queue_and_get_studio(client, studio_id)
    alto_candidates = [
        candidate
        for candidate in first_payload["candidates"]
        if candidate["suggested_slot_id"] == 2 and candidate["status"] == "pending"
    ]
    assert len(alto_candidates) == 3
    assert alto_candidates[0]["diagnostics"]["generation_context_slot_ids"] == [1]
    assert alto_candidates[0]["diagnostics"]["generation_context_track_count"] == 1
    assert alto_candidates[0]["diagnostics"]["candidate_diversity_label"] in {"distinct", "similar", "single"}
    assert all("후보 " not in candidate["variant_label"] for candidate in alto_candidates)
    assert all("중심 " in candidate["variant_label"] for candidate in alto_candidates)
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
    second_payload = _process_engine_queue_and_get_studio(client, studio_id)
    second_candidates = [
        candidate
        for candidate in second_payload["candidates"]
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
    generate_payload = _process_engine_queue_and_get_studio(client, studio_id)
    alto_candidates = [
        candidate
        for candidate in generate_payload["candidates"]
        if candidate["suggested_slot_id"] == 2 and candidate["status"] == "pending"
    ]
    assert len(alto_candidates) == 3
    alto_events = _candidate_events(alto_candidates[0])
    assert [note["beat"] for note in alto_events[:2]] == [2, 3]
    assert [note["onset_seconds"] for note in alto_events[:2]] == [1, 2]


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
        "gigastudy_api.services.track_registration.review_track_registration",
        fail_ai_registration_review,
    )
    monkeypatch.setattr(
        "gigastudy_api.services.track_registration.review_ensemble_registration",
        fail_ai_registration_review,
    )

    generate_response = client.post(
        f"/api/studios/{studio_id}/tracks/4/generate",
        json={"context_slot_ids": [3, 5]},
    )

    assert generate_response.status_code == 200
    generate_payload = _process_engine_queue_and_get_studio(client, studio_id)
    baritone_candidates = [
        candidate
        for candidate in generate_payload["candidates"]
        if candidate["suggested_slot_id"] == 4 and candidate["status"] == "pending"
    ]
    assert len(baritone_candidates) == 3
    assert _candidate_events(baritone_candidates[0])[0]["label"] == "E3"

    regenerate_response = client.post(
        f"/api/studios/{studio_id}/tracks/4/generate",
        json={"context_slot_ids": [3, 5]},
    )

    assert regenerate_response.status_code == 200
    regenerate_payload = _process_engine_queue_and_get_studio(client, studio_id)
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
