# Configuration

## Runtime Layers

The runtime configuration is layered:

1. The launcher detects the GPU and sources the matching GPU config such as `rtx-5090.conf`.
2. The launcher checks `/etc/llama-server/active-model.conf` for the selected `MODEL_PROFILE`.
3. If no active profile is set, it falls back to `DEFAULT_MODEL_PROFILE` from the GPU config.
4. It validates the profile against `SUPPORTED_MODEL_PROFILES`.
5. It sources the matching overlay file such as `qwen36-27b.conf` or `mythos.conf`.
6. It launches `llama-server` with the combined values from the GPU config and overlay, including any optional per-model runtime overrides.

The standalone selector at `/etc/llama-server/select-model.sh` uses the same GPU matching and supported-profile metadata, then writes `active-model.conf` for the next service restart. Shared readiness-probe and auth-flag behavior lives in `config/runtime-common.sh`, which is copied into `/etc/llama-server/` alongside the launcher and selector.

## Runtime Scripts

| File | Role |
|---|---|
| [`setup.sh`](../setup.sh) | Interactive installer that builds `llama.cpp`, installs runtime files, restarts `llama-server`, and polls `/v1/models` with bounded local curl timeouts |
| [`config/llama-launcher.sh`](../config/llama-launcher.sh) | Runtime entrypoint used by systemd; detects GPU, resolves the active profile, loads the overlay, and execs `llama-server` |
| [`config/runtime-common.sh`](../config/runtime-common.sh) | Shared shell helpers for setup-time readiness probes and optional API key handling |
| [`config/select-model.sh`](../config/select-model.sh) | Interactive model-profile selector that writes `/etc/llama-server/active-model.conf`, shows install state, and can download the selected model before restart |

## GPU Base Configs

The GPU config files own hardware defaults and the supported profile list. The service identity, working directory, and other unit metadata live in `config/llama-server.service`.

The checked-in `config/llama-server.service` is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7`. Edit those values for your own account before installing or enabling the unit on another machine.

| GPU | Config | VRAM | Default Profile | Supported Profiles |
|---|---|---|---|---|
| RTX 5090 | [`config/rtx-5090.conf`](../config/rtx-5090.conf) | 32GB | `qwen36-27b` | `qwen36-27b`, `qwen36-27B-AEON`, `qwen36-35B-A3B`, `mythos` |
| RTX 5060 Ti | [`config/rtx-5060.conf`](../config/rtx-5060.conf) | 16GB | `qwen35-9b` | `qwen35-9b` |

## Adding a New GPU

1. Copy an existing config:
   ```bash
   cp config/rtx-5090.conf config/rtx-XXXX.conf
   ```
2. Set `DEFAULT_MODEL_PROFILE` and `SUPPORTED_MODEL_PROFILES` for the new card.
3. Adjust the hardware-specific values such as `CONTEXT_LENGTH`, `GPU_LAYERS`, and cache settings.
4. Add matching logic in [`config/llama-launcher.sh`](../config/llama-launcher.sh) and [`config/select-model.sh`](../config/select-model.sh) if the GPU name pattern is new.
5. Re-run `./setup.sh` or manually copy the updated runtime files into `/etc/llama-server/`, including [`config/runtime-common.sh`](../config/runtime-common.sh).

## Config Options

| Variable | Description |
|---|---|
| `DEFAULT_MODEL_PROFILE` | Fallback profile when `active-model.conf` does not set one |
| `SUPPORTED_MODEL_PROFILES` | Space-separated list of profiles allowed on that GPU |
| `MODEL` | Path to the GGUF model file from the overlay |
| `HF_REPO` / `HF_FILE` | Hugging Face repo and filename used by `setup.sh` |
| `JINJA` | Optional per-model toggle for `llama-server --jinja`; use `on` for models whose chat/tool templates should be rendered with Jinja |
| `MMPROJ` | Optional path to a multimodal projector GGUF; when set, the launcher passes `--mmproj` and validates the file exists |
| `MMPROJ_HF_REPO` / `MMPROJ_HF_FILE` | Optional Hugging Face metadata used by the selector to download `MMPROJ`; `MMPROJ_HF_REPO` defaults to `HF_REPO` when omitted |
| `ALIAS` | Model name reported by the API |
| `TEMPERATURE` / `TOP_P` / `TOP_K` / `MIN_P` / `PRESENCE_PENALTY` / `REPEAT_PENALTY` | Optional per-model decoding overrides from the overlay |
| `HOST` | Bind address |
| `PORT` | API port |
| `API_KEY` | Optional bearer token for requests; leave unset or empty to disable auth |
| `GPU_LAYERS` | Layers to offload to GPU |
| `CONTEXT_LENGTH` | Max context length in tokens |
| `PARALLEL_SLOTS` | Concurrent request slots |
| `FLASH_ATTENTION` | Enables faster inference and lower memory use |
| `CACHE_TYPE_K` / `CACHE_TYPE_V` | KV cache quantization |

## Model Overlays

Model-specific settings live in overlay files like `qwen36-27b.conf`, `qwen35-9b.conf`, and `mythos.conf`. These files define the model path, Hugging Face metadata, chat-template behavior, optional multimodal projector metadata, and `ALIAS`. When a specific artifact needs different runtime limits than the GPU-wide default, an overlay can also override settings such as `CONTEXT_LENGTH`; overlays should not redefine secrets such as `API_KEY`.

Overlays can also define optional decoding knobs such as `TEMPERATURE` and `TOP_P`. That is the supported way to keep a model profile aligned with its published runtime guidance without moving GPU-memory-sensitive settings out of the base config.

For model cards that recommend `llama-cli --jinja`, set `JINJA="on"` in the overlay. For model cards that also recommend `--mmproj`, set `MMPROJ` to the local projector path and `MMPROJ_HF_FILE` to the projector filename. The launcher fails fast if a configured projector is missing or empty, and the selector can download it when the Hugging Face metadata is present.

To switch models:

1. Run the selector:
   ```bash
   sudo /etc/llama-server/select-model.sh
   ```
2. Choose one of the profiles listed for the detected GPU.
3. If the selected profile is marked `missing` or `empty file`, let the selector download or re-download it before restart.
4. Restart the service if the selector does not do it automatically:
   ```bash
   sudo systemctl restart llama-server
   ```

The selector writes `/etc/llama-server/active-model.conf`, and the launcher loads that file on startup. Manual edits are possible, but the selector is the supported workflow.

## Model-Specific Notes

- `mythos` is a supported RTX 5090 profile. It uses the `Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF` language-model GGUF directly in this service.
- `qwen36-27b` is the RTX 5090 default profile. It uses the `unsloth/Qwen3.6-27B-GGUF` `Qwen3.6-27B-UD-Q5_K_XL.gguf` artifact and enables Jinja chat-template handling.
- `qwen36-27B-AEON` and `qwen36-35B-A3B` are RTX 5090 experiment profiles that also enable Jinja. The 35B A3B overlay includes commented `MMPROJ` metadata for the matching projector artifact.
- `qwen35-9b` is the RTX 5060 Ti default profile.
- `LilaRest/gemma-4-31B-it-NVFP4-turbo` is still a separate `vLLM` server path, not a `llama.cpp` overlay.

See [MODELS.md](MODELS.md) for the exact commands and runtime distinctions.
