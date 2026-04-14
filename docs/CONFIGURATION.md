# Configuration

## How GPU Detection Works

The systemd service runs [`config/llama-launcher.sh`](../config/llama-launcher.sh), which:

1. Queries `nvidia-smi` for the GPU name
2. Matches it to a config file such as `rtx-5090.conf`
3. Sources that config and launches `llama-server` with the right flags

This lets the same repo work across multiple machines without local code changes.

## Per-GPU Config Files

| GPU | Config | VRAM | Default Model | Quant |
|---|---|---|---|---|
| RTX 5090 | [`config/rtx-5090.conf`](../config/rtx-5090.conf) | 32GB | Qwen3.5-27B | Q4_K_M |
| RTX 5060 Ti | [`config/rtx-5060.conf`](../config/rtx-5060.conf) | 16GB | Qwen3.5-9B | Q4_K_M |

## Adding a New GPU

1. Copy an existing config:
   ```bash
   cp config/rtx-5090.conf config/rtx-XXXX.conf
   ```
2. Adjust the model path, context length, and related values for the new card.
3. Add a matching clause in [`config/llama-launcher.sh`](../config/llama-launcher.sh).
4. Re-run `./setup.sh` or manually copy the new config into `/etc/llama-server/`.

## Config Options

| Variable | Description |
|---|---|
| `MODEL` | Path to the GGUF model file |
| `HF_REPO` / `HF_FILE` | Hugging Face repo and filename used by `setup.sh` |
| `ALIAS` | Model name reported by the API |
| `HOST` | Bind address |
| `PORT` | API port |
| `API_KEY` | Required bearer token for requests |
| `GPU_LAYERS` | Layers to offload to GPU |
| `CONTEXT_LENGTH` | Max context length in tokens |
| `PARALLEL_SLOTS` | Concurrent request slots |
| `FLASH_ATTENTION` | Enables faster inference and lower memory use |
| `CACHE_TYPE_K` / `CACHE_TYPE_V` | KV cache quantization |

## Changing Models

1. Download the new GGUF file into `~/models/`.
2. Edit the config for your GPU:
   ```bash
   sudo nano /etc/llama-server/rtx-5090.conf
   ```
3. Update:
   - `MODEL`
   - `HF_REPO`
   - `HF_FILE`
   - `ALIAS`
4. Restart the service:
   ```bash
   sudo systemctl restart llama-server
   ```

This automation path is for `llama.cpp` + GGUF models. If a model is not packaged as GGUF or requires another runtime, treat it as a separate serving path instead of forcing it into `/etc/llama-server/*.conf`.

## Model-Specific Notes

- For `Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF`, use the language-model GGUF directly in this service.
- For `LilaRest/gemma-4-31B-it-NVFP4-turbo`, use a separate `vLLM` server. Do not try to wire it into the current `llama.cpp` service config.

See [MODELS.md](MODELS.md) for the exact commands and runtime distinctions.
