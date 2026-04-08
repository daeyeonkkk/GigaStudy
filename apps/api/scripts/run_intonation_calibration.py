from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import (
    load_calibration_corpus,
    render_calibration_summary_markdown,
    run_calibration_corpus,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the repeatable intonation calibration corpus.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("calibration/synthetic_vocal_baseline.json"),
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
    manifest_path = args.manifest.resolve()
    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)

    summary_json = summary.model_dump(mode="json")
    markdown_summary = render_calibration_summary_markdown(summary)

    if args.json_output is not None:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(summary_json, indent=2), encoding="utf-8")
    if args.markdown_output is not None:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(markdown_summary, encoding="utf-8")

    print(json.dumps(summary_json, indent=2))


if __name__ == "__main__":
    main()
