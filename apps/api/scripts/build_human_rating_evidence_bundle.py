from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import (
    load_calibration_corpus,
    render_calibration_summary_markdown,
    run_calibration_corpus,
)
from gigastudy_api.services.calibration_evidence import (
    build_evidence_bundle_slug,
    build_human_rating_evidence_bundle,
    render_human_rating_evidence_markdown,
)
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.threshold_fitting import (
    build_threshold_calibration_report,
    render_threshold_calibration_markdown,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a human-rating evidence bundle from calibration and threshold-fit outputs."
    )
    parser.add_argument(
        "--round-root",
        type=Path,
        default=None,
        help="Optional evidence-round root. When set, defaults the manifest and output directory to that round.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Path to a generated human-rating corpus manifest.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for the generated bundle artifacts.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    round_paths = resolve_evidence_round_paths(args.round_root) if args.round_root is not None else None
    default_manifest_path = round_paths.human_rating_generated_corpus_path if round_paths else Path(
        "calibration/human_rating_corpus.generated.json"
    )
    default_output_dir = round_paths.human_rating_evidence_output_dir if round_paths else Path("calibration/output")
    manifest_path = (args.manifest or default_manifest_path).resolve()
    output_dir = (args.output_dir or default_output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)
    report = build_threshold_calibration_report(summary)
    bundle = build_human_rating_evidence_bundle(summary, report, manifest_path=manifest_path)

    slug = build_evidence_bundle_slug(summary.corpus_id)

    calibration_json_path = output_dir / f"{slug}.calibration-summary.json"
    calibration_markdown_path = output_dir / f"{slug}.calibration-summary.md"
    threshold_json_path = output_dir / f"{slug}.threshold-report.json"
    threshold_markdown_path = output_dir / f"{slug}.threshold-report.md"
    bundle_json_path = output_dir / f"{slug}.evidence-bundle.json"
    bundle_markdown_path = output_dir / f"{slug}.evidence-bundle.md"

    calibration_json = json.dumps(summary.model_dump(mode="json"), indent=2)
    calibration_markdown = render_calibration_summary_markdown(summary)
    threshold_json = json.dumps(report.model_dump(mode="json"), indent=2)
    threshold_markdown = render_threshold_calibration_markdown(report)
    bundle_json = json.dumps(bundle.model_dump(mode="json"), indent=2)
    bundle_markdown = render_human_rating_evidence_markdown(bundle)

    calibration_json_path.write_text(calibration_json, encoding="utf-8")
    calibration_markdown_path.write_text(calibration_markdown, encoding="utf-8")
    threshold_json_path.write_text(threshold_json, encoding="utf-8")
    threshold_markdown_path.write_text(threshold_markdown, encoding="utf-8")
    bundle_json_path.write_text(bundle_json, encoding="utf-8")
    bundle_markdown_path.write_text(bundle_markdown, encoding="utf-8")

    print(
        json.dumps(
            {
                "bundle_id": bundle.bundle_id,
                "corpus_id": bundle.corpus_id,
                "output_dir": str(output_dir),
                "outputs": {
                    "calibration_json": str(calibration_json_path),
                    "calibration_markdown": str(calibration_markdown_path),
                    "threshold_json": str(threshold_json_path),
                    "threshold_markdown": str(threshold_markdown_path),
                    "bundle_json": str(bundle_json_path),
                    "bundle_markdown": str(bundle_markdown_path),
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
