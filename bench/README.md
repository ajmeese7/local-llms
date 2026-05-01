# bench

Static SPA over eval runs. No build step (Babel-in-browser, React via CDN).

## Layout

```
bench/
  index.html
  app.jsx data.jsx components.jsx home.jsx sections.jsx guide.jsx
  reports/
    reports.json                     # registry index
    profiles.json                    # config snapshot for the guide cards
    <run-id>/
      manifest.json                  # full run fingerprint
      summary.json                   # aggregated metrics
      results.jsonl                  # per-item rows
      report.html report.md          # standalone per-run views
```

## Workflow

`llms eval run` writes one directory per run under `reports/`. The SPA needs `reports.json` (and `profiles.json` for the guide) to know what is available; refresh after a run:

```
uv run llms eval report
```

To populate the hub with mock-transport demo data without a live llama-server:

```
uv run python scripts/seed_hub.py
uv run llms eval report
```

To serve locally:

```
cd bench && python -m http.server 5173
```

Then open <http://127.0.0.1:5173/>.

## Schema

- `loadIndex()` reads `reports/reports.json`, built by `llms eval report` from each run's `manifest.json` + `summary.json`.
- `loadProfilesSnapshot()` reads `reports/profiles.json`, a flat snapshot of the active config tree the guide section renders.
- `loadRun(id)` lazily fetches the run's `manifest.json`, `summary.json`, `results.jsonl`. The detail view at `#/run/<id>` renders summary cards, by-category breakdown, per-item table, and a manifest disclosure.

The home page shows a flat run list with adapter and track filters, a comparable-groups panel that groups runs sharing a `comparability_key`, and the model reading guide.
