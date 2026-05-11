"""Manifest invariants: comparability key, write/read, file SHA-256."""

from __future__ import annotations

from pathlib import Path

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
)


def _model() -> ModelFingerprint:
    return ModelFingerprint(
        profile="p",
        alias="P",
        model_path="/m/p.gguf",
        model_sha256="abc",
        hf_repo=None,
        hf_file=None,
    )


def _provider(commit: str | None = "abc123") -> ProviderFingerprint:
    return ProviderFingerprint(
        name="llama.cpp",
        server_binary="/opt/llama/build/bin/llama-server",
        git_commit=commit,
        cmake_args=("-DGGML_CUDA=ON",),
    )


def _decode() -> DecodeFingerprint:
    return DecodeFingerprint(
        temperature=0.0,
        top_p=None,
        top_k=None,
        min_p=None,
        presence_penalty=None,
        repeat_penalty=None,
        max_tokens=1024,
    )


def _dataset(subset: str | None = None) -> DatasetFingerprint:
    return DatasetFingerprint(name="local_smoke", version="v1", subset=subset, item_count=5)


def _adapter() -> AdapterFingerprint:
    return AdapterFingerprint(
        name="local_smoke",
        version="v1",
        track="smoke",
        prompt_template_version="v1",
    )


def test_comparability_key_deterministic() -> None:
    a = compute_comparability_key(
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
    )
    b = compute_comparability_key(
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
    )
    assert a == b
    assert len(a) == 64  # sha256 hex


def test_comparability_key_changes_with_subset() -> None:
    base = compute_comparability_key(
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
    )
    other = compute_comparability_key(
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(subset="coding_only"),
        adapter=_adapter(),
    )
    assert base != other


def test_comparability_key_changes_with_provider_commit() -> None:
    a = compute_comparability_key(
        model=_model(),
        provider=_provider(commit="aaa"),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
    )
    b = compute_comparability_key(
        model=_model(),
        provider=_provider(commit="bbb"),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
    )
    assert a != b


def test_manifest_write_read_roundtrip(tmp_path: Path) -> None:
    manifest = Manifest(
        run_id="run-1",
        endpoint_name="chat-default",
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
        seed=42,
        repo_sha="deadbeef",
        hostname="testhost",
        timestamp="2026-05-01T12:00:00Z",
        comparability_key="x" * 64,
    )
    target = tmp_path / "manifest.json"
    manifest.write(target)
    restored = Manifest.read(target)
    assert restored.run_id == "run-1"
    assert restored.provider.cmake_args == manifest.provider.cmake_args
    assert restored.adapter.name == "local_smoke"


def test_manifest_hardware_server_roundtrip(tmp_path: Path) -> None:
    manifest = Manifest(
        run_id="run-hw",
        endpoint_name="chat-default",
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
        seed=0,
        repo_sha=None,
        hostname="testhost",
        timestamp="2026-05-01T12:00:00Z",
        comparability_key="x" * 64,
        hardware=HardwareInfo(
            profile="rtx-5090",
            gpu_name="NVIDIA RTX 5090",
            vram_mb=32607,
            boost_clock_mhz=2880,
            mem_clock_max_mhz=14000,
            app_clock_graphics_mhz=2700,
            app_clock_memory_mhz=14000,
            power_limit_w=575.0,
            persistence_mode="Enabled",
        ),
        server=ServerInfo(engine="llama.cpp", version="b1234", git_commit=None),
    )
    target = tmp_path / "manifest.json"
    manifest.write(target)
    restored = Manifest.read(target)
    assert restored.hardware.gpu_name == "NVIDIA RTX 5090"
    assert restored.hardware.vram_mb == 32607
    assert restored.hardware.boost_clock_mhz == 2880
    assert restored.hardware.power_limit_w == 575.0
    assert restored.hardware.persistence_mode == "Enabled"
    assert restored.server is not None
    assert restored.server.engine == "llama.cpp"
    assert restored.server.version == "b1234"


def test_legacy_manifest_without_hardware_still_loads(tmp_path: Path) -> None:
    """Reports written before this change have no hardware/server keys.
    Reading them back must not crash; defaults fill in."""
    target = tmp_path / "manifest.json"
    manifest = Manifest(
        run_id="legacy",
        endpoint_name="ep",
        model=_model(),
        provider=_provider(),
        decode=_decode(),
        dataset=_dataset(),
        adapter=_adapter(),
        seed=0,
        repo_sha=None,
        hostname="h",
        timestamp="2026-01-01T00:00:00Z",
        comparability_key="0" * 64,
    )
    payload = manifest.to_json()
    # Strip the hardware/server keys to simulate an old report.
    legacy = payload.replace('"hardware": {', '"_old_hardware": {').replace(
        '"server": null,', '"_old_server": null,'
    )
    target.write_text(legacy)
    restored = Manifest.read(target)
    assert restored.hardware.gpu_name is None
    assert restored.server is None


def test_file_sha256_known_value(tmp_path: Path) -> None:
    target = tmp_path / "x.bin"
    target.write_bytes(b"hello world\n")
    sha = file_sha256(target)
    assert sha == "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
