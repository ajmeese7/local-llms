"""Resolve: precedence, capability, and reference-error paths."""

from __future__ import annotations

from pathlib import Path

import pytest

from llms.serving.config.errors import (
    CapabilityError,
    ConfigReferenceError,
    ProviderCompatError,
)
from llms.serving.config.loader import ConfigBundle, load_bundle
from llms.serving.config.resolve import resolve_runtime


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


@pytest.fixture
def stub_root(tmp_path: Path) -> Path:
    _write(
        tmp_path / "providers" / "llama_cpp.yaml",
        """
kind: provider
name: llama.cpp
repo_url: https://example.com/llama.cpp.git
install_dir: /opt/llama.cpp
capabilities:
  jinja: true
  mmproj: true
  kv_unified: true
  spec_default: true
  ngram_mod: true
""",
    )
    _write(
        tmp_path / "providers" / "ik_llama_cpp.yaml",
        """
kind: provider
name: ik_llama.cpp
repo_url: https://example.com/ik_llama.cpp.git
install_dir: /opt/ik_llama.cpp
capabilities:
  jinja: true
  mmproj: true
  kv_unified: false
  spec_default: false
  ngram_mod: false
""",
    )
    _write(
        tmp_path / "hardware" / "rtx-test.yaml",
        """
kind: hardware
name: rtx-test
gpu_match_patterns: ["test"]
default_endpoint: ep-default
supported_endpoints:
  - ep-default
  - ep-override
  - ep-blocked
  - ep-unproven
  - ep-kv
defaults:
  context_length: 8192
  port: 5000
""",
    )
    _write(
        tmp_path / "profiles" / "vanilla.yaml",
        """
kind: profile
name: vanilla
alias: V
model_path: /tmp/v.gguf
""",
    )
    _write(
        tmp_path / "profiles" / "wants-kv.yaml",
        """
kind: profile
name: wants-kv
alias: K
model_path: /tmp/k.gguf
kv_unified: true
""",
    )
    _write(
        tmp_path / "profiles" / "blocked-on-ik.yaml",
        """
kind: profile
name: blocked-on-ik
alias: B
model_path: /tmp/b.gguf
provider_compat:
  blocked: [ik_llama.cpp]
""",
    )
    _write(
        tmp_path / "profiles" / "proven-llama-only.yaml",
        """
kind: profile
name: proven-llama-only
alias: P
model_path: /tmp/p.gguf
provider_compat:
  proven: [llama.cpp]
""",
    )
    _write(
        tmp_path / "endpoints" / "ep-default.yaml",
        """
kind: endpoint
name: ep-default
profile: vanilla
provider: llama.cpp
""",
    )
    _write(
        tmp_path / "endpoints" / "ep-override.yaml",
        """
kind: endpoint
name: ep-override
profile: vanilla
provider: llama.cpp
overrides:
  port: 7777
  context_length: 999999
""",
    )
    _write(
        tmp_path / "endpoints" / "ep-blocked.yaml",
        """
kind: endpoint
name: ep-blocked
profile: blocked-on-ik
provider: ik_llama.cpp
""",
    )
    _write(
        tmp_path / "endpoints" / "ep-unproven.yaml",
        """
kind: endpoint
name: ep-unproven
profile: proven-llama-only
provider: ik_llama.cpp
""",
    )
    _write(
        tmp_path / "endpoints" / "ep-kv.yaml",
        """
kind: endpoint
name: ep-kv
profile: wants-kv
provider: ik_llama.cpp
""",
    )
    return tmp_path


@pytest.fixture
def stub_bundle(stub_root: Path) -> ConfigBundle:
    return load_bundle(stub_root)


def test_precedence_endpoint_over_hardware(stub_bundle: ConfigBundle) -> None:
    rt = resolve_runtime(stub_bundle, endpoint_name="ep-override", hardware_name="rtx-test")
    assert rt.port == 7777
    assert rt.context_length == 999999


def test_precedence_hardware_default(stub_bundle: ConfigBundle) -> None:
    rt = resolve_runtime(stub_bundle, endpoint_name="ep-default", hardware_name="rtx-test")
    assert rt.port == 5000
    assert rt.context_length == 8192


def test_blocked_provider_raises(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(ProviderCompatError) as info:
        resolve_runtime(stub_bundle, endpoint_name="ep-blocked", hardware_name="rtx-test")
    assert info.value.status == "blocked"


def test_unproven_provider_raises(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(ProviderCompatError) as info:
        resolve_runtime(stub_bundle, endpoint_name="ep-unproven", hardware_name="rtx-test")
    assert info.value.status == "unproven"


def test_kv_unified_against_unsupported_provider(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(CapabilityError) as info:
        resolve_runtime(stub_bundle, endpoint_name="ep-kv", hardware_name="rtx-test")
    assert info.value.capability == "kv_unified"


def test_unknown_endpoint(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(ConfigReferenceError):
        resolve_runtime(stub_bundle, endpoint_name="ghost", hardware_name="rtx-test")


def test_unknown_hardware(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(ConfigReferenceError):
        resolve_runtime(stub_bundle, endpoint_name="ep-default", hardware_name="ghost")


def test_provider_override_swaps_backend(stub_bundle: ConfigBundle) -> None:
    """`--provider` lets a caller pin a different backend than the endpoint
    binds, without editing YAML."""
    rt = resolve_runtime(
        stub_bundle,
        endpoint_name="ep-default",
        hardware_name="rtx-test",
        provider_override="ik_llama.cpp",
    )
    assert rt.provider.name == "ik_llama.cpp"


def test_provider_override_unknown_name_raises(stub_bundle: ConfigBundle) -> None:
    with pytest.raises(ConfigReferenceError):
        resolve_runtime(
            stub_bundle,
            endpoint_name="ep-default",
            hardware_name="rtx-test",
            provider_override="nonexistent-backend",
        )


def test_provider_override_can_unblock_a_failing_endpoint(stub_bundle: ConfigBundle) -> None:
    """`ep-unproven` binds a llama-only profile to ik_llama.cpp and normally
    fails. Override to llama.cpp on the same endpoint resolves cleanly."""
    rt = resolve_runtime(
        stub_bundle,
        endpoint_name="ep-unproven",
        hardware_name="rtx-test",
        provider_override="llama.cpp",
    )
    assert rt.provider.name == "llama.cpp"
    assert rt.profile.name == "proven-llama-only"
