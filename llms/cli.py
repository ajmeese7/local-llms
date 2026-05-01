"""Top-level CLI entry point. Subcommands are wired in their own modules."""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from llms import __version__
from llms.eval.adapter import BenchmarkAdapter
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
from llms.serving.telemetry.aggregate import summarize
from llms.serving.telemetry.log import TelemetryWriter, default_log_path

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
LOG_OPT = typer.Option(
    None,
    "--log",
    help="Path to the request JSONL. Defaults to XDG state.",
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


@endpoint_app.command("stats")
def endpoint_stats(
    log_path: Path | None = LOG_OPT,
    window: str = typer.Option("24h", "--window", "-w", help="Window duration (e.g. 1h, 24h, 7d)."),
) -> None:
    """Aggregate per-request telemetry over a time window."""
    delta = _parse_window(window)
    if delta is None:
        err_console.print(f"[red]✗[/] could not parse window '{window}'")
        raise typer.Exit(code=2)

    path = log_path or default_log_path()
    summary = summarize(log_path=path, window=delta)

    if summary.request_count == 0:
        console.print(f"[yellow]no records in {window}[/] (looked at {path})")
        return

    table = Table(title=f"Request stats — last {window}")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    table.add_row("requests", str(summary.request_count))
    table.add_row("errors", str(summary.error_count))
    table.add_row("p50 latency", _fmt_ms(summary.p50_latency_ms))
    table.add_row("p95 latency", _fmt_ms(summary.p95_latency_ms))
    table.add_row("p50 ttft", _fmt_ms(summary.p50_ttft_ms))
    table.add_row("p95 ttft", _fmt_ms(summary.p95_ttft_ms))
    table.add_row(
        "median tok/s",
        f"{summary.median_tokens_per_sec:.1f}"
        if summary.median_tokens_per_sec is not None
        else "—",
    )
    console.print(table)


def _parse_window(spec: str) -> timedelta | None:
    """Parse "30s" / "5m" / "24h" / "7d" — single suffix only."""
    if not spec:
        return None
    unit = spec[-1].lower()
    try:
        amount = int(spec[:-1])
    except ValueError:
        return None
    return {
        "s": timedelta(seconds=amount),
        "m": timedelta(minutes=amount),
        "h": timedelta(hours=amount),
        "d": timedelta(days=amount),
    }.get(unit)


def _fmt_ms(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f} ms"


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


# ── eval ────────────────────────────────────────────────────────────────────

EVAL_OUTPUT_OPT = typer.Option(
    Path("bench/reports"),
    "--output",
    "-o",
    help="Where to write per-run artifacts (manifest, jsonl, html).",
)


def _load_adapter(name: str) -> BenchmarkAdapter:
    """Return an adapter instance for `name`. Imported lazily to keep
    `llms --help` responsive when the eval extras aren't installed."""
    if name == "local_smoke":
        from llms.eval.adapters.local_smoke import LocalSmokeAdapter

        return LocalSmokeAdapter()
    raise typer.BadParameter(f"unknown adapter '{name}' (have: local_smoke)")


@eval_app.command("run")
def eval_run(
    adapter_name: str = typer.Argument(..., help="Adapter name (e.g. local_smoke)."),
    endpoint: str = typer.Option(
        ..., "--endpoint", "-e", help="Endpoint name from config/endpoints/."
    ),
    config_root: Path = CONFIG_OPT,
    state_db: Path | None = STATE_OPT,
    hardware: str | None = HW_OPT,
    gpu_override: str | None = typer.Option(None, "--gpu-name"),
    base_url: str | None = typer.Option(
        None,
        "--base-url",
        help="Override the endpoint URL (default: derived from endpoint config).",
    ),
    output_root: Path = EVAL_OUTPUT_OPT,
    subset: str | None = typer.Option(None, "--subset", help="Adapter-specific subset selector."),
    seed: int = typer.Option(0, "--seed"),
    hash_model: bool = typer.Option(
        False, "--hash-model", help="SHA-256 the model file (slow, but pins the manifest)."
    ),
    write_telemetry: bool = typer.Option(
        True, "--telemetry/--no-telemetry", help="Append per-request rows to the request log."
    ),
    notes: str = typer.Option("", "--notes"),
) -> None:
    """Drive an adapter against an endpoint and write the run to disk."""
    from llms.eval.endpoint_url import base_url_from_runtime
    from llms.eval.runner import run_eval

    hw = _resolve_hardware_name(config_root, hardware, gpu_override)
    bundle = load_bundle(config_root)
    if endpoint not in bundle.endpoints:
        err_console.print(f"[red]✗[/] unknown endpoint '{endpoint}'")
        raise typer.Exit(code=2)
    runtime = resolve_runtime(bundle, endpoint_name=endpoint, hardware_name=hw)
    target_url = base_url or base_url_from_runtime(runtime)

    try:
        adapter = _load_adapter(adapter_name)
    except typer.BadParameter as exc:
        err_console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=2) from exc

    telemetry = TelemetryWriter() if write_telemetry else None
    console.print(
        f"running [bold]{adapter_name}[/] against [cyan]{target_url}[/] "
        f"(endpoint=[bold]{endpoint}[/], hardware=[bold]{hw}[/])"
    )
    outcome = run_eval(
        adapter=adapter,
        runtime=runtime,
        endpoint_name=endpoint,
        base_url=target_url,
        output_root=output_root,
        subset=subset,
        seed=seed,
        hash_model=hash_model,
        telemetry=telemetry,
        notes=notes,
    )
    summary = outcome.summary
    accuracy = f"{summary.accuracy.point:.3f}" if summary.accuracy is not None else "—"
    console.print(
        f"[green]✓[/] {summary.item_count} items, accuracy={accuracy}, "
        f"parse_failures={summary.parse_failure_count}, errors={summary.error_count}"
    )
    console.print(f"  artifacts: [dim]{outcome.manifest_path.parent}[/]")


