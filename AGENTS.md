# AGENTS

## Repo purpose

- Local OpenAI-compatible inference service built around `llama.cpp`, `systemd`, NVIDIA GPUs.
- Two planes: serving (config, lifecycle, launcher, telemetry) and evaluation (adapters, manifests, scoring, hub).
- Workflow: GPU detect → resolve active endpoint from config → preflight → exec llama-server.

## What matters in most sessions

- The launcher is python: `llms.serving.launcher.exec_launcher`. systemd calls `.venv/bin/llms launcher exec`.
- Config is YAML under `config/{hardware,providers,profiles,endpoints}/`; `llms config lint` validates the tree.
- Endpoint state lives in SQLite at `~/.local/state/llms/state.db`; `llms endpoint activate <name>` writes a revision.
- Benchmark adapters live in `llms/eval/adapters/`. The runner writes per-run artifacts under `bench/reports/<id>/`.
- The static hub at `bench/` is intended to be published; the home page indexes runs and renders the model reading guide.

## Current config layout

Profiles in `config/profiles/`: `qwen36-27b`, `qwen36-27B-AEON`, `qwen36-35B-A3B`, `qwen36-35B-A3B-q4-ngram`, `qwen35-9b`, `mythos`, `carnice-v2-27b`.

Endpoints in `config/endpoints/`: `chat-default`, `chat-aeon`, `chat-mythos`, `chat-a3b`, `chat-a3b-ngram`, `chat-carnice`, `chat-9b`.

Hardware in `config/hardware/`: `rtx-5090`, `rtx-5060`.

Providers in `config/providers/`: `llama.cpp`, `ik_llama.cpp`.

## Important model facts

- Upstream `Qwen/Qwen3.6-27B` is a Transformers/Safetensors release, not a GGUF. The default `qwen36-27b` profile points at `unsloth/Qwen3.6-27B-GGUF`.
- Qwen profiles set `jinja: true` so the launcher passes `--jinja`.
- Optional multimodal projector files: `mmproj_path` + `mmproj_hf_file` on the profile.
- Provider capabilities are declared per-provider in YAML. `kv_unified` and `spec_default` are llama.cpp-only today.
- `qwen36-35B-A3B-q4-ngram` uses `ngram-mod` speculative decoding; requires a recent llama.cpp build.
- `qwen36-27b` raises `context_length` to 262144; reduce first if the selected quant does not fit.

## Files worth checking first

- `README.md`
- `docs/SETUP.md`, `docs/CONFIGURATION.md`, `docs/MODELS.md`
- `llms/serving/launcher/render.py` and `tests/serving/snapshots/`
- `llms/serving/config/models.py`
- `llms/eval/manifest.py`

## Normal verification

```
uv run pytest tests/
uv run mypy llms
uv run ruff check .
uv run llms config lint
bash -n setup.sh scripts/provider.sh
```

## Editing notes

- Profile YAML carries model behavior; the launcher and renderer stay generic. Do not hardcode model-specific flags into python.
- `config/llama-server.service.template` is rendered by `setup.sh` with the invoking user, primary group, and repo path. Do not commit a concrete `llama-server.service` alongside it; the template is the only source of truth.
- When you change a profile field, update both the Pydantic model and a snapshot test if rendering changes.
- The hub publishes from `bench/`; do not put non-published artifacts there.
