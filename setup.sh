#!/usr/bin/env bash
# Interactive setup script for vLLM as a systemd service on WSL2.
# Each step asks for confirmation before proceeding.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$HOME/.venvs/vllm"
CONFIG_DIR="$SCRIPT_DIR/config"
SERVICE_SRC="$CONFIG_DIR/vllm.service"
LAUNCHER_SRC="$CONFIG_DIR/vllm-launcher.sh"
DEST_DIR="/etc/vllm"
SERVICE_DEST="/etc/systemd/system/vllm.service"

# ── Helpers ──────────────────────────────────────────────────────────────────

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

# systemd
if [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
    ok "systemd is PID 1"
else
    err "systemd is NOT PID 1. Enable it in /etc/wsl.conf ([boot] systemd=true) and restart WSL."
    errors=$((errors + 1))
fi

# nvidia-smi
if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    ok "NVIDIA GPU detected: $gpu_name"
else
    err "nvidia-smi not found or not working. Install NVIDIA drivers on the Windows host."
    errors=$((errors + 1))
fi

# Python 3.10+
if command -v python3 &>/dev/null; then
    py_ver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    py_major=$(echo "$py_ver" | cut -d. -f1)
    py_minor=$(echo "$py_ver" | cut -d. -f2)
    if [ "$py_major" -ge 3 ] && [ "$py_minor" -ge 10 ]; then
        ok "Python $py_ver found"
    else
        err "Python $py_ver is too old. vLLM requires Python 3.10+."
        errors=$((errors + 1))
    fi
else
    err "python3 not found."
    errors=$((errors + 1))
fi

if [ "$errors" -gt 0 ]; then
    err "Fix the above issues before continuing."
    exit 1
fi

echo ""

# ── Step 2: Create virtual environment ──────────────────────────────────────

if [ -d "$VENV_DIR" ]; then
    ok "Virtual environment already exists at $VENV_DIR"
else
    if confirm "Create Python virtual environment at $VENV_DIR?"; then
        info "Creating venv..."
        python3 -m venv "$VENV_DIR"
        ok "Virtual environment created"
    else
        warn "Skipping venv creation. The service will fail without it."
    fi
fi

echo ""

# ── Step 3: Install vLLM ────────────────────────────────────────────────────

if "$VENV_DIR/bin/pip" show vllm &>/dev/null; then
    installed_ver=$("$VENV_DIR/bin/pip" show vllm 2>/dev/null | grep -i ^version | awk '{print $2}')
    ok "vLLM $installed_ver is already installed"
    if confirm "Upgrade vLLM to the latest version?"; then
        info "Upgrading vLLM (this may take a few minutes)..."
        "$VENV_DIR/bin/pip" install --upgrade vllm
        ok "vLLM upgraded"
    fi
else
    if confirm "Install vLLM in the virtual environment? (this may take a few minutes)"; then
        info "Installing vLLM..."
        "$VENV_DIR/bin/pip" install vllm
        ok "vLLM installed"
    else
        warn "Skipping vLLM install. The service will fail without it."
    fi
fi

echo ""

# ── Step 4: Copy config files & launcher ────────────────────────────────────

# Detect GPU to show which config will be used
detected_gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
if echo "$detected_gpu" | grep -qi "5090"; then
    matched_config="rtx-5090.yaml"
elif echo "$detected_gpu" | grep -qi "5060"; then
    matched_config="rtx-5060.yaml"
else
    matched_config=""
fi

if [ -n "$matched_config" ]; then
    info "GPU '$detected_gpu' matches config: $matched_config"
else
    warn "No config matches GPU '$detected_gpu'. You may need to add one to config/ and update vllm-launcher.sh."
fi

config_files=("$CONFIG_DIR"/rtx-*.yaml)
if [ ${#config_files[@]} -eq 0 ]; then
    err "No GPU config files (config/rtx-*.yaml) found in repo."
    exit 1
fi

if confirm "Copy GPU configs and launcher to $DEST_DIR? (${#config_files[@]} config file(s))"; then
    sudo mkdir -p "$DEST_DIR"
    for f in "${config_files[@]}"; do
        sudo cp "$f" "$DEST_DIR/"
        ok "Copied $(basename "$f")"
    done
    sudo cp "$LAUNCHER_SRC" "$DEST_DIR/vllm-launcher.sh"
    sudo chmod +x "$DEST_DIR/vllm-launcher.sh"
    ok "Copied launcher script"
    if [ -n "$matched_config" ]; then
        warn "Edit $DEST_DIR/$matched_config to set your API key before starting the service."
    fi
else
    warn "Skipping config copy."
fi

echo ""

# ── Step 5: Install systemd service ─────────────────────────────────────────

if [ -f "$SERVICE_DEST" ]; then
    ok "Service file already exists at $SERVICE_DEST"
    if confirm "Overwrite $SERVICE_DEST with the version from this repo?"; then
        sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
        ok "Service file overwritten"
    fi
else
    if confirm "Install systemd service to $SERVICE_DEST?"; then
        sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
        ok "Service file installed"
    else
        warn "Skipping service install."
    fi
fi

echo ""

# ── Step 6: Reload systemd & enable service ─────────────────────────────────

if confirm "Reload systemd and enable+start the vLLM service?"; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now vllm
    ok "Service enabled and started"
else
    warn "Skipping service activation. Start manually with: sudo systemctl enable --now vllm"
fi

echo ""

# ── Step 7: Verify ──────────────────────────────────────────────────────────

if systemctl is-active --quiet vllm; then
    ok "vLLM service is running"
    info "Waiting for the API to become available (model loading can take a while)..."

    active_config=""
    if [ -n "${matched_config:-}" ] && [ -f "$DEST_DIR/$matched_config" ]; then
        active_config="$DEST_DIR/$matched_config"
    fi
    api_key=$(grep -oP '(?<=api-key:\s")[^"]+' "$active_config" 2>/dev/null || echo "change-this-key")
    port=$(grep -oP '(?<=port:\s)\d+' "$active_config" 2>/dev/null || echo "8000")

    attempts=0
    max_attempts=60
    while [ $attempts -lt $max_attempts ]; do
        if curl -sf "http://127.0.0.1:$port/v1/models" \
             -H "Authorization: Bearer $api_key" >/dev/null 2>&1; then
            ok "API is responding!"
            echo ""
            info "Models available:"
            curl -s "http://127.0.0.1:$port/v1/models" \
                 -H "Authorization: Bearer $api_key" | python3 -m json.tool 2>/dev/null || true
            echo ""
            break
        fi
        attempts=$((attempts + 1))
        sleep 5
    done

    if [ $attempts -eq $max_attempts ]; then
        warn "API did not respond within $((max_attempts * 5)) seconds."
        warn "Check logs with: journalctl -u vllm -f"
    fi
else
    info "Service is not running. Check status with: systemctl status vllm"
fi

echo ""
info "Setup complete. Useful commands:"
echo "  systemctl status vllm          # check service status"
echo "  journalctl -u vllm -f          # follow live logs"
echo "  sudo systemctl restart vllm    # restart after config changes"
echo "  sudo nano $DEST_DIR/${matched_config:-rtx-XXXX.yaml}  # edit config"
