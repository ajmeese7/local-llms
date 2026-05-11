"""OpenAI-compatible HTTP client.

The eval plane is an HTTP consumer of the serving plane — never an importer.
This module wraps `httpx.Client` and exposes one method (`complete`) that
takes a `Prompt` and returns a typed `CompletionResult`.

We stream responses as Server-Sent Events for two reasons. First, accurate
TTFT: we measure the wall time to the first SSE `data:` line, not the headers
of a buffered non-streaming POST (which on llama-server arrive only after the
full response is generated). Second, partial-output preservation: every chunk
we receive is appended to a running buffer, so when a request errors mid-flight
— wall-clock deadline, network drop, server crash — the text we've already
seen still lands in `CompletionResult.text` and the adapter scores against it
rather than against an empty string.

Token counts are reported by the server in the terminal `usage` chunk when we
ask for them via `stream_options.include_usage`. If the run is cut short
before that chunk arrives, `prompt_tokens` / `output_tokens` stay `None` and
the runner reports tokens/sec as None for that item.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import httpx

from llms.eval.types import Prompt


@dataclass(frozen=True, slots=True)
class CompletionResult:
    text: str
    http_status: int
    ttft_ms: float | None
    latency_ms: float
    prompt_tokens: int | None
    output_tokens: int | None
    raw: dict[str, object]
    error: str | None = None


# Idle gap allowed between SSE chunks before the request is considered dead.
# A loaded local model that hasn't emitted a token in this long is wedged, not
# slow — the runner should move on rather than wait the full wall budget.
_DEFAULT_READ_TIMEOUT_S = 120.0

# Conservative tok/s floor used to size each request's total wall budget. A
# 30B-class model on a single 5090 sustains ~20 tok/s on these prompts; 5 tok/s
# gives us 4x headroom for slower hardware and reasoning-heavy items without
# letting a runaway generation block the suite all night.
_TOK_PER_SEC_FLOOR = 5.0
_MIN_WALL_BUDGET_S = 600.0
_WALL_BUFFER_S = 60.0


class CompletionClient:
    """Thin wrapper over httpx.Client with `complete(prompt)` for one shot."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        model: str | None = None,
        read_timeout: float = _DEFAULT_READ_TIMEOUT_S,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(
                connect=10.0,
                read=read_timeout,
                write=30.0,
                pool=10.0,
            ),
            transport=transport,
        )
        self.model = model

    def __enter__(self) -> CompletionClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self._client.close()

    def close(self) -> None:
        self._client.close()

    def complete(self, prompt: Prompt) -> CompletionResult:
        body: dict[str, object] = {
            "model": self.model or "default",
            "messages": [{"role": "user", "content": prompt.text}],
            "max_tokens": prompt.max_tokens,
            "temperature": prompt.temperature,
            "stream": True,
            # Ask for a terminal usage chunk so we don't have to estimate
            # prompt/completion token counts ourselves.
            "stream_options": {"include_usage": True},
            # Default-off for Qwen3-style chain-of-thought: most adapters size
            # max_tokens for short final answers, not hidden `<think>` reasoning.
            # Adapters that want thinking on (e.g. frontend_agentic agentic
            # items) set Prompt.enable_thinking=True to override.
            "chat_template_kwargs": {
                "enable_thinking": (
                    prompt.enable_thinking if prompt.enable_thinking is not None else False
                )
            },
        }
        if prompt.top_p is not None:
            body["top_p"] = prompt.top_p
        if prompt.top_k is not None:
            body["top_k"] = prompt.top_k
        if prompt.stop:
            body["stop"] = list(prompt.stop)

        wall_budget_s = max(
            _MIN_WALL_BUDGET_S,
            prompt.max_tokens / _TOK_PER_SEC_FLOOR + _WALL_BUFFER_S,
        )
        started = time.perf_counter()
        deadline = started + wall_budget_s

        ttft_ms: float | None = None
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        prompt_tokens: int | None = None
        output_tokens: int | None = None
        http_status = 0
        error: str | None = None

        try:
            with self._client.stream("POST", "/v1/chat/completions", json=body) as response:
                http_status = response.status_code
                if response.status_code != 200:
                    payload_bytes = response.read()
                    latency_ms = (time.perf_counter() - started) * 1000.0
                    return CompletionResult(
                        text="",
                        http_status=response.status_code,
                        ttft_ms=None,
                        latency_ms=latency_ms,
                        prompt_tokens=None,
                        output_tokens=None,
                        raw={},
                        error=f"http {response.status_code}: {payload_bytes[:200]!r}",
                    )
                for raw_line in response.iter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].lstrip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - started) * 1000.0
                    choices = chunk.get("choices") or []
                    if choices and isinstance(choices[0], dict):
                        delta = choices[0].get("delta") or {}
                        content = delta.get("content")
                        if isinstance(content, str):
                            content_parts.append(content)
                        reasoning = delta.get("reasoning_content")
                        if isinstance(reasoning, str):
                            reasoning_parts.append(reasoning)
                    usage = chunk.get("usage")
                    if isinstance(usage, dict):
                        pt = usage.get("prompt_tokens")
                        if isinstance(pt, int):
                            prompt_tokens = pt
                        ct = usage.get("completion_tokens")
                        if isinstance(ct, int):
                            output_tokens = ct
                    if time.perf_counter() > deadline:
                        error = f"wall budget exceeded after {wall_budget_s:.0f}s"
                        break
        except httpx.HTTPError as exc:
            error = str(exc) or type(exc).__name__

        latency_ms = (time.perf_counter() - started) * 1000.0
        # Prefer visible content; fall back to reasoning when the model emitted
        # only a `<think>` trace (e.g. truncated mid-thought) so adapters score
        # the actual tokens produced rather than empty string.
        text = "".join(content_parts) or "".join(reasoning_parts)
        return CompletionResult(
            text=text,
            http_status=http_status if http_status else (200 if text else 0),
            ttft_ms=ttft_ms,
            latency_ms=latency_ms,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            raw={},
            error=error,
        )


__all__ = ["CompletionClient", "CompletionResult"]
