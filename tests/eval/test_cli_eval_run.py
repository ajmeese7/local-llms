"""CLI-level integration test for `llms eval run`.

Drives the real Typer app end-to-end against the real config tree, with
`run_eval` patched to inject an `httpx.MockTransport` so no live server is
required. Protects against regressions in argument plumbing, runtime
resolution, and manifest emission that a unit test on `run_eval` alone
cannot catch.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from typer.testing import CliRunner

from llms.cli import app
from llms.eval import runner as runner_module

runner = CliRunner()


def _sse_body(content: str) -> bytes:
    chunks = [
        {"choices": [{"index": 0, "delta": {"content": content}}]},
        {"choices": [], "usage": {"prompt_tokens": 4, "completion_tokens": 1}},
    ]
    return ("".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n").encode()


def _mock_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=_sse_body("B"),
        )

    return httpx.MockTransport(handler)


@pytest.fixture
def _patched_runner(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wrap `run_eval` so every CLI invocation gets the mock transport.

    `llms.cli.eval_run` imports `run_eval` lazily inside the function body, so
    patching the runner module's attribute is enough; the CLI re-resolves on
    each call.
    """
    original = runner_module.run_eval

    def wrapped(**kwargs: object):
        kwargs.setdefault("transport", _mock_transport())
        return original(**kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(runner_module, "run_eval", wrapped)


def test_eval_run_local_smoke_end_to_end(
    tmp_path: Path,
    _patched_runner: None,
) -> None:
    """Drive the full CLI through a real config tree with a stub transport.

    `local_smoke` is bundled in the package, so no HF download is needed and
    the test is hermetic. MMLU/GSM8K go through `datasets.load_dataset` and
    would require an HF cache directory; that's covered by per-adapter tests.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    output = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "eval",
            "run",
            "local_smoke",
            "--endpoint",
            "chat-default",
            "--hardware",
            "rtx-5090",
            "--base-url",
            "http://stub.test/v1",
            "--skip-preflight",
            "--no-telemetry",
            "--output",
            str(output),
            "--config",
            str(repo_root / "config"),
        ],
    )

    assert result.exit_code == 0, (
        f"exit={result.exit_code}\nstdout={result.output!r}\nexc={result.exception!r}"
    )

    run_dirs = [p for p in output.iterdir() if p.is_dir()]
    assert len(run_dirs) == 1, f"expected one run dir, got {run_dirs}"
    manifest_path = run_dirs[0] / "manifest.json"
    assert manifest_path.is_file()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["adapter"]["name"] == "local_smoke"
    assert manifest["endpoint_name"] == "chat-default"
    # Anonymization should be visible end-to-end:
    assert not manifest["model"]["model_path"].startswith("/home/")
    assert len(manifest["hostname"]) == 8  # 8-char digest