@eval_app.command("list")
def eval_list(output_root: Path = EVAL_OUTPUT_OPT) -> None:
    """List runs under the output directory."""
    from llms.eval.manifest import Manifest

    if not output_root.exists():
        console.print(f"[yellow]no runs under {output_root}[/]")
        return
    rows: list[tuple[str, str, str, str, str]] = []
    for run_dir in sorted(output_root.iterdir()):
        manifest_file = run_dir / "manifest.json"
        if not manifest_file.is_file():
            continue
        manifest = Manifest.read(manifest_file)
        rows.append(
            (
                manifest.run_id,
                f"{manifest.adapter.name}@{manifest.adapter.version}",
                manifest.endpoint_name,
                manifest.timestamp,
                manifest.comparability_key[:8],
            )
        )

    if not rows:
        console.print(f"[yellow]no runs in {output_root}[/]")
        return

    table = Table(title=f"Eval runs in {output_root}")
    table.add_column("Run id")
    table.add_column("Adapter")
    table.add_column("Endpoint")
    table.add_column("Timestamp")
    table.add_column("Compat")
    for r in rows:
        table.add_row(*r)
    console.print(table)


@eval_app.command("show")
def eval_show(
    run_id: str = typer.Argument(...),
    output_root: Path = EVAL_OUTPUT_OPT,
) -> None:
    """Print the run summary for `run_id`."""
    from llms.eval.manifest import Manifest

    summary_file = output_root / run_id / "summary.json"
    manifest_file = output_root / run_id / "manifest.json"
    if not summary_file.is_file() or not manifest_file.is_file():
        err_console.print(f"[red]✗[/] no run named '{run_id}' under {output_root}")
        raise typer.Exit(code=2)
    manifest = Manifest.read(manifest_file)
    summary = json.loads(summary_file.read_text())
    console.print(
        f"[bold]{run_id}[/] · adapter={manifest.adapter.name}@{manifest.adapter.version} "
        f"· endpoint={manifest.endpoint_name}"
    )
    console.print(f"compat: {manifest.comparability_key}")
    console.print(json.dumps(summary, indent=2, sort_keys=True))


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
