# Models

## Model Recommendations

### RTX 5090 (32GB VRAM)

With Q4_K_M quantization, models up to about the high-20B/low-30B range fit comfortably in VRAM. Larger models such as 70B can still be attempted with CPU offload, but they do not fit cleanly in 32GB by themselves. Blackwell-specific FP4 runtimes also become viable here.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.6-27B | llama.cpp | Q5_K_XL | varies by artifact | Default RTX 5090 profile in this repo; enables Jinja and uses a 262K context override |
| Qwen3.6-27B AEON | llama.cpp | Q6_K | varies by artifact | RTX 5090 experiment profile; enables Jinja and uses a 262K context override |
| Qwen3.6-35B-A3B HauhauCS | llama.cpp | Q5_K_P | varies by artifact | RTX 5090 experiment profile; enables Jinja and can load the matching projector when `MMPROJ` is set |
| Qwen3.6-35B-A3B HauhauCS ngram | llama.cpp | Q4_K_P | varies by artifact | RTX 5090 experimental profile with 262K context, parallel 4, f16 unified KV, and ngram-mod speculative decoding |
| MYTHOS-26B-A4B-PRISM-PRO-DQ | llama.cpp | PRISM-DQ GGUF | ~17GB | Supported RTX 5090 profile via `mythos` |
| Gemma 4 31B IT NVFP4 Turbo | vLLM | NVFP4 | ~18.5 GiB GPU memory | Best treated as a separate Blackwell-only server |
| Llama-3.1-70B | llama.cpp | Q4_K_M | ~40GB | Needs CPU offload for some layers |

### RTX 5060 Ti (16GB VRAM)

With Q4_K_M, models up to about 14B fit comfortably.

| Model | Runtime | Quant | Size | Notes |
|---|---|---|---|---|
| Qwen3.5-9B | llama.cpp | Q4_K_M | ~5.5GB | Default 5060 Ti profile |
| Llama-3.1-8B | llama.cpp | Q4_K_M | ~4.9GB | Fast and dependable |

## Unique Model Profiles

### gemma-4-31B-it-NVFP4-turbo

`LilaRest/gemma-4-31B-it-NVFP4-turbo` is not a `llama.cpp` / GGUF model. The model card documents it as a Blackwell-focused `vLLM` deployment.

Expected runtime requirements:

- `vllm >= 0.19`
- CUDA 13.0
- `--quantization modelopt`
- Blackwell GPU with at least 20 GB VRAM

This remains a strong RTX 5090 experiment, but it belongs on a separate `vLLM` server rather than inside this `llama-server`-based service.

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

## Downloading model files

Every profile YAML carries `hf_repo` and `hf_file` (and `mmproj_hf_file` if the model needs a vision projector). The launcher won't start without those files on disk; pre-fetch them with:

```sh
uv run llms model status <profile>     # check whether the .gguf is there
uv run llms model fetch <profile>      # download missing files (prompts)
uv run llms model fetch <profile> --yes
```

`endpoint activate` and `eval run` both run the same check and offer the same prompt before doing anything else — no more discovering at journalctl time that the file isn't there.

## Practical Notes

- If you run out of VRAM, reduce `CONTEXT_LENGTH` before switching to a smaller model. The `q4_0` KV cache also helps.
- If a model card shows `llama-cli --jinja`, set `JINJA="on"` in that profile overlay. The Qwen overlays in this repo already do this.
- If a model card shows `--mmproj`, set `MMPROJ` and `MMPROJ_HF_FILE` in the overlay before selecting that profile. The launcher will pass `--mmproj`, and the selector can download the projector when the metadata is present.
- For repeated long-context workloads, `qwen36-35B-A3B-q4-ngram` enables `--spec-type ngram-mod --spec-ngram-size-n 24 --draft-max 48 --draft-min 12`. Newer llama.cpp builds can use `SPEC_DEFAULT="on"` for the upstream shortcut instead.

## Related Guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [BENCHMARKING.md](BENCHMARKING.md)
