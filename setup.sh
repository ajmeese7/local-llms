#!/usr/bin/env bash
# Interactive setup script for llama.cpp as a systemd service.
# Works on native Linux and WSL2. Each step asks for confirmation before proceeding.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
LLAMA_DIR="$HOME/.local/share/llama.cpp"
MODELS_DIR="$HOME/models"
SERVICE_SRC="$CONFIG_DIR/llama-server.service"
LAUNCHER_SRC="$CONFIG_DIR/llama-launcher.sh"
DEST_DIR="/etc/llama-server"
SERVICE_DEST="/etc/systemd/system/llama-server.service"

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

# Build tools
for cmd in cmake git gcc g++; do
    if command -v "$cmd" &>/dev/null; then
        ok "$cmd found"
    else
        err "$cmd not found. Install with: sudo apt install build-essential cmake git"
        errors=$((errors + 1))
    fi
done

# nvcc compiler & CUDA toolkit version
if command -v nvcc &>/dev/null; then
    nvcc_path="$(command -v nvcc)"
    cuda_version=$(nvcc --version | grep -oP 'release \K[0-9]+\.[0-9]+')
    ok "nvcc found at $nvcc_path (CUDA $cuda_version)"

    # Blackwell (RTX 50 series) requires CUDA 12.8+
    cuda_major="${cuda_version%%.*}"
    cuda_minor="${cuda_version##*.}"
    if echo "$gpu_name" | grep -qP '(RTX\s*)?50[0-9]{2}'; then
        if [ "$cuda_major" -lt 12 ] || { [ "$cuda_major" -eq 12 ] && [ "$cuda_minor" -lt 8 ]; }; then
            err "CUDA $cuda_version is too old for $gpu_name (Blackwell). CUDA 12.8+ required."
            err "The Ubuntu nvidia-cuda-toolkit package is outdated. Install from NVIDIA's repo instead:"
            err "  https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=24.04&target_type=deb_network"
            err "After installing, ensure the new nvcc is first in PATH (e.g. /usr/local/cuda/bin/nvcc)."
            errors=$((errors + 1))
        fi
    fi

    # Driver/toolkit CUDA version compatibility check
    # If toolkit version > driver's supported CUDA version, GPU calls will hang the system
    driver_cuda_version=$(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version: \K[0-9]+\.[0-9]+' || true)
    if [ -n "$driver_cuda_version" ]; then
        driver_cuda_major="${driver_cuda_version%%.*}"
        driver_cuda_minor="${driver_cuda_version##*.}"
        if [ "$cuda_major" -gt "$driver_cuda_major" ] || \
           { [ "$cuda_major" -eq "$driver_cuda_major" ] && [ "$cuda_minor" -gt "$driver_cuda_minor" ]; }; then
            err "CUDA toolkit ($cuda_version) is NEWER than the driver supports ($driver_cuda_version)."
            err "This mismatch will cause a hard system freeze when building GPU code."
            err "Downgrade the CUDA toolkit to match your driver ($driver_cuda_version):"
            err "  1. Download the matching toolkit runfile from https://developer.nvidia.com/cuda-toolkit-archive"
            err "  2. Install toolkit only:  sudo sh cuda_*_linux.run --toolkit --silent --override"
            err "  3. Update symlink:        sudo ln -sfn /usr/local/cuda-$driver_cuda_version /usr/local/cuda"
            err "  WARNING: Do NOT try to upgrade the driver instead — the DKMS build will freeze the system."
            errors=$((errors + 1))
        else
            ok "CUDA toolkit ($cuda_version) is compatible with driver (supports up to $driver_cuda_version)"
        fi
    else
        warn "Could not detect driver CUDA version from nvidia-smi. Skipping compatibility check."
    fi
else
    err "nvcc not found in PATH. Install CUDA toolkit from:"
    err "  https://developer.nvidia.com/cuda-downloads"
    errors=$((errors + 1))
fi

if [ "$errors" -gt 0 ]; then
    err "Fix the above issues before continuing."
    exit 1
fi

echo ""

# ── Step 2: Detect GPU & select config ──────────────────────────────────────

detected_gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
if echo "$detected_gpu" | grep -qi "5090"; then
    matched_config="rtx-5090.conf"
elif echo "$detected_gpu" | grep -qi "5060"; then
    matched_config="rtx-5060.conf"
else
    matched_config=""
fi

if [ -n "$matched_config" ]; then
    info "GPU '$detected_gpu' matches config: $matched_config"
    # shellcheck source=/dev/null
    source "$CONFIG_DIR/$matched_config"
else
    warn "No config matches GPU '$detected_gpu'. You may need to add one to config/."
fi

echo ""

# ── Step 3: Build llama.cpp ─────────────────────────────────────────────────

if [ -x "$LLAMA_DIR/build/bin/llama-server" ]; then
    ok "llama-server already built at $LLAMA_DIR"
    if confirm "Rebuild llama.cpp from source? (pull latest and recompile)"; then
        info "Pulling latest llama.cpp..."
        cd "$LLAMA_DIR" && git pull
        info "Cleaning old build directory..."
        rm -rf build
        info "Building with CUDA support (this may take a few minutes)..."
        nvcc_path="$(command -v nvcc)"
        cmake -B build -DGGML_CUDA=ON \
            -DCMAKE_C_COMPILER=gcc-12 \
            -DCMAKE_CXX_COMPILER=g++-12 \
            -DCMAKE_CUDA_COMPILER="$nvcc_path" \
            -DCMAKE_CUDA_HOST_COMPILER=gcc-12
        cmake --build build --config Release -j1
        ok "llama.cpp rebuilt"
    fi
else
    if confirm "Clone and build llama.cpp from source with CUDA? (this may take a few minutes)"; then
        mkdir -p "$(dirname "$LLAMA_DIR")"
        if [ -d "$LLAMA_DIR" ]; then
            info "Updating existing llama.cpp clone..."
            cd "$LLAMA_DIR" && git pull
        else
            info "Cloning llama.cpp..."
            git clone https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
        fi
        cd "$LLAMA_DIR"
        info "Cleaning old build directory..."
        rm -rf build
        info "Building with CUDA support..."
        nvcc_path="$(command -v nvcc)"
        cmake -B build -DGGML_CUDA=ON \
            -DCMAKE_C_COMPILER=gcc-12 \
            -DCMAKE_CXX_COMPILER=g++-12 \
            -DCMAKE_CUDA_COMPILER="$nvcc_path" \
            -DCMAKE_CUDA_HOST_COMPILER=gcc-12
        cmake --build build --config Release -j1
        ok "llama.cpp built"
    else
        warn "Skipping llama.cpp build. The service will fail without it."
    fi
fi

echo ""

# ── Step 4: Download model ──────────────────────────────────────────────────

if [ -n "$matched_config" ] && [ -n "${MODEL:-}" ]; then
    if [ -f "$MODEL" ]; then
        model_size=$(du -h "$MODEL" | cut -f1)
        ok "Model already downloaded: $MODEL ($model_size)"
    else
        info "Model: ${HF_REPO}/${HF_FILE}"
        if confirm "Download model to $MODEL?"; then
            mkdir -p "$MODELS_DIR"
            info "Downloading $HF_FILE (this may take a while)..."
            curl -L --progress-bar \
                "https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}" \
                -o "$MODEL"
            ok "Model downloaded"
        else
            warn "Skipping model download. The service will fail without it."
        fi
    fi
else
    warn "No GPU config matched — skipping model download."
fi

echo ""

# ── Step 5: Copy config files & launcher ────────────────────────────────────

config_files=("$CONFIG_DIR"/rtx-*.conf)
if [ ${#config_files[@]} -eq 0 ]; then
    err "No GPU config files (config/rtx-*.conf) found in repo."
    exit 1
fi

if confirm "Copy GPU configs and launcher to $DEST_DIR? (${#config_files[@]} config file(s))"; then
    sudo mkdir -p "$DEST_DIR"
    for f in "${config_files[@]}"; do
        sudo cp "$f" "$DEST_DIR/"
        ok "Copied $(basename "$f")"
    done
    sudo cp "$LAUNCHER_SRC" "$DEST_DIR/llama-launcher.sh"
    sudo chmod +x "$DEST_DIR/llama-launcher.sh"
    ok "Copied launcher script"
    if [ -n "$matched_config" ]; then
        warn "Edit $DEST_DIR/$matched_config to set your API key before starting the service."
    fi
else
    warn "Skipping config copy."
fi

echo ""

# ── Step 6: Install systemd service ─────────────────────────────────────────

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

# ── Step 7: Reload systemd & enable service ─────────────────────────────────

if confirm "Reload systemd and enable+start the llama-server service?"; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now llama-server
    ok "Service enabled and started"
else
    warn "Skipping service activation. Start manually with: sudo systemctl enable --now llama-server"
fi

echo ""

# ── Step 8: Verify ──────────────────────────────────────────────────────────

if systemctl is-active --quiet llama-server; then
    ok "llama-server service is running"
    info "Waiting for the API to become available (model loading can take a moment)..."

    active_config=""
    if [ -n "${matched_config:-}" ] && [ -f "$DEST_DIR/$matched_config" ]; then
        active_config="$DEST_DIR/$matched_config"
        # shellcheck source=/dev/null
        source "$active_config"
    fi
    port="${PORT:-8000}"
    api_key="${API_KEY:-change-this-key}"

    attempts=0
    max_attempts=30
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
        sleep 2
    done

    if [ $attempts -eq $max_attempts ]; then
        warn "API did not respond within $((max_attempts * 2)) seconds."
        warn "Check logs with: journalctl -u llama-server -f"
    fi
else
    info "Service is not running. Check status with: systemctl status llama-server"
fi

echo ""
info "Setup complete. Useful commands:"
echo "  systemctl status llama-server          # check service status"
echo "  journalctl -u llama-server -f          # follow live logs"
echo "  sudo systemctl restart llama-server    # restart after config changes"
echo "  sudo nano $DEST_DIR/${matched_config:-rtx-XXXX.conf}  # edit config"
