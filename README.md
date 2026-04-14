# local-llms

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA. The repo supports native Linux and WSL2 and exposes an OpenAI-compatible API backed by your NVIDIA GPU.

## Quick Start

```bash
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms

# Review the config for your GPU and set your API key
nano config/rtx-5090.conf

# Run the interactive setup
./setup.sh
```

## Documentation

The detailed guides now live under [`docs/`](docs/README.md).

| Guide | Purpose |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, CUDA install, quick start, and manual setup |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | GPU config files, launcher behavior, and model switching |
| [docs/USAGE.md](docs/USAGE.md) | Web UI, API examples, compatible apps, and useful commands |
| [docs/MODELS.md](docs/MODELS.md) | Model recommendations and notes for MYTHOS and Gemma NVFP4 |
| [docs/BENCHMARKING.md](docs/BENCHMARKING.md) | `llama-bench`, API timing, `lm-eval`, compare mode, and benchmark workflow |
| [docs/SWE-BENCH.md](docs/SWE-BENCH.md) | Software-task benchmarking playbook for SWE-bench |
| [docs/WSL2.md](docs/WSL2.md) | Networking, auto-start, and keep-alive guidance for WSL2 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | CUDA, OOM, service startup, and build failures |
| [docs/DRIVER-RECOVERY.md](docs/DRIVER-RECOVERY.md) | NVIDIA driver recovery after a broken install |

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
