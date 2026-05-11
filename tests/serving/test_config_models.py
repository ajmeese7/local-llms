"""Pydantic model invariants: coercion, validation, error paths."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from llms.serving.config.models import (
    EndpointConfig,
    HardwareConfig,
    HardwareDefaults,
    ProfileConfig,
    ProviderCapabilities,
    ProviderConfig,
    SpeculativeConfig,
)


class TestBoolCoercion:
    @pytest.mark.parametrize("truthy", ["on", "ON", "yes", "y", "true", "1", 1, True])
    def test_truthy_strings(self, truthy: object) -> None:
        defaults = HardwareDefaults(context_length=512, flash_attention=truthy)  # type: ignore[arg-type]
        assert defaults.flash_attention is True

    @pytest.mark.parametrize("falsy", ["off", "no", "n", "false", "0", "", 0, False])
    def test_falsy_strings(self, falsy: object) -> None:
        defaults = HardwareDefaults(context_length=512, flash_attention=falsy)  # type: ignore[arg-type]
        assert defaults.flash_attention is False


class TestPathExpansion:
    def test_provider_install_dir(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HOME", "/home/test")
        provider = ProviderConfig(
            kind="provider",
            name="x",
            repo_url="https://example.com",
            install_dir="~/foo",
        )
        assert provider.install_dir == "/home/test/foo"

    def test_profile_paths(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HOME", "/home/test")
        profile = ProfileConfig(
            kind="profile",
            name="p",
            alias="P",
            model_path="~/models/x.gguf",
            mmproj_path="$HOME/models/proj.gguf",
        )
        assert profile.model_path == "/home/test/models/x.gguf"
        assert profile.mmproj_path == "/home/test/models/proj.gguf"


class TestExtraForbidden:
    def test_unknown_field_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ProviderConfig(
                kind="provider",
                name="x",
                repo_url="https://example.com",
                install_dir="/tmp",
                unknown_field="bad",  # type: ignore[call-arg]
            )


class TestNamePattern:
    @pytest.mark.parametrize("name", ["llama.cpp", "qwen36-27b", "rtx-5090", "a"])
    def test_accepted(self, name: str) -> None:
        ProviderConfig(
            kind="provider",
            name=name,
            repo_url="https://example.com",
            install_dir="/tmp",
        )

    @pytest.mark.parametrize("name", ["", "-foo", "foo bar", "/foo", "."])
    def test_rejected(self, name: str) -> None:
        with pytest.raises(ValidationError):
            ProviderConfig(
                kind="provider",
                name=name,
                repo_url="https://example.com",
                install_dir="/tmp",
            )


class TestSpeculative:
    def test_draft_inversion_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SpeculativeConfig(draft_min=10, draft_max=5)

    def test_draft_equal_ok(self) -> None:
        SpeculativeConfig(draft_min=5, draft_max=5)


class TestHardware:
    def test_default_endpoint_must_be_supported(self) -> None:
        with pytest.raises(ValidationError):
            HardwareConfig(
                kind="hardware",
                name="hw",
                gpu_match_patterns=["x"],
                default_endpoint="missing",
                supported_endpoints=["other"],
                defaults=HardwareDefaults(context_length=4096),
            )

    def test_gpu_match(self) -> None:
        hw = HardwareConfig(
            kind="hardware",
            name="hw",
            gpu_match_patterns=["5090", "5080"],
            defaults=HardwareDefaults(context_length=4096),
        )
        assert hw.matches_gpu("NVIDIA GeForce RTX 5090")
        assert hw.matches_gpu("NVIDIA GeForce RTX 5080 Ti")
        assert not hw.matches_gpu("NVIDIA GeForce RTX 4090")


class TestProvider:
    def test_alias_match(self) -> None:
        p = ProviderConfig(
            kind="provider",
            name="llama.cpp",
            aliases=["llama", "ggerganov"],
            repo_url="https://example.com",
            install_dir="/tmp",
        )
        assert p.matches("llama.cpp")
        assert p.matches("LLAMA")
        assert p.matches(" ggerganov ")
        assert not p.matches("ik_llama.cpp")

    def test_capabilities_default_to_lenient(self) -> None:
        caps = ProviderCapabilities()
        assert caps.jinja is True
        assert caps.kv_unified is False  # historically not all providers ship this


class TestEndpoint:
    def test_minimal(self) -> None:
        ep = EndpointConfig(kind="endpoint", name="ep", profile="p")
        assert ep.provider is None
        assert ep.overrides.host is None
