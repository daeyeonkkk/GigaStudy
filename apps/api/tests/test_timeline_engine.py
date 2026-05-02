from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.engine.timeline import events_with_sync_offset


def test_events_with_sync_offset_preserves_negative_layer_shift() -> None:
    note = note_from_pitch(
        beat=1,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test",
        pitch_midi=60,
    )

    shifted = events_with_sync_offset([note], sync_offset_seconds=-0.25, bpm=120)

    assert shifted[0].onset_seconds == -0.25
    assert shifted[0].beat == 0.5


def test_events_with_sync_offset_sets_voice_index_without_rewriting_existing_voice() -> None:
    missing_voice = note_from_pitch(
        beat=2,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test",
        pitch_midi=64,
    )
    existing_voice = note_from_pitch(
        beat=3,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test",
        pitch_midi=67,
        voice_index=5,
    )

    shifted = events_with_sync_offset([missing_voice, existing_voice], sync_offset_seconds=0.5, bpm=120, voice_index=2)

    assert [note.voice_index for note in shifted] == [2, 5]
    assert [note.beat for note in shifted] == [3, 4]
