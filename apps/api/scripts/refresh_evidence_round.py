from __future__ import annotations

import argparse
import json
from pathlib import Path

from gigastudy_api.services.evidence_round_refresh import refresh_evidence_round


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Refresh one evidence round by rebuilding support artifacts in place."
    )
    parser.add_argument(
        "--round-root",
        type=Path,
        required=True,
        help="Path to the evidence round root.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    result = refresh_evidence_round(args.round_root)
    print(json.dumps(result.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
