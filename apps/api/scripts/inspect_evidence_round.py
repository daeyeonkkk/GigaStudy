from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.evidence_round_audit import (
    inspect_evidence_round,
    render_evidence_round_audit_markdown,
)
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect one external evidence round and summarize what is present, missing, and next."
    )
    parser.add_argument(
        "--round-root",
        type=Path,
        required=True,
        help="Path to the evidence round root.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=None,
        help="Optional output path for the audit JSON.",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=None,
        help="Optional output path for the audit Markdown.",
    )
    parser.add_argument(
        "--write-default-outputs",
        action="store_true",
        help="Write round-audit.json and round-audit.md into the selected round root.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    round_paths = resolve_evidence_round_paths(args.round_root)
    report = inspect_evidence_round(round_paths.root)
    rendered_json = json.dumps(report.model_dump(mode="json"), indent=2)
    rendered_markdown = render_evidence_round_audit_markdown(report)

    output_json_path = args.output_json
    output_md_path = args.output_md
    if args.write_default_outputs:
        output_json_path = output_json_path or round_paths.audit_json_path
        output_md_path = output_md_path or round_paths.audit_markdown_path

    if output_json_path is not None:
        output_json_path.parent.mkdir(parents=True, exist_ok=True)
        output_json_path.write_text(rendered_json, encoding="utf-8")
    if output_md_path is not None:
        output_md_path.parent.mkdir(parents=True, exist_ok=True)
        output_md_path.write_text(rendered_markdown, encoding="utf-8")

    print(rendered_markdown)


if __name__ == "__main__":
    main()
