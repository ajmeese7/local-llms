"""End-to-end runner test using httpx.MockTransport — no real HTTP server."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from llms.eval.adapters.local_smoke import LocalSmokeAdapter
from llms.eval.runner import run_eval
from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import (
    EndpointConfig,
    HardwareConfig,
    HardwareDefaults,
    ProfileConfig,
    ProviderCapabilities,
    ProviderConfig,
)
from llms.serving.config.resolve import resolve_runtime
from llms.serving.telemetry.log import TelemetryWriter

# A canned response that matches every keyword rubric in v1 prompts.
_CANNED_RESPONSE = (
    "mutable default argument is the bug; use None and check is None.\n"
    "Use pytest with def test_ to verify; we still call append after copy.\n"
    "wait_for_http_ok using curl --connect-timeout, %{http_code}; return 0; return 1.\n"
    "journalctl, systemctl status, nvidia-smi, CONTEXT_LENGTH, KV cache, Q4 quant, GPU_LAYERS, ngl.\n"
    "Inside the server room, 2 AM, $ systemctl, an unresolved choice.\n"
    "Atlas-17, 42 minutes, 48129, ledger_events.\n"
)


def _stub_runtime():
    bundle = ConfigBundle(root=Path("/tmp"))
    bundle.providers["llama.cpp"] = ProviderConfig(
        kind="provider",
        name="llama.cpp",
        repo_url="https://example.com",
        install_dir="/opt/llama.cpp",
        capabilities=ProviderCapabilities(),
    )
    bundle.hardware["hw"] = HardwareConfig(
        kind="hardware",
        name="hw",
        gpu_match_patterns=["x"],
        defaults=HardwareDefaults(context_length=8192),
    )
    bundle.profiles["p"] = ProfileConfig(
        kind="profile",
        name="p",
        alias="P",
        model_path="/m/p.gguf",
    )
    bundle.endpoints["ep"] = EndpointConfig(
        kind="endpoint", name="ep", profile="p", provider="llama.cpp"
    )
    return resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")


def _sse_body(content: str, *, prompt_tokens: int, completion_tokens: int) -> bytes:
    """Encode a chat-completions response as an OpenAI-style SSE stream."""
    chunks = [
        {"choices": [{"index": 0, "delta": {"content": content}}]},
        {
            "choices": [],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        },
    ]
    lines = [f"data: {json.dumps(c)}\n\n" for c in chunks]
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode("utf-8")


def _mock_transport() -> httpx.BaseTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        body = json.loads(request.content)
        assert body["model"]
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=_sse_body(_CANNED_RESPONSE, prompt_tokens=100, completion_tokens=50),
        )

    return httpx.MockTransport(handler)


def test_runner_end_to_end(tmp_path: Path) -> None:
    runtime = _stub_runtime()
    telemetry = TelemetryWriter(path=tmp_path / "requests.jsonl")
    outcome = run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=runtime,
        endpoint_name="ep",
        base_url="http://stub",
        output_root=tmp_path / "runs",
        transport=_mock_transport(),
        telemetry=telemetry,
    )
    assert outcome.summary.item_count == 5
    assert outcome.manifest_path.is_file()
    assert outcome.results_path.is_file()
    assert outcome.report_html_path.is_file()
    # The canned response satisfies every keyword group.
    assert outcome.summary.correct_count == 5

    # Telemetry log got one row per item.
    rows = (tmp_path / "requests.jsonl").read_text().strip().splitlines()
    assert len(rows) == 5

    # results.jsonl is parseable, one row per item.
    raw_rows = outcome.results_path.read_text().strip().splitlines()
    assert len(raw_rows) == 5
    parsed = [json.loads(r) for r in raw_rows]
    assert all(p["score"]["correct"] for p in parsed)


def test_runner_records_errors_on_http_500(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        # Preflight `GET /v1/models` must succeed or run_eval bails before
        # ever issuing a chat-completions call; we want to observe the 500
        # response path, not the preflight path.
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        return httpx.Response(500, json={"error": "boom"})

    runtime = _stub_runtime()
    outcome = run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=runtime,
        endpoint_name="ep",
        base_url="http://stub",
        output_root=tmp_path / "runs",
        transport=httpx.MockTransport(handler),
        subset="coding_bugfix",
    )
    assert outcome.summary.item_count == 1
    assert outcome.summary.error_count == 1
    rows = [json.loads(r) for r in outcome.results_path.read_text().strip().splitlines()]
    assert rows[0]["http_status"] == 500
    assert rows[0]["error"]


def test_preflight_failure_raises_before_iteration(tmp_path: Path) -> None:
    """`GET /v1/models` returning 5xx means the server can't even tell us what
    it's serving. Bail out before any chat-completions call so a dead backend
    doesn't burn one connect timeout per prompt."""
    from llms.eval.runner import EndpointUnreachableError

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(503, text="service unavailable")
        # Should never be reached.
        raise AssertionError("chat-completions hit despite preflight failure")

    with pytest.raises(EndpointUnreachableError):
        run_eval(
            adapter=LocalSmokeAdapter(),
            runtime=_stub_runtime(),
            endpoint_name="ep",
            base_url="http://stub",
            output_root=tmp_path / "runs",
            transport=httpx.MockTransport(handler),
            subset="coding_bugfix",
        )


