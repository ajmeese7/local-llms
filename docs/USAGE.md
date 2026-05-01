# Usage

## Built-in web UI

`llama-server` includes a chat interface. Open:

```
http://localhost:9999
```

## OpenAI-compatible API

```
curl http://localhost:9999/v1/models -H "Content-Type: application/json"

curl http://localhost:9999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<alias-from-/v1/models>",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

If the active endpoint sets `overrides.api_key` (or the hardware sets `defaults.api_key`), add `-H "Authorization: Bearer <key>"` to those requests.

Any tool that speaks the OpenAI API can target `http://<host>:9999/v1`. The active model is whichever endpoint `llms endpoint activate` last pointed at, resolved from the YAML tree at launch time.

## Compatible applications

| Application | Type | Notes |
|---|---|---|
| [Open WebUI](https://github.com/open-webui/open-webui) | Self-hosted web chat | Full-featured ChatGPT-like UI |
| [Chatbox](https://chatboxai.app/) | Desktop app | Simple, cross-platform |
| [Continue](https://continue.dev/) | VS Code / JetBrains extension | AI coding assistant |

## Useful commands

```
# Service
systemctl status llama-server
sudo systemctl restart llama-server
journalctl -u llama-server -f

# API smoke
curl http://127.0.0.1:9999/v1/models

# Endpoint lifecycle
.venv/bin/llms endpoint list
.venv/bin/llms endpoint activate chat-default
.venv/bin/llms endpoint rollback
.venv/bin/llms endpoint revisions --hardware rtx-5090

# Config
.venv/bin/llms config lint
nano config/profiles/qwen36-27b.yaml      # then `llms config lint` and restart

# Update llama.cpp
./scripts/provider.sh install llama.cpp --rebuild --jobs 4
sudo systemctl restart llama-server

# Telemetry
.venv/bin/llms endpoint stats --window 24h

# Eval
.venv/bin/llms eval run mmlu --endpoint chat-default --max-items 50
.venv/bin/llms eval report
```

## Related guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [MODELS.md](MODELS.md)
- [BENCHMARKING.md](BENCHMARKING.md)
