#!/usr/bin/env bash
# Bootstrap the local-llms service. Works on native Linux and WSL2.
# Confirms each step before mutating anything outside the repo.
#
#   1. Verify prereqs (systemd, NVIDIA driver/toolkit, build tools, uv)
#   2. uv sync the python venv
#   3. Lint the YAML config tree
#   4. Build the inference provider(s) via scripts/provider.sh
#   5. Install / refresh the systemd unit and (re)start the service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
SERVICE_SRC="$CONFIG_DIR/llama-server.service"
SERVICE_DEST="/etc/systemd/system/llama-server.service"
VENV_DIR="$SCRIPT_DIR/.venv"
LLMS_BIN="$VENV_DIR/bin/llms"

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
err()   { printf '\033[1;31m[ERR]\033[0m   %s\n' "$*"; }

confirm() {
    local prompt="$1"
    local reply
    printf '\033[1;36m[???]\033[0m  %s [y/N] ' "$prompt"
    read -r reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

# ── Step 1: Prerequisites ───────────────────────────────────────────────────

info "Step 1: Checking prerequisites"

errors=0

if [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
    ok "systemd is PID 1"
else
    err "systemd is NOT PID 1. Enable it in /etc/wsl.conf ([boot] systemd=true) and restart WSL."
    errors=$((errors + 1))
fi

if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    ok "NVIDIA GPU detected: $gpu_name"
else
    err "nvidia-smi not found or not working. Install NVIDIA drivers on the Windows host."
    errors=$((errors + 1))
fi

for cmd in cmake git gcc-12 g++-12 uv; do
    if command -v "$cmd" &>/dev/null; then
        ok "$cmd found"
    else
        err "$cmd not found."
        errors=$((errors + 1))
    fi
done

if command -v nvcc &>/dev/null; then
    nvcc_path="$(command -v nvcc)"
    cuda_version=$(nvcc --version | grep -oP 'release \K[0-9]+\.[0-9]+')
    ok "nvcc found at $nvcc_path (CUDA $cuda_version)"
    cuda_major="${cuda_version%%.*}"
    cuda_minor="${cuda_version##*.}"

    if [ -n "${gpu_name:-}" ] && echo "$gpu_name" | grep -qP '(RTX\s*)?50[0-9]{2}'; then
        if [ "$cuda_major" -lt 12 ] || { [ "$cuda_major" -eq 12 ] && [ "$cuda_minor" -lt 8 ]; }; then
            err "CUDA $cuda_version is too old for $gpu_name (Blackwell). CUDA 12.8+ required."
            errors=$((errors + 1))
        fi
    fi

    driver_cuda_version=$(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version: \K[0-9]+\.[0-9]+' || true)
    if [ -n "$driver_cuda_version" ]; then
        driver_cuda_major="${driver_cuda_version%%.*}"
        driver_cuda_minor="${driver_cuda_version##*.}"
        if [ "$cuda_major" -gt "$driver_cuda_major" ] || \
           { [ "$cuda_major" -eq "$driver_cuda_major" ] && [ "$cuda_minor" -gt "$driver_cuda_minor" ]; }; then
            err "CUDA toolkit ($cuda_version) is NEWER than the driver supports ($driver_cuda_version)."
            err "This mismatch will cause a hard freeze when building GPU code. Downgrade the toolkit."
            errors=$((errors + 1))
        else
            ok "CUDA toolkit ($cuda_version) compatible with driver (supports up to $driver_cuda_version)"
        fi
    fi
else
    err "nvcc not found in PATH."
    errors=$((errors + 1))
fi

if [ "$errors" -gt 0 ]; then
    err "Fix the above issues before continuing."
    exit 1
fi

echo ""

# ── Step 2: Python environment ──────────────────────────────────────────────

info "Step 2: Sync the Python environment"
if confirm "Run 'uv sync --all-extras' in $SCRIPT_DIR?"; then
    (cd "$SCRIPT_DIR" && uv sync --all-extras)
    ok "venv ready at $VENV_DIR"
else
    warn "Skipping uv sync. The launcher will not start without the venv."
fi

[ -x "$LLMS_BIN" ] || warn "$LLMS_BIN missing; complete uv sync before continuing."

echo ""

# ── Step 3: Validate config ─────────────────────────────────────────────────

if [ -x "$LLMS_BIN" ]; then
    info "Step 3: Validate the YAML config tree"
    if (cd "$SCRIPT_DIR" && "$LLMS_BIN" config lint); then
        ok "config tree clean"
    else
        err "Config lint failed; fix before continuing."
        exit 1
    fi
    echo ""
fi

# ── Step 4: Build providers ─────────────────────────────────────────────────

info "Step 4: Build the inference providers"
if confirm "Build llama.cpp from source with CUDA?"; then
    "$SCRIPT_DIR/scripts/provider.sh" install llama.cpp
fi
if confirm "Also build ik_llama.cpp for backend comparisons?"; then
    "$SCRIPT_DIR/scripts/provider.sh" install ik_llama.cpp
fi

echo ""

# ── Step 5: systemd unit ────────────────────────────────────────────────────

info "Step 5: Install systemd unit at $SERVICE_DEST"
if [ -f "$SERVICE_DEST" ]; then
    if confirm "Overwrite $SERVICE_DEST with the version from this repo?"; then
        sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
        ok "Service file overwritten"
    fi
else
    if confirm "Install systemd service to $SERVICE_DEST?"; then
        sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
        ok "Service file installed"
    fi
fi

echo ""

# ── Step 6: Reload systemd and (re)start ────────────────────────────────────

if [ -f "$SERVICE_DEST" ] && confirm "Reload systemd and (re)start llama-server?"; then
    sudo systemctl daemon-reload
    sudo systemctl enable llama-server
    sudo systemctl restart llama-server
    ok "Service enabled and restarted"

    info "Waiting for the API..."
    attempts=0
    max_attempts=30
    port=$(awk -F': *' '/^[[:space:]]*port:/ {print $2; exit}' "$CONFIG_DIR"/hardware/*.yaml | head -1)
    port=${port:-9999}
    while [ $attempts -lt $max_attempts ]; do
        if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${port}/v1/models"; then
            ok "API responding at http://127.0.0.1:${port}"
            break
        fi
        attempts=$((attempts + 1))
        sleep 2
    done
    [ $attempts -lt $max_attempts ] || warn "API did not respond; check journalctl -u llama-server -f"
fi

echo ""
info "Setup complete. Useful commands:"
printf '  %-44s # %s\n' "$LLMS_BIN endpoint list" "show endpoints in the YAML tree"
printf '  %-44s # %s\n' "$LLMS_BIN endpoint activate <name>" "switch active endpoint, then systemctl restart"
printf '  %-44s # %s\n' "systemctl status llama-server" "service status"
printf '  %-44s # %s\n' "journalctl -u llama-server -f" "follow live logs"
printf '  %-44s # %s\n' "$LLMS_BIN eval run mmlu --endpoint chat-default" "run an eval"
