"""Run manifest. The eval plane's "no manifest, no run" gate.

Captures everything needed to recompute or compare a run later: model
fingerprint, provider build, decode params, prompt template version,
dataset slice, adapter version, repo SHA, seed, timestamp. The
`comparability_key` is a SHA-256 of the subset of fields that matters for
"can two runs be compared apples-to-apples"; runs with matching keys are
flagged comparable in reports.
"""

from __future__ import annotations

import hashlib
import json
import socket
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import yaml


@dataclass(frozen=True, slots=True)
class ModelFingerprint:
    profile: str
    alias: str
    model_path: str
    model_sha256: str | None
    hf_repo: str | None
    hf_file: str | None


@dataclass(frozen=True, slots=True)
class ProviderFingerprint:
    name: str
    server_binary: str
    git_commit: str | None
    cmake_args: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DecodeFingerprint:
    temperature: float | None
    top_p: float | None
    top_k: int | None
    min_p: float | None
    presence_penalty: float | None
    repeat_penalty: float | None
    max_tokens: int | None


@dataclass(frozen=True, slots=True)
class DatasetFingerprint:
    name: str
    version: str
    subset: str | None
    item_count: int


@dataclass(frozen=True, slots=True)
class AdapterFingerprint:
    name: str
    version: str
    track: str
    prompt_template_version: str
    scorer_version: str = "v1"


@dataclass(frozen=True, slots=True)
class HardwareInfo:
    """Best-effort host hardware snapshot. All fields optional; CPU-only hosts
    leave them null and the hub renders 'unknown' gracefully.

    The clock / power / persistence fields exist so two runs taken on
    differently-tuned configurations of the same GPU (think overclock vs.
    stock) are visibly distinguishable in the UI. We don't auto-invalidate
    cells across state changes; the user reads the strip and decides.
    """

    profile: str | None = None  # resolved hardware config name (e.g. 'rtx-5090')
    gpu_name: str | None = None
    vram_mb: int | None = None
    boost_clock_mhz: int | None = None        # clocks.max.graphics
    mem_clock_max_mhz: int | None = None      # clocks.max.memory
    app_clock_graphics_mhz: int | None = None  # clocks.applications.graphics
    app_clock_memory_mhz: int | None = None   # clocks.applications.memory
    power_limit_w: float | None = None        # power.limit
    persistence_mode: str | None = None       # 'Enabled' | 'Disabled' | None


@dataclass(frozen=True, slots=True)
class ServerInfo:
    """Inference server identity. `engine` is the provider name; `version` and
    `git_commit` come from whichever the provider can report at run time."""

    engine: str
    version: str | None = None
    git_commit: str | None = None


@dataclass(frozen=True, slots=True)
class Manifest:
    """Immutable record of one run's exact configuration."""

    run_id: str  # ULID-style or "<adapter>-<timestamp>"
    endpoint_name: str
    model: ModelFingerprint
    provider: ProviderFingerprint
    decode: DecodeFingerprint
    dataset: DatasetFingerprint
    adapter: AdapterFingerprint
    seed: int
    repo_sha: str | None
    hostname: str
    timestamp: str  # ISO-8601 UTC
    comparability_key: str
    notes: str = ""
    hardware: HardwareInfo = field(default_factory=HardwareInfo)
    server: ServerInfo | None = None
    extras: dict[str, object] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json())

    @classmethod
    def read(cls, path: Path) -> Manifest:
        return _manifest_from_dict(yaml.safe_load(path.read_text()))


