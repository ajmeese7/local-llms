#!/usr/bin/env python3
"""Extract model IDs from an OpenAI-compatible /v1/models payload."""

from __future__ import annotations

import json
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"could not parse /v1/models response as JSON: {exc}") from exc

    model_ids = [
        item.get("id")
        for item in payload.get("data", [])
        if isinstance(item, dict) and item.get("id")
    ]

    if not model_ids:
        raise SystemExit("no model ids found in /v1/models response")

    print("\n".join(model_ids))


if __name__ == "__main__":
    main()
