# bench

Static SPA over v2 eval runs. No build step (Babel-in-browser, React via CDN).

## Layout

```
bench/
  index.html
  app.jsx data.jsx components.jsx home.jsx sections.jsx
  reports/
    reports.json                     # registry index
    <run-id>/
      manifest.json                  # full run fingerprint
      summary.json                   # aggregated metrics
      results.jsonl                  # per-item rows
      report.html report.md          # standalone per-run views
```

## Workflow

Real runs land in `reports/<run-id>/` straight from `llms eval run`. The
SPA needs `reports/reports.json` to know they exist; refresh after a run:

```
uv run llms eval report
```

To populate the hub with mock-transport demo data (no live llama-server
needed):

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

Loaded by `data.jsx`:

- `loadIndex()` reads `reports/reports.json` (a registry built from each
  run's `manifest.json` + `summary.json`).
- `loadRun(id)` lazily fetches the run's `manifest.json`, `summary.json`,
  `results.jsonl`. The SPA renders a flat run list at `#/` and a per-run
  detail view at `#/run/<id>` with summary cards, by-category breakdown,
  per-item table, and a manifest disclosure.

The "Comparable groups" panel groups runs by their `comparability_key`
(SHA-256 of model + provider + decode + prompt + dataset + adapter
fingerprints).
