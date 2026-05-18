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
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": []})
        sse = (
            'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n'
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse.encode("utf-8"),
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
    """A single full run produces one cell with one full run, no partials."""
    output = tmp_path / "reports"
    run_eval(
        adapter=LocalSmokeAdapter(),
        runtime=_runtime(),
        endpoint_name="ep",
        base_url="http://stub",
        output_root=output,
        transport=_ok_transport(),
    )
    registry = build_registry(output)
    assert registry["version"] >= 5
    benches = registry["benches"]
    assert len(benches) == 1
    bench = benches[0]
    assert bench["model_profile"] == "p"
    assert bench["hardware_profile"] == "hw"
    assert bench["cell_count"] == 1
    assert bench["run_count"] == 1
    assert bench["partial_run_count"] == 0
    cell = bench["cells"][0]
    assert cell["adapter"]["name"] == "local_smoke"
    assert cell["run_count"] == 1
    assert cell["partial_run_count"] == 0
    assert cell["partial_only"] is False
    assert cell["history_ids"] == [registry["reports"][0]["id"]]
    assert cell["comparability_key"] == registry["reports"][0]["comparability_key"]


def test_subset_rerun_attaches_to_full_run_cell(tmp_path: Path) -> None:
    """A subset re-run lands in `partial_runs` of the full-run cell rather
    than spawning a new capability."""
    output = tmp_path / "reports"
    args = {
        "adapter": LocalSmokeAdapter(),
        "runtime": _runtime(),
        "endpoint_name": "ep",
        "base_url": "http://stub",
        "output_root": output,
        "transport": _ok_transport(),
    }
    full = run_eval(**args)
    partial = run_eval(**args, subset="coding_bugfix")

    registry = build_registry(output)
    benches = registry["benches"]
    assert len(benches) == 1
    bench = benches[0]
    assert bench["cell_count"] == 1
    assert bench["run_count"] == 1
    assert bench["partial_run_count"] == 1
    cell = bench["cells"][0]
    assert cell["run_count"] == 1
    assert cell["history_ids"] == [full.manifest.run_id]
    assert cell["partial_run_count"] == 1
    assert len(cell["partial_runs"]) == 1
    p = cell["partial_runs"][0]
    assert p["id"] == partial.manifest.run_id
    assert p["subset"] == "coding_bugfix"
    assert isinstance(p["item_count"], int)
    # Parent key matches across full and subset; full key differs.
    assert full.manifest.comparability_key != partial.manifest.comparability_key


def test_subset_only_history_renders_as_partial_cell(tmp_path: Path) -> None:
    """If the only runs against a model are subset re-runs, they still show
    up — as a cell flagged `partial_only` so the UI can tag it."""
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
    assert cell["partial_only"] is True
    assert cell["run_count"] == 0
    assert cell["partial_run_count"] == 1
    assert bench["run_count"] == 0
    assert bench["partial_run_count"] == 1


def test_bench_cell_history_accumulates_across_reruns(tmp_path: Path) -> None:
    """Two full runs of the same adapter against the same model land in one
    cell, newest first, with both ids preserved."""
    output = tmp_path / "reports"
    args = {
        "adapter": LocalSmokeAdapter(),
        "runtime": _runtime(),
        "endpoint_name": "ep",
        "base_url": "http://stub",
        "output_root": output,
        "transport": _ok_transport(),
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
        # Minimal summary.json — registry now skips zombie runs (no summary
        # or item_count=0), so a sort test needs at least one scored item.
        (run_dir / "summary.json").write_text(json.dumps({"item_count": 1}))
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


def _write_minimal_run(
    output: Path,
    *,
    run_id: str,
    timestamp: str,
    engine: str,
    comparability_key: str,
) -> None:
    """Drop a manifest+summary pair into `output/<run_id>/` so build_registry
    sees it. Used by tests that need to control hardware/server fingerprints
    without booting the runner."""
    run_dir = output / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "summary.json").write_text(json.dumps({"item_count": 1}))
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "endpoint_name": "ep",
                "model": {"profile": "p", "alias": "P", "model_path": "/m/p.gguf"},
                "provider": {"name": engine, "server_binary": "/opt/x/llama-server", "git_commit": None, "cmake_args": []},
                "decode": {"max_tokens": 8},
                "dataset": {"name": "mmlu", "version": "v1", "subset": None, "item_count": 1},
                "adapter": {
                    "name": "mmlu", "version": "v1", "track": "general_capability",
                    "prompt_template_version": "v1", "scorer_version": "v1",
                },
                "hardware": {"profile": "hw", "gpu_name": "RTX 5090"},
                "server": {"engine": engine, "git_commit": None, "version": None},
                "seed": 0, "repo_sha": None, "hostname": "x",
                "timestamp": timestamp,
                "comparability_key": comparability_key,
            }
        )
    )


def test_same_model_different_engines_split_into_two_benches(tmp_path: Path) -> None:
    """Two runs of the same adapter against the same model on the same GPU
    but different inference backends produce two separate benches."""
    output = tmp_path / "reports"
    _write_minimal_run(output, run_id="a", timestamp="2026-05-18T02:00:00Z", engine="llama.cpp", comparability_key="a" * 64)
    _write_minimal_run(output, run_id="b", timestamp="2026-05-18T03:00:00Z", engine="ik_llama.cpp", comparability_key="b" * 64)

    benches = build_registry(output)["benches"]
    assert len(benches) == 2
    engines = sorted(b["server_engine"] for b in benches)
    assert engines == ["ik_llama.cpp", "llama.cpp"]
    # Each bench owns exactly the run it came from.
    by_engine = {b["server_engine"]: b for b in benches}
    assert by_engine["llama.cpp"]["cells"][0]["history_ids"] == ["a"]
    assert by_engine["ik_llama.cpp"]["cells"][0]["history_ids"] == ["b"]
    # Title is the model alias only; engine surfaces alongside (eyebrow on
    # home cards, stat ribbon on the detail page), not baked into the title.
    assert by_engine["llama.cpp"]["title"] == "P"
    assert by_engine["ik_llama.cpp"]["title"] == "P"
    # Bench ids are derived from (hw, model, engine), so they differ.
    assert by_engine["llama.cpp"]["id"] != by_engine["ik_llama.cpp"]["id"]
