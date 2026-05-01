#!/usr/bin/env python3
"""Build OpenAI-compatible request JSON for chat/completions modes."""

from __future__ import annotations

import json
import sys


def main() -> None:
    mode, model, prompt, max_tokens, temperature = sys.argv[1:]

    payload: dict[str, object] = {
        "model": model,
        "max_tokens": int(max_tokens),
        "temperature": float(temperature),
    }

    if mode == "chat":
        payload["messages"] = [{"role": "user", "content": prompt}]
    elif mode == "completions":
        payload["prompt"] = prompt
    else:
        raise SystemExit(f"unsupported mode: {mode}")

    print(json.dumps(payload))


if __name__ == "__main__":
    main()
