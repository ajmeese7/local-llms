"""Pure command-line argv renderer.

Mirrors the argv generation in `config/llama-launcher.sh:207-247`. Snapshot
tests pin the output for every shipped (hardware, endpoint) pair so behavior
parity with the bash launcher is auditable before we cut over.
"""

from __future__ import annotations

from llms.serving.config.models import RuntimeConfig


def _flash_attention_flag(enabled: bool) -> str:
    """`-fa on|off`. The bash launcher passes the literal string."""
    return "on" if enabled else "off"


def render_argv(rt: RuntimeConfig) -> list[str]:
    """Build the llama-server argv. Returns a fresh list each call."""
    profile = rt.profile
    provider = rt.provider
    caps = provider.capabilities

    argv: list[str] = [
        str(provider.server_binary_path),
        "-m",
        profile.model_path,
        "--alias",
        profile.alias,
        "--host",
        rt.host,
        "--port",
        str(rt.port),
        "-ngl",
        str(rt.gpu_layers),
        "-c",
        str(rt.context_length),
        "-np",
        str(rt.parallel_slots),
        "-fa",
        _flash_attention_flag(rt.flash_attention),
        "--cache-type-k",
        rt.cache_type_k,
        "--cache-type-v",
        rt.cache_type_v,
    ]

    if rt.api_key:
        argv.extend(["--api-key", rt.api_key])

    if profile.jinja:
        argv.append("--jinja")

    if profile.mmproj_path:
        argv.extend(["--mmproj", profile.mmproj_path])

    # KV-unified is silently dropped when the provider does not support it.
    # `resolve_runtime` already raises on a hard mismatch; the post-resolution
    # bool is therefore safe to honor as-is.
    if profile.kv_unified and caps.kv_unified:
        argv.append("--kv-unified")

    spec = profile.speculative
    if spec.default and caps.spec_default:
        argv.append("--spec-default")
    elif spec.default:
        # Provider lacks `--spec-default` but supports the longhand. The bash
        # launcher emitted these specific values; keep parity.
        argv.extend(
            [
                "--spec-type",
                "ngram-mod",
                "--spec-ngram-size-n",
                "24",
                "--draft-max",
                "64",
                "--draft-min",
                "48",
            ]
        )
    else:
        if spec.spec_type:
            argv.extend(["--spec-type", spec.spec_type])
        if spec.ngram_size_n is not None:
            argv.extend(["--spec-ngram-size-n", str(spec.ngram_size_n)])
        if spec.ngram_size_m is not None:
            argv.extend(["--spec-ngram-size-m", str(spec.ngram_size_m)])
        if spec.ngram_min_hits is not None:
            argv.extend(["--spec-ngram-min-hits", str(spec.ngram_min_hits)])
        if spec.draft_max is not None:
            argv.extend(["--draft-max", str(spec.draft_max)])
        if spec.draft_min is not None:
            argv.extend(["--draft-min", str(spec.draft_min)])

    decode = profile.decode
    if decode.temperature is not None:
        argv.extend(["--temp", _fmt_number(decode.temperature)])
    if decode.top_p is not None:
        argv.extend(["--top-p", _fmt_number(decode.top_p)])
    if decode.top_k is not None:
        argv.extend(["--top-k", str(decode.top_k)])
    if decode.min_p is not None:
        argv.extend(["--min-p", _fmt_number(decode.min_p)])
    if decode.presence_penalty is not None:
        argv.extend(["--presence-penalty", _fmt_number(decode.presence_penalty)])
    if decode.repeat_penalty is not None:
        argv.extend(["--repeat-penalty", _fmt_number(decode.repeat_penalty)])

    return argv


def _fmt_number(value: float) -> str:
    """Match the bash launcher's behavior of printing user-supplied numerics
    verbatim. Integers print without a trailing `.0`; floats keep their value."""
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        return str(int(value))
    return repr(value)


__all__ = ["render_argv"]
