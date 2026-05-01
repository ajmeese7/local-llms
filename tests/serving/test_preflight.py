"""Preflight checks: file existence, executability, edge cases."""

from __future__ import annotations

from pathlib import Path

import pytest

from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import (
    EndpointConfig,
    HardwareConfig,
    HardwareDefaults,
    ProfileConfig,
    ProviderCapabilities,
    ProviderConfig,
)
from llms.serving.config.resolve import resolve_runtime
from llms.serving.launcher.preflight import check_runtime


@pytest.fixture
def runtime(tmp_path: Path):
    model = tmp_path / "models" / "fake.gguf"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"x" * 16)
    server = tmp_path / "build" / "bin" / "llama-server"
    server.parent.mkdir(parents=True)
    server.write_text("#!/bin/sh\necho fake\n")
    server.chmod(0o755)
    bundle = ConfigBundle(root=tmp_path)
    bundle.providers["p"] = ProviderConfig(
        kind="provider",
        name="p",
        repo_url="https://example.com",
        install_dir=str(tmp_path),
        capabilities=ProviderCapabilities(),
    )
    bundle.hardware["hw"] = HardwareConfig(
        kind="hardware",
        name="hw",
        gpu_match_patterns=["x"],
        defaults=HardwareDefaults(context_length=4096),
    )
    bundle.profiles["v"] = ProfileConfig(kind="profile", name="v", alias="V", model_path=str(model))
    bundle.endpoints["ep"] = EndpointConfig(kind="endpoint", name="ep", profile="v", provider="p")
    return resolve_runtime(bundle, endpoint_name="ep", hardware_name="hw")


def test_clean_runtime_has_no_problems(runtime) -> None:
    assert check_runtime(runtime) == []


def test_missing_model_flagged(runtime, tmp_path: Path) -> None:
    runtime.profile.__dict__["model_path"] = str(tmp_path / "missing.gguf")
    problems = check_runtime(runtime)
    assert any(p.field == "profile.model_path" and "not found" in p.detail for p in problems)


def test_empty_model_flagged(runtime, tmp_path: Path) -> None:
    empty = tmp_path / "empty.gguf"
    empty.write_bytes(b"")
    runtime.profile.__dict__["model_path"] = str(empty)
    problems = check_runtime(runtime)
    assert any("empty" in p.detail for p in problems)


def test_missing_binary_flagged(runtime, tmp_path: Path) -> None:
    bad = tmp_path / "no-binary"
    runtime.provider.__dict__["install_dir"] = str(bad)
    problems = check_runtime(runtime)
    assert any(p.field == "provider.server_binary_path" for p in problems)


def test_non_executable_binary_flagged(runtime, tmp_path: Path) -> None:
    server = tmp_path / "build" / "bin" / "llama-server"
    server.chmod(0o644)
    problems = check_runtime(runtime)
    assert any("not executable" in p.detail for p in problems)
