# local_smoke run local_smoke-20260516T162823Z-4d8dfa

- track: `smoke`  ·  adapter: `local_smoke@v1`
- endpoint: `chat-granite`  ·  profile: `granite-4.1-30b`
- provider: `llama.cpp`
- hardware: `NVIDIA GeForce RTX 5090`, 32607 MiB VRAM
- gpu state: boost 3090 MHz, power 600 W, persistence enabled
- server: `llama.cpp`
- comparability: `c9098a1632ca…`
- timestamp: 2026-05-16T16:28:23Z

## Summary

| Metric | Value |
|---|---|
| items | 5 |
| correct | 3 |
| parse failures | 0 |
| errors | 0 |
| accuracy | 0.600 (95% CI 0.200-1.000) |
| partial mean | 0.933 (95% CI 0.867-1.000) |
| median latency | 22135 ms |
| median ttft | 383 ms |
| median throughput | 17.3 tok/s |
| wall-clock | 2m 11s |
| compute (sum of latencies) | 2m 11s |

## By category

| Category | Items | Correct | Accuracy | Partial mean |
|---|---|---|---|---|
| assistant | 1 | 0 | 0.000 | 0.833 |
| coding | 2 | 1 | 0.500 | 0.917 |
| creative | 1 | 1 | 1.000 | 1.000 |
| long-context | 1 | 1 | 1.000 | 1.000 |