def compute_comparability_key(
    *,
    model: ModelFingerprint,
    provider: ProviderFingerprint,
    decode: DecodeFingerprint,
    dataset: DatasetFingerprint,
    adapter: AdapterFingerprint,
) -> str:
    """SHA-256 of the (deterministically-serialized) reproducibility-critical fields."""
    payload = {
        "model": {
            "profile": model.profile,
            "alias": model.alias,
            "model_sha256": model.model_sha256,
            "hf_repo": model.hf_repo,
            "hf_file": model.hf_file,
        },
        "provider": {
            "name": provider.name,
            "git_commit": provider.git_commit,
            "cmake_args": list(provider.cmake_args),
        },
        "decode": asdict(decode),
        "dataset": asdict(dataset),
        "adapter": {
            "name": adapter.name,
            "version": adapter.version,
            "track": adapter.track,
            "prompt_template_version": adapter.prompt_template_version,
            "scorer_version": adapter.scorer_version,
        },
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _as_list(value: object) -> list[object]:
    if isinstance(value, list):
        return list(value)
    if isinstance(value, tuple):
        return list(value)
    return []


def compute_parent_key_from_manifest(manifest: dict[str, object]) -> str:
    """SHA-256 of the comparability fields with dataset-slice inputs cleared.

    A 2-item subset re-run and the 17-item full run it was carved from share
    everything except `dataset.subset`, `dataset.item_count`, and the derived
    `decode.max_tokens` hint (which is the max budget across the prompts that
    happened to be sampled). The registry uses this parent key to attach
    subset re-runs to the full-run cell instead of spawning a new "capability".
    The full `comparability_key` is still the bootstrap-stats partition; this
    key is strictly a UI-grouping aid.
    """
    def _dict(key: str) -> dict[str, object]:
        value = manifest.get(key)
        return value if isinstance(value, dict) else {}

    model = _dict("model")
    provider = _dict("provider")
    decode = _dict("decode")
    dataset = _dict("dataset")
    adapter = _dict("adapter")
    payload = {
        "model": {
            "profile": model.get("profile"),
            "alias": model.get("alias"),
            "model_sha256": model.get("model_sha256"),
            "hf_repo": model.get("hf_repo"),
            "hf_file": model.get("hf_file"),
        },
        "provider": {
            "name": provider.get("name"),
            "git_commit": provider.get("git_commit"),
            "cmake_args": _as_list(provider.get("cmake_args")),
        },
        "decode": {
            "temperature": decode.get("temperature"),
            "top_p": decode.get("top_p"),
            "top_k": decode.get("top_k"),
            "min_p": decode.get("min_p"),
            "presence_penalty": decode.get("presence_penalty"),
            "repeat_penalty": decode.get("repeat_penalty"),
            # max_tokens is derived from which items happened to be sampled,
            # so it varies with the subset and is excluded here on purpose.
            "max_tokens": None,
        },
        "dataset": {
            "name": dataset.get("name"),
            "version": dataset.get("version"),
            "subset": None,
            "item_count": 0,
        },
        "adapter": {
            "name": adapter.get("name"),
            "version": adapter.get("version"),
            "track": adapter.get("track"),
            "prompt_template_version": adapter.get("prompt_template_version"),
            "scorer_version": adapter.get("scorer_version", "v1"),
        },
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def file_sha256(path: Path, *, chunk_size: int = 1 << 20) -> str:
    """Hex SHA-256 of a file. Streams in chunks so 10GB models don't OOM."""
    hasher = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


def repo_sha(*, cwd: Path | None = None) -> str | None:
    """`git rev-parse HEAD` if available; None if not a repo or git missing."""
    try:
        # B603: explicit static argv, no shell interpolation.
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() or None


def utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def hostname() -> str:
    try:
        return socket.gethostname()
    except OSError:
        return "unknown"


def _section(data: dict[str, object], key: str) -> dict[str, object]:
    raw = data.get(key)
    if not isinstance(raw, dict):
        raise ValueError(f"manifest section '{key}' missing or not a mapping")
    return raw


def _manifest_from_dict(data: dict[str, object]) -> Manifest:
    """Loose round-trip for read(): rebuild the typed manifest from JSON."""
    model = ModelFingerprint(**_section(data, "model"))  # type: ignore[arg-type]
    provider_raw = dict(_section(data, "provider"))
    cmake = provider_raw.get("cmake_args")
    provider_raw["cmake_args"] = tuple(cmake) if isinstance(cmake, list | tuple) else ()
    provider = ProviderFingerprint(**provider_raw)  # type: ignore[arg-type]
    decode = DecodeFingerprint(**_section(data, "decode"))  # type: ignore[arg-type]
    dataset = DatasetFingerprint(**_section(data, "dataset"))  # type: ignore[arg-type]
    adapter = AdapterFingerprint(**_section(data, "adapter"))  # type: ignore[arg-type]
    extras_raw = data.get("extras") or {}
    extras = dict(extras_raw) if isinstance(extras_raw, dict) else {}
    hardware_raw = data.get("hardware") or {}
    hardware = (
        HardwareInfo(**hardware_raw)  # type: ignore[arg-type]
        if isinstance(hardware_raw, dict)
        else HardwareInfo()
    )
    server_raw = data.get("server")
    server = ServerInfo(**server_raw) if isinstance(server_raw, dict) else None  # type: ignore[arg-type]
    return Manifest(
        run_id=str(data["run_id"]),
        endpoint_name=str(data["endpoint_name"]),
        model=model,
        provider=provider,
        decode=decode,
        dataset=dataset,
        adapter=adapter,
        seed=int(data["seed"]),  # type: ignore[call-overload]
        repo_sha=data.get("repo_sha"),  # type: ignore[arg-type]
        hostname=str(data["hostname"]),
        timestamp=str(data["timestamp"]),
        comparability_key=str(data["comparability_key"]),
        notes=str(data.get("notes") or ""),
        hardware=hardware,
        server=server,
        extras=extras,
    )


__all__ = [
    "AdapterFingerprint",
    "DatasetFingerprint",
    "DecodeFingerprint",
    "HardwareInfo",
    "Manifest",
    "ModelFingerprint",
    "ProviderFingerprint",
    "ServerInfo",
    "compute_comparability_key",
    "compute_parent_key_from_manifest",
    "file_sha256",
    "hostname",
    "repo_sha",
    "utc_now_iso",
]
