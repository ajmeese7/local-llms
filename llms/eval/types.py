"""Core dataclasses passed between adapter, runner, and scorer.

These are deliberately small and immutable. Adapters return them; the runner
threads them through HTTP + scoring without ever calling back into the
serving plane internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Item:
    """One benchmark task."""

    id: str
    category: str
    prompt: str
    expected: object | None = None  # adapter-defined ground truth
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Prompt:
    """A rendered prompt + sampling params for one HTTP request.

    `enable_thinking` overrides the http client's default "thinking off" for
    Qwen-family servers. None = use the client default (off); True/False sets
    the chat-template kwarg explicitly. Adapters that want long reasoning
    traces (frontend_agentic's agentic items, for example) set this to True.
    """

    text: str
    temperature: float = 0.0
    top_p: float | None = None
    top_k: int | None = None
    max_tokens: int = 1024
    stop: tuple[str, ...] = ()
    enable_thinking: bool | None = None


@dataclass(frozen=True, slots=True)
class ParsedAnswer:
    """The model's response after the adapter has parsed it.

    `value` is adapter-defined: a string for free-text adapters, a dict for
    structured-output adapters, etc. `parse_failed` is true when the parser
    couldn't make sense of the raw response — distinct from a wrong answer.
    """

    raw: str
    value: object | None
    parse_failed: bool = False
    parse_error: str | None = None


@dataclass(frozen=True, slots=True)
class Score:
    """One graded item.

    `correct` is the deterministic 0/1 outcome the runner aggregates.
    `partial` is an adapter-specific 0..1 quality score for adapters that
    grade with rubrics (the local_smoke harness, for example).
    `breakdown` carries any per-subtask detail to surface in reports.
    """

    correct: bool
    partial: float
    breakdown: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ItemResult:
    """One item end-to-end: parsed answer + score + timing."""

    item: Item
    parsed: ParsedAnswer
    score: Score
    ttft_ms: float | None
    latency_ms: float | None
    output_tokens: int | None
    tokens_per_sec: float | None
    http_status: int
    error: str | None = None
    prompt: str = ""  # rendered prompt text sent to the model


__all__ = ["Item", "ItemResult", "ParsedAnswer", "Prompt", "Score"]
