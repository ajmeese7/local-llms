"""Telemetry writer + aggregator round-trip."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from llms.serving.telemetry.aggregate import summarize
from llms.serving.telemetry.log import RequestRecord, TelemetryWriter


def test_writer_appends_jsonl_lines(tmp_path: Path) -> None:
    log = tmp_path / "requests.jsonl"
    writer = TelemetryWriter(path=log)
    writer.write(RequestRecord.now(endpoint="ep", latency_ms=120.0))
    writer.write(RequestRecord.now(endpoint="ep", latency_ms=200.0, error="500"))
    lines = log.read_text().splitlines()
    assert len(lines) == 2
    assert "latency_ms" in lines[0]


def test_summary_excludes_records_outside_window(tmp_path: Path) -> None:
    log = tmp_path / "requests.jsonl"
    writer = TelemetryWriter(path=log)
    # One ancient record (outside any reasonable window).
    writer.write(
        RequestRecord(
            timestamp="2000-01-01T00:00:00Z",
            endpoint="ep",
            latency_ms=1.0,
        )
    )
    writer.write(RequestRecord.now(endpoint="ep", latency_ms=100.0))
    writer.write(RequestRecord.now(endpoint="ep", latency_ms=200.0, error="x"))

    summary = summarize(log_path=log, window=timedelta(hours=1))
    assert summary.request_count == 2
    assert summary.error_count == 1
    assert summary.p50_latency_ms is not None
    assert summary.p50_latency_ms <= summary.p95_latency_ms  # type: ignore[operator]


def test_summary_handles_empty_log(tmp_path: Path) -> None:
    summary = summarize(log_path=tmp_path / "missing.jsonl")
    assert summary.request_count == 0
    assert summary.p50_latency_ms is None


def test_summary_skips_corrupt_lines(tmp_path: Path) -> None:
    log = tmp_path / "requests.jsonl"
    log.write_text("\n".join(["{not json", '{"timestamp": "bad"}', "", '"non-object"']))
    summary = summarize(log_path=log)
    assert summary.request_count == 0


def test_percentiles_exact_for_known_data(tmp_path: Path) -> None:
    log = tmp_path / "requests.jsonl"
    writer = TelemetryWriter(path=log)
    now = datetime.now(UTC)
    for _i, latency in enumerate([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], start=1):
        writer.write(
            RequestRecord(
                timestamp=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                endpoint="ep",
                latency_ms=float(latency),
            )
        )
    summary = summarize(log_path=log)
    assert summary.request_count == 10
    assert summary.p50_latency_ms is not None
    # Linear interpolation: 50th percentile of [10..100] step 10 == 55.
    assert abs(summary.p50_latency_ms - 55.0) < 1e-6
