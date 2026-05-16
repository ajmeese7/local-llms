# Benchmarking

The eval plane drives an OpenAI-compatible endpoint and writes a per-run directory under `bench/reports/`. Every run carries a manifest (model + provider + decode + dataset + adapter fingerprints) so two runs can be compared apples-to-apples.

## TL;DR

```sh
uv run llms endpoint status          # is chat-default (or whatever) the active endpoint?
just bench-suite chat-default 50     # local_smoke + niah + gsm8k(50) + mmlu(50), then refresh the hub
cd bench && python3 -m http.server 5173
# open http://localhost:5173
```

The endpoint must already be served by llama-server / ik_llama_cpp. The bench harness hits the running endpoint, it doesn't spin servers up for you.

## 5090 endpoints

| Endpoint         | Profile                  | Notes |
|------------------|--------------------------|-------|
| `chat-default`   | qwen36-27b               | the daily driver |
| `chat-aeon`      | qwen36-27B-AEON          | uncensored variant |
| `chat-carnice`   | carnice-v2-27b           | |
| `chat-mythos`    | mythos                   | MYTHOS-26B-A4B |
| `chat-a3b`       | qwen36-35B-A3B           | Q5_K_P, multimodal |
| `chat-a3b-ngram` | qwen36-35B-A3B-q4-ngram  | Q4_K_P + ngram speculation |

`chat-9b` is the 5060 Ti endpoint; skip it on the 5090.

## Just recipes

| Recipe | What it does |
|---|---|
| `just bench-suite ENDPOINT [MAX_ITEMS]` | Runs `local_smoke`, `niah`, `gsm8k`, `mmlu` against `ENDPOINT`. Caps `mmlu` / `gsm8k` at `MAX_ITEMS` (default 50). Refreshes the hub at the end. |
| `just bench-full ENDPOINT` | Same as `bench-suite` but with the full `mmlu` (~14k) and `gsm8k` (~1.3k) splits. Hours, not minutes. |
| `just bench-frontend-agentic ENDPOINT [SUBSET]` | The 17-prompt front-end + agentic suite (~25 min wall). Excluded from `bench-suite` because of the runtime. |

Sweep every 5090 endpoint, capped:

```sh
for ep in chat-default chat-aeon chat-carnice chat-mythos chat-a3b chat-a3b-ngram; do
  just bench-suite "$ep" 50
done
```

Full splits instead: swap `bench-suite "$ep" 50` for `bench-full "$ep"`.

Each sweep drops one bench card per `(rtx-5090, model_profile)` pair. Re-runs append to existing cells, they don't replace them. Subset re-runs (e.g. `--subset design`) attach as **partial re-runs** under the same cell rather than spawning a new capability (same drill-down, ratings keyed by the partial run's own comparability_key).

## Running individual adapters

```sh
uv run llms eval run <adapter> --endpoint <name> \
    [--provider <p>] [--max-items N] [--subset spec] [--seed 0] \
    [--skip-preflight] [--max-consecutive-errors N] [--yes]
```

Sanity-check the stack before a long run:

```sh
uv run llms endpoint status              # which endpoint is active
uv run llms model status chat-default    # is the .gguf actually on disk?
curl -s http://127.0.0.1:9999/v1/models  # llama-server reachable?
```

Drive an adapter:

```sh
uv run llms eval run local_smoke --endpoint chat-default       # ~5 items, sanity check
uv run llms eval run gsm8k       --endpoint chat-default -n 50 # ~2 min on a 5090
uv run llms eval run niah        --endpoint chat-default       # 9 items, 3 lengths x 3 depths
uv run llms eval run frontend_agentic --endpoint chat-default  # 17-prompt FE + agentic suite, ~25 min
```

`-n` (`--max-items`) caps `mmlu` and `gsm8k`. `local_smoke`, `niah`, and `frontend_agentic` ignore it (their item counts are fixed by construction).

Filter to a slice of an adapter with `--subset`:

```sh
# mmlu by subject:
uv run llms eval run mmlu --endpoint chat-default -n 100 \
    --subset abstract_algebra,college_physics

# frontend_agentic by category (design | canvas | agentic):
uv run llms eval run frontend_agentic --endpoint chat-default --subset design

# frontend_agentic by individual prompt id:
uv run llms eval run frontend_agentic --endpoint chat-default \
    --subset design_saas_landing,design_pricing_page
```

After a run, refresh the hub registry:

```sh
uv run llms eval report
```

## Safety rails

The runner won't blindly burn through a suite when the backend is broken:

