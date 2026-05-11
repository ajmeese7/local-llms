# Running benches on the 5090

Each `just bench-suite ENDPOINT [MAX_ITEMS]` recipe:
1. Runs `local_smoke`, `niah`, `gsm8k` (capped to `MAX_ITEMS` items, default 50), and `mmlu` (also capped) against the endpoint.
2. Calls `llms eval report` to regenerate `bench/reports/reports.json`.

`bench-full` is the same thing without item caps. Slow, but it gives you the full dataset.

The endpoint must already be serving (its profile loaded into llama-server / ik_llama_cpp). The bench harness just hits the running endpoint, it doesn't spin servers up for you — but it does check first:

- The eval-run preflight pings `GET /v1/models` and bails fast if the server isn't responding. No more "17 consecutive connect timeouts" on a dead service.
- It also checks the profile's `model_path` is on disk *before* hitting HTTP, and offers to download from `hf_repo`/`hf_file` if not. Pre-fetch with `llms model fetch <profile>` if you'd rather not deal with the prompt.

To compare the same model against two backends, pass `--provider` to both `endpoint activate` (server-side: pins the binary on next restart) and `eval run` (manifest: records which backend served the responses):

```bash
llms endpoint activate chat-carnice --provider ik_llama.cpp
sudo systemctl restart llama-server
just bench-suite chat-carnice 50          # records the active provider in manifests
# ...or pass it explicitly per-eval-run if you're mixing backends:
llms eval run frontend_agentic --endpoint chat-carnice --provider ik_llama.cpp
```

---

## Default sweep (Qwen3.6-27B on the 5090)

```bash
just bench-suite chat-default 50
```

Same thing, full splits:

```bash
just bench-full chat-default
```

---

## Every 5090 endpoint, capped

```bash
for ep in chat-default chat-aeon chat-carnice chat-mythos chat-a3b chat-a3b-ngram; do
  just bench-suite "$ep" 50
done
```

Drops one bench card per `(rtx-5090, model_profile)` pair. Re-runs append to existing cells, they don't replace them. Subset re-runs (e.g. `llms eval run frontend_agentic --subset design`) attach as **partial re-runs** under the same cell rather than spawning a new capability — same drill-down, ratings keyed by the partial run's own comparability_key.

## Every 5090 endpoint, full

```bash
for ep in chat-default chat-aeon chat-carnice chat-mythos chat-a3b chat-a3b-ngram; do
  just bench-full "$ep"
done
```

## Endpoint list (5090 only)

| Endpoint         | Profile                  | Notes |
|------------------|--------------------------|-------|
| `chat-default`   | qwen36-27b               | the daily driver |
| `chat-aeon`      | qwen36-27B-AEON          | uncensored variant |
| `chat-carnice`   | carnice-v2-27b           | |
| `chat-mythos`    | mythos                   | MYTHOS-26B-A4B |
| `chat-a3b`       | qwen36-35B-A3B           | Q5_K_P, multimodal |
| `chat-a3b-ngram` | qwen36-35B-A3B-q4-ngram  | Q4_K_P + ngram speculation |

`chat-9b` is the 5060 Ti one — skip it on the 5090.

---

## After the runs land

```bash
cd bench && python -m http.server 5173
# open http://localhost:5173
```

Each completed adapter run shows up as a cell on the matching bench card. The GPU state ribbon picks up boost / app clock / mem clock / power limit / persistence mode from the new manifest fields, so any OC profile shifts between runs are visible per-cell.
