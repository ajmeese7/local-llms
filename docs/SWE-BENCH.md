# SWE-bench

SWE-bench is the right benchmark if the question is "which model is better at software tasks?" rather than "which model is faster?"

## What SWE-bench Measures

SWE-bench evaluates whether a model can resolve real GitHub issues by producing a patch that actually fixes the problem in the target repository.

That makes it much closer to your intended usage than generic multiple-choice or short-form reasoning benchmarks.

## When to Use It

Use SWE-bench after you already know a model is operationally viable on your hardware.

Recommended sequence:

1. Use [BENCHMARKING.md](BENCHMARKING.md) to screen for latency and throughput.
2. Use `lm-eval` for a quick quality sanity check.
3. Use SWE-bench Lite or a small verified subset for software-task capability.

## Resource Requirements

The upstream project documents SWE-bench as a Docker-based evaluation harness and warns that evaluation is resource intensive.

Their README recommends:

- `x86_64` machine
- At least 120 GB free storage
- At least 16 GB RAM
- At least 8 CPU cores

If you are using Docker Desktop, make sure the virtual disk has enough free space. Their guidance also recommends keeping `--max_workers` below `min(0.75 * os.cpu_count(), 24)`.

## What This Repo Should Own

This repo is a good place to document:

- Which local model endpoints you want to test
- Which benchmark tier each model belongs to
- Which prompts, temperatures, and system settings you consider canonical

This repo should not try to replace the SWE-bench harness itself. SWE-bench is patch-evaluation infrastructure, not just a request-timing script.

## Minimal Local Playbook

### 1. Install SWE-bench

```bash
git clone https://github.com/swe-bench/SWE-bench.git
cd SWE-bench
pip install -e .
```

Validate the harness:

```bash
python3 -m swebench.harness.run_evaluation \
  --predictions_path gold \
  --max_workers 1 \
  --instance_ids sympy__sympy-20590 \
  --run_id validate-gold
```

### 2. Start the model endpoint you want to evaluate

Examples:

- `llama.cpp` service from this repo on `http://127.0.0.1:9999/v1`
- `vLLM` Gemma NVFP4 server on `http://127.0.0.1:8001/v1`

Before spending time on SWE-bench, verify that the endpoint is stable under your usual local prompt load.

### 3. Generate predictions

SWE-bench separates **inference** from **evaluation**.

The upstream docs describe inference tooling for:

- API-based models
- Local Llama-family models
- Live inference on open GitHub issues

Practical advice for your setup:

- If the upstream inference script cleanly supports your chosen serving path, use it.
- If you are serving through your own OpenAI-compatible local endpoint, verify whether the inference path you choose supports custom base URLs before you commit to a long run.
- If it does not, generate predictions with your own wrapper and feed the resulting predictions file into the evaluation harness.

The key contract is simple: produce a valid `predictions_path` artifact, then pass that to `run_evaluation`.

### 4. Evaluate predictions on SWE-bench Lite

```bash
python3 -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path <path_to_predictions> \
  --max_workers 1 \
  --run_id local-llm-check
```

This creates:

- Docker build logs under `logs/build_images`
- Evaluation logs under `logs/run_evaluation`
- Final results under `evaluation_results`

### 5. Compare models deliberately

For local model comparisons, keep these fixed across runs:

- Dataset split or subset
- Prompt format
- Temperature and sampling settings
- Retry policy
- Worker count
- Serving stack

If you change both the model and the surrounding agent/prompting workflow, the result stops being a clean model comparison.

## Recommended Starting Scope

For Mythos vs Gemma NVFP4 on your hardware:

1. Start with a very small subset to confirm the pipeline works end to end.
2. Move to SWE-bench Lite instead of the full benchmark first.
3. Only expand the run once you know the endpoint is stable and the predictions format is correct.

This will save you a lot of wasted time compared with launching a large run immediately.

## Related Guides

- [BENCHMARKING.md](BENCHMARKING.md)
- [MODELS.md](MODELS.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