- **Missing model file**: before resolving anything else, the CLI checks the profile's `model_path` (and `mmproj_path`) exist. Missing files trigger an interactive "download from Hugging Face?" prompt (or a clean exit-2 error under non-TTY contexts; pass `--yes` to accept, or pre-fetch with `llms model fetch <profile>`).
- **Pre-flight HTTP check**: a `GET /v1/models` ping against the endpoint URL before the first prompt. A crash-looping systemd unit shows up as `EndpointUnreachableError` in milliseconds rather than 17 connect timeouts. Pass `--skip-preflight` for servers that don't implement that route.
- **Early abort**: tracks consecutive connectivity failures (connect refused, timeout, reset) and aborts after `--max-consecutive-errors` (default 1). HTTP 200 with bad content never counts; that's a model quality signal, not infrastructure. Aborted runs emit a partial summary with an `aborted_reason` so the registry doesn't claim they finished.

## Comparing backends on the same model

`--provider` on both `endpoint activate` and `eval run` swaps the inference backend without authoring a new endpoint YAML. The active revision persists the override (the systemd unit picks up the right binary on restart), and the eval manifest records it (the two runs land in distinct comparability cells):

```sh
uv run llms endpoint activate chat-carnice --provider ik_llama.cpp
sudo systemctl restart llama-server
just bench-suite chat-carnice 50        # records ik_llama.cpp in every manifest

# ...or pass it per-run when mixing backends:
uv run llms eval run frontend_agentic --endpoint chat-carnice --provider ik_llama.cpp
```

## Adapters

| Adapter | Track | Source | What it measures |
|---|---|---|---|
| `local_smoke` | `smoke` | bundled 5-prompt set | Keyword rubric covering coding, ops, creative, long-context |
| `mmlu` | `general_capability` | `cais/mmlu`, split=test | 4-choice MCQ across 57 academic subjects |
| `gsm8k` | `general_capability` | `gsm8k`, split=test | Grade-school math, exact-match on the final integer |
| `niah` | `reliability_factuality` | synthesized in package | Long-context recall: a unique secret code embedded in filler text |
| `frontend_agentic` | `general_capability` | bundled 17-prompt JSON | 5 web-design briefs + 6 canvas/WebGL + 6 agentic reasoning tasks, keyword rubric scoring. See [FRONTEND_AGENTIC_EVAL.md](FRONTEND_AGENTIC_EVAL.md). |

Deferred adapters (HumanEval, SWE-ReBench, MMMU) are tracked in [ROADMAP.md](ROADMAP.md).

`local_smoke` is the fastest sanity check; the response satisfies it deterministically when the model behaves. `mmlu` and `gsm8k` need the `eval` extra (`uv sync --extra eval`) to fetch the HuggingFace datasets. `niah` needs nothing external.

## Comparability

Every manifest carries `comparability_key`: a SHA-256 over the model fingerprint, provider build, decode params, prompt template version, dataset slice, adapter version, and scorer version. Two runs with matching keys are directly comparable. The hub groups them in the "Comparable groups" panel.

`--seed` is included in the manifest but not in the comparability key, since changing the seed should not invalidate a comparison; only changes that affect the score should.

### Fair comparisons

The comparability key catches most reproducibility failures, but lock these down by hand when running comparisons:

- Same GPU, driver, CUDA version, llama.cpp commit. The provider git commit field on the manifest is currently `null`; capture it manually until `llms provider install` populates it.
- Same context length and quantization (already in the comparability key).
- Same prompt template version. The adapter pins this; bumping it produces a different key and the hub flags incomparable runs.

## Browsing runs

Each run writes:

```
bench/reports/<run-id>/
  manifest.json    full fingerprint + comparability key
  summary.json     accuracy with bootstrap 95% CI, by-category, latency percentiles
  results.jsonl    one row per item: parsed answer, score, timing
  report.md        readable summary
  report.html      self-contained standalone page
```

CLI:

```sh
uv run llms eval list
uv run llms eval show <run-id>
uv run llms eval report                    # rebuild bench/reports/{reports,profiles}.json
```

Then serve the static hub at `bench/`:

```sh
cd bench && python3 -m http.server 5173
# open http://localhost:5173
```

Each completed adapter run shows up as a cell on the matching bench card. The GPU state ribbon picks up boost / app clock / mem clock / power limit / persistence mode from the manifest, so any OC profile shifts between runs are visible per-cell.

To populate the hub with mock-transport demo data without a live llama-server:

```sh
uv run python scripts/seed_hub.py
uv run llms eval report
```

## Endpoint URL override

The runner derives the endpoint URL from the resolved runtime config (`http://<host>:<port>`). Pass `--base-url` to point at a hosted endpoint, a colocated llama-server on a non-default port, or a remote inference box.

## Telemetry

The runner appends per-request rows to `~/.local/state/llms/requests.jsonl`. Aggregate windows:

```sh
uv run llms endpoint stats --window 24h
```

## Building providers separately

If you only want the build path (no full setup), either of these works:

```sh
uv run llms provider install llama.cpp
uv run llms provider install ik_llama.cpp --rebuild --jobs 4

# Equivalent: the CLI wrapper shells out to this script under the hood.
./scripts/provider.sh install ik_llama.cpp --rebuild --jobs 4
```
