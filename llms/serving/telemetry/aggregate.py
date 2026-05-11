"""Read the JSONL request log and compute window-bounded rollups."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Summary:
    window_start: datetime | None
    window_end: datetime
    request_count: int
    error_count: int
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    p50_ttft_ms: float | None
    p95_ttft_ms: float | None
    median_tokens_per_sec: float | None


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    rank = (len(ordered) - 1) * pct
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return ordered[lo]
    weight = rank - lo
    return ordered[lo] * (1 - weight) + ordered[hi] * weight


def _median(values: list[float]) -> float | None:
    return _percentile(values, 0.5)


def _parse_iso(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def _iter_records(path: Path) -> Iterable[dict[str, object]]:
    if not path.exists():
        return
    with path.open(encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                # Skip corrupt rows rather than aborting; the writer is best-effort.
                continue
            if isinstance(value, dict):
                yield value


def summarize(
    *,
    log_path: Path,
    window: timedelta | None = None,
    now: datetime | None = None,
) -> Summary:
    """Aggregate every record in `log_path` newer than `now - window`."""
    cutoff = (now or datetime.now(UTC)) - window if window else None
    end = now or datetime.now(UTC)

    latencies: list[float] = []
    ttfts: list[float] = []
    tps: list[float] = []
    request_count = 0
    error_count = 0

    for record in _iter_records(log_path):
        ts_raw = record.get("timestamp")
        if not isinstance(ts_raw, str):
            continue
        try:
            ts = _parse_iso(ts_raw)
        except ValueError:
            continue
        if cutoff is not None and ts < cutoff:
            continue

        request_count += 1
        if record.get("error") is not None:
            error_count += 1
        for source, sink in (
            ("latency_ms", latencies),
            ("ttft_ms", ttfts),
            ("tokens_per_sec", tps),
        ):
            value = record.get(source)
            if isinstance(value, int | float):
                sink.append(float(value))

    return Summary(
        window_start=cutoff,
        window_end=end,
        request_count=request_count,
        error_count=error_count,
        p50_latency_ms=_percentile(latencies, 0.5),
        p95_latency_ms=_percentile(latencies, 0.95),
        p50_ttft_ms=_percentile(ttfts, 0.5),
        p95_ttft_ms=_percentile(ttfts, 0.95),
        median_tokens_per_sec=_median(tps),
    )


__all__ = ["Summary", "summarize"]
