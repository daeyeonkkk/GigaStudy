from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.calibration import load_calibration_corpus, render_calibration_summary_markdown, run_calibration_corpus
from gigastudy_api.services.calibration_claim_gate import (
    ClaimGatePolicy,
    evaluate_calibration_claim_gate,
    render_calibration_claim_gate_markdown,
)
from gigastudy_api.services.threshold_fitting import build_threshold_calibration_report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate whether a human-rated corpus is strong enough to begin threshold-closure review."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Path to the generated human rating corpus manifest.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=None,
        help="Optional output path for the claim-gate JSON.",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=None,
        help="Optional output path for the claim-gate Markdown.",
    )
    parser.add_argument("--minimum-rated-case-count", type=int, default=6)
    parser.add_argument("--minimum-rated-note-count", type=int, default=30)
    parser.add_argument("--minimum-human-rating-agreement-ratio", type=float, default=0.72)
    parser.add_argument("--minimum-threshold-exact-agreement-ratio", type=float, default=0.68)
    parser.add_argument("--minimum-usable-threshold-fit-note-count", type=int, default=24)
    parser.add_argument("--allow-failed-cases", action="store_true")
    parser.add_argument("--allow-synthetic-evidence", action="store_true")
    parser.add_argument(
        "--exit-nonzero-when-not-ready",
        action="store_true",
        help="Exit with status 1 when the evaluated corpus is not claim-ready.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    corpus = load_calibration_corpus(manifest_path)
    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)
    report = build_threshold_calibration_report(summary)
    policy = ClaimGatePolicy(
        minimum_rated_case_count=args.minimum_rated_case_count,
        minimum_rated_note_count=args.minimum_rated_note_count,
        minimum_human_rating_agreement_ratio=args.minimum_human_rating_agreement_ratio,
        minimum_threshold_exact_agreement_ratio=args.minimum_threshold_exact_agreement_ratio,
        minimum_usable_threshold_fit_note_count=args.minimum_usable_threshold_fit_note_count,
        require_zero_failed_cases=not args.allow_failed_cases,
        require_non_synthetic_evidence=not args.allow_synthetic_evidence,
    )
    result = evaluate_calibration_claim_gate(summary, report, policy=policy)

    rendered_markdown = render_calibration_claim_gate_markdown(result)
    rendered_json = json.dumps(
        {
            "claim_gate": result.model_dump(mode="json"),
            "calibration_summary_markdown": render_calibration_summary_markdown(summary),
        },
        indent=2,
    )

    if args.output_json is not None:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(rendered_json, encoding="utf-8")
    if args.output_md is not None:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(rendered_markdown, encoding="utf-8")

    print(rendered_markdown)

    if args.exit_nonzero_when_not_ready and not result.release_claim_ready:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
