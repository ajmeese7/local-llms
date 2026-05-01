"""Phase 0 smoke: the CLI loads, version + help work."""

from __future__ import annotations

from typer.testing import CliRunner

from llms import __version__
from llms.cli import app

runner = CliRunner()


def test_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_help_lists_subcommands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for sub in ("config", "endpoint", "eval", "provider"):
        assert sub in result.stdout


def test_unimplemented_subcommands_exit_two() -> None:
    """Subcommands that haven't shipped their phase yet must signal not-yet."""
    for cmd in (["endpoint", "status"], ["eval", "run"]):
        result = runner.invoke(app, cmd)
        assert result.exit_code == 2, f"{cmd} should exit 2 until implemented"
