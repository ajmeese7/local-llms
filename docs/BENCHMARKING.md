# Benchmarking

This repo includes a helper at [`scripts/benchmark.sh`](../scripts/benchmark.sh) for repeatable local benchmarks. Results are written under `./benchmark-results/`.

## Benchmark Layers

Use three levels of comparison:

1. Raw engine speed
2. API latency and throughput
3. Task quality

Keep comparisons fair:

- Use the same prompt length, max output tokens, temperature, and concurrency.
- Restart the server or discard the first run if you want to reduce warmup effects.
- Record GPU, driver, CUDA version, context length, and quantization.

For selector-backed profiles, also record the active `MODEL_PROFILE`. Some overlays carry decoding defaults. In particular, `gemma4-e4b-obliterated` injects `--temp 0.7 --top-p 0.9 --top-k 40 --repeat-penalty 1.1` through the launcher.

## 1. Raw llama.cpp throughput

Use `llama-bench` for GGUF runtime comparisons:

```bash
~/.local/share/llama.cpp/build/bin/llama-bench \
  -m ~/models/mythos-26b-a4b-prism-pro-dq.gguf
```

Or use the helper:

```bash
./scripts/benchmark.sh llama-bench \
  --model-file ~/models/mythos-26b-a4b-prism-pro-dq.gguf \
  --runs 3 \
  --label mythos-llama-bench
```

```bash
./scripts/benchmark.sh llama-bench \
  --model-file ~/models/gemma-4-E4B-it-OBLITERATED-Q4_K_M.gguf \
  --runs 3 \
  --label gemma4-e4b-obliterated-llama-bench
```

Look at the `pp` and `tg` rows in each log:

- `pp` measures prompt processing throughput
- `tg` measures token generation throughput

## 2. API latency and throughput

If you want end-to-end timing against an OpenAI-compatible server, use `vllm bench serve` or the local helper.

### Using vLLM's benchmark tool

```bash
vllm bench serve \
  --backend openai \
  --base-url http://127.0.0.1:8000 \
  --endpoint /v1/completions \
  --dataset-name random \
  --model MYTHOS-26B-A4B \
  --num-prompts 200 \
  --input-len 2048 \
  --output-len 256 \
  --request-rate 1
```

Repeat against the Gemma server on port `8001`.

### Using the repo helper

```bash
./scripts/benchmark.sh api \
  --base-url http://127.0.0.1:8000/v1 \
  --model MYTHOS-26B-A4B \
  --iterations 5 \
  --max-tokens 256 \
  --label mythos-api

./scripts/benchmark.sh api \
  --base-url http://127.0.0.1:8000/v1 \
  --model gemma-4-E4B-it-OBLITERATED \
  --iterations 5 \
  --max-tokens 256 \
  --label gemma4-e4b-obliterated-api

./scripts/benchmark.sh api \
  --base-url http://127.0.0.1:8001/v1 \
  --model LilaRest/gemma-4-31B-it-NVFP4-turbo \
  --iterations 5 \
  --max-tokens 256 \
  --label gemma-nvfp4-api
```

Each run stores:

- Request metadata
- Raw response JSON
- Per-run latency metrics
- A TSV summary with derived completion tokens/sec when usage data is available

## Compare saved API runs

Once you have saved a few `api` runs, generate a Markdown comparison table:

```bash
./scripts/benchmark.sh compare \
  --run-dir ./benchmark-results/20260414-101500-mythos-api \
  --run-dir ./benchmark-results/20260414-102200-gemma-nvfp4-api \
  --output ./benchmark-results/model-comparison.md
```

The compare mode is intentionally narrow. It aggregates structured API timings only. Keep the raw `llama-bench` logs and `lm-eval` outputs for deeper inspection.

## 3. Task quality with lm-eval

Use EleutherAI's `lm-evaluation-harness` against your local API:

```bash
pip install "lm_eval[api]"

export OPENAI_API_KEY=your-configured-api-key  # only if the local server requires auth

lm_eval \
  --model local-completions \
  --tasks gsm8k,hellaswag,mmlu \
  --model_args model=MYTHOS-26B-A4B,base_url=http://127.0.0.1:8000/v1/completions,num_concurrent=1,max_retries=3,tokenized_requests=False,batch_size=1
```

Helper version:

```bash
./scripts/benchmark.sh lm-eval \
  --base-url http://127.0.0.1:8000/v1/completions \
  --model MYTHOS-26B-A4B \
  --tasks gsm8k,hellaswag,mmlu \
  --limit 50 \
  --label mythos-lm-eval
```

Repeat against the Gemma endpoint on port `8001`.

## 4. Perplexity on your own corpus

If your workload looks more like “fit on my own docs or codebase” than public benchmarks, use `llama-perplexity`:

```bash
~/.local/share/llama.cpp/build/bin/llama-perplexity \
  -m ~/models/mythos-26b-a4b-prism-pro-dq.gguf \
  -f ./sample-corpus.txt
```

Only compare perplexity on the exact same corpus.

## 5. Coding-task evaluation with SWE-bench

If software engineering is the main use case, add SWE-bench as a later-stage benchmark after speed and general quality checks.

Recommended order:

1. `llama-bench` or `api` mode to eliminate slow candidates
2. `lm-eval` for quick quality sanity checks
3. SWE-bench Lite or a small verified subset for software-task capability

See [SWE-BENCH.md](SWE-BENCH.md) for the dedicated playbook.

## Simple Benchmark Sheet

| Model | Runtime | Prompt len | Output len | Req/s | TTFT | tok/s | Task score notes |
|---|---|---|---|---|---|---|---|
| MYTHOS-26B-A4B | llama.cpp | 2048 | 256 | 1 | | | |
| gemma-4-E4B-it-OBLITERATED | llama.cpp | 2048 | 256 | 1 | | | |
| gemma-4-31B-it-NVFP4-turbo | vLLM | 2048 | 256 | 1 | | | |
