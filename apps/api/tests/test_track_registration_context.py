from gigastudy_api.api.schemas.studios import ArrangementRegion, PitchEvent, Studio, TrackSlot
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services import track_registration
from gigastudy_api.services.engine.arrangement import EnsembleValidationResult
from gigastudy_api.services.engine.event_quality import RegistrationQualityResult
from gigastudy_api.services.studio_documents import (
    create_tuned_recording_material_version,
    register_track_material,
    restore_track_material_archive,
)


def test_registration_context_uses_region_events_after_region_edit(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_prepare_events_for_track_registration(
        events: list[TrackPitchEvent],
        **kwargs: object,
    ) -> RegistrationQualityResult:
        captured["reference_tracks"] = kwargs["reference_tracks"]
        return RegistrationQualityResult(events=events, diagnostics={"actions": []})

    def fake_prepare_ensemble_registration(
        *,
        candidate_events: list[TrackPitchEvent],
        existing_tracks_by_slot: dict[int, list[TrackPitchEvent]],
        **_: object,
    ) -> EnsembleValidationResult:
        captured["existing_tracks_by_slot"] = existing_tracks_by_slot
        return EnsembleValidationResult(events=candidate_events, diagnostics={"snapshot_count": len(existing_tracks_by_slot)})

    monkeypatch.setattr(
        track_registration,
        "prepare_events_for_track_registration",
        fake_prepare_events_for_track_registration,
    )
    monkeypatch.setattr(track_registration, "prepare_ensemble_registration", fake_prepare_ensemble_registration)
    studio = Studio(
        studio_id="studio-region-context",
        title="Region context",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                duration_seconds=2,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            ),
            TrackSlot(
                slot_id=2,
                name="Alto",
                status="empty",
                duration_seconds=0,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            ),
        ],
        regions=[
            ArrangementRegion(
                region_id="edited-region-1",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="edited.mid",
                start_seconds=0.25,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="edited-region-1-event-1",
                        track_slot_id=1,
                        region_id="edited-region-1",
                        label="C4",
                        pitch_midi=60,
                        start_seconds=0.25,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    candidate = TrackPitchEvent(label="E4", pitch_midi=64, beat=1, duration_beats=1, source="ai")

    result = track_registration.TrackRegistrationPreparer().prepare_events(
        studio,
        2,
        source_kind="ai",
        events=[candidate],
    )

    reference_tracks = captured["reference_tracks"]
    existing_tracks_by_slot = captured["existing_tracks_by_slot"]
    assert len(result.events) == 1
    assert result.events[0].id == candidate.id
    assert result.events[0].source == "ai"
    assert result.events[0].voice_index == 2
    assert len(reference_tracks) == 1
    assert reference_tracks[0][0].id == "edited-region-1-event-1"
    assert existing_tracks_by_slot[1][0].region_id == "edited-region-1"


def test_register_track_material_persists_explicit_region_and_clears_track_shadow() -> None:
    track = TrackSlot(
        slot_id=1,
        name="Soprano",
        status="empty",
        duration_seconds=0,
        events=[],
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="studio-register-region",
        title="Register region",
        bpm=120,
        tracks=[track],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    event = TrackPitchEvent(
        id="source-event-1",
        label="C4",
        pitch_midi=60,
        beat=1,
        duration_beats=1,
        onset_seconds=0,
        duration_seconds=0.5,
        source="midi",
    )

    register_track_material(
        studio,
        track,
        timestamp="2026-01-01T00:00:10Z",
        source_kind="midi",
        source_label="seed.mid",
        events=[event],
        duration_seconds=0.5,
        registration_diagnostics={"actions": ["test"]},
    )

    assert track.status == "registered"
    assert track.events == []
    assert len(studio.regions) == 1
    assert studio.regions[0].region_id == "track-1-region-1"
    assert studio.regions[0].pitch_events[0].event_id == "track-1-region-1-source-event-1"


def test_recording_registration_pins_original_recording_version_once() -> None:
    track = TrackSlot(
        slot_id=1,
        name="Soprano",
        status="empty",
        duration_seconds=0,
        events=[],
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="studio-recording-version",
        title="Recording version",
        bpm=120,
        tracks=[track],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    event = TrackPitchEvent(
        id="voice-event-1",
        label="C4",
        pitch_midi=60,
        beat=1,
        duration_beats=1,
        onset_seconds=0,
        duration_seconds=0.5,
        source="voice",
    )

    register_track_material(
        studio,
        track,
        timestamp="2026-01-01T00:00:10Z",
        source_kind="recording",
        source_label="take-1.wav",
        events=[event],
        duration_seconds=0.5,
        registration_diagnostics={"actions": ["test"]},
        audio_source_path="uploads/studio/track-1/take-1.wav",
        audio_mime_type="audio/wav",
    )

    original_archive = studio.track_material_archives[0]
    assert original_archive.reason == "original_recording"
    assert original_archive.pinned is True
    assert original_archive.label == "원본 녹음"
    assert track.active_material_version_id == original_archive.archive_id
    anchors = studio.regions[0].diagnostics["audio_source_anchors"]
    event_id = studio.regions[0].pitch_events[0].event_id
    assert anchors[event_id]["source_event_id"] == event_id
    assert anchors[event_id]["source_start_seconds"] == 0
    assert anchors[event_id]["source_duration_seconds"] == 0.5
    assert 260 <= anchors[event_id]["source_pitch_hz"] <= 263

    register_track_material(
        studio,
        track,
        timestamp="2026-01-01T00:00:20Z",
        source_kind="recording",
        source_label="take-2.wav",
        events=[event],
        duration_seconds=0.5,
        registration_diagnostics={"actions": ["test"]},
        audio_source_path="uploads/studio/track-1/take-2.wav",
        audio_mime_type="audio/wav",
    )

    original_archives = [
        archive
        for archive in studio.track_material_archives
        if archive.reason == "original_recording" and archive.pinned
    ]
    assert len(original_archives) == 1
    assert track.active_material_version_id is None
    assert studio.regions[0].audio_source_path == "uploads/studio/track-1/take-2.wav"


def test_tuned_recording_version_is_inactive_until_restored() -> None:
    track = TrackSlot(
        slot_id=1,
        name="Soprano",
        status="empty",
        duration_seconds=0,
        events=[],
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="studio-tuned-version",
        title="Tuned version",
        bpm=120,
        tracks=[track],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    event = TrackPitchEvent(
        id="voice-event-1",
        label="C4",
        pitch_midi=60,
        beat=1,
        duration_beats=1,
        onset_seconds=0,
        duration_seconds=0.5,
        source="voice",
    )
    register_track_material(
        studio,
        track,
        timestamp="2026-01-01T00:00:10Z",
        source_kind="recording",
        source_label="take-1.wav",
        events=[event],
        duration_seconds=0.5,
        registration_diagnostics={"actions": ["test"]},
        audio_source_path="uploads/studio/track-1/take-1.wav",
        audio_mime_type="audio/wav",
    )
    active_before_tuning = track.active_material_version_id

    tuned_archive = create_tuned_recording_material_version(
        studio,
        track,
        audio_mime_type="audio/wav",
        audio_source_path="jobs/studio-tuned-version/job-1/edit-applied-track.wav",
        based_on_archive_id=active_before_tuning,
        label="보정본 1",
        timestamp="2026-01-01T00:01:00Z",
    )

    assert tuned_archive.reason == "tuned_recording"
    assert tuned_archive.label == "보정본 1"
    assert track.active_material_version_id == active_before_tuning
    assert studio.regions[0].audio_source_path == "uploads/studio/track-1/take-1.wav"

    restore_track_material_archive(studio, track, tuned_archive)

    assert track.active_material_version_id == tuned_archive.archive_id
    assert studio.regions[0].audio_source_path == "jobs/studio-tuned-version/job-1/edit-applied-track.wav"
