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

## Manual Setup

### 1. Install build dependencies

```bash
sudo apt install build-essential cmake git gcc-12 g++-12
```

### 2. Build llama.cpp with CUDA

```bash
git clone https://github.com/ggerganov/llama.cpp.git ~/.local/share/llama.cpp
cd ~/.local/share/llama.cpp
cmake -B build -DGGML_CUDA=ON \
  -DCMAKE_C_COMPILER=gcc-12 \
  -DCMAKE_CXX_COMPILER=g++-12 \
  -DCMAKE_CUDA_COMPILER="$(command -v nvcc)" \
  -DCMAKE_CUDA_HOST_COMPILER=gcc-12
cmake --build build --config Release -j4
```

### 3. Download a model

```bash
mkdir -p ~/models

# RTX 5090 default
curl -L --progress-bar \
  https://huggingface.co/ggml-org/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-Q8_0.gguf \
  -o ~/models/Qwen3.6-27B-Q8_0.gguf

# RTX 5060 Ti default
curl -L --progress-bar \
  https://huggingface.co/huihui-ai/Huihui-Qwen3.5-9B-abliterated-GGUF/resolve/main/huihui-qwen3.5-9b-abliterated-q4_k_m.gguf \
  -o ~/models/Qwen3.5-9B.Q4_K_M.gguf

# RTX 5060 Ti alternate
curl -L --progress-bar \
  https://huggingface.co/OBLITERATUS/gemma-4-E4B-it-OBLITERATED/resolve/main/gemma-4-E4B-it-OBLITERATED-Q4_K_M.gguf \
  -o ~/models/gemma-4-E4B-it-OBLITERATED-Q4_K_M.gguf

# Optional RTX 5090 experiment: MYTHOS
curl -L --progress-bar \
  https://huggingface.co/Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF/resolve/main/mythos-26b-a4b-prism-pro-dq.gguf \
  -o ~/models/mythos-26b-a4b-prism-pro-dq.gguf
```

For more model options, see [MODELS.md](MODELS.md).

The upstream `Qwen/Qwen3.6-27B` release is published in Transformers/Safetensors format. This repo's `llama.cpp` path uses the corresponding `ggml-org/Qwen3.6-27B-GGUF` Q8_0 build for the RTX 5090 default profile.

### 4. Copy runtime configs, overlays, and scripts

```bash
sudo mkdir -p /etc/llama-server
sudo cp config/*.conf /etc/llama-server/
sudo cp config/llama-launcher.sh /etc/llama-server/
sudo cp config/runtime-common.sh /etc/llama-server/
sudo cp config/select-model.sh /etc/llama-server/
sudo chmod +x /etc/llama-server/llama-launcher.sh
sudo chmod +x /etc/llama-server/select-model.sh
```

Those runtime files have distinct roles:

- `llama-launcher.sh`: systemd entrypoint that detects the GPU, resolves `MODEL_PROFILE`, sources the overlay, and execs `llama-server`.
- `runtime-common.sh`: shared helper functions for local API readiness probes and optional auth flag/header handling.
- `select-model.sh`: interactive selector that writes `/etc/llama-server/active-model.conf`, shows whether each supported profile is installed, missing, or empty, and can download the selected model before restart.

Edit the GPU base config for your card:

```bash
sudo nano /etc/llama-server/rtx-5090.conf
```

### 5. Install the systemd service

Before copying the unit file, edit `config/llama-server.service` if you have not already. It is hardcoded to `User=ajmeese7`, `Group=ajmeese7`, and `/home/ajmeese7`, so those values must match your username and home path.

```bash
sudo cp config/llama-server.service /etc/systemd/system/llama-server.service
```

### 6. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable llama-server
sudo systemctl restart llama-server
```

### 7. Verify

```bash
systemctl status llama-server
curl http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer <your-key>"  # only if API_KEY is set
```

## Next Steps

- [CONFIGURATION.md](CONFIGURATION.md) for config changes and model switching
- [USAGE.md](USAGE.md) for API examples and common commands
- [WSL2.md](WSL2.md) for networking and auto-start on Windows

## Reinstalling

Rerunning `./setup.sh` copies the runtime-managed configs and scripts into `/etc/llama-server` again. Existing runtime files are preserved as `.bak` before replacement, and if a `.bak` already exists it is archived to a timestamped backup first.

If you had custom edits in `/etc/llama-server`, compare them against the new files after reinstalling. Intentional overrides such as `API_KEY` may need to be merged forward from the backup copy into the new active config.
