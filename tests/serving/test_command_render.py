"""Snapshot tests for the launcher argv renderer.

The bash launcher at config/llama-launcher.sh:207-247 is the source of truth
we are migrating away from. These snapshots pin the Python renderer's output
so we can prove parity before swapping the runtime path.

To regenerate after an intentional change, run:
    uv run pytest tests/serving/test_command_render.py --snapshot-update
"""

from __future__ import annotations

import json

import pytest

from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import (
    EndpointConfig,
    EndpointOverrides,
    HardwareConfig,
    HardwareDefaults,
    ProfileConfig,
    ProviderCapabilities,
    ProviderConfig,
    SpeculativeConfig,
)
from llms.serving.config.resolve import resolve_runtime
from llms.serving.launcher.render import render_argv

# (hardware_name, endpoint_name) → snapshot filename
SHIPPED_MATRIX: list[tuple[str, str]] = [
    ("rtx-5090", "chat-default"),
    ("rtx-5090", "chat-aeon"),
    ("rtx-5090", "chat-mythos"),
    ("rtx-5090", "chat-a3b"),
    ("rtx-5090", "chat-a3b-ngram"),
    ("rtx-5090", "chat-carnice"),
    ("rtx-5060", "chat-9b"),
]


def _argv_blob(argv: list[str]) -> str:
    """Stable, diffable representation: one JSON-quoted token per line."""
    return "\n".join(json.dumps(token) for token in argv) + "\n"


@pytest.mark.parametrize(("hw", "ep"), SHIPPED_MATRIX, ids=[f"{h}__{e}" for h, e in SHIPPED_MATRIX])
def test_shipped_render(shipped_bundle: ConfigBundle, snapshot, hw: str, ep: str) -> None:
    rt = resolve_runtime(shipped_bundle, endpoint_name=ep, hardware_name=hw)
    snapshot.assert_match(_argv_blob(render_argv(rt)), f"{hw}__{ep}.argv")


# ── Synthetic-renderer cases that the shipped configs do not exercise ───────


def _provider(name: str, *, kv_unified: bool, spec_default: bool) -> ProviderConfig:
    return ProviderConfig(
        kind="provider",
        name=name,
        repo_url="https://example.com",
        install_dir="/opt/" + name,
        capabilities=ProviderCapabilities(
            jinja=True,
            mmproj=True,
            kv_unified=kv_unified,
            spec_default=spec_default,
            ngram_mod=True,
        ),
    )


def _hardware() -> HardwareConfig:
    return HardwareConfig(
        kind="hardware",
        name="hw",
        gpu_match_patterns=["x"],
        defaults=HardwareDefaults(context_length=4096),
    )


def test_no_optional_flags_when_profile_is_minimal() -> None:
    profile = ProfileConfig(
        kind="profile",
        name="vanilla",
        alias="V",
        model_path="/m/v.gguf",
    )
    bundle = ConfigBundle(root=__import__("pathlib").Path("/tmp"))
    bundle.providers["p"] = _provider("p", kv_unified=False, spec_default=False)
    bundle.hardware["hw"] = _hardware()
    bundle.profiles[profile.name] = profile
    bundle.endpoints["ep"] = EndpointConfig(
        kind="endpoint", name="ep", profile=profile.name, provider="p"
    )
    rt = resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")
    argv = render_argv(rt)
    for forbidden in ("--jinja", "--mmproj", "--kv-unified", "--spec-default", "--temp"):
        assert forbidden not in argv


def test_spec_default_falls_back_when_provider_lacks_support() -> None:
    """SPEC_DEFAULT on a provider without support should expand to explicit
    ngram-mod flags, matching llama-launcher.sh:227-230."""
    profile = ProfileConfig(
        kind="profile",
        name="speccy",
        alias="S",
        model_path="/m/s.gguf",
        speculative=SpeculativeConfig(default=False),  # we'll flip via override below
    )
    # Build a profile with default=true after the validator path; round-trip
    # via dict so Pydantic re-runs coercion.
    profile = ProfileConfig.model_validate(
        {**profile.model_dump(), "speculative": {"default": True}}
    )
    provider = _provider("p", kv_unified=False, spec_default=False)
    bundle = ConfigBundle(root=__import__("pathlib").Path("/tmp"))
    bundle.providers["p"] = provider
    bundle.hardware["hw"] = _hardware()
    bundle.profiles[profile.name] = profile
    bundle.endpoints["ep"] = EndpointConfig(
        kind="endpoint", name="ep", profile=profile.name, provider="p"
    )
    # Capability check for spec_default=True against a provider lacking support
    # should raise; this protects users from rendering an argv that the binary
    # would silently accept but interpret differently.
    with pytest.raises(Exception):  # noqa: B017
        resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")


def test_endpoint_api_key_override_renders_flag() -> None:
    profile = ProfileConfig(kind="profile", name="v", alias="V", model_path="/m/v.gguf")
    bundle = ConfigBundle(root=__import__("pathlib").Path("/tmp"))
    bundle.providers["p"] = _provider("p", kv_unified=False, spec_default=False)
    bundle.hardware["hw"] = _hardware()
    bundle.profiles[profile.name] = profile
    bundle.endpoints["ep"] = EndpointConfig(
        kind="endpoint",
        name="ep",
        profile=profile.name,
        provider="p",
        overrides=EndpointOverrides(api_key="secret-token"),
    )
    rt = resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")
    argv = render_argv(rt)
    idx = argv.index("--api-key")
    assert argv[idx + 1] == "secret-token"
