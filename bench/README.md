# Bench

Static benchmark report hub.

```bash
../scripts/bench.sh add ../benchmark-results/5090-suite-20260428-151710
../scripts/bench.sh validate
../scripts/bench.sh serve
```

Report folders live under `reports/<id>/`:

- `meta.json`: title, date, hardware, server, profile manifest
- `results.jsonl`: per-prompt benchmark rows
- `profiles/*.conf`: model overlays used by the run

`reports/reports.json` controls which runs appear on the home page.
