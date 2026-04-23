# Configuration

## Runtime Layers

The runtime configuration is layered:

1. The launcher detects the GPU and sources the matching GPU config such as `rtx-5090.conf`.
2. The launcher checks `/etc/llama-server/active-model.conf` for the selected `MODEL_PROFILE`.
3. If no active profile is set, it falls back to `DEFAULT_MODEL_PROFILE` from the GPU config.
4. It validates the profile against `SUPPORTED_MODEL_PROFILES`.
5. It sources the matching overlay file such as `qwen36-27b.conf` or `mythos.conf`.
6. It launches `llama-server` with the combined values from the GPU config and overlay, including any optional per-model runtime overrides.

The standalone selector at `/etc/llama-server/select-model.sh` uses the same GPU matching and supported-profile metadata, then writes `active-model.conf` for the next service restart.

## GPU Base Configs

The GPU config files own hardware defaults and the supported profile list. The service identity, working directory, and other unit metadata live in `config/llama-server.service`.

The checked-in `config/llama-server.service` is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7`. Edit those values for your own account before installing or enabling the unit on another machine.

| GPU | Config | VRAM | Default Profile | Supported Profiles |
|---|---|---|---|---|
| RTX 5090 | [`config/rtx-5090.conf`](../config/rtx-5090.conf) | 32GB | `qwen36-27b` | `qwen36-27b`, `qwen35-27b`, `mythos`, `gemma4-e4b-obliterated` |
| RTX 5060 Ti | [`config/rtx-5060.conf`](../config/rtx-5060.conf) | 16GB | `qwen35-9b` | `qwen35-9b`, `gemma4-e4b-obliterated` |

## Adding a New GPU

1. Copy an existing config:
   ```bash
   cp config/rtx-5090.conf config/rtx-XXXX.conf
   ```
2. Set `DEFAULT_MODEL_PROFILE` and `SUPPORTED_MODEL_PROFILES` for the new card.
3. Adjust the hardware-specific values such as `CONTEXT_LENGTH`, `GPU_LAYERS`, and cache settings.
4. Add matching logic in [`config/llama-launcher.sh`](../config/llama-launcher.sh) and [`config/select-model.sh`](../config/select-model.sh) if the GPU name pattern is new.
5. Re-run `./setup.sh` or manually copy the updated runtime files into `/etc/llama-server/`.

## Config Options

| Variable | Description |
|---|---|
| `DEFAULT_MODEL_PROFILE` | Fallback profile when `active-model.conf` does not set one |
| `SUPPORTED_MODEL_PROFILES` | Space-separated list of profiles allowed on that GPU |
| `MODEL` | Path to the GGUF model file from the overlay |
| `HF_REPO` / `HF_FILE` | Hugging Face repo and filename used by `setup.sh` |
| `ALIAS` | Model name reported by the API |
| `TEMPERATURE` / `TOP_P` / `TOP_K` / `REPEAT_PENALTY` | Optional per-model decoding overrides from the overlay |
| `HOST` | Bind address |
| `PORT` | API port |
| `API_KEY` | Required bearer token for requests |
| `GPU_LAYERS` | Layers to offload to GPU |
| `CONTEXT_LENGTH` | Max context length in tokens |
| `PARALLEL_SLOTS` | Concurrent request slots |
| `FLASH_ATTENTION` | Enables faster inference and lower memory use |
| `CACHE_TYPE_K` / `CACHE_TYPE_V` | KV cache quantization |

## Model Overlays

Model-specific settings live in overlay files like `qwen36-27b.conf`, `qwen35-27b.conf`, `qwen35-9b.conf`, `mythos.conf`, and `gemma4-e4b-obliterated.conf`. These files define the model path, Hugging Face metadata, and `ALIAS`. When a specific artifact needs different runtime limits than the GPU-wide default, an overlay can also lower settings such as `CONTEXT_LENGTH`; overlays should not redefine secrets such as `API_KEY`.

Overlays can also define optional decoding knobs such as `TEMPERATURE`, `TOP_P`, `TOP_K`, and `REPEAT_PENALTY`. That is the supported way to keep a model profile aligned with its published runtime guidance without moving GPU-memory-sensitive settings out of the base config.

To switch models:

1. Run the selector:
   ```bash
   sudo /etc/llama-server/select-model.sh
   ```
2. Choose one of the profiles listed for the detected GPU.
3. Make sure the selected profile's GGUF has already been downloaded locally.
4. Restart the service if the selector does not do it automatically:
   ```bash
   sudo systemctl restart llama-server
   ```

The selector writes `/etc/llama-server/active-model.conf`, and the launcher loads that file on startup. Manual edits are possible, but the selector is the supported workflow.

## Model-Specific Notes

- `mythos` is a supported RTX 5090 profile. It uses the `Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF` language-model GGUF directly in this service.
- `gemma4-e4b-obliterated` is supported on both GPUs and carries the OBLITERATUS recommended decoding defaults as overlay-owned runtime overrides.
- `qwen36-27b` is the RTX 5090 default profile. It uses the `ggml-org/Qwen3.6-27B-GGUF` Q8_0 artifact derived from the upstream `Qwen/Qwen3.6-27B` release, and the overlay lowers `CONTEXT_LENGTH` to `32768` to keep that larger quant practical on a 32 GB card.
- `qwen35-27b` remains available on RTX 5090 as an alternate profile.
- `qwen35-9b` is the RTX 5060 Ti default profile.
- `LilaRest/gemma-4-31B-it-NVFP4-turbo` is still a separate `vLLM` server path, not a `llama.cpp` overlay.

See [MODELS.md](MODELS.md) for the exact commands and runtime distinctions.
