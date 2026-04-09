from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import load_calibration_corpus, run_calibration_corpus
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.threshold_fitting import (
    build_threshold_calibration_report,
    render_threshold_calibration_markdown,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fit candidate difficulty thresholds from a human-rated corpus.")
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
        help="Path to a generated human-rating corpus manifest.",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        default=None,
        help="Optional path for the JSON report.",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=None,
        help="Optional path for the Markdown report.",
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
        else Path("calibration/human_rating_corpus.generated.json").resolve()
    )
    json_output_path = (
        args.json_output.resolve()
        if args.json_output is not None
        else round_paths.human_rating_threshold_json_path
        if round_paths is not None
        else None
    )
    markdown_output_path = (
        args.markdown_output.resolve()
        if args.markdown_output is not None
        else round_paths.human_rating_threshold_markdown_path
        if round_paths is not None
        else None
    )
    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)
    report = build_threshold_calibration_report(summary)

    report_json = json.dumps(report.model_dump(mode="json"), indent=2)
    report_markdown = render_threshold_calibration_markdown(report)

    if json_output_path is not None:
        json_output_path.parent.mkdir(parents=True, exist_ok=True)
        json_output_path.write_text(report_json, encoding="utf-8")
    if markdown_output_path is not None:
        markdown_output_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_output_path.write_text(report_markdown, encoding="utf-8")

    print(report_json)


if __name__ == "__main__":
    main()
