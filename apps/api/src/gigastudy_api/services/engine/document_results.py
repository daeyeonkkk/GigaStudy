from __future__ import annotations

import json
from pathlib import Path

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.event_normalization import annotate_track_events_for_slot
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile


def mark_events_as_document(
    mapped_events: dict[int, list[TrackPitchEvent]],
    *,
    extraction_method: str = "audiveris_document_v1",
) -> dict[int, list[TrackPitchEvent]]:
    return {
        slot_id: annotate_track_events_for_slot(
            [
                event.model_copy(
                    update={
                        "source": "document",
                        "extraction_method": extraction_method,
                    }
                )
                for event in events
            ],
            slot_id=slot_id,
        )
        for slot_id, events in mapped_events.items()
    }


def write_pdf_vector_document_summary(
    output_dir: Path,
    parsed_symbolic: ParsedSymbolicFile,
    *,
    source_label: str,
    primary_error: str,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "pdf-vector-document-summary.json"
    payload = {
        "method": "pdf_vector_document_v1",
        "source_label": source_label,
        "fallback_reason": primary_error,
        "tracks": [
            {
                "slot_id": track.slot_id,
                "name": track.name,
                "event_count": len(track.events),
                "diagnostics": track.diagnostics,
            }
            for track in parsed_symbolic.tracks
        ],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path
