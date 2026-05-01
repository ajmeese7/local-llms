"""Pydantic v2 models for hardware, provider, profile, endpoint configs.

Each kind corresponds to one YAML file under config/<kind>/<name>.yaml. Files
are validated independently here; cross-reference and capability checks run
against the resolved bundle in `llms.serving.config.resolve`.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

ConfigName = Annotated[str, Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$", min_length=1)]


def _coerce_bool(value: Any) -> Any:
    """Accept the same on/off/yes/no spellings the bash launcher tolerated.

    Returning the original value when it isn't a known string lets pydantic's
    standard bool coercion take over for actual booleans and numeric 0/1.
    """
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"on", "yes", "y", "true", "1"}:
            return True
        if lowered in {"off", "no", "n", "false", "0", ""}:
            return False
    return value


def _expand_path(value: Any) -> Any:
    if isinstance(value, str):
        return os.path.expanduser(os.path.expandvars(value))
    return value


class _Base(BaseModel):
    """Common base for every typed config entity."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ───────────────────────── Provider ──────────────────────────────────────────


class ProviderCapabilities(_Base):
    """Flags the command renderer consults before emitting provider-specific args.

    A capability set to false means the renderer will silently drop the
    corresponding profile flag (matching the bash launcher's behavior at
    config/llama-launcher.sh:190-238). A capability set to true means the
    renderer will pass the flag through.
    """

    jinja: bool = True
    mmproj: bool = True
    kv_unified: bool = False
    spec_default: bool = False
    ngram_mod: bool = True

    @field_validator("*", mode="before")
    @classmethod
    def _bool(cls, v: Any) -> Any:
        return _coerce_bool(v)


class ProviderConfig(_Base):
    """An inference backend. Mirrors config/provider-common.sh."""

    kind: Literal["provider"]
    name: ConfigName
    aliases: list[str] = Field(default_factory=list)
    repo_url: str
    install_dir: str
    server_bin: str = "build/bin/llama-server"
    bench_bin: str = "build/bin/llama-bench"
    cmake_args: list[str] = Field(default_factory=list)
    capabilities: ProviderCapabilities = Field(default_factory=ProviderCapabilities)

    @field_validator("install_dir", mode="before")
    @classmethod
    def _expand(cls, v: Any) -> Any:
        return _expand_path(v)

    def matches(self, identifier: str) -> bool:
        """True if `identifier` is the canonical name or any declared alias."""
        target = identifier.strip().lower()
        if target == self.name.lower():
            return True
        return any(target == alias.strip().lower() for alias in self.aliases)

    @property
    def server_binary_path(self) -> Path:
        return Path(self.install_dir) / self.server_bin

    @property
    def bench_binary_path(self) -> Path:
        return Path(self.install_dir) / self.bench_bin


# ───────────────────────── Hardware ──────────────────────────────────────────


CacheType = Literal["f16", "q8_0", "q4_0", "q5_0", "q5_1", "q4_1", "iq4_nl"]


class HardwareDefaults(_Base):
    """Hardware-floor settings. Profile and endpoint may override most of these."""

    host: str = "0.0.0.0"
    port: int = Field(default=9999, ge=1, le=65535)
    gpu_layers: int = 99
    context_length: int = Field(ge=512)
    parallel_slots: int = Field(default=1, ge=1)
    flash_attention: bool = True
    cache_type_k: CacheType = "q8_0"
    cache_type_v: CacheType = "q4_0"
    api_key: str | None = None

    @field_validator("flash_attention", mode="before")
    @classmethod
    def _bool(cls, v: Any) -> Any:
        return _coerce_bool(v)


class HardwareConfig(_Base):
    """A GPU class: detection patterns, defaults, supported endpoints."""

    kind: Literal["hardware"]
    name: ConfigName
    description: str | None = None
    gpu_match_patterns: list[str] = Field(min_length=1)
    default_endpoint: ConfigName | None = None
    supported_endpoints: list[ConfigName] = Field(default_factory=list)
    default_provider: ConfigName = "llama.cpp"
    defaults: HardwareDefaults

    @model_validator(mode="after")
    def _default_in_supported(self) -> HardwareConfig:
        if (
            self.default_endpoint is not None
            and self.supported_endpoints
            and self.default_endpoint not in self.supported_endpoints
        ):
            raise ValueError(
                f"default_endpoint '{self.default_endpoint}' must be in supported_endpoints"
            )
        return self

    def matches_gpu(self, gpu_name: str) -> bool:
        return any(re.search(pat, gpu_name, re.IGNORECASE) for pat in self.gpu_match_patterns)


# ───────────────────────── Profile ──────────────────────────────────────────


