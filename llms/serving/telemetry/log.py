"""Per-request telemetry writer.

The eval plane (Phase 4+) is the primary producer: it knows TTFT, e2e latency,
output tokens, and which run a request belongs to. Writers are append-only
JSONL; readers in `aggregate.py` slurp the file and compute rollups.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Self

from platformdirs import user_state_path


def default_log_path() -> Path:
    return Path(user_state_path("llms", appauthor=False)) / "requests.jsonl"


@dataclass(frozen=True, slots=True)
class RequestRecord:
    """One HTTP request to an inference endpoint.

    Optional fields stay optional because not every caller has every metric.
    The eval runner fills them all; ad-hoc curl benchmarks may fill only a
    subset.
    """

    timestamp: str  # ISO-8601 UTC, "2026-05-01T12:34:56Z"
    endpoint: str  # OpenAI-compatible URL or endpoint name
    profile: str | None = None
    run_id: str | None = None  # eval run reference
    item_id: str | None = None  # benchmark item id
    prompt_tokens: int | None = None
    output_tokens: int | None = None
    ttft_ms: float | None = None
    latency_ms: float | None = None
    tokens_per_sec: float | None = None
    http_status: int | None = None
    error: str | None = None
    extras: dict[str, object] = field(default_factory=dict)

    @classmethod
    def now(cls, **kwargs: object) -> Self:
        return cls(timestamp=_utc_iso(), **kwargs)  # type: ignore[arg-type]

    def to_json_line(self) -> str:
        payload = {k: v for k, v in asdict(self).items() if v not in (None, {})}
        return json.dumps(payload, separators=(",", ":"))


def _utc_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class TelemetryWriter:
    """Append-only JSONL writer. One file per host, by default in XDG state."""

    def __init__(self, *, path: Path | None = None) -> None:
        self.path = (path or default_log_path()).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, record: RequestRecord) -> None:
        line = record.to_json_line()
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


__all__ = ["RequestRecord", "TelemetryWriter", "default_log_path"]
