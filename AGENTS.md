# AGENTS

## Repo Purpose

- Local OpenAI-compatible inference service built around `llama.cpp`, `systemd`, and NVIDIA GPUs.
- Main workflow: detect GPU -> load GPU base config -> resolve active/default model profile -> source model overlay -> launch `llama-server`.

## What Matters In Most Sessions

- GPU base configs live in `config/rtx-5090.conf` and `config/rtx-5060.conf`.
- Model overlays live in `config/*.conf`.
- Runtime selection is written to `/etc/llama-server/active-model.conf` by `config/select-model.sh`.
- The launcher is `config/llama-launcher.sh`.
- The installer is `setup.sh`.
- The benchmark helper is `scripts/benchmark.sh`.

## Current Model Layout

- RTX 5090 default profile: `qwen36-27b`
- RTX 5090 supported profiles: `qwen36-27b`, `qwen36-27B-AEON`, `qwen36-35B-A3B`, `qwen36-35B-A3B-q4-ngram`, `mythos`
- RTX 5060 Ti default profile: `qwen35-9b`
- RTX 5060 Ti supported profiles: `qwen35-9b`

## Important Model Facts

- Upstream `Qwen/Qwen3.6-27B` is a Transformers/Safetensors release, not a GGUF.
- This repo's default `qwen36-27b` `llama.cpp` path uses `unsloth/Qwen3.6-27B-GGUF`, currently `Qwen3.6-27B-UD-Q5_K_XL.gguf`.
- The Qwen overlays enable `JINJA="on"` so the launcher passes `--jinja`.
- The launcher supports optional multimodal projector files with `MMPROJ` and `MMPROJ_HF_FILE`; keep projector behavior in model overlays.
- The launcher supports optional `ngram-mod` speculative decoding via overlay fields: `SPEC_TYPE`, `SPEC_NGRAM_SIZE_N`, `DRAFT_MAX`, `DRAFT_MIN`, or `SPEC_DEFAULT`.
- The `qwen36-35B-A3B-q4-ngram` profile is experimental and assumes a recent enough `llama.cpp` build for `ngram-mod`; `SPEC_DEFAULT` requires a newer build than explicit flags.
- The `qwen36-27b` overlay raises `CONTEXT_LENGTH` to `262144`; reduce context first if the selected quant does not fit comfortably.

## Files Worth Checking First

- `README.md`
- `docs/SETUP.md`
- `docs/CONFIGURATION.md`
- `docs/MODELS.md`
- `config/llama-launcher.sh`
- `config/select-model.sh`

## Normal Verification

- Syntax check: `bash -n setup.sh config/llama-launcher.sh config/select-model.sh`
- Find model/profile references: `rg -n "qwen36|qwen35-9b|mythos" .`
- Inspect current repo changes: `git status --short`

## Editing Notes

- Keep changes aligned with the layered config model; avoid hardcoding model behavior into the launcher when an overlay can own it.
- `config/llama-server.service` is intentionally hardcoded to the repo owner's user/home values and docs call that out; preserve that assumption unless the user asks to generalize it.
- Prefer updating docs when changing profile names, defaults, download URLs, or runtime expectations.
