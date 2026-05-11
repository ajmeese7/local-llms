# Usage

## Built-in web UI

`llama-server` includes a chat interface. Open:

```
http://localhost:9999
```

## OpenAI-compatible API

```sh
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

```sh
# Service
systemctl status llama-server
sudo systemctl restart llama-server
journalctl -u llama-server -f

# API smoke
curl http://127.0.0.1:9999/v1/models

# Endpoint lifecycle
.venv/bin/llms endpoint list
.venv/bin/llms endpoint activate chat-default
.venv/bin/llms endpoint activate chat-carnice --provider ik_llama.cpp   # swap backend without new YAML
.venv/bin/llms endpoint rollback
.venv/bin/llms endpoint revisions --hardware rtx-5090

# Model files (downloaded from Hugging Face based on profile.hf_repo/hf_file)
.venv/bin/llms model status <profile>                                   # is the .gguf on disk?
.venv/bin/llms model fetch <profile>                                    # download if missing
.venv/bin/llms model fetch <profile> --yes                              # non-interactive

# Providers (inference backends)
.venv/bin/llms provider list                                            # known backends + capabilities
.venv/bin/llms provider install ik_llama.cpp                            # build from source

# Config
.venv/bin/llms config lint
nano config/profiles/qwen36-27b.yaml      # then `llms config lint` and restart

# Telemetry
.venv/bin/llms endpoint stats --window 24h

# Eval
.venv/bin/llms eval run mmlu --endpoint chat-default --max-items 50
.venv/bin/llms eval run frontend_agentic --endpoint chat-carnice --provider ik_llama.cpp
.venv/bin/llms eval run frontend_agentic --endpoint chat-carnice --subset design
.venv/bin/llms eval report
```

### Eval-run flags worth knowing

| Flag | Default | Why |
|---|---|---|
| `--endpoint <name>` | — | Resolves a profile + provider + hardware combo from the YAML tree. |
| `--provider <name>` | endpoint's bound provider | Pins the backend recorded on the manifest. Must match whatever's actually listening; the eval just hits the URL, it doesn't restart the server. |
| `--subset <s>` | full suite | Adapter-defined. For `frontend_agentic`: a category (`design`, `canvas`, `agentic`) or a comma-separated list of item ids. |
| `--max-items N` | — | Cap dataset size on adapters that draw from large pools (`mmlu`, `gsm8k`). |
| `--skip-preflight` | off | Skip the `GET /v1/models` reachability ping before iterating items. |
| `--max-consecutive-errors N` | 1 | Abort the run after N consecutive connect/timeout failures. HTTP 200 with bad content never counts — those are quality signals. |
| `--yes` | off | Auto-accept the "model file missing, download now?" prompt. Required for non-TTY contexts (CI). |

### Failure modes the harness catches early

The eval refuses to start when:

- The configured profile's `model_path` (or `mmproj_path`) isn't on disk. The CLI prompts to download from `hf_repo`/`hf_file` instead of letting the systemd unit crash-loop.
- `GET /v1/models` against the resolved base URL doesn't return < 500. Saves you the per-prompt connect timeout when the server is wedged or pointing at a different port.

Mid-run, if connections start dropping (server crashed during the run), the harness aborts after the configured consecutive-error threshold and writes a partial summary with `aborted_reason` set so the registry doesn't pretend the run finished.

## Related guides

- [CONFIGURATION.md](CONFIGURATION.md)
- [MODELS.md](MODELS.md)
- [BENCHMARKING.md](BENCHMARKING.md)
