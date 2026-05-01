"""Glue logic: GPU info → hardware match → resolved runtime."""

from __future__ import annotations

import pytest

from llms.serving.config.errors import ConfigReferenceError
from llms.serving.config.loader import ConfigBundle
from llms.serving.launcher.gpu import GPUInfo
from llms.serving.launcher.resolve_active import (
    match_hardware,
    resolve_for_gpu,
)


def test_match_5090(shipped_bundle: ConfigBundle) -> None:
    hw = match_hardware(shipped_bundle, "NVIDIA GeForce RTX 5090")
    assert hw.name == "rtx-5090"


def test_match_5060(shipped_bundle: ConfigBundle) -> None:
    hw = match_hardware(shipped_bundle, "NVIDIA GeForce RTX 5060 Ti")
    assert hw.name == "rtx-5060"


def test_unknown_gpu_raises(shipped_bundle: ConfigBundle) -> None:
    with pytest.raises(ConfigReferenceError):
        match_hardware(shipped_bundle, "NVIDIA GeForce RTX 4090")


def test_uses_default_when_no_state(shipped_bundle: ConfigBundle) -> None:
    gpu = GPUInfo(name="NVIDIA GeForce RTX 5090", detected_via="override")
    res = resolve_for_gpu(shipped_bundle, gpu, active_endpoint_per_hardware={})
    assert res.endpoint_name == "chat-default"
    assert res.fallback_used is True


def test_prefers_stored_endpoint_over_default(shipped_bundle: ConfigBundle) -> None:
    gpu = GPUInfo(name="NVIDIA GeForce RTX 5090", detected_via="override")
    res = resolve_for_gpu(
        shipped_bundle, gpu, active_endpoint_per_hardware={"rtx-5090": "chat-aeon"}
    )
    assert res.endpoint_name == "chat-aeon"
    assert res.fallback_used is False
    assert res.runtime.profile.name == "qwen36-27B-AEON"
