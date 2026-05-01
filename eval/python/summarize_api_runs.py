#!/usr/bin/env python3
"""Summarize API benchmark TSV rows into a text summary file."""

from __future__ import annotations

import csv
import statistics
import sys
from pathlib import Path


def avg_float(rows: list[dict[str, str]], key: str) -> float | None:
    values = [float(row[key]) for row in rows if row.get(key)]
    return statistics.mean(values) if values else None


def avg_int(rows: list[dict[str, str]], key: str) -> float | None:
    values = [int(float(row[key])) for row in rows if row.get(key)]
    return statistics.mean(values) if values else None


def main() -> None:
    tsv_path = Path(sys.argv[1])
    summary_path = Path(sys.argv[2])

    rows = list(csv.DictReader(tsv_path.open(encoding="utf-8"), delimiter="\t"))
    if not rows:
        raise SystemExit("no API benchmark rows found")

    ok_rows = [row for row in rows if row.get("http_code") == "200"]

    lines = [f"runs: {len(rows)}", f"successful_runs: {len(ok_rows)}"]
    if ok_rows:
        metrics = [
            ("time_total", "avg_time_total_sec", "{:.3f}", avg_float),
            ("time_starttransfer", "avg_ttft_sec", "{:.3f}", avg_float),
            ("prompt_tokens", "avg_prompt_tokens", "{:.1f}", avg_int),
            ("completion_tokens", "avg_completion_tokens", "{:.1f}", avg_int),
            ("total_tokens", "avg_total_tokens", "{:.1f}", avg_int),
        ]
        for key, label, fmt, aggregator in metrics:
            value = aggregator(ok_rows, key)
            if value is not None:
                lines.append(f"{label}: {fmt.format(value)}")

        tokens_per_sec = avg_float(ok_rows, "tokens_per_sec")
        if tokens_per_sec is not None:
            lines.append(f"avg_completion_tokens_per_sec: {tokens_per_sec:.3f}")

    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
