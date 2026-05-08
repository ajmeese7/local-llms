"""Hub registry generator: real-shape data via the runner, then check the JSON."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from llms.eval.adapters.local_smoke import LocalSmokeAdapter
from llms.eval.report.registry import REGISTRY_VERSION, build_registry, emit_registry
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


def _runtime():
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
        kind="profile", name="p", alias="P", model_path="/m/p.gguf"
    )
    bundle.endpoints["ep"] = EndpointConfig(
        kind="endpoint", name="ep", profile="p", provider="llama.cpp"
    )
    return resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")


def _ok_transport() -> httpx.BaseTransport:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    return httpx.MockTransport(handler)


def test_empty_root_yields_empty_registry(tmp_path: Path) -> None:
    registry = build_registry(tmp_path)
    assert registry["version"] == REGISTRY_VERSION
    assert registry["reports"] == []


def test_emit_registry_writes_file(tmp_path: Path) -> None:
    target = emit_registry(tmp_path)
    assert target == tmp_path / "reports.json"
    assert target.is_file()
    payload = json.loads(target.read_text())
    assert payload["version"] == REGISTRY_VERSION


def test_real_run_appears_in_registry(tmp_path: Path) -> None:
    output = tmp_path / "reports"
    run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=output,
        transport=_ok_transport(),
        subset="coding_bugfix",
    )
    registry = build_registry(output)
    assert len(registry["reports"]) == 1
    entry = registry["reports"][0]
    assert entry["adapter"]["name"] == "local_smoke"
    assert entry["endpoint"] == "ep"
    assert entry["item_count"] == 1
    assert entry["comparability_prefix"]
    assert entry["accuracy"] is None or "point" in entry["accuracy"]


def test_registry_skips_runs_without_manifest(tmp_path: Path) -> None:
    output = tmp_path / "reports"
    junk = output / "not-a-real-run"
    junk.mkdir(parents=True)
    (junk / "results.jsonl").write_text("")
    registry = build_registry(output)
    assert registry["reports"] == []


def test_registry_surfaces_timing_per_cell_and_suite(tmp_path: Path) -> None:
    """A real run populates wall_seconds on the cell and suite_seconds on the bench."""
    output = tmp_path / "reports"
    run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=output,
        transport=_ok_transport(),
        subset="coding_bugfix",
    )
    registry = build_registry(output)
    bench = registry["benches"][0]
    cell = bench["cells"][0]
    assert isinstance(cell["wall_seconds"], int | float)
    assert cell["wall_seconds"] >= 0
    assert isinstance(bench["suite_seconds"], int | float)
    assert bench["suite_seconds"] == cell["wall_seconds"]
    # Per-run entry mirrors the timing block.
    entry = registry["reports"][0]
    assert entry["timing"] is not None
    assert "wall_seconds" in entry["timing"]


def test_registry_groups_into_benches(tmp_path: Path) -> None:
    output = tmp_path / "reports"
    run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=output,
        transport=_ok_transport(),
        subset="coding_bugfix",
    )
    registry = build_registry(output)
    assert registry["version"] >= 4
    benches = registry["benches"]
    assert len(benches) == 1
    bench = benches[0]
    assert bench["model_profile"] == "p"
    assert bench["hardware_profile"] == "hw"
    assert bench["cell_count"] == 1
    assert bench["run_count"] == 1
    cell = bench["cells"][0]
    assert cell["adapter"]["name"] == "local_smoke"
    assert cell["run_count"] == 1
    assert cell["history_ids"] == [registry["reports"][0]["id"]]
    assert cell["comparability_key"] == registry["reports"][0]["comparability_key"]


def test_bench_cell_history_accumulates_across_reruns(tmp_path: Path) -> None:
    """Two runs of the same adapter against the same model land in one cell,
    newest first, with both ids preserved."""
    output = tmp_path / "reports"
    args = {
        "adapter": LocalSmokeAdapter(),
        "runtime": _runtime(),
        "endpoint_name": "ep",
        "base_url": "http://stub",
        "output_root": output,
        "transport": _ok_transport(),
        "subset": "coding_bugfix",
    }
    a = run_eval(**args)
    b = run_eval(**args)
    registry = build_registry(output)
    benches = registry["benches"]
    assert len(benches) == 1
    cell = benches[0]["cells"][0]
    assert cell["run_count"] == 2
    assert set(cell["history_ids"]) == {a.manifest.run_id, b.manifest.run_id}
    # The latest is whichever got the later timestamp; both share the key.
    assert cell["latest"]["id"] in cell["history_ids"]
    assert cell["comparability_key"] == a.manifest.comparability_key


def test_registry_sorted_newest_first(tmp_path: Path) -> None:
    output = tmp_path / "reports"
    output.mkdir()
    for stamp, run in (("2025-01-01T00:00:00Z", "old"), ("2026-05-01T00:00:00Z", "new")):
        run_dir = output / run
        run_dir.mkdir()
        (run_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "run_id": run,
                    "endpoint_name": "ep",
                    "model": {
                        "profile": "p",
                        "alias": "P",
                        "model_path": "/m/p.gguf",
                        "model_sha256": None,
                        "hf_repo": None,
                        "hf_file": None,
                    },
                    "provider": {
                        "name": "llama.cpp",
                        "server_binary": "/opt/llama.cpp/build/bin/llama-server",
                        "git_commit": None,
                        "cmake_args": [],
                    },
                    "decode": {
                        "temperature": None,
                        "top_p": None,
                        "top_k": None,
                        "min_p": None,
                        "presence_penalty": None,
                        "repeat_penalty": None,
                        "max_tokens": 8,
                    },
                    "dataset": {
                        "name": "mmlu",
                        "version": "v1",
                        "subset": None,
                        "item_count": 1,
                    },
                    "adapter": {
                        "name": "mmlu",
                        "version": "v1",
                        "track": "general_capability",
                        "prompt_template_version": "v1",
                        "scorer_version": "v1",
                    },
                    "seed": 0,
                    "repo_sha": None,
                    "hostname": "x",
                    "timestamp": stamp,
                    "comparability_key": "0" * 64,
                }
            )
        )
    registry = build_registry(output)
    assert [r["id"] for r in registry["reports"]] == ["new", "old"]
