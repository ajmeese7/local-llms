"""Launcher entry: detect → resolve → preflight → exec llama-server.

Designed to be called by systemd. The systemd unit installs as:
    ExecStart=<path-to-llms> launcher exec
and this function replaces the current process via execvp on success.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from llms.serving.config.loader import load_bundle
from llms.serving.launcher.gpu import GPUDetectionError, detect_gpu
from llms.serving.launcher.preflight import Problem, check_runtime
from llms.serving.launcher.render import render_argv
from llms.serving.launcher.resolve_active import resolve_for_gpu
from llms.serving.state.store import StateStore

log = logging.getLogger("llms.launcher")


class LauncherError(RuntimeError):
    """Anything that prevented us from reaching execvp."""


def prepare(
    *,
    config_root: Path,
    state_path: Path | None = None,
    gpu_override: str | None = None,
) -> tuple[list[str], list[Problem]]:
    """Pure-python equivalent of the launcher: resolve and render argv.

    Returns `(argv, problems)`. Callers should inspect `problems` and decide
    whether to abort. `exec_launcher` does that and only execvp's if there are
    no error-severity problems.
    """
    bundle = load_bundle(config_root)
    if not bundle.hardware:
        raise LauncherError(f"no hardware configs found under {config_root}")

    try:
        gpu = detect_gpu(override=gpu_override)
    except GPUDetectionError as exc:
        raise LauncherError(str(exc)) from exc

    store = StateStore(path=state_path)
    resolution = resolve_for_gpu(
        bundle, gpu, active_endpoint_per_hardware=store.all_active_endpoints()
    )
    argv = render_argv(resolution.runtime)
    problems = check_runtime(resolution.runtime)

    log.info(
        "launcher resolved: gpu=%s hardware=%s endpoint=%s fallback=%s",
        gpu.name,
        resolution.hardware.name,
        resolution.endpoint_name,
        resolution.fallback_used,
    )
    return argv, problems


def exec_launcher(
    *,
    config_root: Path,
    state_path: Path | None = None,
    gpu_override: str | None = None,
) -> None:
    """Resolve, preflight, then replace the process. Never returns on success."""
    argv, problems = prepare(
        config_root=config_root, state_path=state_path, gpu_override=gpu_override
    )
    blockers = [p for p in problems if p.severity == "error"]
    if blockers:
        for p in problems:
            sys.stderr.write(f"[{p.severity}] {p.field}: {p.detail}\n")
        raise LauncherError(f"{len(blockers)} preflight error(s); refusing to exec")

    binary = argv[0]
    log.info("execvp: %s", binary)
    os.execvp(binary, argv)


__all__ = ["LauncherError", "exec_launcher", "prepare"]
