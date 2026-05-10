"""End-to-end orchestrator: load adapter → iterate items → call HTTP → write."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from llms.eval.adapter import BenchmarkAdapter
from llms.eval.http_client import CompletionClient
from llms.eval.manifest import (
    AdapterFingerprint,
    DatasetFingerprint,
    DecodeFingerprint,
    HardwareInfo,
    Manifest,
    ModelFingerprint,
    ProviderFingerprint,
    ServerInfo,
    compute_comparability_key,
    file_sha256,
    hostname,
    repo_sha,
    utc_now_iso,
)
from llms.eval.report.emit import emit as emit_report
from llms.eval.scoring import RunSummary, Timing, summarize
from llms.eval.types import Item, ItemResult
from llms.serving.config.models import RuntimeConfig
from llms.serving.launcher.gpu import detect_gpu_quiet
from llms.serving.telemetry.log import RequestRecord, TelemetryWriter


@dataclass(frozen=True, slots=True)
class RunOutcome:
    manifest: Manifest
    summary: RunSummary
    results_path: Path
    manifest_path: Path
    summary_path: Path
    report_md_path: Path
    report_html_path: Path
    interrupted: bool = False


def _decode_fingerprint(rt: RuntimeConfig, *, max_tokens_hint: int | None) -> DecodeFingerprint:
    decode = rt.profile.decode
    return DecodeFingerprint(
        temperature=decode.temperature,
        top_p=decode.top_p,
        top_k=decode.top_k,
        min_p=decode.min_p,
        presence_penalty=decode.presence_penalty,
        repeat_penalty=decode.repeat_penalty,
        max_tokens=max_tokens_hint,
    )


def _model_fingerprint(rt: RuntimeConfig, *, hash_model: bool) -> ModelFingerprint:
    sha: str | None = None
    model_path = Path(rt.profile.model_path)
    if hash_model and model_path.exists():
        sha = file_sha256(model_path)
    return ModelFingerprint(
        profile=rt.profile.name,
        alias=rt.profile.alias,
        model_path=rt.profile.model_path,
        model_sha256=sha,
        hf_repo=rt.profile.hf_repo,
        hf_file=rt.profile.hf_file,
    )


def _provider_fingerprint(rt: RuntimeConfig) -> ProviderFingerprint:
    return ProviderFingerprint(
        name=rt.provider.name,
        server_binary=str(rt.provider.server_binary_path),
        git_commit=None,  # `llms provider install` will record this; not yet implemented
        cmake_args=tuple(rt.provider.cmake_args),
    )


def _hardware_info(rt: RuntimeConfig) -> HardwareInfo:
    """Snapshot what we know about the host. Best effort: a CPU-only host or a
    machine without `nvidia-smi` still produces a valid (if sparse) record.
    Captures clock / power / persistence so OC vs. stock runs are visibly
    distinguishable in the hub."""
    gpu = detect_gpu_quiet()
    if gpu is None:
        return HardwareInfo(profile=rt.hardware.name)
    return HardwareInfo(
        profile=rt.hardware.name,
        gpu_name=gpu.name,
        vram_mb=gpu.vram_mb,
        boost_clock_mhz=gpu.boost_clock_mhz,
        mem_clock_max_mhz=gpu.mem_clock_max_mhz,
        app_clock_graphics_mhz=gpu.app_clock_graphics_mhz,
        app_clock_memory_mhz=gpu.app_clock_memory_mhz,
        power_limit_w=gpu.power_limit_w,
        persistence_mode=gpu.persistence_mode,
    )


def _server_info(rt: RuntimeConfig) -> ServerInfo:
    """The provider config tells us the engine. Version / git commit are
    populated lazily once `llms provider install` records them."""
    return ServerInfo(
        engine=rt.provider.name,
        version=None,
        git_commit=None,
    )


def build_manifest(
    *,
    adapter: BenchmarkAdapter,
    runtime: RuntimeConfig,
    endpoint_name: str,
    dataset_subset: str | None,
    item_count: int,
    seed: int,
    max_tokens_hint: int | None,
    hash_model: bool = False,
    repo_root: Path | None = None,
    notes: str = "",
) -> Manifest:
    """Pure helper. Tests call it; the runner calls it once per run."""
    model = _model_fingerprint(runtime, hash_model=hash_model)
    provider = _provider_fingerprint(runtime)
    decode = _decode_fingerprint(runtime, max_tokens_hint=max_tokens_hint)
    dataset = DatasetFingerprint(
        name=adapter.name,
        version=adapter.version,
        subset=dataset_subset,
        item_count=item_count,
    )
    adapter_fp = AdapterFingerprint(
        name=adapter.name,
        version=adapter.version,
        track=adapter.track,
        prompt_template_version=getattr(adapter, "template_version", "v1"),
    )
    key = compute_comparability_key(
        model=model, provider=provider, decode=decode, dataset=dataset, adapter=adapter_fp
    )
    return Manifest(
        run_id=_new_run_id(adapter.name),
        endpoint_name=endpoint_name,
        model=model,
        provider=provider,
        decode=decode,
        dataset=dataset,
        adapter=adapter_fp,
        seed=seed,
        repo_sha=repo_sha(cwd=repo_root),
        hostname=hostname(),
        timestamp=utc_now_iso(),
        comparability_key=key,
        notes=notes,
        hardware=_hardware_info(runtime),
        server=_server_info(runtime),
    )


def _new_run_id(adapter_name: str) -> str:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    suffix = uuid.uuid4().hex[:6]
    return f"{adapter_name}-{stamp}-{suffix}"


def _iter_results(
    adapter: BenchmarkAdapter,
    items: list[Item],
    client: CompletionClient,
    *,
    telemetry: TelemetryWriter | None,
    run_id: str,
    profile: str,
    on_item_start: Callable[[int, int, Item], None] | None = None,
    on_item_finish: Callable[[int, int, ItemResult], None] | None = None,
) -> Iterable[ItemResult]:
    total = len(items)
    for idx, item in enumerate(items, start=1):
        if on_item_start is not None:
            on_item_start(idx, total, item)
        prompt = adapter.render_prompt(item)
        completion = client.complete(prompt)
        parsed = adapter.parse(completion.text, item)
        score = adapter.score(parsed, item)
        tokens_per_sec: float | None = None
        if completion.output_tokens and completion.latency_ms:
            tokens_per_sec = completion.output_tokens / (completion.latency_ms / 1000.0)
        result = ItemResult(
            item=item,
            parsed=parsed,
            score=score,
            ttft_ms=completion.ttft_ms,
            latency_ms=completion.latency_ms,
            output_tokens=completion.output_tokens,
            tokens_per_sec=tokens_per_sec,
            http_status=completion.http_status,
            error=completion.error,
            prompt=prompt.text,
            prompt_tokens=completion.prompt_tokens,
            max_tokens=prompt.max_tokens,
        )
        if telemetry is not None:
            telemetry.write(
                RequestRecord.now(
                    endpoint=profile,
                    profile=profile,
                    run_id=run_id,
                    item_id=item.id,
                    output_tokens=completion.output_tokens,
                    ttft_ms=completion.ttft_ms,
                    latency_ms=completion.latency_ms,
                    tokens_per_sec=tokens_per_sec,
                    http_status=completion.http_status,
                    error=completion.error,
                )
            )
        if on_item_finish is not None:
            on_item_finish(idx, total, result)
        yield result


def run_eval(
    *,
    adapter: BenchmarkAdapter,
    runtime: RuntimeConfig,
    endpoint_name: str,
    base_url: str,
    output_root: Path,
    subset: str | None = None,
    seed: int = 0,
    hash_model: bool = False,
    transport: httpx.BaseTransport | None = None,
    telemetry: TelemetryWriter | None = None,
    repo_root: Path | None = None,
    notes: str = "",
    on_item_start: Callable[[int, int, Item], None] | None = None,
    on_item_finish: Callable[[int, int, ItemResult], None] | None = None,
) -> RunOutcome:
    """Drive `adapter` end-to-end against `base_url`. Writes artifacts to disk."""
    items = list(adapter.load_dataset(subset=subset, seed=seed))
    if not items:
        raise ValueError("adapter returned no items for the requested subset")

    max_tokens_hint = max(
        (p.max_tokens for p in (adapter.render_prompt(i) for i in items)), default=0
    )

    manifest = build_manifest(
        adapter=adapter,
        runtime=runtime,
        endpoint_name=endpoint_name,
        dataset_subset=subset,
        item_count=len(items),
        seed=seed,
        max_tokens_hint=max_tokens_hint or None,
        hash_model=hash_model,
        repo_root=repo_root,
        notes=notes,
    )

    run_dir = output_root / manifest.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "manifest.json"
    results_path = run_dir / "results.jsonl"
    summary_path = run_dir / "summary.json"
    manifest.write(manifest_path)

    results: list[ItemResult] = []
    started_at = utc_now_iso()
    t0 = time.perf_counter()
    interrupted = False
    try:
        with (
            CompletionClient(
                base_url=base_url,
                api_key=runtime.api_key,
                model=runtime.profile.alias,
                transport=transport,
            ) as client,
            results_path.open("w", encoding="utf-8") as out,
        ):
            for result in _iter_results(
                adapter,
                items,
                client,
                telemetry=telemetry,
                run_id=manifest.run_id,
                profile=runtime.profile.name,
                on_item_start=on_item_start,
                on_item_finish=on_item_finish,
            ):
                results.append(result)
                out.write(json.dumps(_result_to_json(result, run_id=manifest.run_id)) + "\n")
                out.flush()  # crash-safe: each row is on disk before the next starts
    except KeyboardInterrupt:
        interrupted = True

    # Always emit a summary, even on interrupt — a partial summary is honest
    # and lets the registry rank the run by what actually completed. A run
    # with zero scored items writes a summary with item_count=0, which the
    # registry filter (registry._entry_for) drops as a zombie.
    wall_seconds = time.perf_counter() - t0
    compute_seconds = (
        sum(r.latency_ms for r in results if r.latency_ms is not None) / 1000.0
    )
    timing = Timing(
        started_at=started_at,
        finished_at=utc_now_iso(),
        wall_seconds=wall_seconds,
        compute_seconds=compute_seconds,
    )
    summary = summarize(results, timing=timing)
    summary_path.write_text(json.dumps(_summary_to_json(summary), indent=2, sort_keys=True))
    md_path, html_path = emit_report(manifest=manifest, summary=summary, run_dir=run_dir)
    return RunOutcome(
        manifest=manifest,
        summary=summary,
        manifest_path=manifest_path,
        results_path=results_path,
        summary_path=summary_path,
        report_md_path=md_path,
        report_html_path=html_path,
        interrupted=interrupted,
    )


def _result_to_json(result: ItemResult, *, run_id: str) -> dict[str, object]:
    return {
        "run_id": run_id,
        "item_id": result.item.id,
        "category": result.item.category,
        "prompt": result.prompt,
        "raw": result.parsed.raw,
        "value": result.parsed.value,
        "parse_failed": result.parsed.parse_failed,
        "parse_error": result.parsed.parse_error,
        "score": {
            "correct": result.score.correct,
            "partial": result.score.partial,
            "breakdown": result.score.breakdown,
        },
        "ttft_ms": result.ttft_ms,
        "latency_ms": result.latency_ms,
        "output_tokens": result.output_tokens,
        "prompt_tokens": result.prompt_tokens,
        "max_tokens": result.max_tokens,
        "tokens_per_sec": result.tokens_per_sec,
        "http_status": result.http_status,
        "error": result.error,
    }


def _summary_to_json(summary: RunSummary) -> dict[str, object]:
    payload = asdict(summary)
    return payload


__all__ = ["RunOutcome", "build_manifest", "run_eval"]
