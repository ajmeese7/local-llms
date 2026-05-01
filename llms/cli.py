"""Top-level CLI entry point. Subcommands are wired in their own modules."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from llms import __version__
from llms.serving.config.errors import ConfigError
from llms.serving.config.lint import lint as lint_configs
from llms.serving.config.loader import load_bundle
from llms.serving.config.resolve import resolve_runtime
from llms.serving.launcher.exec import LauncherError, exec_launcher, prepare
from llms.serving.launcher.gpu import GPUDetectionError, detect_gpu
from llms.serving.launcher.resolve_active import match_hardware
from llms.serving.providers.registry import list_providers
from llms.serving.runtime.systemd import restart_hint
from llms.serving.state.store import StateStore

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
launcher_app = typer.Typer(help="systemd-facing launcher.", no_args_is_help=True)

app.add_typer(config_app, name="config")
app.add_typer(endpoint_app, name="endpoint")
app.add_typer(eval_app, name="eval")
app.add_typer(provider_app, name="provider")
app.add_typer(launcher_app, name="launcher")

console = Console()
err_console = Console(stderr=True)


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
STATE_OPT = typer.Option(
    None,
    "--state-db",
    help="Path to the SQLite state file. Defaults to XDG_STATE_HOME/llms/state.db.",
)
HW_OPT = typer.Option(
    None,
    "--hardware",
    "-H",
    help="Hardware name (skips GPU autodetect).",
)


def _resolve_hardware_name(
    config_root: Path, hardware: str | None, gpu_override: str | None
) -> str:
    bundle = load_bundle(config_root)
    if hardware is not None:
        if hardware not in bundle.hardware:
            err_console.print(f"[red]✗[/] unknown hardware '{hardware}'")
            raise typer.Exit(code=2)
        return hardware
    try:
        gpu = detect_gpu(override=gpu_override)
    except GPUDetectionError as exc:
        err_console.print(f"[red]✗[/] {exc}")
        err_console.print("hint: pass --hardware <name> to skip detection")
        raise typer.Exit(code=2) from exc
    try:
        return match_hardware(bundle, gpu.name).name
    except ConfigError as exc:
        err_console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=2) from exc


# ── config ──────────────────────────────────────────────────────────────────


@config_app.command("lint")
def config_lint(config_root: Path = CONFIG_OPT) -> None:
    """Validate every YAML in the config tree against its schema."""
    bundle, problems = lint_configs(config_root)
    if problems:
        for problem in problems:
            err_console.print(f"[red]✗[/] {problem}")
        raise typer.Exit(code=1)
    counts = (
        f"{len(bundle.hardware)} hardware, {len(bundle.providers)} providers, "
        f"{len(bundle.profiles)} profiles, {len(bundle.endpoints)} endpoints"
    )
    console.print(f"[green]✓[/] config tree clean ({counts})")


# ── endpoint ────────────────────────────────────────────────────────────────


@endpoint_app.command("list")
def endpoint_list(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
) -> None:
    """List endpoints. Marks the currently active one per hardware."""
    bundle = load_bundle(config_root)
    store = StateStore(path=state_db)
    active = store.all_active_endpoints()

    if not bundle.endpoints:
        console.print("[yellow]no endpoints defined[/]")
        return

    table = Table(title="Endpoints")
    table.add_column("Name")
    table.add_column("Profile")
    table.add_column("Provider")
    table.add_column("Active for")
    table.add_column("Description")
    for ep in sorted(bundle.endpoints.values(), key=lambda e: e.name):
        active_for = ",".join(sorted(hw for hw, name in active.items() if name == ep.name))
        table.add_row(
            ep.name,
            ep.profile,
            ep.provider or "—",
            active_for or "—",
            ep.description or "",
        )
    console.print(table)


@endpoint_app.command("status")
def endpoint_status(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    hardware: str | None = HW_OPT,
) -> None:
    """Show the active endpoint per hardware."""
    bundle = load_bundle(config_root)
    store = StateStore(path=state_db)
    active = store.all_active()

    table = Table(title="Active endpoints")
    table.add_column("Hardware")
    table.add_column("Endpoint")
    table.add_column("Reason")
    table.add_column("Actor")
    table.add_column("Activated")
    rows = active.items() if hardware is None else [(hardware, active.get(hardware))]
    for hw, rev in rows:
        if rev is None:
            default = bundle.hardware.get(hw, None)
            fallback = default.default_endpoint if default else None
            table.add_row(hw, fallback or "—", "(no revisions)", "—", "—")
        else:
            table.add_row(
                hw,
                rev.endpoint_name,
                rev.reason or "—",
                rev.actor,
                rev.created_at.isoformat(),
            )
    console.print(table)


@endpoint_app.command("activate")
def endpoint_activate(
    name: str = typer.Argument(..., help="Endpoint name to activate."),
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    hardware: str | None = HW_OPT,
    gpu_override: str | None = typer.Option(
        None, "--gpu-name", help="Override GPU detection (when --hardware is omitted)."
    ),
    reason: str = typer.Option("", "--reason", "-r", help="Why this change was made."),
) -> None:
    """Make `name` the active endpoint for the given hardware."""
    hw = _resolve_hardware_name(config_root, hardware, gpu_override)
    bundle = load_bundle(config_root)
    if name not in bundle.endpoints:
        err_console.print(f"[red]✗[/] unknown endpoint '{name}'")
        raise typer.Exit(code=2)
    try:
        resolve_runtime(bundle, endpoint_name=name, hardware_name=hw)
    except ConfigError as exc:
        err_console.print(f"[red]✗[/] cannot activate: {exc}")
        raise typer.Exit(code=1) from exc

    store = StateStore(path=state_db)
    rev = store.append_revision(hardware=hw, endpoint_name=name, reason=reason)
    console.print(f"[green]✓[/] activated [bold]{name}[/] on [cyan]{hw}[/] (revision {rev.id})")
    console.print(f"  hint: [dim]{restart_hint()}[/dim]")


@endpoint_app.command("rollback")
def endpoint_rollback(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    hardware: str | None = HW_OPT,
    gpu_override: str | None = typer.Option(None, "--gpu-name"),
    to_revision: int | None = typer.Option(
        None, "--to-revision", help="Specific historical revision id to restore."
    ),
    reason: str = typer.Option("rollback", "--reason", "-r"),
) -> None:
    """Revert the active endpoint to a prior revision."""
    hw = _resolve_hardware_name(config_root, hardware, gpu_override)
    store = StateStore(path=state_db)
    history = store.list_revisions(hardware=hw, limit=2)

    if to_revision is None:
        if len(history) < 2:
            err_console.print(f"[red]✗[/] no prior revision for {hw} to roll back to")
            raise typer.Exit(code=1)
        target = history[1]
    else:
        target = store.get_revision(to_revision)  # type: ignore[assignment]
        if target is None or target.hardware != hw:
            err_console.print(f"[red]✗[/] revision {to_revision} not found for hardware {hw}")
            raise typer.Exit(code=2)

    bundle = load_bundle(config_root)
    if target.endpoint_name not in bundle.endpoints:
        err_console.print(
            f"[red]✗[/] endpoint '{target.endpoint_name}' from revision {target.id} no longer exists"
        )
        raise typer.Exit(code=1)

    try:
        resolve_runtime(bundle, endpoint_name=target.endpoint_name, hardware_name=hw)
    except ConfigError as exc:
        err_console.print(f"[red]✗[/] target endpoint no longer resolves: {exc}")
        raise typer.Exit(code=1) from exc

    rev = store.append_revision(
        hardware=hw,
        endpoint_name=target.endpoint_name,
        reason=f"{reason} (was rev {target.id})",
    )
    console.print(
        f"[green]✓[/] rolled {hw} back to [bold]{target.endpoint_name}[/] (new revision {rev.id})"
    )
    console.print(f"  hint: [dim]{restart_hint()}[/dim]")


@endpoint_app.command("revisions")
def endpoint_revisions(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    hardware: str | None = HW_OPT,
    name: str | None = typer.Option(None, "--name", help="Filter by endpoint name."),
    limit: int = typer.Option(20, "--limit", "-n"),
) -> None:
    """Show recent revisions."""
    if hardware is None and name is None:
        bundle = load_bundle(config_root)
        if len(bundle.hardware) == 1:
            hardware = next(iter(bundle.hardware))
    store = StateStore(path=state_db)
    revs = store.list_revisions(hardware=hardware, endpoint_name=name, limit=limit)
    if not revs:
        console.print("[yellow]no revisions[/]")
        return

    table = Table(title="Revision history")
    table.add_column("Id")
    table.add_column("Hardware")
    table.add_column("Endpoint")
    table.add_column("Reason")
    table.add_column("Actor")
    table.add_column("Activated")
    for r in revs:
        table.add_row(
            str(r.id),
            r.hardware,
            r.endpoint_name,
            r.reason or "—",
            r.actor,
            r.created_at.isoformat(),
        )
    console.print(table)


# ── eval (still stubbed) ────────────────────────────────────────────────────


@eval_app.command("run")
def eval_run() -> None:
    """Execute a benchmark run from a manifest (Phase 4)."""
    console.print("[yellow]not implemented yet (Phase 4)[/]")
    raise typer.Exit(code=2)


# ── provider ────────────────────────────────────────────────────────────────


@provider_app.command("list")
def provider_list(config_root: Path = CONFIG_OPT) -> None:
    """List known inference providers and capabilities."""
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


# ── launcher ────────────────────────────────────────────────────────────────


@launcher_app.command("render")
def launcher_render(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    gpu_override: str | None = typer.Option(None, "--gpu-name"),
    as_json: bool = typer.Option(False, "--json", help="Emit argv as JSON list."),
) -> None:
    """Dry-run: print the argv that `launcher exec` would run, plus preflight."""
    try:
        argv, problems = prepare(
            config_root=config_root, state_path=state_db, gpu_override=gpu_override
        )
    except LauncherError as exc:
        err_console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=2) from exc

    if as_json:
        print(json.dumps(argv))
    else:
        for token in argv:
            print(token)

    if problems:
        err_console.print()
        for p in problems:
            colour = "red" if p.severity == "error" else "yellow"
            err_console.print(f"[{colour}]{p.severity}[/]: {p.field}: {p.detail}")


@launcher_app.command("exec")
def launcher_exec(
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    gpu_override: str | None = typer.Option(None, "--gpu-name"),
) -> None:
    """Resolve, preflight, exec llama-server. Called by systemd."""
    try:
        exec_launcher(config_root=config_root, state_path=state_db, gpu_override=gpu_override)
    except LauncherError as exc:
        err_console.print(f"[red]✗[/] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    app()
