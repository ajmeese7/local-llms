"""Hub registry generator.

Walks `bench/reports/<id>/{manifest.json, summary.json}` and emits one
flat `reports.json` the SPA loads up front. Per-run heavy data
(`results.jsonl`) is fetched lazily by the hub when a row is opened.
Also emits `profiles.json`, a snapshot of the config tree the SPA
guide reads to render real model cards.

The registry's `benches` block groups runs by `(hardware_profile,
model_profile)` — one bench per GPU+model pair on this host.
Inside a bench, runs are bucketed into `cells` keyed by
`comparability_key` (one cell = one capability against this model);
each cell keeps history (newest first) so re-runs are not lost.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from llms.serving.config.loader import load_bundle

REGISTRY_VERSION = 4


def build_registry(output_root: Path) -> dict[str, Any]:
    """Return the registry dict. Pure: callers can inspect or write themselves."""
    reports: list[dict[str, Any]] = []
    if output_root.exists():
        for run_dir in sorted(output_root.iterdir()):
            entry = _entry_for(run_dir)
            if entry is not None:
                reports.append(entry)

    reports.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return {
        "version": REGISTRY_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "reports": reports,
        "benches": _build_benches(reports),
    }


def _build_benches(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group reports into benches keyed by (hardware_profile, model_profile).

    A bench is one (GPU, model) pair on this host. Inside a bench, runs are
    bucketed into cells keyed by `comparability_key`; each cell keeps the
    full history (newest first), so re-running the same capability against
    the same model preserves the older results for trend-spotting.
    """
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for report in reports:
        hw_profile = _hw_profile_of(report) or "unknown"
        model_profile = report.get("profile") or report.get("alias") or "unknown"
        grouped.setdefault((hw_profile, model_profile), []).append(report)

    benches: list[dict[str, Any]] = []
    for (hw_profile, model_profile), members in grouped.items():
        members.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        head = members[0]
        cells = _build_cells(members)
        suite_seconds = _sum_or_none(c.get("wall_seconds") for c in cells)
        benches.append(
            {
                "id": _bench_id(hw_profile, model_profile),
                "hardware_profile": hw_profile,
                "model_profile": model_profile,
                "model_alias": head.get("alias") or model_profile,
                "title": _bench_title(head, hw_profile, model_profile),
                "latest_timestamp": head.get("timestamp"),
                "hardware": head.get("hardware"),
                "server": head.get("server"),
                "cell_count": len(cells),
                "run_count": len(members),
                "suite_seconds": suite_seconds,
                "cells": cells,
            }
        )
    benches.sort(key=lambda b: b.get("latest_timestamp") or "", reverse=True)
    return benches


def _sum_or_none(values: Any) -> float | None:
    """Sum non-None numerics; return None if every value is missing."""
    total = 0.0
    seen = False
    for v in values:
        if isinstance(v, int | float):
            total += float(v)
            seen = True
    return total if seen else None


