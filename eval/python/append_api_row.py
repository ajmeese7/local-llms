#!/usr/bin/env python3
"""Append one API benchmark row to a TSV file."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _extract_text(payload: dict, mode: str) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""

    choice = choices[0]
    if mode == "chat":
        message = choice.get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            return "".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        return str(content)

    return str(choice.get("text", ""))


def main() -> None:
    tsv_path = Path(sys.argv[1])
    run_id = sys.argv[2]
    http_code = sys.argv[3]
    time_total = float(sys.argv[4])
    time_starttransfer = float(sys.argv[5])
    response_path = Path(sys.argv[6])
    mode = sys.argv[7]

    prompt_tokens: str | int = ""
    completion_tokens: str | int = ""
    total_tokens: str | int = ""
    output_chars: str | int = ""
    tokens_per_sec: str = ""

    if response_path.exists():
        try:
            data = json.loads(response_path.read_text(encoding="utf-8"))
            usage = data.get("usage") or {}
            prompt_tokens = usage.get("prompt_tokens", "")
            completion_tokens = usage.get("completion_tokens", "")
            total_tokens = usage.get("total_tokens", "")

            text = _extract_text(data, mode)
            output_chars = len(text)

            if completion_tokens not in ("", None) and time_total > 0:
                tokens_per_sec = f"{float(completion_tokens) / time_total:.3f}"
        except Exception:
            pass

    with tsv_path.open("a", encoding="utf-8") as handle:
        handle.write(
            "\t".join(
                [
                    run_id,
                    http_code,
                    f"{time_total:.3f}",
                    f"{time_starttransfer:.3f}",
                    str(prompt_tokens),
                    str(completion_tokens),
                    str(total_tokens),
                    str(output_chars),
                    tokens_per_sec,
                ]
            )
            + "\n"
        )


if __name__ == "__main__":
    main()
