# local-llms task runner.
# Install `just` via `uv tool install rust-just` or `cargo install just`.

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Default: list available recipes.
default:
    @just --list

# Sync the uv environment with all extras + dev deps.
install:
    uv sync --all-extras

# Lint with ruff (no autofix).
lint:
    uv run ruff check .

# Lint + format (autofix where safe).
fmt:
    uv run ruff check --fix .
    uv run ruff format .

# Static type-check the package.
typecheck:
    uv run mypy llms

# Run the test suite.
test *ARGS:
    uv run pytest {{ARGS}}

# Run every quality gate.
check: lint typecheck test

# Quick CLI smoke (manual sanity check).
smoke:
    uv run llms --version
    uv run llms --help

# Validate every YAML in config/.
config-lint:
    uv run llms config lint

# Drop into a python repl with the package on the path.
shell:
    uv run python

# Wipe caches.
clean:
    rm -rf .ruff_cache .mypy_cache .pytest_cache **/__pycache__ dist *.egg-info

# Run every adapter against ENDPOINT, capping mmlu/gsm8k at MAX_ITEMS, then refresh the hub.
# Usage: `just bench-suite chat-default 50` (or `just bench-suite chat-default` for the default cap).
bench-suite ENDPOINT MAX_ITEMS="50":
    @echo "▶ local_smoke  →  {{ENDPOINT}}"
    uv run llms eval run local_smoke --endpoint {{ENDPOINT}}
    @echo "▶ niah         →  {{ENDPOINT}}"
    uv run llms eval run niah --endpoint {{ENDPOINT}}
    @echo "▶ gsm8k (n={{MAX_ITEMS}}) →  {{ENDPOINT}}"
    uv run llms eval run gsm8k --endpoint {{ENDPOINT}} --max-items {{MAX_ITEMS}}
    @echo "▶ mmlu  (n={{MAX_ITEMS}}) →  {{ENDPOINT}}"
    uv run llms eval run mmlu --endpoint {{ENDPOINT}} --max-items {{MAX_ITEMS}}
    uv run llms eval report

# Same as bench-suite but with the full mmlu/gsm8k splits. Slow.
bench-full ENDPOINT:
    uv run llms eval run local_smoke --endpoint {{ENDPOINT}}
    uv run llms eval run niah        --endpoint {{ENDPOINT}}
    uv run llms eval run gsm8k       --endpoint {{ENDPOINT}}
    uv run llms eval run mmlu        --endpoint {{ENDPOINT}}
    uv run llms eval report

# Front-end + agentic suite (17 prompts, ~25 min wall).
# Slim variant for spot-checks: `just bench-frontend-agentic chat-qwopus36 agentic`.
bench-frontend-agentic ENDPOINT SUBSET="":
    @echo "▶ frontend_agentic{{ if SUBSET == '' { '' } else { ' [' + SUBSET + ']' } }} →  {{ENDPOINT}}"
    uv run llms eval run frontend_agentic --endpoint {{ENDPOINT}} {{ if SUBSET == "" { "" } else { "--subset " + SUBSET } }}
    uv run llms eval report