def _build_cells(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One cell per comparability_key inside a bench."""
    by_key: dict[str, list[dict[str, Any]]] = {}
    for r in members:
        key = r.get("comparability_key")
        if not key:
            continue
        by_key.setdefault(key, []).append(r)

    cells: list[dict[str, Any]] = []
    for key, runs in by_key.items():
        runs.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        latest = runs[0]
        latest_timing = latest.get("timing") if isinstance(latest.get("timing"), dict) else None
        cells.append(
            {
                "comparability_key": key,
                "comparability_prefix": key[:8],
                "adapter": latest.get("adapter") or {},
                "latest": latest,
                "history_ids": [r["id"] for r in runs],  # newest first; includes latest
                "run_count": len(runs),
                "wall_seconds": (latest_timing or {}).get("wall_seconds"),
                "compute_seconds": (latest_timing or {}).get("compute_seconds"),
            }
        )
    # Newest cell first, but stable on adapter name as tiebreaker.
    cells.sort(
        key=lambda c: (
            c["latest"].get("timestamp") or "",
            (c["adapter"].get("name") or ""),
        ),
        reverse=True,
    )
    return cells


def _bench_id(hw_profile: str, model_profile: str) -> str:
    """Stable 16-char id for a bench. Uses sha256 so renames produce a
    fresh id (acceptable: a renamed hardware profile is a different bench)."""
    return hashlib.sha256(f"{hw_profile}::{model_profile}".encode()).hexdigest()[:16]


def _hw_profile_of(report: dict[str, Any]) -> str | None:
    hw = report.get("hardware")
    if isinstance(hw, dict):
        profile = hw.get("profile")
        if isinstance(profile, str) and profile:
            return profile
    return None


def _bench_title(head: dict[str, Any], hw_profile: str, model_profile: str) -> str:
    """'<model_alias> on <gpu_short>' when both are known; else fall back."""
    alias = head.get("alias") or model_profile
    hw = head.get("hardware") if isinstance(head.get("hardware"), dict) else None
    gpu = (hw or {}).get("gpu_name") or hw_profile
    if not gpu or gpu == "unknown":
        return alias
    short = gpu.replace("NVIDIA ", "").replace("GeForce ", "")
    return f"{alias} on {short}"


def emit_registry(output_root: Path) -> Path:
    """Write the registry to `output_root/reports.json`. Returns its path."""
    registry = build_registry(output_root)
    target = output_root / "reports.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
    return target


def build_profiles_snapshot(config_root: Path) -> dict[str, Any]:
    """Snapshot the config bundle as JSON the SPA guide can render.

    The guide wants enough fingerprint to render a per-profile card without
    the SPA having to parse YAML. We expose only public-friendly fields:
    no API keys, no install dirs.
    """
    if not config_root.exists():
        return {"version": REGISTRY_VERSION, "profiles": [], "providers": [], "hardware": []}
    bundle = load_bundle(config_root)
    profiles = []
    for profile in sorted(bundle.profiles.values(), key=lambda p: p.name):
        compat = profile.provider_compat
        decode = profile.decode
        profiles.append(
            {
                "name": profile.name,
                "alias": profile.alias,
                "model_path": profile.model_path,
                "model_filename": profile.model_path.split("/")[-1] if profile.model_path else "",
                "hf_repo": profile.hf_repo,
                "hf_file": profile.hf_file,
                "context_length": profile.context_length,
                "parallel_slots": profile.parallel_slots,
                "cache_type_k": profile.cache_type_k,
                "cache_type_v": profile.cache_type_v,
                "kv_unified": profile.kv_unified,
                "jinja": profile.jinja,
                "has_mmproj": bool(profile.mmproj_path),
                "decode": {
                    "temperature": decode.temperature,
                    "top_p": decode.top_p,
                    "top_k": decode.top_k,
                    "min_p": decode.min_p,
                    "presence_penalty": decode.presence_penalty,
                    "repeat_penalty": decode.repeat_penalty,
                },
                "provider_compat": {
                    "proven": list(compat.proven),
                    "blocked": list(compat.blocked),
                    "notes": compat.notes,
                },
            }
        )
    providers = []
    for provider in sorted(bundle.providers.values(), key=lambda p: p.name):
        caps = provider.capabilities
        providers.append(
            {
                "name": provider.name,
                "aliases": list(provider.aliases),
                "repo_url": provider.repo_url,
                "capabilities": {
                    "jinja": caps.jinja,
                    "mmproj": caps.mmproj,
                    "kv_unified": caps.kv_unified,
                    "spec_default": caps.spec_default,
                    "ngram_mod": caps.ngram_mod,
                },
            }
        )
    hardware = []
    for hw in sorted(bundle.hardware.values(), key=lambda h: h.name):
        d = hw.defaults
        hardware.append(
            {
                "name": hw.name,
                "description": hw.description,
                "default_endpoint": hw.default_endpoint,
                "supported_endpoints": list(hw.supported_endpoints),
                "default_provider": hw.default_provider,
                "defaults": {
                    "host": d.host,
                    "port": d.port,
                    "gpu_layers": d.gpu_layers,
                    "context_length": d.context_length,
                    "parallel_slots": d.parallel_slots,
                    "flash_attention": d.flash_attention,
                    "cache_type_k": d.cache_type_k,
                    "cache_type_v": d.cache_type_v,
                },
            }
        )
    return {
        "version": REGISTRY_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "profiles": profiles,
        "providers": providers,
        "hardware": hardware,
    }


def emit_profiles_snapshot(output_root: Path, config_root: Path) -> Path:
    """Write the profiles snapshot to `output_root/profiles.json`."""
    snapshot = build_profiles_snapshot(config_root)
    target = output_root / "profiles.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    return target


def _entry_for(run_dir: Path) -> dict[str, Any] | None:
    if not run_dir.is_dir():
        return None
    manifest_path = run_dir / "manifest.json"
    summary_path = run_dir / "summary.json"
    if not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    summary: dict[str, Any] = {}
    if summary_path.is_file():
        try:
            summary = json.loads(summary_path.read_text())
        except (OSError, json.JSONDecodeError):
            summary = {}

    adapter = manifest.get("adapter", {})
    model = manifest.get("model", {})
    provider = manifest.get("provider", {})
    accuracy = _normalize_ci(summary.get("accuracy"))
    partial = _normalize_ci(summary.get("partial"))
    hardware = manifest.get("hardware") if isinstance(manifest.get("hardware"), dict) else None
    server = manifest.get("server") if isinstance(manifest.get("server"), dict) else None
    timing = summary.get("timing") if isinstance(summary.get("timing"), dict) else None
    return {
        "id": run_dir.name,
        "timestamp": manifest.get("timestamp"),
        "endpoint": manifest.get("endpoint_name"),
        "profile": model.get("profile"),
        "alias": model.get("alias"),
        "provider": provider.get("name"),
        "adapter": {
            "name": adapter.get("name"),
            "version": adapter.get("version"),
            "track": adapter.get("track"),
            "prompt_template_version": adapter.get("prompt_template_version"),
        },
        "comparability_key": manifest.get("comparability_key"),
        "comparability_prefix": (manifest.get("comparability_key") or "")[:8],
        "item_count": summary.get("item_count"),
        "correct_count": summary.get("correct_count"),
        "parse_failure_count": summary.get("parse_failure_count"),
        "error_count": summary.get("error_count"),
        "accuracy": accuracy,
        "partial": partial,
        "median_latency_ms": summary.get("median_latency_ms"),
        "median_ttft_ms": summary.get("median_ttft_ms"),
        "median_tokens_per_sec": summary.get("median_tokens_per_sec"),
        "timing": timing,
        "notes": manifest.get("notes") or "",
        "hardware": hardware,
        "server": server,
    }


def _normalize_ci(value: Any) -> dict[str, Any] | None:
    """summary.json stores CIs as nested dicts; flatten and tolerate nulls."""
    if not isinstance(value, dict):
        return None
    point = value.get("point")
    if point is None:
        return None
    return {
        "point": point,
        "lo": value.get("lo"),
        "hi": value.get("hi"),
        "method": value.get("method"),
    }


__all__ = [
    "REGISTRY_VERSION",
    "build_profiles_snapshot",
    "build_registry",
    "emit_profiles_snapshot",
    "emit_registry",
]
