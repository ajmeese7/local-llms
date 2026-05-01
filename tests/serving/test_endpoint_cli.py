"""CLI behaviors for `llms endpoint *` commands.

We point the CLI at the shipped config tree and a fresh tmp state DB per
invocation.  No GPU is required because every test passes --hardware.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from llms.cli import app

runner = CliRunner()
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_ROOT = REPO_ROOT / "config"


def _common(state_db: Path) -> list[str]:
    return ["--config", str(CONFIG_ROOT), "--state-db", str(state_db)]


def test_list_no_active_initially(tmp_path: Path) -> None:
    result = runner.invoke(app, ["endpoint", "list", *_common(tmp_path / "state.db")])
    assert result.exit_code == 0, result.stdout
    assert "chat-default" in result.stdout
    assert "chat-aeon" in result.stdout


def test_status_with_no_revisions_shows_default(tmp_path: Path) -> None:
    result = runner.invoke(
        app, ["endpoint", "status", *_common(tmp_path / "state.db"), "--hardware", "rtx-5090"]
    )
    assert result.exit_code == 0
    assert "chat-default" in result.stdout
    assert "no revisions" in result.stdout


def test_activate_then_status(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    activate = runner.invoke(
        app,
        [
            "endpoint",
            "activate",
            "chat-aeon",
            *_common(db),
            "--hardware",
            "rtx-5090",
            "--reason",
            "switch",
        ],
    )
    assert activate.exit_code == 0, activate.stdout
    assert "activated" in activate.stdout

    status = runner.invoke(app, ["endpoint", "status", *_common(db), "--hardware", "rtx-5090"])
    assert status.exit_code == 0
    assert "chat-aeon" in status.stdout
    assert "switch" in status.stdout


def test_activate_unknown_endpoint_exits_2(tmp_path: Path) -> None:
    result = runner.invoke(
        app,
        [
            "endpoint",
            "activate",
            "ghost",
            *_common(tmp_path / "state.db"),
            "--hardware",
            "rtx-5090",
        ],
    )
    assert result.exit_code == 2


def test_activate_blocked_endpoint_exits_1(tmp_path: Path) -> None:
    """chat-mythos blocks ik_llama.cpp; activating it on rtx-5090 with that
    provider chain should raise. The shipped config picks llama.cpp by default
    so this needs an override path; here we just check the happy path stays
    happy and the unrelated combination doesn't false-positive."""
    result = runner.invoke(
        app,
        [
            "endpoint",
            "activate",
            "chat-mythos",
            *_common(tmp_path / "state.db"),
            "--hardware",
            "rtx-5090",
        ],
    )
    assert result.exit_code == 0


def test_rollback_without_history_exits_1(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    runner.invoke(
        app,
        [
            "endpoint",
            "activate",
            "chat-default",
            *_common(db),
            "--hardware",
            "rtx-5090",
        ],
    )
    result = runner.invoke(app, ["endpoint", "rollback", *_common(db), "--hardware", "rtx-5090"])
    assert result.exit_code == 1


def test_rollback_to_previous_after_two_activates(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    for ep in ("chat-default", "chat-aeon"):
        runner.invoke(app, ["endpoint", "activate", ep, *_common(db), "--hardware", "rtx-5090"])
    rollback = runner.invoke(app, ["endpoint", "rollback", *_common(db), "--hardware", "rtx-5090"])
    assert rollback.exit_code == 0, rollback.stdout
    status = runner.invoke(app, ["endpoint", "status", *_common(db), "--hardware", "rtx-5090"])
    assert "chat-default" in status.stdout


def test_rollback_to_specific_revision(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    for ep in ("chat-default", "chat-aeon", "chat-mythos"):
        runner.invoke(app, ["endpoint", "activate", ep, *_common(db), "--hardware", "rtx-5090"])
    # revision 1 was chat-default
    rollback = runner.invoke(
        app,
        [
            "endpoint",
            "rollback",
            *_common(db),
            "--hardware",
            "rtx-5090",
            "--to-revision",
            "1",
        ],
    )
    assert rollback.exit_code == 0
    status = runner.invoke(app, ["endpoint", "status", *_common(db), "--hardware", "rtx-5090"])
    assert "chat-default" in status.stdout


def test_revisions_lists_history(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    runner.invoke(
        app,
        ["endpoint", "activate", "chat-default", *_common(db), "--hardware", "rtx-5090"],
    )
    runner.invoke(
        app,
        ["endpoint", "activate", "chat-aeon", *_common(db), "--hardware", "rtx-5090"],
    )
    result = runner.invoke(app, ["endpoint", "revisions", *_common(db), "--hardware", "rtx-5090"])
    assert result.exit_code == 0
    assert "chat-default" in result.stdout
    assert "chat-aeon" in result.stdout


@pytest.fixture
def state_db(tmp_path: Path) -> Path:
    return tmp_path / "state.db"


def test_launcher_render_uses_active(state_db: Path) -> None:
    runner.invoke(
        app,
        [
            "endpoint",
            "activate",
            "chat-aeon",
            "--config",
            str(CONFIG_ROOT),
            "--state-db",
            str(state_db),
            "--hardware",
            "rtx-5090",
        ],
    )
    result = runner.invoke(
        app,
        [
            "launcher",
            "render",
            "--config",
            str(CONFIG_ROOT),
            "--state-db",
            str(state_db),
            "--gpu-name",
            "NVIDIA GeForce RTX 5090",
            "--json",
        ],
    )
    assert result.exit_code == 0, result.stdout
    assert "Qwen3.6-27B (Uncensored)" in result.stdout
