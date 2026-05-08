"""Aggregation: bootstrap CIs, parse-failure tracking, summary objects."""

from __future__ import annotations

import math
import random
import statistics
from collections.abc import Sequence
from dataclasses import dataclass, field

from llms.eval.types import ItemResult


@dataclass(frozen=True, slots=True)
class ConfidenceInterval:
    point: float
    lo: float  # 2.5th percentile
    hi: float  # 97.5th percentile
    method: str = "bootstrap-bca"


@dataclass(frozen=True, slots=True)
class CategoryStats:
    item_count: int
    correct_count: int
    accuracy: float
    partial_mean: float


@dataclass(frozen=True, slots=True)
class Timing:
    """Wall-clock cost of a run.

    `wall_seconds` is the full duration the runner spent driving this adapter
    (item iteration + scoring + summarization). `compute_seconds` is the sum of
    per-item HTTP latencies — i.e. time the model was actively generating. The
    delta is dataset I/O, scoring, parse overhead, and any inter-request gaps.
    """

    started_at: str  # ISO-8601 UTC, captured before the item loop
    finished_at: str  # ISO-8601 UTC, captured after summarize
    wall_seconds: float
    compute_seconds: float


@dataclass(frozen=True, slots=True)
class RunSummary:
    """High-level numbers for one run."""

    item_count: int
    correct_count: int
    parse_failure_count: int
    error_count: int
    accuracy: ConfidenceInterval | None
    partial: ConfidenceInterval | None
    median_latency_ms: float | None
    median_ttft_ms: float | None
    median_tokens_per_sec: float | None
    by_category: dict[str, CategoryStats] = field(default_factory=dict)
    timing: Timing | None = None


def _percentile_from_sorted(values: list[float], pct: float) -> float:
    if not values:
        raise ValueError("percentile of empty sequence")
    if len(values) == 1:
        return values[0]
    rank = (len(values) - 1) * pct
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return values[lo]
    weight = rank - lo
    return values[lo] * (1 - weight) + values[hi] * weight


def bootstrap_mean(
    samples: Sequence[float],
    *,
    iterations: int = 1000,
    seed: int = 1729,
) -> ConfidenceInterval | None:
    """Percentile bootstrap for the mean. Returns None for empty input."""
    if not samples:
        return None
    point = statistics.fmean(samples)
    if len(samples) == 1:
        return ConfidenceInterval(point=point, lo=point, hi=point, method="single-sample")

    rng = random.Random(seed)
    n = len(samples)
    means: list[float] = []
    for _ in range(iterations):
        resample = [samples[rng.randrange(n)] for _ in range(n)]
        means.append(statistics.fmean(resample))
    means.sort()
    lo = _percentile_from_sorted(means, 0.025)
    hi = _percentile_from_sorted(means, 0.975)
    return ConfidenceInterval(point=point, lo=lo, hi=hi, method="bootstrap-percentile")


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def summarize(
    results: Sequence[ItemResult],
    *,
    timing: Timing | None = None,
) -> RunSummary:
    correct = [1.0 if r.score.correct else 0.0 for r in results]
    partial = [r.score.partial for r in results]
    latencies = [r.latency_ms for r in results if r.latency_ms is not None]
    ttfts = [r.ttft_ms for r in results if r.ttft_ms is not None]
    tps = [r.tokens_per_sec for r in results if r.tokens_per_sec is not None]
    parse_failures = sum(1 for r in results if r.parsed.parse_failed)
    errors = sum(1 for r in results if r.error is not None)

    by_cat: dict[str, list[ItemResult]] = {}
    for r in results:
        by_cat.setdefault(r.item.category, []).append(r)
    category_stats = {
        cat: CategoryStats(
            item_count=len(items),
            correct_count=sum(1 for r in items if r.score.correct),
            accuracy=sum(1 for r in items if r.score.correct) / len(items),
            partial_mean=statistics.fmean(r.score.partial for r in items),
        )
        for cat, items in by_cat.items()
    }

    return RunSummary(
        item_count=len(results),
        correct_count=sum(1 for r in results if r.score.correct),
        parse_failure_count=parse_failures,
        error_count=errors,
        accuracy=bootstrap_mean(correct),
        partial=bootstrap_mean(partial),
        median_latency_ms=_median(latencies),
        median_ttft_ms=_median(ttfts),
        median_tokens_per_sec=_median(tps),
        by_category=category_stats,
        timing=timing,
    )


__all__ = [
    "CategoryStats",
    "ConfidenceInterval",
    "RunSummary",
    "Timing",
    "bootstrap_mean",
    "summarize",
]
