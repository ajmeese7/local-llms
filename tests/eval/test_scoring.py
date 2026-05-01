"""Bootstrap CI + summarize."""

from __future__ import annotations

from llms.eval.scoring import bootstrap_mean, summarize
from llms.eval.types import Item, ItemResult, ParsedAnswer, Score


def _result(*, correct: bool, partial: float, latency: float, category: str = "x") -> ItemResult:
    return ItemResult(
        item=Item(id="i", category=category, prompt="p"),
        parsed=ParsedAnswer(raw="r", value="r"),
        score=Score(correct=correct, partial=partial),
        ttft_ms=10.0,
        latency_ms=latency,
        output_tokens=20,
        tokens_per_sec=20 / (latency / 1000.0),
        http_status=200,
    )


def test_bootstrap_empty() -> None:
    assert bootstrap_mean([]) is None


def test_bootstrap_single_sample() -> None:
    ci = bootstrap_mean([0.7])
    assert ci is not None
    assert ci.point == 0.7 and ci.lo == 0.7 and ci.hi == 0.7
    assert ci.method == "single-sample"


def test_bootstrap_uniform_samples_have_zero_width() -> None:
    ci = bootstrap_mean([1.0, 1.0, 1.0, 1.0, 1.0])
    assert ci is not None
    assert ci.point == 1.0
    assert ci.lo == 1.0 and ci.hi == 1.0


def test_bootstrap_seeded_reproducible() -> None:
    samples = [0.0, 0.5, 1.0, 0.5, 0.0, 1.0, 0.0, 1.0]
    a = bootstrap_mean(samples, iterations=200, seed=42)
    b = bootstrap_mean(samples, iterations=200, seed=42)
    assert a is not None
    assert a == b


def test_summarize_aggregates_correctly() -> None:
    results = [
        _result(correct=True, partial=1.0, latency=100.0, category="alpha"),
        _result(correct=False, partial=0.5, latency=200.0, category="alpha"),
        _result(correct=True, partial=0.75, latency=150.0, category="beta"),
    ]
    summary = summarize(results)
    assert summary.item_count == 3
    assert summary.correct_count == 2
    assert summary.parse_failure_count == 0
    assert summary.median_latency_ms == 150.0
    assert summary.accuracy is not None
    assert abs(summary.accuracy.point - (2 / 3)) < 1e-9
    assert "alpha" in summary.by_category
    assert summary.by_category["alpha"].item_count == 2
    assert summary.by_category["alpha"].correct_count == 1


def test_summarize_handles_empty_input() -> None:
    summary = summarize([])
    assert summary.item_count == 0
    assert summary.accuracy is None
    assert summary.median_latency_ms is None
