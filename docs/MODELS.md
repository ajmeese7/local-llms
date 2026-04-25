# Models

## Model Recommendations

### RTX 5090 (32GB VRAM)

With Q4_K_M quantization, models up to about the high-20B/low-30B range fit comfortably in VRAM. Larger models such as 70B can still be attempted with CPU offload, but they do not fit cleanly in 32GB by themselves. Blackwell-specific FP4 runtimes also become viable here.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.6-27B | llama.cpp | Q8_0 | 28.6GB | Default RTX 5090 profile in this repo; uses shorter 32K context |
| MYTHOS-26B-A4B-PRISM-PRO-DQ | llama.cpp | PRISM-DQ GGUF | ~17GB | Supported RTX 5090 profile via `mythos` |
| Gemma 4 E4B IT OBLITERATED | llama.cpp | Q4_K_M | 4.9GB | Supported on both GPUs via `gemma4-e4b-obliterated` |
| Gemma 4 31B IT NVFP4 Turbo | vLLM | NVFP4 | ~18.5 GiB GPU memory | Best treated as a separate Blackwell-only server |
| Llama-3.1-70B | llama.cpp | Q4_K_M | ~40GB | Needs CPU offload for some layers |

### RTX 5060 Ti (16GB VRAM)

With Q4_K_M, models up to about 14B fit comfortably.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.5-9B | llama.cpp | Q4_K_M | ~5.5GB | Default 5060 Ti profile |
| Gemma 4 E4B IT OBLITERATED | llama.cpp | Q4_K_M | 4.9GB | Supported alternate profile via `gemma4-e4b-obliterated` |
| Llama-3.1-8B | llama.cpp | Q4_K_M | ~4.9GB | Fast and dependable |

## Unique Model Profiles

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
  -p 8001:9999 \
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

- If you run out of VRAM, reduce `CONTEXT_LENGTH` before switching to a smaller model. The `q4_0` KV cache also helps.

## Related Guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [BENCHMARKING.md](BENCHMARKING.md)
