"""Populate bench/reports/ with mock-transport demo runs so the hub renders.

The real `llms eval run` writes here too. This script exists so you can spin
up the SPA without a live llama-server (useful for hub iteration and demos).

Usage (from repo root):

    uv run python scripts/seed_hub.py
    uv run llms eval report

then serve `bench/` with any static file host, e.g.:

    cd bench && python -m http.server 5173

The script wipes prior demo runs (any run id starting with `demo-`) before
re-seeding so the directory does not accumulate junk.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import httpx

from llms.eval.adapters.gsm8k import GSM8KAdapter
from llms.eval.adapters.local_smoke import LocalSmokeAdapter
from llms.eval.adapters.mmlu import MMLUAdapter
from llms.eval.adapters.niah import NIAHAdapter
from llms.eval.report.registry import emit_registry
from llms.eval.runner import run_eval
from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import (
    DecodeOverrides,
    EndpointConfig,
    HardwareConfig,
    HardwareDefaults,
    ProfileConfig,
    ProviderCapabilities,
    ProviderConfig,
)
from llms.serving.config.resolve import resolve_runtime

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "bench" / "reports"
FIXTURES = REPO_ROOT / "tests" / "fixtures"


def _runtime(profile_name: str, alias: str) -> object:
    bundle = ConfigBundle(root=Path("/tmp"))
    bundle.providers["llama.cpp"] = ProviderConfig(
        kind="provider",
        name="llama.cpp",
        repo_url="https://example.com",
        install_dir="/opt/llama.cpp",
        capabilities=ProviderCapabilities(),
    )
    bundle.hardware["rtx-5090"] = HardwareConfig(
        kind="hardware",
        name="rtx-5090",
        gpu_match_patterns=["5090"],
        defaults=HardwareDefaults(context_length=131072),
    )
    bundle.profiles[profile_name] = ProfileConfig(
        kind="profile",
        name=profile_name,
        alias=alias,
        model_path=f"/m/{profile_name}.gguf",
        decode=DecodeOverrides(temperature=0.0, top_p=0.95, top_k=20),
    )
    bundle.endpoints["chat-default"] = EndpointConfig(
        kind="endpoint",
        name="chat-default",
        profile=profile_name,
        provider="llama.cpp",
    )
    return resolve_runtime(bundle, endpoint_name="chat-default", hardware_name="rtx-5090")


def _smoke_transport() -> httpx.BaseTransport:
    """A response that satisfies every keyword rubric in local_smoke v1."""
    canned = (
        "mutable default argument is the bug; use None and check is None.\n"
        "pytest with def test_ verifies; we still call append after copy.\n"
        "wait_for_http_ok using curl --connect-timeout, %{http_code}; return 0; return 1.\n"
        "journalctl, systemctl status, nvidia-smi, CONTEXT_LENGTH, KV cache, Q4 quant, GPU_LAYERS, ngl.\n"
        "Inside the server room, 2 AM, $ systemctl, an unresolved choice.\n"
        "Atlas-17, 42 minutes, 48129, ledger_events.\n"
    )

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": canned}}],
                "usage": {"prompt_tokens": 220, "completion_tokens": 90},
            },
        )

    return httpx.MockTransport(handler)


def _mmlu_transport() -> httpx.BaseTransport:
    """Cycle through A,B,C,D to give a partial accuracy."""
    counter = {"i": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        letter = "ABCD"[counter["i"] % 4]
        counter["i"] += 1
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": letter}}],
                "usage": {"prompt_tokens": 80, "completion_tokens": 1},
            },
        )

    return httpx.MockTransport(handler)


def _gsm8k_transport() -> httpx.BaseTransport:
    """Always answer 14 — 1/4 right against the fixture."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Reasoning omitted.\n#### 14",
                        }
                    }
                ],
                "usage": {"prompt_tokens": 60, "completion_tokens": 5},
            },
        )

    return httpx.MockTransport(handler)


def _niah_transport(needle_lookup: dict[str, str]) -> httpx.BaseTransport:
    """Echo the needle for half the items, gibberish for the rest."""
    counter = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        text = body["messages"][0]["content"]
        idx = counter["i"]
        counter["i"] += 1
        for code, prompt_text in needle_lookup.items():
            if prompt_text == text:
                payload = code if idx % 2 == 0 else "ZZ-99999"
                return httpx.Response(
                    200,
                    json={
                        "choices": [{"message": {"role": "assistant", "content": payload}}],
                        "usage": {"prompt_tokens": 1500, "completion_tokens": 8},
                    },
                )
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "ZZ-99999"}}],
                "usage": {"prompt_tokens": 1500, "completion_tokens": 8},
            },
        )

    return httpx.MockTransport(handler)


def _wipe_prior_demo_runs(output: Path) -> None:
    if not output.exists():
        return
    for run_dir in output.iterdir():
        if run_dir.is_dir() and run_dir.name.startswith("demo-"):
            shutil.rmtree(run_dir)


def _patch_run_id(adapter, label: str):
    """Force the run id to a stable demo prefix so re-runs are idempotent."""
    original = adapter.name
    adapter.name = f"demo-{label}"
    return original


def _restore_name(adapter, original: str) -> None:
    adapter.name = original


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    _wipe_prior_demo_runs(output)

    runs = []

    smoke = LocalSmokeAdapter()
    original = _patch_run_id(smoke, "local-smoke")
    runs.append(
        run_eval(
            adapter=smoke,
            runtime=_runtime("qwen36-27b", "Qwen3.6-27B"),
            endpoint_name="chat-default",
            base_url="http://stub",
            output_root=output,
            transport=_smoke_transport(),
            notes="Demo seed: canned response that passes every keyword rubric.",
        )
    )
    _restore_name(smoke, original)

    mmlu = MMLUAdapter(dataset_path=FIXTURES / "mmlu_mini.jsonl")
    original = _patch_run_id(mmlu, "mmlu")
    runs.append(
        run_eval(
            adapter=mmlu,
            runtime=_runtime("qwen36-27b", "Qwen3.6-27B"),
            endpoint_name="chat-default",
            base_url="http://stub",
            output_root=output,
            transport=_mmlu_transport(),
            notes="Demo seed: cycles A/B/C/D against a 5-item fixture.",
        )
    )
    _restore_name(mmlu, original)

    gsm = GSM8KAdapter(dataset_path=FIXTURES / "gsm8k_mini.jsonl")
    original = _patch_run_id(gsm, "gsm8k")
    runs.append(
        run_eval(
            adapter=gsm,
            runtime=_runtime("qwen36-27b", "Qwen3.6-27B"),
            endpoint_name="chat-default",
            base_url="http://stub",
            output_root=output,
            transport=_gsm8k_transport(),
            notes="Demo seed: always answers 14 (one of four fixtures correct).",
        )
    )
    _restore_name(gsm, original)

    niah = NIAHAdapter(lengths=(50,), depths=(0.0, 0.5, 1.0), seed=11)
    original = _patch_run_id(niah, "niah")
    items = list(niah.load_dataset())
    needle_lookup = {item.expected: niah.render_prompt(item).text for item in items}
    runs.append(
        run_eval(
            adapter=niah,
            runtime=_runtime("qwen36-27b", "Qwen3.6-27B"),
            endpoint_name="chat-default",
            base_url="http://stub",
            output_root=output,
            transport=_niah_transport(needle_lookup),
            notes="Demo seed: alternates correct/incorrect needle recall.",
        )
    )
    _restore_name(niah, original)

    target = emit_registry(output)
    print(f"wrote {len(runs)} demo runs and refreshed {target}")


if __name__ == "__main__":
    main()
