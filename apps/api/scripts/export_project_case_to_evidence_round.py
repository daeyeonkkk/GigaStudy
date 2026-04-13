from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import UUID

from gigastudy_api.db.session import get_session_factory
from gigastudy_api.services.evidence_round_project_export import export_project_take_to_evidence_round


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export one real GigaStudy project take into an evidence round for human-rating collection."
    )
    parser.add_argument(
        "--round-root",
        type=Path,
        required=True,
        help="Path to the scaffolded evidence round root.",
    )
    parser.add_argument(
        "--project-id",
        type=UUID,
        required=True,
        help="Project id that owns the exported guide and take.",
    )
    parser.add_argument(
        "--take-track-id",
        type=UUID,
        required=True,
        help="Vocal-take track id to export into the round.",
    )
    parser.add_argument(
        "--case-id",
        type=str,
        default=None,
        help="Optional human-rating case id override. Defaults to a project-title + take-based slug.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow replacing an existing case id and audio payloads in the round.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    session_factory = get_session_factory()
    with session_factory() as session:
        result = export_project_take_to_evidence_round(
            session,
            round_root=args.round_root,
            project_id=args.project_id,
            take_track_id=args.take_track_id,
            case_id=args.case_id,
            overwrite=args.overwrite,
        )

    print(
        json.dumps(
            {
                "round_root": str(result.round_root),
                "case_id": result.case_id,
                "project_id": str(result.project_id),
                "guide_track_id": str(result.guide_track_id),
                "take_track_id": str(result.take_track_id),
                "guide_output_path": str(result.guide_output_path),
                "take_output_path": str(result.take_output_path),
                "metadata_path": str(result.metadata_path),
                "rating_sheet_path": str(result.rating_sheet_path),
                "note_reference_json_path": (
                    str(result.note_reference_json_path) if result.note_reference_json_path is not None else None
                ),
                "note_reference_csv_path": (
                    str(result.note_reference_csv_path) if result.note_reference_csv_path is not None else None
                ),
                "template_case_removed": result.template_case_removed,
                "template_sheet_rows_removed": result.template_sheet_rows_removed,
                "expectation_seeded": result.expectation_seeded,
                "note_reference_written": result.note_reference_written,
                "note_clip_count": result.note_clip_count,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
