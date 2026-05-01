"""Glue: detect GPU → match hardware → look up active endpoint → resolve.

Kept apart from `exec.py` so the resolution path is unit-testable without
calling `os.execvp`.
"""

from __future__ import annotations

from dataclasses import dataclass

from llms.serving.config.errors import ConfigReferenceError
from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import HardwareConfig, RuntimeConfig
from llms.serving.config.resolve import resolve_runtime
from llms.serving.launcher.gpu import GPUInfo


@dataclass(frozen=True, slots=True)
class ActiveResolution:
    """A resolved view ready for preflight + exec."""

    gpu: GPUInfo
    hardware: HardwareConfig
    endpoint_name: str
    runtime: RuntimeConfig
    fallback_used: bool  # true when we used hardware.default_endpoint instead of stored state


def match_hardware(bundle: ConfigBundle, gpu_name: str) -> HardwareConfig:
    for hw in bundle.hardware.values():
        if hw.matches_gpu(gpu_name):
            return hw
    raise ConfigReferenceError("GPU detection", "hardware", gpu_name)


def resolve_for_gpu(
    bundle: ConfigBundle,
    gpu: GPUInfo,
    *,
    active_endpoint_per_hardware: dict[str, str],
) -> ActiveResolution:
    """Pick the right hardware for `gpu`, look up its active endpoint, resolve."""
    hardware = match_hardware(bundle, gpu.name)
    stored = active_endpoint_per_hardware.get(hardware.name)
    if stored is not None:
        endpoint_name = stored
        fallback = False
    elif hardware.default_endpoint is not None:
        endpoint_name = hardware.default_endpoint
        fallback = True
    else:
        raise ConfigReferenceError(
            f"hardware '{hardware.name}'", "active or default endpoint", "<none>"
        )

    runtime = resolve_runtime(bundle, endpoint_name=endpoint_name, hardware_name=hardware.name)
    return ActiveResolution(
        gpu=gpu,
        hardware=hardware,
        endpoint_name=endpoint_name,
        runtime=runtime,
        fallback_used=fallback,
    )


__all__ = ["ActiveResolution", "match_hardware", "resolve_for_gpu"]
