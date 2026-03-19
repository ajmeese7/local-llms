# local-llms

Run a local LLM as a persistent systemd service on WSL2 using [vLLM](https://docs.vllm.ai/). This repo contains everything needed to set up an OpenAI-compatible API server backed by your NVIDIA GPU.

## Prerequisites

| Requirement | Notes |
|---|---|
| WSL2 with systemd enabled | `systemd=true` in `/etc/wsl.conf` — see [Enable systemd](#enable-systemd) |
| NVIDIA GPU with drivers installed on Windows | `nvidia-smi` must work inside WSL |
| Python 3.10+ | Ships with Ubuntu 22.04+ |

### Enable systemd

If systemd isn't already enabled, add this to `/etc/wsl.conf`:

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

# Edit the config for your GPU and set your API key
nano config/rtx-5090.yaml  # or rtx-5060.yaml

# Run the interactive setup
./setup.sh
```

The setup script auto-detects your GPU and walks through each step with `y/n` prompts: creating a venv, installing vLLM, copying the right config files, and enabling the systemd service.

## Manual Setup

If you prefer to run each step yourself:

### 1. Create a virtual environment

```bash
python3 -m venv ~/.venvs/vllm
```

### 2. Install vLLM

```bash
~/.venvs/vllm/bin/pip install vllm
```

### 3. Copy config files and launcher

```bash
sudo mkdir -p /etc/vllm
sudo cp config/rtx-*.yaml /etc/vllm/
sudo cp config/vllm-launcher.sh /etc/vllm/
sudo chmod +x /etc/vllm/vllm-launcher.sh

# Edit the config for your GPU
sudo nano /etc/vllm/rtx-5090.yaml  # or rtx-5060.yaml
```

### 4. Install the systemd service

```bash
sudo cp config/vllm.service /etc/systemd/system/vllm.service
```

### 5. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vllm
```

### 6. Verify

```bash
systemctl status vllm
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer change-this-key"
```

## Configuration

### How GPU detection works

The systemd service runs [`config/vllm-launcher.sh`](config/vllm-launcher.sh), which:

1. Queries `nvidia-smi` for the GPU name
2. Matches it to a config file (e.g. `5090` → `rtx-5090.yaml`)
3. Launches vLLM with that config

This means you can clone the repo on different machines and the right config is used automatically.

### Per-GPU config files

| GPU | Config | VRAM | Default Model |
|---|---|---|---|
| RTX 5090 | [`config/rtx-5090.yaml`](config/rtx-5090.yaml) | 32GB | `Jackrong/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-GGUF` |
| RTX 5060 Ti | [`config/rtx-5060.yaml`](config/rtx-5060.yaml) | 16GB | `huihui-ai/Huihui-Qwen3.5-9B-abliterated` |

### Adding a new GPU

1. Copy an existing config: `cp config/rtx-5090.yaml config/rtx-XXXX.yaml`
2. Adjust `model`, `max-model-len`, etc. for the new GPU's VRAM
3. Add a matching clause in `config/vllm-launcher.sh`
4. Re-run `./setup.sh` (or manually copy to `/etc/vllm/`)

### Config options

| Option | Description |
|---|---|
| `model` | HuggingFace model ID or local path. Downloaded automatically on first use. |
| `host` | Bind address. `0.0.0.0` = accessible from Windows and LAN. |
| `port` | API port (default `8000`). |
| `api-key` | Required for all API requests. Change before starting. |
| `gpu-memory-utilization` | Fraction of VRAM vLLM may use. `0.90` leaves headroom for OS/display. |
| `max-model-len` | Maximum context length in tokens. Reduce if you hit OOM. |
| `generation-config` | `"vllm"` = use vLLM defaults instead of the model repo's `generation_config.json`. |
| `uvicorn-log-level` | Log verbosity: `debug`, `info`, `warning`, `error`. |

### Changing Models

1. Edit the config for your GPU: `sudo nano /etc/vllm/rtx-5090.yaml`
2. Restart the service: `sudo systemctl restart vllm`

The new model downloads automatically on startup. Monitor progress with `journalctl -u vllm -f`.

## WSL Caveats

WSL2 is not a traditional always-on server. Even with systemd, the WSL VM can shut down automatically when Windows detects no active file handles or processes using it. This means:

- **The vLLM service starts when WSL starts**, but WSL itself may not be running after a reboot.
- **WSL can idle-shutdown** if no terminal or Windows process is keeping it alive.
- After `wsl --shutdown` or a Windows reboot, the service won't start until WSL is launched again.

### Auto-Start on Windows Login

To have vLLM available after every Windows login, set up automatic WSL startup.

**Option A: Windows Scheduled Task (recommended)**

1. Open Task Scheduler (`taskschd.msc`)
2. Create a new task:
   - **Trigger:** At log on
   - **Action:** Start a program
   - **Program:** `wsl.exe`
   - **Arguments:** `-d Ubuntu`
3. Under "Conditions", uncheck "Start only if on AC power"

Since the vLLM service is enabled, systemd starts it automatically when the distro boots.

**Option B: WSL boot command**

Add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
command=systemctl start vllm
```

This is less necessary if the service is already `enable`d, but serves as a belt-and-suspenders approach.

## Useful Commands

```bash
# Service management
systemctl status vllm              # check if running
sudo systemctl restart vllm        # restart (e.g. after config change)
sudo systemctl stop vllm           # stop the server
sudo systemctl start vllm          # start the server

# Logs
journalctl -u vllm -f              # follow live logs
journalctl -u vllm --since "5m ago" # recent logs

# Test the API
curl http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer change-this-key"

# Edit config (use your GPU's config file)
sudo nano /etc/vllm/rtx-5090.yaml
```

## Model Recommendations

### RTX 5090 (32GB VRAM)

Dense models up to ~30B parameters (FP16/BF16) fit. MoE models can be larger since only a fraction of parameters are active per token.

| Model | Parameters | Notes |
|---|---|---|
| `Qwen/Qwen3-30B-A3B` | 30B (3B active) | MoE — excellent quality-to-VRAM ratio |
| `mistralai/Mistral-Small-24B-Instruct-2501` | 24B | Strong reasoning |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | 32B | Best open coding model, tight fit |
| `deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct` | 16B (2.4B active) | MoE, great for code |

### RTX 5060 Ti (16GB VRAM)

Dense models up to ~14B parameters fit well. Smaller models leave room for longer context.

| Model | Parameters | Notes |
|---|---|---|
| `huihui-ai/Huihui-Qwen3.5-9B-abliterated` | 9B | Uncensored, good general-purpose |
| `Qwen/Qwen2.5-14B-Instruct` | 14B | High quality, tight fit at 16GB |
| `meta-llama/Llama-3.1-8B-Instruct` | 8B | Fast, high quality, fits easily |
| `Qwen/Qwen2.5-Coder-7B-Instruct` | 7B | Solid coding model with room to spare |

> **Tip:** If a model doesn't fit, try reducing `max-model-len` in the config before switching to a smaller model.

## Troubleshooting

### CUDA / GPU not found

```
RuntimeError: No CUDA GPUs are available
```

- Ensure NVIDIA drivers are installed **on the Windows host** (not inside WSL)
- Run `nvidia-smi` inside WSL — if it fails, restart WSL: `wsl --shutdown` from PowerShell
- Check that your WSL version supports GPU passthrough: `wsl --version`

### Out of memory (OOM)

```
torch.cuda.OutOfMemoryError: CUDA out of memory
```

- Reduce `max-model-len` in the config (e.g. `16384` or `8192`)
- Reduce `gpu-memory-utilization` (e.g. `0.85`)
- Use a smaller model
- Close other GPU-intensive applications on Windows

### Port already in use

```
OSError: [Errno 98] Address already in use
```

- Another process is using port 8000. Find it: `ss -tlnp | grep 8000`
- Change the `port:` value in the config, or stop the conflicting process

### Service fails to start

```bash
# Check what went wrong
systemctl status vllm
journalctl -u vllm --no-pager -n 50
```

Common causes:
- Config syntax error — validate YAML: `python3 -c "import yaml; yaml.safe_load(open('/etc/vllm/rtx-5090.yaml'))"`
- venv missing or broken — recreate: `python3 -m venv ~/.venvs/vllm --clear`
- Model not found — check the model ID is correct on [HuggingFace](https://huggingface.co/models)

### Model download hangs or fails

- Check network connectivity and HuggingFace availability
- For gated models (e.g. Llama), log in first: `~/.venvs/vllm/bin/huggingface-cli login`
- Set `HF_HOME` if you want to use a non-default cache directory
