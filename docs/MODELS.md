# Models

## Model Recommendations

### RTX 5090 (32GB VRAM)

With Q4_K_M quantization, models up to about the high-20B/low-30B range fit comfortably in VRAM. Larger models such as 70B can still be attempted with CPU offload, but they do not fit cleanly in 32GB by themselves. Blackwell-specific FP4 runtimes also become viable here.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.5-27B | llama.cpp | Q4_K_M | 16.5GB | Default profile for this repo on RTX 5090 |
| Qwen3.5-27B | llama.cpp | Q8_0 | 28.6GB | Higher quality, shorter context |
| MYTHOS-26B-A4B-PRISM-PRO-DQ | llama.cpp | PRISM-DQ GGUF | ~17GB | Supported RTX 5090 profile via `mythos` |
| Gemma 4 31B IT NVFP4 Turbo | vLLM | NVFP4 | ~18.5 GiB GPU memory | Best treated as a separate Blackwell-only server |
| Llama-3.1-70B | llama.cpp | Q4_K_M | ~40GB | Needs CPU offload for some layers |

### RTX 5060 Ti (16GB VRAM)

With Q4_K_M, models up to about 14B fit comfortably.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.5-9B | llama.cpp | Q4_K_M | ~5.5GB | Great balance of speed and quality |
| Qwen2.5-14B | llama.cpp | Q4_K_M | ~8.5GB | Larger model, shorter context |
| Llama-3.1-8B | llama.cpp | Q4_K_M | ~4.9GB | Fast and dependable |

## Supported RTX 5090 Profiles

### MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF

`Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF` is a supported RTX 5090 profile in this repo. The runtime uses the `mythos` overlay plus the RTX 5090 base config, and the selector writes the active choice to `/etc/llama-server/active-model.conf`.

Use the language-model file only for the service:

- Base model: `google/gemma-4-26B-A4B-it`
- Quantization: PRISM dynamic quantization
- Language model file: `mythos-26b-a4b-prism-pro-dq.gguf`
- Optional vision projector: `mmproj-mythos-26b-a4b-prism-pro.gguf`
- Text-only size: about 17 GB

On this repo, Mythos is the normal alternate profile on RTX 5090, not a one-off example config. Install the GGUF, run `sudo /etc/llama-server/select-model.sh`, and choose `mythos` to switch to it.

Download:

```bash
curl -L --progress-bar \
  https://huggingface.co/Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF/resolve/main/mythos-26b-a4b-prism-pro-dq.gguf \
  -o ~/models/mythos-26b-a4b-prism-pro-dq.gguf

curl -L --progress-bar \
  https://huggingface.co/Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF/resolve/main/mmproj-mythos-26b-a4b-prism-pro.gguf \
  -o ~/models/mmproj-mythos-26b-a4b-prism-pro.gguf
```

Example config values:

```bash
MODEL="$HOME/models/mythos-26b-a4b-prism-pro-dq.gguf"
HF_REPO="Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF"
HF_FILE="mythos-26b-a4b-prism-pro-dq.gguf"
ALIAS="MYTHOS-26B-A4B"
```

### gemma-4-31B-it-NVFP4-turbo

`LilaRest/gemma-4-31B-it-NVFP4-turbo` is not a `llama.cpp` / GGUF model. The model card documents it as a Blackwell-focused `vLLM` deployment.

Expected runtime requirements:

- `vllm >= 0.19`
- CUDA 13.0
- `--quantization modelopt`
- Blackwell GPU with at least 20 GB VRAM

This remains a strong RTX 5090 experiment, but it belongs on a separate `vLLM` server rather than inside the `/etc/llama-server` model overlay workflow.

Quick start with Docker:

```bash
docker run --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -p 8001:8000 \
  vllm/vllm-openai:cu130-nightly \
  --model LilaRest/gemma-4-31B-it-NVFP4-turbo \
  --quantization modelopt \
  --max-model-len 16384 \
  --max-num-seqs 128 \
  --max-num-batched-tokens 8192 \
  --gpu-memory-utilization 0.95 \
  --kv-cache-dtype fp8 \
  --enable-prefix-caching \
  --trust-remote-code
```

That exposes a second OpenAI-compatible endpoint on `http://127.0.0.1:8001/v1`.

## Practical Notes

- `MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF` is realistic on 32 GB cards, but too large for the 16 GB profile in this repo.
- `mythos` is supported on RTX 5090 through the `SUPPORTED_MODEL_PROFILES="qwen35-27b mythos"` base config and the `mythos.conf` overlay.
- `gemma-4-31B-it-NVFP4-turbo` explicitly targets Blackwell FP4 tensor cores and the model card calls for at least 20 GB VRAM.
- If you run out of VRAM, reduce `CONTEXT_LENGTH` before switching to a smaller model. The `q4_0` KV cache also helps.

## Related Guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [BENCHMARKING.md](BENCHMARKING.md)
