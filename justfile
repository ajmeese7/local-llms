# local-llms v2 task runner.
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

# Run every quality gate Phase 0 ships with.
check: lint typecheck test

# Quick CLI smoke (manual sanity check).
smoke:
    uv run llms --version
    uv run llms --help

# Validate every YAML in config/ once Phase 1 lands.
config-lint:
    uv run llms config lint

# Drop into a python repl with the package on the path.
shell:
    uv run python

# Wipe caches.
clean:
    rm -rf .ruff_cache .mypy_cache .pytest_cache **/__pycache__ dist *.egg-info
