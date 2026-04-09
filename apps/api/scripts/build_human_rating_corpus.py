from __future__ import annotations

import argparse
from pathlib import Path

from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.human_rating_builder import (
    build_human_rating_corpus,
    load_human_rating_metadata,
    load_human_rating_sheet,
    render_human_rating_corpus_json,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a calibration corpus from per-rater note labels.")
    parser.add_argument(
        "--round-root",
        type=Path,
        default=None,
        help="Optional evidence round root. When set, metadata, ratings, and output default to that round.",
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=None,
        help="Path to the case metadata JSON file.",
    )
    parser.add_argument(
        "--ratings",
        type=Path,
        default=None,
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

    round_paths = resolve_evidence_round_paths(args.round_root) if args.round_root is not None else None
    metadata_path = (
        args.metadata.resolve()
        if args.metadata is not None
        else round_paths.human_rating_cases_path
        if round_paths is not None
        else Path("calibration/human_rating_cases.template.json").resolve()
    )
    ratings_path = (
        args.ratings.resolve()
        if args.ratings is not None
        else round_paths.human_rating_sheet_path
        if round_paths is not None
        else Path("calibration/human_rating_sheet.template.csv").resolve()
    )
    output_path = (
        args.output.resolve()
        if args.output is not None
        else round_paths.human_rating_generated_corpus_path
        if round_paths is not None
        else None
    )

    metadata = load_human_rating_metadata(metadata_path)
    rows = load_human_rating_sheet(ratings_path)
    corpus = build_human_rating_corpus(metadata, rows, consensus_ratio=args.consensus_ratio)
    rendered_json = render_human_rating_corpus_json(corpus)

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered_json, encoding="utf-8")

    print(rendered_json)


if __name__ == "__main__":
    main()
