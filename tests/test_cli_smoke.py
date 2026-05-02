"""CLI smoke: the entry point loads and shows what it should."""

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
    for sub in ("config", "endpoint", "eval", "provider", "launcher"):
        assert sub in result.stdout
