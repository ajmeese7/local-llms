"""Hub registry generator.

Walks `bench/reports/<id>/{manifest.json, summary.json}` and emits one
flat `reports.json` the SPA loads up front. Per-run heavy data
(`results.jsonl`) is fetched lazily by the hub when a row is opened.
Also emits `profiles.json`, a snapshot of the config tree the SPA
guide reads to render real model cards.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from llms.serving.config.loader import load_bundle

REGISTRY_VERSION = 2


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
    }


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
        "notes": manifest.get("notes") or "",
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
