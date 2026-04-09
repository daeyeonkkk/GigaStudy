from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import load_calibration_corpus, run_calibration_corpus
from gigastudy_api.services.threshold_fitting import (
    build_threshold_calibration_report,
    render_threshold_calibration_markdown,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fit candidate difficulty thresholds from a human-rated corpus.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("calibration/human_rating_corpus.generated.json"),
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
    manifest_path = args.manifest.resolve()
    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)
    report = build_threshold_calibration_report(summary)

    report_json = json.dumps(report.model_dump(mode="json"), indent=2)
    report_markdown = render_threshold_calibration_markdown(report)

    if args.json_output is not None:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(report_json, encoding="utf-8")
    if args.markdown_output is not None:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(report_markdown, encoding="utf-8")

    print(report_json)


if __name__ == "__main__":
    main()
