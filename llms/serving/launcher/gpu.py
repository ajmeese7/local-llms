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
    vram_mb: int | None = None
    boost_clock_mhz: int | None = None
    mem_clock_max_mhz: int | None = None
    app_clock_graphics_mhz: int | None = None
    app_clock_memory_mhz: int | None = None
    power_limit_w: float | None = None
    persistence_mode: str | None = None


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

    # Order in QUERY_FIELDS must match the parse order in _parse_gpu_row.
    query = ",".join(_QUERY_FIELDS)
    try:
        # B603: trusted binary path resolved from a fixed allowlist.
        result = subprocess.run(
            [binary, f"--query-gpu={query}", "--format=csv,noheader,nounits"],
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

    parsed = _parse_gpu_row(first_line)
    detected_via = "wsl-path" if binary == WSL_NVIDIA_SMI else "PATH"
    return GPUInfo(
        name=parsed.name,
        detected_via=detected_via,
        vram_mb=parsed.vram_mb,
        boost_clock_mhz=parsed.boost_clock_mhz,
        mem_clock_max_mhz=parsed.mem_clock_max_mhz,
        app_clock_graphics_mhz=parsed.app_clock_graphics_mhz,
        app_clock_memory_mhz=parsed.app_clock_memory_mhz,
        power_limit_w=parsed.power_limit_w,
        persistence_mode=parsed.persistence_mode,
    )


_QUERY_FIELDS = (
    "name",
    "memory.total",
    "clocks.max.graphics",
    "clocks.max.memory",
    "clocks.applications.graphics",
    "clocks.applications.memory",
    "power.limit",
    "persistence_mode",
)


@dataclass(frozen=True, slots=True)
class _ParsedGPURow:
    name: str
    vram_mb: int | None
    boost_clock_mhz: int | None
    mem_clock_max_mhz: int | None
    app_clock_graphics_mhz: int | None
    app_clock_memory_mhz: int | None
    power_limit_w: float | None
    persistence_mode: str | None


def _parse_gpu_row(row: str) -> _ParsedGPURow:
    """Parse one nvidia-smi CSV row.

    Tolerant: rows shorter than the full query (older nvidia-smi or a
    single-column build) just leave later fields None instead of erroring.
    nvidia-smi reports `[Not Supported]` / `N/A` for fields it cannot read;
    we treat those as None.
    """
    parts = [p.strip() for p in row.split(",")]
    name = parts[0] if parts else ""
    rest = parts[1:]

    def _int(idx: int) -> int | None:
        if idx >= len(rest):
            return None
        try:
            return int(float(rest[idx]))
        except ValueError:
            return None

    def _float(idx: int) -> float | None:
        if idx >= len(rest):
            return None
        try:
            return float(rest[idx])
        except ValueError:
            return None

    def _str(idx: int) -> str | None:
        if idx >= len(rest):
            return None
        v = rest[idx]
        return v if v and v.lower() not in {"n/a", "[not supported]"} else None

    return _ParsedGPURow(
        name=name,
        vram_mb=_int(0),
        boost_clock_mhz=_int(1),
        mem_clock_max_mhz=_int(2),
        app_clock_graphics_mhz=_int(3),
        app_clock_memory_mhz=_int(4),
        power_limit_w=_float(5),
        persistence_mode=_str(6),
    )


def detect_gpu_quiet(*, override: str | None = None) -> GPUInfo | None:
    """Best-effort variant: returns None when no GPU is available.

    Use from non-launcher call sites (e.g. eval runner) where a CPU-only
    machine is a legitimate run, not an error.
    """
    try:
        return detect_gpu(override=override)
    except GPUDetectionError:
        return None


__all__ = ["GPUDetectionError", "GPUInfo", "detect_gpu", "detect_gpu_quiet"]
