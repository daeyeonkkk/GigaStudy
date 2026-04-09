from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from gigastudy_api.services.evidence_rounds import (
    create_evidence_round_scaffold,
    default_evidence_rounds_root,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a repeatable evidence round scaffold for real human-rating and browser-hardware validation."
    )
    parser.add_argument(
        "--round-id",
        type=str,
        default=f"round-{datetime.now().strftime('%Y%m%d')}",
        help="Round identifier used for the created folder.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=None,
        help="Optional root directory for evidence rounds. Defaults to DreamCatcher when present.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow writing into an existing round folder.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    scaffold = create_evidence_round_scaffold(
        round_id=args.round_id,
        output_root=args.output_root or default_evidence_rounds_root(),
        overwrite=args.overwrite,
    )

    payload = {
        "round_root": str(scaffold.root),
        "readme": str(scaffold.readme),
        "human_rating_cases": str(scaffold.human_rating_cases_path),
        "human_rating_sheet": str(scaffold.human_rating_sheet_path),
        "human_rating_reference_corpus": str(scaffold.human_rating_reference_corpus_path),
        "environment_validation_sheet": str(scaffold.environment_validation_sheet_path),
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