class DecodeOverrides(_Base):
    """Per-profile recommended decoding params. Each is optional; omitted means
    the bash launcher's behavior of `do not pass the flag at all`."""

    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0)
    min_p: float | None = Field(default=None, ge=0, le=1)
    presence_penalty: float | None = None
    repeat_penalty: float | None = None


class SpeculativeConfig(_Base):
    """Speculative decoding knobs. Mirrors the SPEC_* / DRAFT_* shell vars.

    `default=true` selects the provider's preferred preset (passes
    `--spec-default` if the provider supports that flag, otherwise expands to
    the equivalent explicit args). The explicit fields override piecewise.
    """

    default: bool = False
    spec_type: str | None = None
    ngram_size_n: int | None = Field(default=None, ge=1)
    ngram_size_m: int | None = Field(default=None, ge=1)
    ngram_min_hits: int | None = Field(default=None, ge=1)
    draft_max: int | None = Field(default=None, ge=1)
    draft_min: int | None = Field(default=None, ge=1)

    @field_validator("default", mode="before")
    @classmethod
    def _bool(cls, v: Any) -> Any:
        return _coerce_bool(v)

    @model_validator(mode="after")
    def _draft_bounds(self) -> SpeculativeConfig:
        if (
            self.draft_min is not None
            and self.draft_max is not None
            and self.draft_min > self.draft_max
        ):
            raise ValueError(f"draft_min ({self.draft_min}) > draft_max ({self.draft_max})")
        return self


class ProviderCompat(_Base):
    """Profile-declared opinion about which providers are known good or bad."""

    proven: list[ConfigName] = Field(default_factory=list)
    blocked: list[ConfigName] = Field(default_factory=list)
    notes: str | None = None


class ProfileConfig(_Base):
    """A model overlay. One file per (model, quant)."""

    kind: Literal["profile"]
    name: ConfigName
    alias: str
    model_path: str
    hf_repo: str | None = None
    hf_file: str | None = None
    mmproj_path: str | None = None
    mmproj_hf_file: str | None = None
    jinja: bool = False
    context_length: int | None = Field(default=None, ge=512)
    parallel_slots: int | None = Field(default=None, ge=1)
    cache_type_k: CacheType | None = None
    cache_type_v: CacheType | None = None
    kv_unified: bool = False
    speculative: SpeculativeConfig = Field(default_factory=SpeculativeConfig)
    decode: DecodeOverrides = Field(default_factory=DecodeOverrides)
    provider_compat: ProviderCompat = Field(default_factory=ProviderCompat)

    @field_validator("model_path", "mmproj_path", mode="before")
    @classmethod
    def _expand(cls, v: Any) -> Any:
        return _expand_path(v)

    @field_validator("jinja", "kv_unified", mode="before")
    @classmethod
    def _bool(cls, v: Any) -> Any:
        return _coerce_bool(v)


# ───────────────────────── Endpoint ──────────────────────────────────────────


class EndpointOverrides(_Base):
    """Per-endpoint overrides. Empty by default; useful when running the same
    profile on a non-default port or with an alternate API key."""

    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    api_key: str | None = None
    context_length: int | None = Field(default=None, ge=512)
    parallel_slots: int | None = Field(default=None, ge=1)
    gpu_layers: int | None = None
    flash_attention: bool | None = None
    cache_type_k: CacheType | None = None
    cache_type_v: CacheType | None = None

    @field_validator("flash_attention", mode="before")
    @classmethod
    def _bool(cls, v: Any) -> Any:
        return _coerce_bool(v)


class EndpointConfig(_Base):
    """Binds a profile to a provider; this is what `llms endpoint activate`
    points at and what the launcher resolves to a RuntimeConfig."""

    kind: Literal["endpoint"]
    name: ConfigName
    description: str | None = None
    profile: ConfigName
    provider: ConfigName | None = None  # falls back to hardware.default_provider
    overrides: EndpointOverrides = Field(default_factory=EndpointOverrides)


# ───────────────────────── Resolved runtime ──────────────────────────────────


class RuntimeConfig(_Base):
    """Fully merged view used by the command renderer. Pure data; no behavior."""

    endpoint_name: ConfigName
    profile: ProfileConfig
    provider: ProviderConfig
    hardware: HardwareConfig
    host: str
    port: int
    api_key: str | None
    gpu_layers: int
    context_length: int
    parallel_slots: int
    flash_attention: bool
    cache_type_k: CacheType
    cache_type_v: CacheType


__all__ = [
    "CacheType",
    "ConfigName",
    "DecodeOverrides",
    "EndpointConfig",
    "EndpointOverrides",
    "HardwareConfig",
    "HardwareDefaults",
    "ProfileConfig",
    "ProviderCapabilities",
    "ProviderCompat",
    "ProviderConfig",
    "RuntimeConfig",
    "SpeculativeConfig",
]
