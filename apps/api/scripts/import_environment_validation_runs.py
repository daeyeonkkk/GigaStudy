from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.environment_validation_import import (
    build_environment_validation_requests,
    load_environment_validation_sheet,
    render_environment_validation_requests_json,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build or submit environment validation runs from a CSV intake sheet."
    )
    parser.add_argument(
        "--round-root",
        type=Path,
        default=None,
        help="Optional evidence-round root. When set, defaults the CSV and output paths to that round.",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Path to the environment validation CSV file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional path for the preview JSON payload.",
    )
    parser.add_argument(
        "--api-base-url",
        type=str,
        default=None,
        help="Optional API base URL. When set, the script will submit each row to /api/admin/environment-validations.",
    )
    return parser


def submit_requests(api_base_url: str, payloads: str) -> list[dict[str, object]]:
    normalized_base = api_base_url.rstrip("/")
    endpoint = f"{normalized_base}/api/admin/environment-validations"
    results: list[dict[str, object]] = []
    requests_payload = json.loads(payloads)

    for payload in requests_payload:
        request = urllib_request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(request) as response:
                results.append(json.loads(response.read().decode("utf-8")))
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Import failed with status {exc.code}: {detail}") from exc

    return results


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    round_paths = resolve_evidence_round_paths(args.round_root) if args.round_root is not None else None
    csv_path = (args.csv or (round_paths.environment_validation_sheet_path if round_paths else None) or Path("environment_validation/environment_validation_runs.template.csv")).resolve()
    output_path = args.output or (round_paths.environment_validation_generated_requests_path if round_paths else None)

    rows = load_environment_validation_sheet(csv_path)
    requests = build_environment_validation_requests(rows)
    rendered_json = render_environment_validation_requests_json(requests)

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered_json, encoding="utf-8")

    if args.api_base_url:
        submitted = submit_requests(args.api_base_url, rendered_json)
        print(json.dumps(submitted, indent=2))
        return

    print(rendered_json)


if __name__ == "__main__":
    main()
