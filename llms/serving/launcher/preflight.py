"""Preflight checks before exec'ing llama-server.

Mirrors the safety net in `llama-launcher.sh:147-177`. Each check returns a
structured `Problem`; the caller decides whether to abort or continue.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from llms.serving.config.models import RuntimeConfig


@dataclass(frozen=True, slots=True)
class Problem:
    """One human-readable preflight failure."""

    severity: str  # "error" | "warning"
    field: str
    detail: str


def _check_file(path: str | None, *, label: str) -> Problem | None:
    if path is None:
        return None
    p = Path(path)
    if not p.exists():
        return Problem(severity="error", field=label, detail=f"file not found: {p}")
    if not p.is_file():
        return Problem(severity="error", field=label, detail=f"path is not a file: {p}")
    if p.stat().st_size == 0:
        return Problem(severity="error", field=label, detail=f"file is empty: {p}")
    return None


def check_runtime(rt: RuntimeConfig) -> list[Problem]:
    """Run every preflight that can be checked from disk + config."""
    problems: list[Problem] = []

    if (probe := _check_file(rt.profile.model_path, label="profile.model_path")) is not None:
        problems.append(probe)
    if (probe := _check_file(rt.profile.mmproj_path, label="profile.mmproj_path")) is not None:
        problems.append(probe)

    server = Path(rt.provider.server_binary_path)
    if not server.exists():
        problems.append(
            Problem(
                severity="error",
                field="provider.server_binary_path",
                detail=f"binary not found: {server}",
            )
        )
    elif not os.access(server, os.X_OK):
        problems.append(
            Problem(
                severity="error",
                field="provider.server_binary_path",
                detail=f"binary not executable: {server}",
            )
        )

    if rt.context_length < 512:
        problems.append(
            Problem(
                severity="error",
                field="context_length",
                detail=f"context_length {rt.context_length} below 512 floor",
            )
        )

    if rt.parallel_slots < 1:
        problems.append(
            Problem(
                severity="error",
                field="parallel_slots",
                detail=f"parallel_slots must be >= 1, got {rt.parallel_slots}",
            )
        )

    return problems


__all__ = ["Problem", "check_runtime"]
