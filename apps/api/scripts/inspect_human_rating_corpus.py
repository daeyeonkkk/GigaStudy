from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import load_calibration_corpus
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
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
    source_group = parser.add_mutually_exclusive_group(required=False)
    source_group.add_argument(
        "--round-root",
        type=Path,
        help="Optional evidence-round root. When set, inspect the round metadata or generated manifest.",
    )
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
        "--source-kind",
        choices=("metadata", "manifest"),
        default="metadata",
        help="When using --round-root, choose whether to inspect the round metadata or generated manifest.",
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

    if args.round_root is not None:
        round_paths = resolve_evidence_round_paths(args.round_root)
        metadata_path = round_paths.human_rating_cases_path.resolve()
        manifest_path = round_paths.human_rating_generated_corpus_path.resolve()
    else:
        metadata_path = args.metadata.resolve() if args.metadata is not None else None
        manifest_path = args.manifest.resolve() if args.manifest is not None else None

    use_metadata_source = False
    if args.round_root is not None:
        use_metadata_source = args.source_kind == "metadata"
    elif args.metadata is not None:
        use_metadata_source = True

    if use_metadata_source and metadata_path is not None:
        metadata = load_human_rating_metadata(metadata_path)
        report = inspect_human_rating_metadata(metadata, metadata_path=metadata_path)
    elif manifest_path is not None:
        corpus = load_calibration_corpus(manifest_path)
        report = inspect_calibration_corpus(corpus, manifest_path=manifest_path)
    else:
        raise SystemExit("One of --round-root, --metadata, or --manifest must be provided.")

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
