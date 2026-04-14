# Setup

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA.

## Prerequisites

| Requirement | Notes |
|---|---|
| Linux with systemd | Native Linux or WSL2 with `systemd=true` |
| NVIDIA GPU with drivers installed | In WSL2, `nvidia-smi` must work inside Linux |
| Build tools | `sudo apt install build-essential cmake git` |
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

```bash
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms

# Review the config for your GPU and set your API key
nano config/rtx-5090.conf

# Run the interactive setup
./setup.sh
```

The setup script auto-detects your GPU, builds `llama.cpp`, downloads the configured model, copies the config files, and enables the systemd service.

## Manual Setup

### 1. Install build dependencies

```bash
sudo apt install build-essential cmake git
```

### 2. Build llama.cpp with CUDA

```bash
git clone https://github.com/ggerganov/llama.cpp.git ~/.local/share/llama.cpp
cd ~/.local/share/llama.cpp
cmake -B build -DGGML_CUDA=ON \
  -DCMAKE_CUDA_COMPILER="$(command -v nvcc)" \
  -DCMAKE_CUDA_HOST_COMPILER=gcc-12
cmake --build build --config Release -j4
```

### 3. Download a model

```bash
mkdir -p ~/models

# RTX 5090 default
curl -L --progress-bar \
  https://huggingface.co/Jackrong/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-GGUF/resolve/main/Qwen3.5-27B.Q4_K_M.gguf \
  -o ~/models/Qwen3.5-27B.Q4_K_M.gguf

# RTX 5060 Ti default
curl -L --progress-bar \
  https://huggingface.co/huihui-ai/Huihui-Qwen3.5-9B-abliterated-GGUF/resolve/main/huihui-qwen3.5-9b-abliterated-q4_k_m.gguf \
  -o ~/models/Qwen3.5-9B.Q4_K_M.gguf

# Optional RTX 5090 experiment: MYTHOS
curl -L --progress-bar \
  https://huggingface.co/Ex0bit/MYTHOS-26B-A4B-PRISM-PRO-DQ-GGUF/resolve/main/mythos-26b-a4b-prism-pro-dq.gguf \
  -o ~/models/mythos-26b-a4b-prism-pro-dq.gguf
```

For more model options, see [MODELS.md](MODELS.md).

### 4. Copy config files and launcher

```bash
sudo mkdir -p /etc/llama-server
sudo cp config/rtx-*.conf /etc/llama-server/
sudo cp config/llama-launcher.sh /etc/llama-server/
sudo chmod +x /etc/llama-server/llama-launcher.sh
```

Edit the config for your GPU:

```bash
sudo nano /etc/llama-server/rtx-5090.conf
```

### 5. Install the systemd service

```bash
sudo cp config/llama-server.service /etc/systemd/system/llama-server.service
```

### 6. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now llama-server
```

### 7. Verify

```bash
systemctl status llama-server
curl http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer change-this-key"
```

## Next Steps

- [CONFIGURATION.md](CONFIGURATION.md) for config changes and model switching
- [USAGE.md](USAGE.md) for API examples and common commands
- [WSL2.md](WSL2.md) for networking and auto-start on Windows
