"""Lint pass: load the bundle, then run cross-reference checks for every
endpoint x hardware pair the bundle declares as legal.

This is what `llms config lint` calls. Returns a flat list of human-readable
problem strings; an empty list means the tree is clean.
"""

from __future__ import annotations

from pathlib import Path

from llms.serving.config.errors import ConfigError
from llms.serving.config.loader import ConfigBundle, load_bundle
from llms.serving.config.resolve import resolve_runtime


def lint(root: Path) -> tuple[ConfigBundle, list[str]]:
    """Load `root`, resolve every (hardware, supported_endpoint) pair, return errors."""
    problems: list[str] = []
    try:
        bundle = load_bundle(root)
    except ConfigError as exc:
        return ConfigBundle(root=root), [str(exc)]

    if not bundle.hardware:
        problems.append(f"no hardware configs found under {root / 'hardware'}")
    if not bundle.providers:
        problems.append(f"no provider configs found under {root / 'providers'}")
    if not bundle.profiles:
        problems.append(f"no profile configs found under {root / 'profiles'}")
    if not bundle.endpoints:
        problems.append(f"no endpoint configs found under {root / 'endpoints'}")

    for hw_name, hw in bundle.hardware.items():
        endpoints = hw.supported_endpoints or list(bundle.endpoints)
        for ep_name in endpoints:
            try:
                resolve_runtime(bundle, endpoint_name=ep_name, hardware_name=hw_name)
            except ConfigError as exc:
                problems.append(f"[{hw_name} → {ep_name}] {exc}")

    return bundle, problems


__all__ = ["lint"]
