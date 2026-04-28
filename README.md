# local-llms

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA. The repo supports native Linux and WSL2 and exposes an OpenAI-compatible API backed by your NVIDIA GPU.

## Quick Start

Before running the commands below on your own machine, edit `config/llama-server.service`. It is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7`, so those values must match your username and home path.

```bash
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms

# Review the config for your GPU, such as `config/rtx-5090.conf` or `config/rtx-5060.conf`
# and optionally set API_KEY before exposing the service on your network
nano config/rtx-5090.conf  # example for RTX 5090

# Run the interactive setup
./setup.sh

# Pick the runtime model profile after setup
sudo /etc/llama-server/select-model.sh
```

The GPU config owns hardware defaults and optional authentication. Leave `API_KEY` unset to run without bearer auth, or set it before treating the service as reachable on your LAN. After setup installs the runtime files into `/etc/llama-server/`, use the selector to switch between supported model profiles without editing the GPU config again. The selector shows whether each supported profile is installed, missing, or backed by an empty file, and can download the selected model before restart when needed.

## Documentation

The detailed guides now live under [`docs/`](docs/README.md).

| Guide | Purpose |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, CUDA install, quick start, and manual setup |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | GPU config files, launcher behavior, and model switching |
| [docs/USAGE.md](docs/USAGE.md) | Web UI, API examples, compatible apps, and useful commands |
| [docs/MODELS.md](docs/MODELS.md) | Model recommendations and notes for Qwen3.6, MYTHOS, and Gemma NVFP4 |
| [docs/BENCHMARKING.md](docs/BENCHMARKING.md) | Scripted API timing, `llama-bench`, compare mode, and benchmark workflow |
| [docs/SWE-BENCH.md](docs/SWE-BENCH.md) | Software-task benchmarking playbook for SWE-bench |
| [docs/WSL2.md](docs/WSL2.md) | Networking, auto-start, and keep-alive guidance for WSL2 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | CUDA, OOM, service startup, and build failures |
| [docs/DRIVER-RECOVERY.md](docs/DRIVER-RECOVERY.md) | NVIDIA driver recovery after a broken install |

## Runtime Scripts

The main operational entrypoints are:

- [`setup.sh`](setup.sh): interactive installer that builds `llama.cpp`, installs runtime files into `/etc/llama-server`, restarts the service, and waits for the local API to respond with bounded readiness checks.
- [`config/llama-launcher.sh`](config/llama-launcher.sh): systemd entrypoint that detects the GPU, resolves the active model profile, loads the overlay, and execs `llama-server`.
- [`config/runtime-common.sh`](config/runtime-common.sh): shared shell helpers used by setup-time API verification and launcher-time optional `--api-key` handling.
- [`config/select-model.sh`](config/select-model.sh): writes `/etc/llama-server/active-model.conf` for the next restart.
- [`scripts/benchmark.sh`](scripts/benchmark.sh): benchmark helper for active API aliases, API timing, `llama-bench`, and compare mode.

## Suggested Reading Paths

### New machine

1. [docs/SETUP.md](docs/SETUP.md)
2. [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
3. [docs/USAGE.md](docs/USAGE.md)

### Model experiments

1. [docs/MODELS.md](docs/MODELS.md)
2. [docs/BENCHMARKING.md](docs/BENCHMARKING.md)
3. [docs/SWE-BENCH.md](docs/SWE-BENCH.md)

### WSL2-specific deployment

1. [docs/SETUP.md](docs/SETUP.md)
2. [docs/WSL2.md](docs/WSL2.md)
3. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Benchmark Helper

This repo includes a helper script for repeatable local benchmark runs:

```bash
./scripts/benchmark.sh --help
```

Use [docs/BENCHMARKING.md](docs/BENCHMARKING.md) for the benchmark workflow and [docs/SWE-BENCH.md](docs/SWE-BENCH.md) for software-task evaluation.
