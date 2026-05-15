# bench

Static SPA over eval runs. No build step (Babel-in-browser, React via CDN).

## Layout

```
bench/
  index.html
  app.jsx data.jsx components.jsx home.jsx sections.jsx
  reports/
    reports.json                     # registry index (reports + suites)
    profiles.json                    # config snapshot
    <run-id>/
      manifest.json                  # full run fingerprint (incl. hardware/server)
      summary.json                   # aggregated metrics
      results.jsonl                  # per-item rows
      report.html report.md          # standalone per-run views
```

## Workflow

`llms eval run` writes one directory per run under `reports/`. The SPA needs `reports.json` (and `profiles.json` for the guide) to know what is available; refresh after a run:

```sh
uv run llms eval report
```

To populate the hub with mock-transport demo data without a live llama-server:

```sh
uv run python scripts/seed_hub.py
uv run llms eval report
```

To serve locally:

```sh
cd bench && python3 -m http.server 5173
```

Then open <http://127.0.0.1:5173/>.

## Publishing to GitHub Pages

The repo ships a `.github/workflows/pages.yml` job that deploys `bench/` to GitHub Pages on every push to `master`. Enable Pages in the repo settings (Source: GitHub Actions) and the next push will publish.

`bench/reports/` is gitignored by default — the upstream repo's hub deploys empty, with the SPA chrome but no runs. To publish your own runs, you have two options:

1. **Force-add specific runs on master** (or a deploy branch):

   ```sh
   uv run llms eval run local_smoke --endpoint chat-default
   uv run llms eval report
   git add -f bench/reports/<run-id>/ bench/reports/reports.json bench/reports/profiles.json
   git commit -m "publish: <run-id>"
   git push
   ```

   The `-f` is required because of `.gitignore`. Pick the runs you actually want public; results.jsonl bloats fast.

2. **Maintain a deploy fork or branch** where `bench/reports/` is removed from `.gitignore` and every `llms eval report` commit lands. Upstream stays clean, your deploy is always fresh.

## Schema (registry v5)

- `loadIndex()` reads `reports/reports.json`, built by `llms eval report` from each run's `manifest.json` + `summary.json`.
- `benches` group reports by `(hardware_profile, model_profile)` — one bench per GPU + model on the host. Each bench owns capability **cells**.
- `cells` are bucketed by a `parent_key`: the same SHA-256 used for the run's full `comparability_key` but with `dataset.subset`, `dataset.item_count`, and `decode.max_tokens` cleared. Subset re-runs (e.g. `--subset design`) therefore land inside the cell of the full run they were carved from instead of inflating the "CAPABILITIES" count.
- Within a cell:
  - `history_ids` — full runs (subset=None), newest first.
  - `partial_runs` — subset re-runs, listed separately (click-through routes to `#/bench/<id>/prompts/<adapter>/<runId>`).
  - `partial_only: true` when the only runs against this parent_key are subset runs.
- `loadProfilesSnapshot()` reads `reports/profiles.json`, a flat snapshot of the active config tree.
- `loadBench(id)` lazily fetches each cell's latest run; `loadRun(id)` is used by the partial-re-run drilldown to pull a specific run on demand.

The home page shows a per-bench card grid. Each bench has three tabs:

- **Overview** — capability cells with rollup metrics, cleanliness grid, and optional cross-bench leaderboards. Cells expose `▸ history (N earlier)` and `▸ partial re-runs (N)` disclosures for drill-down.
- **Prompts** — per-item runs from the selected cell (or partial re-run). A run picker toggles between "Full run" and each partial; ratings are scoped to the active run's `comparability_key`.
- **Config** — profile + provider + hardware fingerprint for the bench.
