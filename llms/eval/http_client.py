"""OpenAI-compatible HTTP client.

The eval plane is an HTTP consumer of the serving plane — never an importer.
This module wraps `httpx.Client` and exposes one method (`complete`) that
takes a `Prompt` and returns a typed `CompletionResult`.

Returned timing is approximate but useful: TTFT is the time-to-first-byte
header (not the first SSE token, since we use non-streaming POSTs); latency
is total wall time. Token counts come from the response if the server
includes them; otherwise we leave them None and let the runner fall back to
splitting on whitespace.
"""

from __future__ import annotations

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


class CompletionClient:
    """Thin wrapper over httpx.Client with `complete(prompt)` for one shot."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float = 600.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=timeout,
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
            "stream": False,
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

        started = time.perf_counter()
        ttft_ms: float | None = None
        try:
            with self._client.stream("POST", "/v1/chat/completions", json=body) as response:
                ttft_ms = (time.perf_counter() - started) * 1000.0
                payload_bytes = response.read()
                latency_ms = (time.perf_counter() - started) * 1000.0
                if response.status_code != 200:
                    return CompletionResult(
                        text="",
                        http_status=response.status_code,
                        ttft_ms=ttft_ms,
                        latency_ms=latency_ms,
                        prompt_tokens=None,
                        output_tokens=None,
                        raw={},
                        error=f"http {response.status_code}: {payload_bytes[:200]!r}",
                    )
                payload = response.json()
        except httpx.HTTPError as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            return CompletionResult(
                text="",
                http_status=0,
                ttft_ms=ttft_ms,
                latency_ms=latency_ms,
                prompt_tokens=None,
                output_tokens=None,
                raw={},
                error=str(exc),
            )

        text = _extract_text(payload)
        usage = payload.get("usage") or {}
        return CompletionResult(
            text=text,
            http_status=200,
            ttft_ms=ttft_ms,
            latency_ms=latency_ms,
            prompt_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            raw=payload,
        )


def _extract_text(payload: dict[str, object]) -> str:
    """Pull the response text out of an OpenAI chat-completions payload.

    llama-server's chat-template parser splits Qwen3-style `<think>…</think>`
    blocks into `reasoning_content`, leaving `content` empty when the response
    is truncated mid-thought. Fall back to `reasoning_content` so adapters see
    the actual tokens the model produced rather than scoring "" as a wrong
    answer.
    """
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str) and content:
        return content
    reasoning = message.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning:
        return reasoning
    return ""


__all__ = ["CompletionClient", "CompletionResult"]
