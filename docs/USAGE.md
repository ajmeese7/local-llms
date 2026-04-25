# Usage

## Built-in Web UI

`llama-server` includes a chat interface. Open:

```text
http://localhost:9999
```

## OpenAI-Compatible API

```bash
# Inspect the active model alias first
curl http://localhost:9999/v1/models \
  -H "Content-Type: application/json"

# Then use the alias returned by /v1/models in chat completions
curl http://localhost:9999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<alias-from-/v1/models>",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

If you set `API_KEY` in the GPU base config, add `-H "Authorization: Bearer <your-key>"` to those requests.

Any tool that speaks the OpenAI API can target `http://<your-ip>:9999/v1`. The active model comes from the GPU config plus `/etc/llama-server/active-model.conf`, not from the GPU config alone. Some overlays also set runtime decoding defaults, so the effective behavior is the combination of the GPU base config and the selected model overlay.

`API_KEY` is optional. Leave it unset to run without bearer auth, or set it in the GPU base config before treating the service as reachable on your LAN.

## Compatible Applications

| Application | Type | Notes |
|---|---|---|
| [Open WebUI](https://github.com/open-webui/open-webui) | Self-hosted web chat | Full-featured ChatGPT-like UI |
| [Chatbox](https://chatboxai.app/) | Desktop app | Simple, cross-platform |
| [Continue](https://continue.dev/) | VS Code / JetBrains extension | AI coding assistant |

## Useful Commands

```bash
# Service management
systemctl status llama-server
sudo systemctl restart llama-server
sudo systemctl stop llama-server
sudo systemctl start llama-server

# Logs
journalctl -u llama-server -f
journalctl -u llama-server --since "5m ago"

# Test the API
curl http://127.0.0.1:9999/v1/models

# If API_KEY is set, include the bearer token
curl http://127.0.0.1:9999/v1/models \
  -H "Authorization: Bearer <your-key>"

# Edit the GPU base config for hardware defaults and optional API key
sudo nano /etc/llama-server/rtx-5090.conf  # example for RTX 5090

# Switch the active MODEL_PROFILE
sudo /etc/llama-server/select-model.sh

# Edit the active overlay only if you are intentionally changing overlay-owned model metadata or per-model decoding overrides
sudo nano /etc/llama-server/qwen36-27b.conf  # example overlay on RTX 5090

# Update llama.cpp
cd ~/.local/share/llama.cpp && git pull
cmake --build build --config Release -j4
sudo systemctl restart llama-server

# Benchmark helper
./scripts/benchmark.sh --help
```

## Related Guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [MODELS.md](MODELS.md)
- [BENCHMARKING.md](BENCHMARKING.md)
