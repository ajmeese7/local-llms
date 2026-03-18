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

# Edit the config to set your model and API key
nano config/vllm.yaml

# Run the interactive setup
./setup.sh
```

The setup script walks through each step with `y/n` prompts: creating a venv, installing vLLM, copying config files, and enabling the systemd service.

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

### 3. Copy the config file

```bash
sudo mkdir -p /etc/vllm
sudo cp config/vllm.yaml /etc/vllm/config.yaml

# Edit to set your model and API key
sudo nano /etc/vllm/config.yaml
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

All server settings live in `/etc/vllm/config.yaml`. The template is in [`config/vllm.yaml`](config/vllm.yaml).

| Option | Default | Description |
|---|---|---|
| `model` | `Qwen/Qwen3-30B-A3B` | HuggingFace model ID or local path. Downloaded automatically on first use. |
| `host` | `0.0.0.0` | Bind address. `0.0.0.0` makes it accessible from Windows and LAN. |
| `port` | `8000` | API port. |
| `api-key` | `change-this-key` | Required for all API requests. Change before starting. |
| `gpu-memory-utilization` | `0.90` | Fraction of VRAM vLLM may use. Leave headroom for OS/display. |
| `max-model-len` | `32768` | Maximum context length in tokens. Reduce if you hit OOM. |
| `generation-config` | `vllm` | Use vLLM defaults instead of the model repo's `generation_config.json`. |
| `uvicorn-log-level` | `info` | Log verbosity: `debug`, `info`, `warning`, `error`. |

### Changing Models

1. Edit `/etc/vllm/config.yaml` and change the `model:` value
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

# Edit config
sudo nano /etc/vllm/config.yaml
```

## Model Recommendations

Models that work well on a 32GB VRAM GPU (RTX 5090):

| Model | Parameters | Notes |
|---|---|---|
| `Qwen/Qwen3-30B-A3B` | 30B (3B active) | MoE — excellent quality-to-VRAM ratio |
| `meta-llama/Llama-3.1-8B-Instruct` | 8B | Fast, high quality, fits easily |
| `mistralai/Mistral-Small-24B-Instruct-2501` | 24B | Strong reasoning, fits in 32GB |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | 32B | Best open coding model, tight fit at 32GB |
| `deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct` | 16B (2.4B active) | MoE, great for code |

For 32GB VRAM, dense models up to ~30B parameters (in FP16/BF16) generally fit. MoE models can be much larger since only a fraction of parameters are active per token.

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
- Config syntax error — validate YAML: `python3 -c "import yaml; yaml.safe_load(open('/etc/vllm/config.yaml'))"`
- venv missing or broken — recreate: `python3 -m venv ~/.venvs/vllm --clear`
- Model not found — check the model ID is correct on [HuggingFace](https://huggingface.co/models)

### Model download hangs or fails

- Check network connectivity and HuggingFace availability
- For gated models (e.g. Llama), log in first: `~/.venvs/vllm/bin/huggingface-cli login`
- Set `HF_HOME` if you want to use a non-default cache directory
