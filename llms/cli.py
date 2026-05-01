"""Top-level CLI entry point. Subcommands are wired in their own modules."""

from __future__ import annotations

import typer
from rich.console import Console

from llms import __version__

app = typer.Typer(
    name="llms",
    help="Local LLM serving + evaluation. See `llms <subcommand> --help`.",
    no_args_is_help=True,
    add_completion=False,
)

config_app = typer.Typer(help="Validate and inspect YAML config.", no_args_is_help=True)
endpoint_app = typer.Typer(help="Manage endpoint lifecycle.", no_args_is_help=True)
eval_app = typer.Typer(help="Run benchmarks and emit reports.", no_args_is_help=True)
provider_app = typer.Typer(help="Install and inspect inference providers.", no_args_is_help=True)

app.add_typer(config_app, name="config")
app.add_typer(endpoint_app, name="endpoint")
app.add_typer(eval_app, name="eval")
app.add_typer(provider_app, name="provider")

console = Console()


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"llms {__version__}")
        raise typer.Exit()


@app.callback()
def root(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        help="Show version and exit.",
        callback=_version_callback,
        is_eager=True,
    ),
) -> None:
    """Entry callback. Subcommands are registered above."""


@config_app.command("lint")
def config_lint() -> None:
    """Validate every YAML in config/ against its schema (Phase 1)."""
    console.print("[yellow]not implemented yet (Phase 1)[/]")
    raise typer.Exit(code=2)


@endpoint_app.command("status")
def endpoint_status() -> None:
    """Show the currently active endpoint (Phase 2)."""
    console.print("[yellow]not implemented yet (Phase 2)[/]")
    raise typer.Exit(code=2)


@eval_app.command("run")
def eval_run() -> None:
    """Execute a benchmark run from a manifest (Phase 4)."""
    console.print("[yellow]not implemented yet (Phase 4)[/]")
    raise typer.Exit(code=2)


@provider_app.command("list")
def provider_list() -> None:
    """List known inference providers and capabilities (Phase 1)."""
    console.print("[yellow]not implemented yet (Phase 1)[/]")
    raise typer.Exit(code=2)


if __name__ == "__main__":
    app()
