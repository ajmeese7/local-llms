#!/usr/bin/env python3
"""Compare API benchmark run directories and emit a CSV summary."""

from __future__ import annotations

import csv
import statistics
import sys
from pathlib import Path


def parse_request_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data

    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()

    return data


def mean(values: list[float]) -> float | None:
    return statistics.mean(values) if values else None


def summarize_run(run_dir: Path) -> dict[str, str]:
    summary_tsv = run_dir / "summary.tsv"
    request_txt = run_dir / "request.txt"

    if not summary_tsv.exists():
        raise SystemExit(f"run directory is missing summary.tsv: {run_dir}")

    request_meta = parse_request_file(request_txt)
    rows = list(csv.DictReader(summary_tsv.open(encoding="utf-8"), delimiter="\t"))
    ok_rows = [row for row in rows if row.get("http_code") == "200"]

    avg_time_total = mean([float(row["time_total"]) for row in ok_rows if row.get("time_total")])
    avg_tokens_per_sec = mean(
        [float(row["tokens_per_sec"]) for row in ok_rows if row.get("tokens_per_sec")]
    )

    return {
        "run_dir": str(run_dir),
        "model": request_meta.get("model", ""),
        "avg_time_total_sec": f"{avg_time_total:.3f}" if avg_time_total is not None else "",
        "avg_completion_tokens_per_sec": (
            f"{avg_tokens_per_sec:.3f}" if avg_tokens_per_sec is not None else ""
        ),
    }


def main() -> None:
    output_path = sys.argv[1]
    run_dirs = [Path(value) for value in sys.argv[2:]]

    rows = [summarize_run(run_dir) for run_dir in run_dirs]
    fieldnames = [
        "run_dir",
        "model",
        "avg_time_total_sec",
        "avg_completion_tokens_per_sec",
    ]

    if output_path in ("", "-"):
        writer = csv.DictWriter(sys.stdout, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        return

    with open(output_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
