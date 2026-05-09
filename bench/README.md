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

- `loadIndex()` reads `reports/reports.json`, built by `llms eval report` from each run's `manifest.json` + `summary.json`. The registry's `suites` block groups runs by `comparability_key` (one suite = one adapter/dataset/decode, varying profiles).
- `loadProfilesSnapshot()` reads `reports/profiles.json`, a flat snapshot of the active config tree.
- `loadSuite(id)` lazily fetches each member run's `manifest.json`, `summary.json`, `results.jsonl`, then rolls them up into per-profile + per-prompt views.
- Profile config rendering reads from `profiles.json` (shipped by `llms eval report`); legacy `.conf` lookups were removed when the source-of-truth migrated to YAML.

The home page shows the latest suite as a hero, a suite grid, and a cross-suite leaderboard. Each suite report has five tabs:

- **Summary** — recommendations, bar chart, scatter, cleanliness grid.
- **Profiles** — sortable manifest with role highlights.
- **Prompts** — per-prompt × per-profile output with expandable excerpts.
- **Configs** — per-profile snapshot cards (read from `profiles.json`).
- **Methodology** — timings / rubric / cleanliness explainers + GGUF reading guide.
