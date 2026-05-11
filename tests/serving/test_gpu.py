"""GPU detection: subprocess paths, override, error paths."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from llms.serving.launcher import gpu


def test_override_short_circuits() -> None:
    info = gpu.detect_gpu(override="NVIDIA GeForce RTX 5090")
    assert info.name == "NVIDIA GeForce RTX 5090"
    assert info.detected_via == "override"


def test_missing_nvidia_smi_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLMS_NVIDIA_SMI", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    monkeypatch.setattr(gpu, "WSL_NVIDIA_SMI", "/nonexistent")
    with pytest.raises(gpu.GPUDetectionError):
        gpu.detect_gpu()


def test_env_override_path_used(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "fake-smi"
    fake.write_text("#!/bin/sh\nexit 0\n")
    fake.chmod(0o755)
    monkeypatch.setenv("LLMS_NVIDIA_SMI", str(fake))

    completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="MyGPU\n", stderr="")
    with patch.object(subprocess, "run", return_value=completed) as mock_run:
        info = gpu.detect_gpu()
    assert info.name == "MyGPU"
    assert mock_run.call_args.args[0][0] == str(fake)


def test_subprocess_failure_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "fake-smi"
    fake.write_text("#!/bin/sh\nexit 1\n")
    fake.chmod(0o755)
    monkeypatch.setenv("LLMS_NVIDIA_SMI", str(fake))

    def boom(*_a: object, **_kw: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.CalledProcessError(returncode=1, cmd="x")

    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(gpu.GPUDetectionError):
        gpu.detect_gpu()


def test_blank_output_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "fake-smi"
    fake.write_text("#!/bin/sh\nexit 0\n")
    fake.chmod(0o755)
    monkeypatch.setenv("LLMS_NVIDIA_SMI", str(fake))

    completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="\n\n", stderr="")
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: completed)
    with pytest.raises(gpu.GPUDetectionError):
        gpu.detect_gpu()
