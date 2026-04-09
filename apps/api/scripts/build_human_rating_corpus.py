from __future__ import annotations

import argparse
from pathlib import Path

from gigastudy_api.services.human_rating_builder import (
    build_human_rating_corpus,
    load_human_rating_metadata,
    load_human_rating_sheet,
    render_human_rating_corpus_json,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a calibration corpus from per-rater note labels.")
    parser.add_argument(
        "--metadata",
        type=Path,
        default=Path("calibration/human_rating_cases.template.json"),
        help="Path to the case metadata JSON file.",
    )
    parser.add_argument(
        "--ratings",
        type=Path,
        default=Path("calibration/human_rating_sheet.template.csv"),
        help="Path to the human rating sheet CSV file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional output path for the generated calibration corpus JSON.",
    )
    parser.add_argument(
        "--consensus-ratio",
        type=float,
        default=0.67,
        help="Required agreement ratio for a consensus label before falling back to 'unclear'.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    metadata = load_human_rating_metadata(args.metadata.resolve())
    rows = load_human_rating_sheet(args.ratings.resolve())
    corpus = build_human_rating_corpus(metadata, rows, consensus_ratio=args.consensus_ratio)
    rendered_json = render_human_rating_corpus_json(corpus)

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered_json, encoding="utf-8")

    print(rendered_json)


if __name__ == "__main__":
    main()
