from threading import RLock

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    PitchEvent,
    SaveRegionEventPatch,
    SaveRegionRevisionRequest,
    SplitRegionRequest,
    Studio,
    TrackSlot,
)
from gigastudy_api.services.engine.timeline import events_from_region
from gigastudy_api.services.studio_region_commands import StudioRegionCommands
from gigastudy_api.services.studio_repository import _shift_explicit_regions_for_slot


class InMemoryRegionRepository:
    def __init__(self, studio: Studio) -> None:
        self._lock = RLock()
        self.studio = studio

    def _load_studio(self, studio_id: str) -> Studio | None:
        if studio_id != self.studio.studio_id:
            return None
        return self.studio

    def _find_track(self, studio: Studio, slot_id: int) -> TrackSlot:
        return next(track for track in studio.tracks if track.slot_id == slot_id)

    def _save_studio(self, studio: Studio) -> None:
        self.studio = studio


def test_explicit_region_sync_shift_preserves_negative_timeline_position() -> None:
    region = ArrangementRegion(
        region_id="region-1",
        track_slot_id=1,
        track_name="Soprano",
        start_seconds=0.1,
        duration_seconds=1,
        pitch_events=[
            PitchEvent(
                event_id="region-1-event-1",
                track_slot_id=1,
                region_id="region-1",
                label="C4",
                pitch_midi=60,
                start_seconds=0.1,
                duration_seconds=0.5,
                start_beat=1,
                duration_beats=1,
                source="midi",
            )
        ],
    )

    _shift_explicit_regions_for_slot([region], slot_id=1, delta_seconds=-0.25)

    assert region.start_seconds == -0.15
    assert region.sync_offset_seconds == -0.15
    assert region.pitch_events[0].start_seconds == -0.15


def test_split_region_rebases_right_event_beats_to_right_region_start() -> None:
    studio = Studio(
        studio_id="studio-split",
        title="Split",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                duration_seconds=2,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        regions=[
            ArrangementRegion(
                region_id="region-1",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="edited.mid",
                start_seconds=-0.25,
                duration_seconds=1.5,
                pitch_events=[
                    PitchEvent(
                        event_id="region-1-event-1",
                        track_slot_id=1,
                        region_id="region-1",
                        label="C4",
                        pitch_midi=60,
                        start_seconds=-0.25,
                        duration_seconds=1,
                        start_beat=1,
                        duration_beats=2,
                        source="midi",
                    ),
                    PitchEvent(
                        event_id="region-1-event-2",
                        track_slot_id=1,
                        region_id="region-1",
                        label="D4",
                        pitch_midi=62,
                        start_seconds=0.75,
                        duration_seconds=0.5,
                        start_beat=3,
                        duration_beats=1,
                        source="midi",
                    ),
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    repository = InMemoryRegionRepository(studio)
    commands = StudioRegionCommands(now=lambda: "2026-01-01T00:00:10Z", repository=repository)

    commands.split_region("studio-split", "region-1", SplitRegionRequest(split_seconds=0.25))

    right_region = next(region for region in repository.studio.regions if region.region_id != "region-1")
    assert [event.start_seconds for event in right_region.pitch_events] == [0.25, 0.75]
    assert [event.start_beat for event in right_region.pitch_events] == [1, 2]
    assert [event.beat for event in events_from_region(right_region, bpm=120)] == [1.5, 2.5]


def test_region_revision_preserves_millisecond_event_duration() -> None:
    studio = Studio(
        studio_id="studio-precision",
        title="Precision",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                duration_seconds=1,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        regions=[
            ArrangementRegion(
                region_id="region-1",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="edited.mid",
                start_seconds=0,
                duration_seconds=0.01,
                pitch_events=[
                    PitchEvent(
                        event_id="region-1-event-1",
                        track_slot_id=1,
                        region_id="region-1",
                        label="C4",
                        pitch_midi=60,
                        start_seconds=0.002,
                        duration_seconds=0.001,
                        start_beat=1.004,
                        duration_beats=0.002,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    repository = InMemoryRegionRepository(studio)
    commands = StudioRegionCommands(now=lambda: "2026-01-01T00:00:10Z", repository=repository)

    commands.save_region_revision(
        "studio-precision",
        "region-1",
        SaveRegionRevisionRequest(
            duration_seconds=0.003,
            events=[
                SaveRegionEventPatch(
                    event_id="region-1-event-1",
                    duration_seconds=0.001,
                    start_seconds=0.002,
                )
            ],
        ),
    )

    region = repository.studio.regions[0]
    assert region.duration_seconds == 0.003
    assert region.pitch_events[0].start_seconds == 0.002
    assert region.pitch_events[0].duration_seconds == 0.001
