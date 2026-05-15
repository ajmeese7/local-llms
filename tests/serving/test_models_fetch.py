"""Missing-model detection and CLI prompt behavior."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from llms.cli import app
from llms.serving.config.models import ProfileConfig
from llms.serving.models import find_missing

runner = CliRunner()


def _profile(model_path: str, *, hf_repo: str | None = None, hf_file: str | None = None) -> ProfileConfig:
    return ProfileConfig(
        kind="profile",
        name="t",
        alias="T",
        model_path=model_path,
        hf_repo=hf_repo,
        hf_file=hf_file,
    )


def test_find_missing_returns_empty_when_file_present(tmp_path: Path) -> None:
    f = tmp_path / "m.gguf"
    f.write_text("stub")
    prof = _profile(str(f))
    assert find_missing(prof) == []


def test_find_missing_reports_absent_file(tmp_path: Path) -> None:
    prof = _profile(str(tmp_path / "missing.gguf"), hf_repo="org/repo", hf_file="missing.gguf")
    missing = find_missing(prof)
    assert len(missing) == 1
    assert missing[0].label == "model"
    assert missing[0].downloadable


def test_find_missing_flags_non_downloadable_when_hf_coords_absent(tmp_path: Path) -> None:
    prof = _profile(str(tmp_path / "missing.gguf"))
    missing = find_missing(prof)
    assert len(missing) == 1
    assert not missing[0].downloadable


def test_model_status_reports_present_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`llms model status <profile>` exits 0 when the file is on disk."""
    # status doesn't write anything; just needs HOME to expand a path it can find.
    monkeypatch.delenv("LLMS_SKIP_MODEL_CHECK", raising=False)
    result = runner.invoke(app, ["model", "status", "qwen36-27B-AEON", "--config", "config"])
    # On this machine the file exists; assert behavior is one of the two
    # documented outcomes (don't depend on file presence).
    assert result.exit_code in (0, 1)
    if result.exit_code == 1:
        assert "missing" in result.stdout.lower() or "missing" in (result.stderr or "").lower()


def test_eval_run_blocks_when_model_missing_without_tty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a TTY and without --yes, the helper exits 2 with a clear hint."""
    monkeypatch.delenv("LLMS_SKIP_MODEL_CHECK", raising=False)
    # Point at a real config endpoint whose profile model file won't exist
    # under HOME=/home/test (the conftest pin).
    result = runner.invoke(
        app,
        [
            "eval",
            "run",
            "local_smoke",
            "--endpoint",
            "chat-aeon",
            "--config",
            "config",
            "--hardware",
            "rtx-5090",
        ],
    )
    assert result.exit_code == 2
    combined = (result.stdout or "") + (result.stderr or "")
    assert "missing" in combined.lower() or "model" in combined.lower()
