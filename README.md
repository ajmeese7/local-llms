# local-llms

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA. Native Linux and WSL2. OpenAI-compatible API on top of an NVIDIA GPU. Includes a benchmark harness, a static report hub, and CLI tooling for endpoint lifecycle.

## Quick start

`config/llama-server.service` is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7/src/local-llms`. Edit those before installing on a different machine.

```
git clone https://github.com/meese-family/local-llms.git
cd local-llms
./setup.sh
```

`setup.sh` checks prereqs, runs `uv sync --all-extras`, lints the YAML config tree, optionally builds the llama.cpp / ik_llama.cpp binaries, installs the systemd unit, and (re)starts the service.

After the service is running:

```
.venv/bin/llms endpoint list                    # see what endpoints are defined
.venv/bin/llms endpoint activate chat-default   # switch active endpoint, then systemctl restart
.venv/bin/llms eval run mmlu --endpoint chat-default --max-items 50
.venv/bin/llms eval report                      # refresh the hub registry
```

## Configuration

The config tree is YAML under `config/`. Files are typed; `llms config lint` validates the whole tree.

| Directory | Kind | What it carries |
|---|---|---|
| `config/hardware/` | hardware | GPU detection regex, host/port floor, default endpoint |
| `config/providers/` | provider | inference backend (llama.cpp, ik_llama.cpp), capability flags |
| `config/profiles/` | profile | one model + decode params + provider compatibility |
| `config/endpoints/` | endpoint | binds a profile to a provider; this is what `llms endpoint activate` points at |

Precedence at runtime: endpoint overrides win, then profile, then hardware defaults. Capability mismatches (a profile asking for `kv_unified` against a provider that does not support it) raise at `config lint` rather than at launch.

## CLI

```
llms config lint                                  # validate the YAML tree
llms provider list                                # show inference backends + capabilities
llms endpoint list|status|activate|rollback|revisions|stats
llms launcher render|exec                         # systemd entry, plus a dry-run printer
llms eval run <adapter> --endpoint <name>         # run a benchmark
llms eval list|show|report                        # browse runs, refresh the hub registry
```

Adapters shipping today: `local_smoke` (5-prompt keyword rubric), `mmlu`, `gsm8k`, `niah`. Deferred adapters and other follow-ups are tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Documentation

| Guide | Purpose |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prereqs, CUDA toolkit notes, manual setup |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | YAML config tree, merge precedence, capability checks |
| [docs/USAGE.md](docs/USAGE.md) | API examples, useful commands |
| [docs/MODELS.md](docs/MODELS.md) | Model recommendations and notes |
| [docs/BENCHMARKING.md](docs/BENCHMARKING.md) | Eval adapters, run manifests, the report hub |
| [docs/SWE-BENCH.md](docs/SWE-BENCH.md) | Notes for SWE-bench integration |
| [docs/WSL2.md](docs/WSL2.md) | Networking, auto-start, keep-alive |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | CUDA, OOM, service startup, build failures |
| [docs/DRIVER-RECOVERY.md](docs/DRIVER-RECOVERY.md) | NVIDIA driver recovery |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is left |

## Hub

The static SPA at `bench/` reads runs from `bench/reports/`. It is meant to be published; see [`bench/README.md`](bench/README.md).

```
cd bench && python -m http.server 5173
```
