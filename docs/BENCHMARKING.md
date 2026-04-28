# Benchmarking

Use [`scripts/benchmark.sh`](../scripts/benchmark.sh). This guide intentionally avoids raw runtime commands and one-off API recipes. If the repo has benchmark automation, the docs should use that automation.

Results are written under `./benchmark-results/`.

## What Works From This Repo

| Benchmark | Command | Requires |
|---|---|---|
| Active API aliases | `models` | Running `llama-server`, `curl`, `python3` |
| API latency and output speed | `api` | Running `llama-server`, `curl`, `python3` |
| Saved API run comparison | `compare` | API benchmark result directories, `python3` |
| Raw GGUF runtime speed | `llama-bench` | `llama.cpp` built by `setup.sh` |

`setup.sh` builds `llama.cpp` under `~/.local/share/llama.cpp`. That build normally provides `llama-server` and `llama-bench`. If `llama-bench` is missing, rerun `./setup.sh` and choose the rebuild path.

## Before Running

Start from a working service:

- `./setup.sh` has completed.
- `sudo /etc/llama-server/select-model.sh` has selected an installed profile.
- `http://127.0.0.1:9999/v1/models` responds from the local machine.

If `API_KEY` is set in the runtime GPU config, either export the same value as `API_KEY` or pass `--api-key` to the helper.

## Check The Active Alias

```bash
./scripts/benchmark.sh models
```

This prints the model aliases exposed by the active OpenAI-compatible endpoint. The `api` command also auto-detects the first alias, so this is mainly a sanity check.

## API Benchmark

```bash
./scripts/benchmark.sh api \
  --iterations 5 \
  --max-tokens 256 \
  --label active-api
```

By default this targets `http://127.0.0.1:9999/v1`, auto-detects the first model alias from `/models`, sends completion requests, and stores:

- `request.txt`: endpoint, model, mode, iterations, token limit, temperature
- `response-*.json`: raw responses
- `metrics-*.txt`: curl timing data
- `summary.tsv`: per-run metrics
- `summary.txt`: averages across successful runs

Use chat mode only when you specifically want to benchmark `/v1/chat/completions`:

```bash
./scripts/benchmark.sh api \
  --mode chat \
  --iterations 5 \
  --max-tokens 256 \
  --label active-chat-api
```

For a second local endpoint, keep the same helper and change only the base URL:

```bash
./scripts/benchmark.sh api \
  --base-url http://127.0.0.1:8001/v1 \
  --iterations 5 \
  --max-tokens 256 \
  --label endpoint-8001-api
```

## Raw llama.cpp Benchmark

```bash
./scripts/benchmark.sh llama-bench \
  --runs 3 \
  --label active-llama-bench
```

Without `--model-file`, the helper resolves the active runtime model from the GPU config, `/etc/llama-server/active-model.conf`, and the selected model overlay. Use this when comparing GGUF runtime throughput without HTTP overhead.

Each run stores a raw `llama-bench` log. Inspect the `pp` and `tg` rows:

- `pp`: prompt processing throughput
- `tg`: token generation throughput

## Compare API Runs

After saving two or more API runs, compare them with the helper:

```bash
./scripts/benchmark.sh compare \
  --run-dir ./benchmark-results/20260414-101500-active-api \
  --run-dir ./benchmark-results/20260414-102200-active-chat-api \
  --output ./benchmark-results/model-comparison.md
```

The compare mode intentionally reads only structured `api` outputs. It does not parse `llama-bench` logs.

## Fair Comparisons

Keep these fixed when comparing models or endpoints:

- Prompt text
- `--mode`
- `--max-tokens`
- Temperature
- Concurrency, if you add it later
- GPU, driver, CUDA version, context length, and quantization
- Active `MODEL_PROFILE`

Some overlays carry decoding defaults. Record the active profile with the result when comparing it to another model.

## What This Guide Does Not Cover

This guide is for benchmarks the repo can run through its own helper. External quality suites are separate projects with their own setup, dependencies, and failure modes. They should not be mixed into this basic throughput guide unless this repo grows first-class scripts for installing and running them.
