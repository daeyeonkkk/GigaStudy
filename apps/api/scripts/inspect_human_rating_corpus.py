from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from gigastudy_api.services.calibration import load_calibration_corpus
from gigastudy_api.services.human_rating_builder import load_human_rating_metadata
from gigastudy_api.services.real_vocal_corpus import (
    inspect_calibration_corpus,
    inspect_human_rating_metadata,
    render_corpus_inventory_markdown,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect a human-rating metadata file or generated corpus for real-audio readiness."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--metadata",
        type=Path,
        help="Path to the human rating case metadata JSON file.",
    )
    source_group.add_argument(
        "--manifest",
        type=Path,
        help="Path to the generated human rating corpus JSON file.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=None,
        help="Optional output path for the inventory JSON report.",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=None,
        help="Optional output path for the inventory Markdown report.",
    )
    parser.add_argument(
        "--require-real-audio",
        action="store_true",
        help="Exit non-zero unless every case uses real wav_path sources.",
    )
    parser.add_argument(
        "--fail-on-missing",
        action="store_true",
        help="Exit non-zero if any guide/take source is missing or invalid.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.metadata is not None:
        metadata_path = args.metadata.resolve()
        metadata = load_human_rating_metadata(metadata_path)
        report = inspect_human_rating_metadata(metadata, metadata_path=metadata_path)
    else:
        manifest_path = args.manifest.resolve()
        corpus = load_calibration_corpus(manifest_path)
        report = inspect_calibration_corpus(corpus, manifest_path=manifest_path)

    rendered_json = json.dumps(report.model_dump(mode="json"), indent=2)
    rendered_markdown = render_corpus_inventory_markdown(report)

    if args.output_json is not None:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(rendered_json, encoding="utf-8")
    if args.output_md is not None:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(rendered_markdown, encoding="utf-8")

    print(rendered_markdown)

    if args.fail_on_missing and not report.summary.all_sources_resolved:
        raise SystemExit(1)
    if args.require_real_audio and report.summary.cases_using_real_audio != report.summary.total_cases:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
