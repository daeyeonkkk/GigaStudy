from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import (
    load_calibration_corpus,
    render_calibration_summary_markdown,
    run_calibration_corpus,
)
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the repeatable intonation calibration corpus.")
    parser.add_argument(
        "--round-root",
        type=Path,
        default=None,
        help="Optional evidence round root. When set, manifest and outputs default to that round.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Path to a calibration manifest JSON file.",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        default=None,
        help="Optional path for the JSON summary.",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=None,
        help="Optional path for the Markdown summary.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    round_paths = resolve_evidence_round_paths(args.round_root) if args.round_root is not None else None
    manifest_path = (
        args.manifest.resolve()
        if args.manifest is not None
        else round_paths.human_rating_generated_corpus_path
        if round_paths is not None
        else Path("calibration/synthetic_vocal_baseline.json").resolve()
    )
    json_output_path = (
        args.json_output.resolve()
        if args.json_output is not None
        else round_paths.human_rating_calibration_json_path
        if round_paths is not None
        else None
    )
    markdown_output_path = (
        args.markdown_output.resolve()
        if args.markdown_output is not None
        else round_paths.human_rating_calibration_markdown_path
        if round_paths is not None
        else None
    )
    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)

    summary_json = summary.model_dump(mode="json")
    markdown_summary = render_calibration_summary_markdown(summary)

    if json_output_path is not None:
        json_output_path.parent.mkdir(parents=True, exist_ok=True)
        json_output_path.write_text(json.dumps(summary_json, indent=2), encoding="utf-8")
    if markdown_output_path is not None:
        markdown_output_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_output_path.write_text(markdown_summary, encoding="utf-8")

    print(json.dumps(summary_json, indent=2))


if __name__ == "__main__":
    main()