def test_consecutive_connectivity_errors_abort_the_run(tmp_path: Path) -> None:
    """A backend that accepts preflight but then drops every chat-completions
    call should abort the run on the first item, not burn through all of them.
    """
    call_log: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        call_log.append(request.url.path)
        # Simulate the network-class failure the user actually hit: server
        # crashed and the socket times out / refuses. httpx will raise; the
        # client catches and returns http_status=0 with the error.
        raise httpx.ConnectError("Connection refused")

    outcome = run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_stub_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=tmp_path / "runs",
        transport=httpx.MockTransport(handler),
        max_consecutive_errors=1,
    )
    assert outcome.aborted_reason is not None
    assert "connectivity" in outcome.aborted_reason
    # Exactly one chat-completions attempt before aborting (the local_smoke
    # full suite has 5 items; we should not have called the rest).
    assert len(call_log) == 1


def test_read_timeout_does_not_abort_the_run(tmp_path: Path) -> None:
    """A ReadTimeout means the backend accepted the connection but stalled
    (slow prefill on a long prompt, wedged generation). That's a per-item
    failure, not a dead-backend signal, so the suite should keep going.
    """
    call_log: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        call_log.append(request.url.path)
        raise httpx.ReadTimeout("timed out")

    outcome = run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_stub_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=tmp_path / "runs",
        transport=httpx.MockTransport(handler),
        max_consecutive_errors=1,
    )
    # No connectivity-class abort — the run completed all items.
    assert outcome.aborted_reason is None
    assert len(call_log) == 5
    # Each item recorded the timeout error.
    rows = [json.loads(r) for r in outcome.results_path.read_text().strip().splitlines()]
    assert len(rows) == 5
    assert all(r["error"] for r in rows)


def test_runner_records_timing(tmp_path: Path) -> None:
    """Wall-clock and compute-clock timing land in summary.json."""
    outcome = run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_stub_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=tmp_path / "runs",
        transport=_mock_transport(),
        subset="coding_bugfix",
    )
    timing = outcome.summary.timing
    assert timing is not None
    assert timing.wall_seconds >= 0
    assert timing.compute_seconds >= 0
    # ISO-8601 stamps round-trip through summary.json.
    payload = json.loads(outcome.summary_path.read_text())
    assert payload["timing"]["started_at"]
    assert payload["timing"]["finished_at"]
    assert "wall_seconds" in payload["timing"]


def test_runner_writes_comparable_keys(tmp_path: Path) -> None:
    runtime = _stub_runtime()
    args = {
        "adapter": LocalSmokeAdapter(),
        "runtime": runtime,
        "endpoint_name": "ep",
        "base_url": "http://stub",
        "transport": _mock_transport(),
        "subset": "coding_bugfix",
    }
    a = run_eval(**args, output_root=tmp_path / "runs-a")
    b = run_eval(**args, output_root=tmp_path / "runs-b")
    assert a.manifest.comparability_key == b.manifest.comparability_key
    assert a.manifest.run_id != b.manifest.run_id
