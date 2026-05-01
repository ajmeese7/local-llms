"""Top-level CLI entry point. Subcommands are wired in their own modules."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from llms import __version__
from llms.serving.config.lint import lint as lint_configs
from llms.serving.providers.registry import list_providers

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


CONFIG_OPT = typer.Option(
    Path("config"),
    "--config",
    "-c",
    help="Path to the config tree (defaults to ./config).",
    exists=True,
    file_okay=False,
    dir_okay=True,
)


@config_app.command("lint")
def config_lint(config_root: Path = CONFIG_OPT) -> None:
    """Validate every YAML in the config tree against its schema."""
    bundle, problems = lint_configs(config_root)
    if problems:
        for problem in problems:
            console.print(f"[red]✗[/] {problem}")
        raise typer.Exit(code=1)
    counts = (
        f"{len(bundle.hardware)} hardware, {len(bundle.providers)} providers, "
        f"{len(bundle.profiles)} profiles, {len(bundle.endpoints)} endpoints"
    )
    console.print(f"[green]✓[/] config tree clean ({counts})")


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
def provider_list(config_root: Path = CONFIG_OPT) -> None:
    """List known inference providers and capabilities."""
    from llms.serving.config.loader import load_bundle

    bundle = load_bundle(config_root)
    if not bundle.providers:
        console.print(f"[yellow]no providers found under {config_root / 'providers'}[/]")
        raise typer.Exit(code=1)

    table = Table(title="Providers", show_lines=False)
    table.add_column("Name")
    table.add_column("Aliases")
    table.add_column("Server bin")
    table.add_column("Capabilities")
    for provider in list_providers(bundle):
        caps = provider.capabilities
        cap_str = ",".join(sorted(name for name, value in caps.model_dump().items() if value))
        table.add_row(
            provider.name,
            ",".join(provider.aliases) or "—",
            str(provider.server_binary_path),
            cap_str or "—",
        )
    console.print(table)


if __name__ == "__main__":
    app()
