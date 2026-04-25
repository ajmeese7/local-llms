# Setup

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA.

## Prerequisites

| Requirement | Notes |
|---|---|
| Linux with systemd | Native Linux or WSL2 with `systemd=true` |
| NVIDIA GPU with drivers installed | In WSL2, `nvidia-smi` must work inside Linux |
| Build tools | `sudo apt install build-essential cmake git gcc-12 g++-12` |
| CUDA toolkit | Blackwell GPUs need CUDA 12.8+ |

## CUDA Toolkit Installation

**RTX 50 series (Blackwell) requires CUDA 12.8+.** The Ubuntu `nvidia-cuda-toolkit` package only provides CUDA 12.0, which is too old. Install from NVIDIA's official repo instead:

```bash
sudo apt remove nvidia-cuda-toolkit

wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit
```

Keep the toolkit version compatible with your installed driver. `setup.sh` checks this explicitly and will stop if the toolkit is newer than the driver supports, because that mismatch can break CUDA builds.

Then add CUDA to your shell path:

```bash
export PATH=/usr/local/cuda/bin:$PATH
```

Verify:

```bash
nvcc --version
```

For older GPUs, the Ubuntu package may work, but the NVIDIA repo version is still the safer default.

## Enable systemd on WSL2

Native Linux users can skip this section.

Add this to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Restart WSL from PowerShell:

```powershell
wsl --shutdown
```

Verify inside Linux:

```bash
ps -p 1 -o comm=
```

It should print `systemd`.

## Quick Start

Before running the commands below on your own machine, edit `config/llama-server.service` for your account. It is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7`, so those values must match your username and home path.

```bash
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms

# Review the config for your GPU, such as `config/rtx-5090.conf` or `config/rtx-5060.conf`,
# and optionally set API_KEY before exposing the service on your network
nano config/rtx-5090.conf  # example for RTX 5090

# Run the interactive setup
./setup.sh

# Choose the active model profile afterward
sudo /etc/llama-server/select-model.sh
```

The setup script auto-detects your GPU, builds `llama.cpp`, offers to download the resolved model, installs the runtime configs and scripts, and offers to enable the systemd service during Step 7 if you confirm. If the resolved active profile points at a missing or empty GGUF, setup now skips service activation and tells you to use the selector to download that model or switch to an installed profile first.

`API_KEY` is optional. Leave it unset to run without bearer auth, or set it before treating the service as reachable on your LAN or beyond.

## Next Steps

- [CONFIGURATION.md](CONFIGURATION.md) for config changes and model switching
- [USAGE.md](USAGE.md) for API examples and common commands
- [WSL2.md](WSL2.md) for networking and auto-start on Windows

## Reinstalling

Rerunning `./setup.sh` copies the runtime-managed configs and scripts into `/etc/llama-server` again. Existing runtime files are preserved as `.bak` before replacement, and if a `.bak` already exists it is archived to a timestamped backup first.

If you had custom edits in `/etc/llama-server`, compare them against the new files after reinstalling. Intentional overrides such as `API_KEY` may need to be merged forward from the backup copy into the new active config.
