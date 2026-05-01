"""GPU detection. Mirrors `llama-launcher.sh:78-89`.

WSL ships `nvidia-smi` at a non-standard path. We try that location first,
fall back to PATH, and finally let the user override via `LLMS_NVIDIA_SMI`
or `--gpu-name` on the launcher CLI.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

WSL_NVIDIA_SMI = "/usr/lib/wsl/lib/nvidia-smi"


class GPUDetectionError(RuntimeError):
    """No GPU could be detected. The user must supply --gpu-name."""


@dataclass(frozen=True, slots=True)
class GPUInfo:
    name: str
    detected_via: str  # "env" | "wsl-path" | "PATH" | "override"


def _which_nvidia_smi() -> str | None:
    override = os.environ.get("LLMS_NVIDIA_SMI")
    if override and os.access(override, os.X_OK):
        return override
    if os.access(WSL_NVIDIA_SMI, os.X_OK):
        return WSL_NVIDIA_SMI
    return shutil.which("nvidia-smi")


def detect_gpu(*, override: str | None = None) -> GPUInfo:
    """Return the first GPU's display name. Raises if none detected."""
    if override:
        return GPUInfo(name=override.strip(), detected_via="override")

    binary = _which_nvidia_smi()
    if binary is None:
        raise GPUDetectionError(
            "nvidia-smi not found. Set LLMS_NVIDIA_SMI=/path/to/nvidia-smi or "
            "pass --gpu-name to override detection."
        )

    try:
        # B603: trusted binary path resolved from a fixed allowlist.
        result = subprocess.run(
            [binary, "--query-gpu=name", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise GPUDetectionError(f"nvidia-smi failed: {exc}") from exc

    first_line = next((line.strip() for line in result.stdout.splitlines() if line.strip()), "")
    if not first_line:
        raise GPUDetectionError("nvidia-smi returned no GPU rows")

    detected_via = "wsl-path" if binary == WSL_NVIDIA_SMI else "PATH"
    return GPUInfo(name=first_line, detected_via=detected_via)


__all__ = ["GPUDetectionError", "GPUInfo", "detect_gpu"]
