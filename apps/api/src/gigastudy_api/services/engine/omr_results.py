from __future__ import annotations

import json
from pathlib import Path

from gigastudy_api.domain.track_events import TrackNote
from gigastudy_api.services.engine.notation import annotate_track_notes_for_slot
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile


def mark_notes_as_omr(
    mapped_notes: dict[int, list[TrackNote]],
    *,
    extraction_method: str = "audiveris_omr_v0",
) -> dict[int, list[TrackNote]]:
    return {
        slot_id: annotate_track_notes_for_slot(
            [
                note.model_copy(
                    update={
                        "source": "omr",
                        "extraction_method": extraction_method,
                    }
                )
                for note in notes
            ],
            slot_id=slot_id,
        )
        for slot_id, notes in mapped_notes.items()
    }


def write_pdf_vector_omr_summary(
    output_dir: Path,
    parsed_symbolic: ParsedSymbolicFile,
    *,
    source_label: str,
    primary_error: str,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "pdf-vector-omr-summary.json"
    payload = {
        "method": "pdf_vector_omr_v0",
        "source_label": source_label,
        "fallback_reason": primary_error,
        "tracks": [
            {
                "slot_id": track.slot_id,
                "name": track.name,
                "note_count": len(track.notes),
                "diagnostics": track.diagnostics,
            }
            for track in parsed_symbolic.tracks
        ],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path
