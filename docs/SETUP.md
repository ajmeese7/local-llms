# Setup

Bootstrap the local-llms service on native Linux or WSL2.

## Prerequisites

| Requirement | Notes |
|---|---|
| Linux with systemd | Native Linux or WSL2 with `systemd=true` in `/etc/wsl.conf` |
| NVIDIA GPU with drivers | In WSL2, `nvidia-smi` must work inside Linux |
| Build tools | `sudo apt install build-essential cmake git gcc-12 g++-12` |
| CUDA toolkit | Blackwell (RTX 50 series) needs CUDA 12.8+ |
| `uv` | https://docs.astral.sh/uv/getting-started/installation/ |

## CUDA toolkit

RTX 50 series requires CUDA 12.8+. The Ubuntu `nvidia-cuda-toolkit` package is too old.

```sh
sudo apt remove nvidia-cuda-toolkit

wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit

export PATH=/usr/local/cuda/bin:$PATH
nvcc --version
```

Keep the toolkit no newer than the driver's supported CUDA version. `setup.sh` checks this and stops if there is a mismatch, because building GPU code against a too-new toolkit can hard-freeze the system.

## Enable systemd on WSL2

Skip this on native Linux. Otherwise add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Restart WSL from PowerShell:

```powershell
wsl --shutdown
```

Verify inside Linux:

```sh
ps -p 1 -o comm=
```

Should print `systemd`.

## Install

The systemd unit lives in the repo as `config/llama-server.service.template` with `@@USER@@`, `@@GROUP@@`, and `@@REPO_ROOT@@` placeholders. `setup.sh` substitutes the invoking user, that user's primary group, and the absolute repo path at install time, then writes the rendered unit to `/etc/systemd/system/llama-server.service`. To override (e.g. install under a service account), set `SUDO_USER` before running setup.

```sh
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms
./setup.sh
```

`setup.sh` checks prereqs, runs `uv sync --all-extras`, lints the YAML config tree, optionally builds the provider binaries via `scripts/provider.sh`, installs the systemd unit, then enables and (re)starts the service.

Pick an endpoint after setup:

```sh
.venv/bin/llms endpoint list
.venv/bin/llms endpoint activate chat-default
sudo systemctl restart llama-server
```

If the chosen profile's model file isn't on disk yet, `endpoint activate` prompts you to download it from `hf_repo` / `hf_file`. Auto-accept with `--yes`, or pre-fetch ahead of time:

```sh
.venv/bin/llms model status chat-default
.venv/bin/llms model fetch chat-default
```

Want a different inference backend than the endpoint's bound provider? Build it with `llms provider install <name>` (a thin wrapper over `scripts/provider.sh install`) and pass `--provider <name>` to `endpoint activate`. The override is persisted on the revision and the launcher exec's the right binary on next restart.

## Reinstalling

Rerunning `./setup.sh` is idempotent. It re-syncs the venv, re-validates the config tree, optionally rebuilds the providers, overwrites the systemd unit if you confirm, and restarts the service.

There is no separate "merge forward from backups" step in this flow; the unit file lives in the repo, not under `/etc/llama-server`. Edit the repo file and rerun setup, or copy the unit yourself.

## Next steps

- [CONFIGURATION.md](CONFIGURATION.md) for the YAML schema and merge precedence
- [USAGE.md](USAGE.md) for API examples
- [BENCHMARKING.md](BENCHMARKING.md) for `llms eval run` and the report hub
- [WSL2.md](WSL2.md) for networking and auto-start on Windows
