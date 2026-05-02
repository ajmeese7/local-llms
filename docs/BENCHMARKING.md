# Benchmarking

The eval plane drives an OpenAI-compatible endpoint and writes a per-run directory under `bench/reports/`. Every run includes a manifest with model + provider + decode + dataset + adapter fingerprints so two runs can be compared apples-to-apples.

## Running

```sh
uv run llms eval run <adapter> --endpoint <name> [--max-items N] [--subset spec] [--seed 0]
```

Each run writes:

```
bench/reports/<run-id>/
  manifest.json    full fingerprint + comparability key
  summary.json     accuracy with bootstrap 95% CI, by-category, latency percentiles
  results.jsonl    one row per item: parsed answer, score, timing
  report.md        readable summary
  report.html      self-contained standalone page
```

After a run, refresh the hub registry:

```sh
uv run llms eval report
```

## Adapters

| Adapter | Track | Source | What it measures |
|---|---|---|---|
| `local_smoke` | `smoke` | bundled 5-prompt set | Keyword rubric covering coding, ops, creative, long-context |
| `mmlu` | `general_capability` | `cais/mmlu`, split=test | 4-choice MCQ across 57 academic subjects |
| `gsm8k` | `general_capability` | `gsm8k`, split=test | Grade-school math, exact-match on the final integer |
| `niah` | `reliability_factuality` | synthesized in package | Long-context recall: a unique secret code embedded in filler text |

Deferred adapters (HumanEval, SWE-ReBench, MMMU) are tracked in [ROADMAP.md](ROADMAP.md).

`local_smoke` is the fastest sanity check; the response satisfies it deterministically when the model behaves. `mmlu` and `gsm8k` need the `eval` extra (`uv sync --extra eval`) to fetch the HuggingFace datasets. `niah` needs nothing external.

## Comparability

Every manifest carries `comparability_key`: a SHA-256 over the model fingerprint, provider build, decode params, prompt template version, dataset slice, adapter version, and scorer version. Two runs with matching keys are directly comparable. The hub groups them in the "Comparable groups" panel.

`--seed` is included in the manifest but not in the comparability key, since changing the seed should not invalidate a comparison; only changes that affect the score should.

## Endpoint URL override

The runner derives the endpoint URL from the resolved runtime config (`http://<host>:<port>`). Pass `--base-url` to point at a hosted endpoint, a colocated llama-server on a non-default port, or a remote inference box.

## Browsing runs

```sh
uv run llms eval list
uv run llms eval show <run-id>
uv run llms eval report                    # rebuild bench/reports/{reports,profiles}.json
```

The static hub at `bench/` reads those JSON files. Serve locally:

```sh
cd bench && python -m http.server 5173
```

To populate the hub with mock-transport demo data without a live llama-server:

```sh
uv run python scripts/seed_hub.py
uv run llms eval report
```

## Telemetry

The runner appends per-request rows to `~/.local/state/llms/requests.jsonl`. Aggregate windows:

```sh
uv run llms endpoint stats --window 24h
```

## Building providers separately

If you only want the build path (no full setup):

```sh
./scripts/provider.sh install llama.cpp
./scripts/provider.sh install ik_llama.cpp --rebuild --jobs 4
```

## Fair comparisons

The comparability key catches most reproducibility failures, but a few things to lock down by hand when running comparisons:

- Same GPU, driver, CUDA version, llama.cpp commit. The provider git commit field on the manifest is currently `null`; capture it manually until `llms provider install` populates it.
- Same context length and quantization (already in the comparability key).
- Same prompt template version. The adapter pins this; bumping it produces a different key and the hub flags incomparable runs.
