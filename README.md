# local-llms

Run a local LLM as a persistent systemd service using [llama.cpp](https://github.com/ggerganov/llama.cpp), compiled from source with CUDA. Works on native Linux and WSL2. This repo contains everything needed to set up an OpenAI-compatible API server backed by your NVIDIA GPU.

## Prerequisites

| Requirement | Notes |
|---|---|
| Linux with systemd | Native Linux or WSL2 with `systemd=true` — see [WSL2 note](#enable-systemd-wsl2-only) |
| NVIDIA GPU with drivers installed on Windows | `nvidia-smi` must work inside WSL |
| Build tools | `sudo apt install build-essential cmake git` |
| CUDA toolkit | See [CUDA toolkit installation](#cuda-toolkit-installation) |

### CUDA toolkit installation

**RTX 50 series (Blackwell) requires CUDA 12.8+.** The Ubuntu `nvidia-cuda-toolkit` package only provides CUDA 12.0, which is too old. Install from NVIDIA's official repo instead:

```bash
# Remove the outdated apt package if installed
sudo apt remove nvidia-cuda-toolkit

# Add NVIDIA's package repo (Ubuntu 24.04)
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit
```

Then add the CUDA binaries to your PATH (add to `~/.bashrc`):

```bash
export PATH=/usr/local/cuda/bin:$PATH
```

Verify with:

```bash
nvcc --version
# Should show CUDA 12.8 or newer
```

> **Older GPUs (RTX 40 series and below):** The apt package (`sudo apt install nvidia-cuda-toolkit`) may work, but the NVIDIA repo version is recommended for all GPUs.

### Enable systemd (WSL2 only)

Native Linux distros run systemd by default — skip this section. For WSL2, if systemd isn't already enabled, add this to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Then restart WSL from PowerShell:

```powershell
wsl --shutdown
```

Verify inside WSL:

```bash
ps -p 1 -o comm=
# should print: systemd
```

## Quick Start

```bash
git clone https://github.com/ajmeese7/local-llms.git
cd local-llms

# Review the config for your GPU and set your API key
#   RTX 5090 (32GB)    → config/rtx-5090.conf
#   RTX 5060 Ti (16GB) → config/rtx-5060.conf
nano config/rtx-5090.conf

# Run the interactive setup
./setup.sh
```

The setup script auto-detects your GPU and walks through each step with `y/n` prompts: building llama.cpp from source with CUDA, downloading the model, copying config files, and enabling the systemd service. The same repo works on both machines — no local changes needed.

## Manual Setup

If you prefer to run each step yourself:

### 1. Install build dependencies

```bash
sudo apt install build-essential cmake git
```

Install the CUDA toolkit following the [CUDA toolkit installation](#cuda-toolkit-installation) instructions above.

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
# RTX 5090 — 27B Q4_K_M (16.5GB)
curl -L --progress-bar \
  https://huggingface.co/Jackrong/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-GGUF/resolve/main/Qwen3.5-27B.Q4_K_M.gguf \
  -o ~/models/Qwen3.5-27B.Q4_K_M.gguf

# RTX 5060 Ti — 9B Q4_K_M
curl -L --progress-bar \
  https://huggingface.co/huihui-ai/Huihui-Qwen3.5-9B-abliterated-GGUF/resolve/main/huihui-qwen3.5-9b-abliterated-q4_k_m.gguf \
  -o ~/models/Qwen3.5-9B.Q4_K_M.gguf
```

### 4. Copy config files and launcher

```bash
sudo mkdir -p /etc/llama-server
sudo cp config/rtx-*.conf /etc/llama-server/
sudo cp config/llama-launcher.sh /etc/llama-server/
sudo chmod +x /etc/llama-server/llama-launcher.sh

# Edit the config for your GPU
sudo nano /etc/llama-server/rtx-5090.conf  # or rtx-5060.conf
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
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer change-this-key"
```

## Configuration

### How GPU detection works

The systemd service runs [`config/llama-launcher.sh`](config/llama-launcher.sh), which:

1. Queries `nvidia-smi` for the GPU name
2. Matches it to a config file (e.g. `5090` → `rtx-5090.conf`)
3. Sources the config and launches `llama-server` with the right flags

This means you can clone the repo on different machines and the right config is used automatically.

### Per-GPU config files

| GPU | Config | VRAM | Default Model | Quant |
|---|---|---|---|---|
| RTX 5090 | [`config/rtx-5090.conf`](config/rtx-5090.conf) | 32GB | Qwen3.5-27B | Q4_K_M (16.5GB) |
| RTX 5060 Ti | [`config/rtx-5060.conf`](config/rtx-5060.conf) | 16GB | Qwen3.5-9B | Q4_K_M |

### Adding a new GPU

1. Copy an existing config: `cp config/rtx-5090.conf config/rtx-XXXX.conf`
2. Adjust model path, context length, etc. for the new GPU's VRAM
3. Add a matching clause in `config/llama-launcher.sh`
4. Re-run `./setup.sh` (or manually copy to `/etc/llama-server/`)

### Config options

| Variable | Description |
|---|---|
| `MODEL` | Path to the GGUF model file. |
| `HF_REPO` / `HF_FILE` | HuggingFace repo and filename for downloading. |
| `ALIAS` | Model name reported by the API. |
| `HOST` | Bind address. `0.0.0.0` = accessible from Windows and LAN. |
| `PORT` | API port (default `8000`). |
| `API_KEY` | Required for all API requests. |
| `GPU_LAYERS` | Layers to offload to GPU. `99` = all. |
| `CONTEXT_LENGTH` | Max context in tokens. Larger = more VRAM for KV cache. |
| `PARALLEL_SLOTS` | Concurrent request slots. `1` = single user. |
| `FLASH_ATTENTION` | `on` for faster inference and lower memory usage. |
| `CACHE_TYPE_K` / `CACHE_TYPE_V` | KV cache quantization: `f16`, `q8_0`, or `q4_0`. Lower = less VRAM, more context. |

### Changing Models

1. Download the new GGUF file to `~/models/`
2. Edit the config: `sudo nano /etc/llama-server/rtx-5090.conf`
3. Update `MODEL`, `HF_REPO`, `HF_FILE`, and `ALIAS`
4. Restart: `sudo systemctl restart llama-server`

## Usage

### Built-in Web UI

`llama-server` includes a chat interface — just open the server URL in your browser:

```
http://localhost:8000
```

### API (curl)

The server exposes an [OpenAI-compatible API](https://platform.openai.com/docs/api-reference/chat). Send chat completions with curl:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.5-27B",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Compatible Applications

Any tool that supports the OpenAI API format can connect by pointing it at `http://<your-ip>:8000/v1` and providing your API key. Some examples:

| Application | Type | Notes |
|---|---|---|
| [Open WebUI](https://github.com/open-webui/open-webui) | Self-hosted web chat | Full-featured ChatGPT-like UI |
| [Chatbox](https://chatboxai.app/) | Desktop app | Simple, cross-platform |
| [Continue](https://continue.dev/) | VS Code / JetBrains extension | AI coding assistant |

## WSL2 Caveats

> **Native Linux users:** Skip this section. Your service starts on boot like any other systemd service.

### LAN Access (mirrored networking)

By default, WSL2 runs behind NAT — the server is only reachable from the Windows host, not from other machines on your network. To fix this, enable mirrored networking.

Edit (or create) `%USERPROFILE%\.wslconfig` on the Windows side:

```ini
[wsl2]
networkingMode=mirrored
vmIdleTimeout=-1
```

`vmIdleTimeout=-1` prevents WSL from automatically shutting down the VM when it thinks it's idle (see [Auto-shutdown behavior](#auto-shutdown-behavior)).

Then restart WSL from PowerShell:

```powershell
wsl --shutdown
```

After restarting, WSL shares the Windows host's network interfaces. Other machines on the LAN can connect directly to the host's IP on port 8000.

You also need to allow inbound traffic on the port. From an **elevated PowerShell** (Run as Administrator):

```powershell
New-NetFirewallRule -DisplayName "llama-server" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

### Auto-shutdown behavior

WSL2 can shut down automatically when Windows detects no active file handles or processes using it. Setting `vmIdleTimeout=-1` in `.wslconfig` (shown above) helps, but [may not be sufficient on its own](https://blog.lecoteauverdoyant.co.uk/articles/wsl-keep-alive.html).

For a more reliable keep-alive, create a startup script that maintains a persistent WSL process:

1. Open the Windows Startup folder: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
2. Create a file named `wslstart.cmd` with this content:
   ```cmd
   @start /b wsl --exec dbus-launch true
   ```

This launches a background `dbus` process inside WSL on login, which keeps the VM alive without a visible window.

### Auto-Start on Windows Login

To have the LLM server available after every Windows login, set up automatic WSL startup.

**Option A: Windows Scheduled Task (recommended)**

1. Open Task Scheduler (`taskschd.msc`)
2. Create a new task:
   - **Trigger:** At log on
   - **Action:** Start a program
   - **Program:** `wsl.exe`
   - **Arguments:** `-d Ubuntu`
3. Under "Conditions", uncheck "Start only if on AC power"

Since the service is enabled, systemd starts it automatically when the distro boots.

**Option B: WSL boot command**

Add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
command=systemctl start llama-server
```

## Useful Commands

```bash
# Service management
systemctl status llama-server              # check if running
sudo systemctl restart llama-server        # restart (e.g. after config change)
sudo systemctl stop llama-server           # stop the server
sudo systemctl start llama-server          # start the server

# Logs
journalctl -u llama-server -f              # follow live logs
journalctl -u llama-server --since "5m ago" # recent logs

# Test the API
curl http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer change-this-key"

# Edit config (use your GPU's config file)
sudo nano /etc/llama-server/rtx-5090.conf  # or rtx-5060.conf

# Update llama.cpp
cd ~/.local/share/llama.cpp && git pull
cmake --build build --config Release -j4
sudo systemctl restart llama-server
```

## Model Recommendations

### RTX 5090 (32GB VRAM)

With Q4_K_M quantization, models up to ~70B params fit. Q8_0 fits up to ~30B.

| Model | Quant | Size | Notes |
|---|---|---|---|
| Qwen3.5-27B | Q4_K_M | 16.5GB | MoE, excellent quality, leaves room for 131k context |
| Qwen3.5-27B | Q8_0 | 28.6GB | Higher quality, shorter context |
| Llama-3.1-70B | Q4_K_M | ~40GB | Won't fully fit — needs CPU offload for some layers |

### RTX 5060 Ti (16GB VRAM)

With Q4_K_M, models up to ~14B fit comfortably.

| Model | Quant | Size | Notes |
|---|---|---|---|
| Qwen3.5-9B | Q4_K_M | ~5.5GB | Great quality, lots of room for context |
| Qwen2.5-14B | Q4_K_M | ~8.5GB | Larger model, shorter context |
| Llama-3.1-8B | Q4_K_M | ~4.9GB | Fast, high quality |

> **Tip:** If you run out of VRAM, reduce `CONTEXT_LENGTH` in the config before switching to a smaller model. The KV cache quantization (`q4_0`) also helps significantly.

## Troubleshooting

### CUDA toolkit / driver version mismatch (system freeze)

If `setup.sh` reports the CUDA toolkit is newer than the driver supports, or if building llama.cpp causes a **hard system freeze**, the CUDA toolkit version is higher than the driver's supported CUDA version. For example, toolkit 13.2 with a driver that only supports 13.1. This causes the GPU to hang at the kernel level, freezing the entire machine.

Check the versions:

```bash
# Driver's max supported CUDA version
nvidia-smi | grep "CUDA Version"

# Installed toolkit version
nvcc --version
```

The toolkit version must be **less than or equal to** the driver's CUDA version. If not, **downgrade the toolkit** (do NOT try to upgrade the driver — the DKMS kernel module build will hit the same freeze):

```bash
# 1. Download the matching CUDA toolkit from NVIDIA
#    Go to https://developer.nvidia.com/cuda-toolkit-archive
#    Select your OS/arch and download the runfile installer
#    Example for CUDA 13.1:
wget https://developer.download.nvidia.com/compute/cuda/13.1.0/local_installers/cuda_13.1.0_590.44.01_linux.run

# 2. Install ONLY the toolkit (skip the driver component)
sudo sh cuda_13.1.0_590.44.01_linux.run --toolkit --silent --override

# 3. Point the cuda symlink at the new version
sudo ln -sfn /usr/local/cuda-13.1 /usr/local/cuda

# 4. Verify
nvcc --version          # should show the downgraded version
nvidia-smi              # CUDA Version here should be >= nvcc version
```

> **Warning:** Do not attempt to fix this by upgrading the NVIDIA driver via `apt`. The driver install compiles kernel modules (DKMS), which invokes the GPU and triggers the same freeze. Downgrading the toolkit is the safe fix — it only copies files to `/usr/local/cuda-*` without touching the driver.

### Recovering from a broken NVIDIA driver install

See [DRIVER-RECOVERY.md](docs/DRIVER-RECOVERY.md) for full recovery instructions, including how to restore the driver from cached packages and boot into a compatible kernel.

### CUDA / GPU not found

```
ggml_cuda_init: no CUDA devices found
```

- Ensure NVIDIA drivers are installed **on the Windows host** (not inside WSL)
- Run `nvidia-smi` inside WSL — if it fails, restart WSL: `wsl --shutdown` from PowerShell
- Make sure llama.cpp was built with `-DGGML_CUDA=ON`

### Out of memory (OOM)

```
CUDA error: out of memory
```

- Reduce `CONTEXT_LENGTH` in the config (e.g. `32768` or `16384`)
- Use a smaller quantization (Q4_K_M instead of Q8_0)
- Use a smaller model
- Close other GPU-intensive applications on Windows

### Port already in use

```
bind: Address already in use
```

- Another process is using port 8000. Find it: `ss -tlnp | grep 8000`
- Change `PORT` in the config, or stop the conflicting process

### Service fails to start

```bash
# Check what went wrong
systemctl status llama-server
journalctl -u llama-server --no-pager -n 50
```

Common causes:
- Model file not found — check that `MODEL` path in the config is correct
- llama-server not built — run `setup.sh` or build manually
- Config syntax error — configs are shell scripts, check for typos

### Build fails

```bash
# Missing build tools
sudo apt install build-essential cmake

# Missing or outdated CUDA toolkit — see Prerequisites section
nvcc --version  # must be 12.8+ for RTX 50 series

# Rebuild from scratch
cd ~/.local/share/llama.cpp
rm -rf build
cmake -B build -DGGML_CUDA=ON \
  -DCMAKE_CUDA_COMPILER="$(command -v nvcc)" \
  -DCMAKE_CUDA_HOST_COMPILER=gcc-12
cmake --build build --config Release -j4
```
