# Configuration

The config tree is YAML under `config/`. Each kind lives in its own directory; `llms config lint` validates the whole tree against Pydantic schemas plus cross-reference + capability checks.

```sh
config/
  hardware/<name>.yaml      # GPU class, detection regex, host/port floor, default endpoint
  providers/<name>.yaml     # inference backend (llama.cpp, ik_llama.cpp), capability flags
  profiles/<name>.yaml      # one model: path, decode params, provider compatibility
  endpoints/<name>.yaml     # binds (profile, provider); active endpoint resolves to one of these
  llama-server.service      # systemd unit; calls .venv/bin/llms launcher exec
```

## Resolution

The launcher resolves the runtime in this order:

1. Detect the GPU via `nvidia-smi`.
2. Pick the first `hardware` whose `gpu_match_patterns` matches the GPU name.
3. Look up the active endpoint for that hardware in `~/.local/state/llms/state.db`. If unset, fall back to `hardware.default_endpoint`.
4. Resolve the endpoint's `profile` and `provider` from the YAML tree.
5. Merge with precedence `endpoint.overrides > profile > hardware.defaults`.
6. Run preflight (model file exists, server binary executable, context within bounds).
7. `execvp` `llama-server` with the rendered argv.

## Endpoint lifecycle

```sh
llms endpoint list                                       # show every endpoint defined
llms endpoint status                                     # show active per hardware
llms endpoint activate chat-default                      # write a revision, swap active pointer
llms endpoint activate chat-carnice --provider ik_llama.cpp  # pin a non-default backend
llms endpoint activate chat-default --yes                # auto-accept the model-download prompt
llms endpoint rollback                                   # revert to the prior revision
llms endpoint rollback --to-revision 7                   # revert to a specific historical revision
llms endpoint revisions --hardware rtx-5090              # show history
```

State lives in SQLite at `~/.local/state/llms/state.db`. Each `activate` and `rollback` appends a row; the active pointer is upserted in the same transaction. The revision row also persists an optional `provider_override` (schema v2), so `--provider X` on activation actually swaps the binary the launcher exec's on next start.

Activation refuses to proceed when the resolved profile's `model_path` (or `mmproj_path`) is missing on disk; the CLI prompts to download from `hf_repo`/`hf_file` (or errors cleanly under non-TTY contexts with a hint to re-run with `--yes` or pre-fetch via `llms model fetch <profile>`).

The CLI does not auto-restart systemd; it prints the `systemctl restart llama-server` command.

## Capability checks

A profile may declare `kv_unified: true`, `jinja: true`, multimodal `mmproj_path`, or speculative-decoding fields. Each provider declares which capabilities it supports. `llms config lint` raises if a profile asks for something the chosen provider does not support, before the service tries to launch it.

`provider_compat` on a profile records empirical evidence:

```yaml
provider_compat:
  proven: [llama.cpp]
  blocked: [ik_llama.cpp]
  notes: "ik_llama.cpp returned HTTP 500 for every prompt in the 2026-04-29 RTX 5090 suite."
```

Activating an endpoint whose profile blocks the chosen provider raises a `ProviderCompatError` at lint time.

## Hardware

| File | GPU pattern | Default endpoint | Defaults |
|---|---|---|---|
| `config/hardware/rtx-5090.yaml` | `5090` | `chat-default` | host 0.0.0.0, port 9999, gpu_layers 99, ctx 131072, KV q8/q4 |
| `config/hardware/rtx-5060.yaml` | `5060` | `chat-9b` | host 0.0.0.0, port 9999, gpu_layers 99, ctx 32768, KV q4/q4 |

To add a new GPU, drop a new YAML in `config/hardware/`. The launcher matches on the regex; no code change required.

## Profile fields

Every field is optional except `kind`, `name`, `alias`, and `model_path`.

| Field | Purpose |
|---|---|
| `model_path` | Local GGUF path. `~` and `$HOME` are expanded. |
| `hf_repo` / `hf_file` | Hugging Face source for the GGUF. Used by external tooling. |
| `mmproj_path` / `mmproj_hf_file` | Multimodal projector. Provider must support `mmproj` or `config lint` raises. |
| `jinja` | Pass `--jinja` to llama-server. |
| `context_length` | Profile-level override of the hardware floor. |
| `parallel_slots` | Same. |
| `cache_type_k` / `cache_type_v` | Same. |
| `kv_unified` | Pass `--kv-unified` when the provider supports it. |
| `speculative.spec_type` / `ngram_size_n` / `draft_max` / `draft_min` / `default` | Speculative decoding controls. `default: true` requires `spec_default` capability. |
| `decode.temperature` / `top_p` / `top_k` / `min_p` / `presence_penalty` / `repeat_penalty` | Per-profile decode overrides; omitted means the launcher does not pass the flag. |
| `provider_compat.proven` / `blocked` / `notes` | Backend compatibility evidence. |

## Endpoint overrides

Endpoints rarely need overrides. When they do, `endpoint.overrides` can adjust `host`, `port`, `api_key`, `context_length`, `parallel_slots`, `gpu_layers`, `flash_attention`, `cache_type_k`, or `cache_type_v` for that endpoint only.

## Adding a profile

1. Drop a YAML in `config/profiles/`.
2. Drop an endpoint YAML in `config/endpoints/` referencing the new profile.
3. Add the endpoint name to the relevant hardware's `supported_endpoints` list.
4. `uv run llms config lint`.
5. `uv run llms endpoint activate <name>` and restart the service.
