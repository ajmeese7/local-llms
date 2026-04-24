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
COMMON_HELPERS_SRC="$CONFIG_DIR/runtime-common.sh"
DEST_DIR="/etc/llama-server"
SERVICE_DEST="/etc/systemd/system/llama-server.service"

# shellcheck source=/dev/null
source "$COMMON_HELPERS_SRC"

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

install_runtime_file() {
    local src="$1"
    local dest="$DEST_DIR/$(basename "$src")"
    local backup_archive

    if [ -e "$dest.bak" ] || [ -L "$dest.bak" ]; then
        backup_archive="$dest.bak.$(date +%Y%m%d-%H%M%S)-$$"
        while [ -e "$backup_archive" ] || [ -L "$backup_archive" ]; do
            backup_archive="$dest.bak.$(date +%Y%m%d-%H%M%S)-$$-$RANDOM"
        done
        sudo mv -f "$dest.bak" "$backup_archive"
        info "Preserved previous backup as $(basename "$backup_archive")"
    fi

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        sudo mv -f "$dest" "$dest.bak"
        info "Backed up $(basename "$dest") to $(basename "$dest").bak"
    fi

    sudo cp "$src" "$dest"
}

profile_supported() {
    local needle="$1"
    local profile
    local supported_profiles="${SUPPORTED_MODEL_PROFILES:-}"

    [ -n "$supported_profiles" ] || return 1

    for profile in $supported_profiles; do
        if [ "$profile" = "$needle" ]; then
            return 0
        fi
    done

    return 1
}

load_active_model_profile() {
    local active_model_file="$1"
    local profile_line
    local profile_value

    [ -f "$active_model_file" ] || return 0

    profile_line="$(grep -m1 -E '^[[:space:]]*MODEL_PROFILE[[:space:]]*=' "$active_model_file" || true)"
    [ -n "$profile_line" ] || return 0

    profile_value="${profile_line#*=}"
    profile_value="${profile_value%%#*}"
    profile_value="${profile_value#"${profile_value%%[![:space:]]*}"}"
    profile_value="${profile_value%"${profile_value##*[![:space:]]}"}"

    case "$profile_value" in
        \"*\")
            profile_value="${profile_value#\"}"
            profile_value="${profile_value%\"}"
            ;;
        \'*\')
            profile_value="${profile_value#\'}"
            profile_value="${profile_value%\'}"
            ;;
    esac

    printf '%s\n' "$profile_value"
}

resolve_model_profile() {
    local active_model_file="$1"
    local active_profile
    local default_profile
    local supported_profiles="${SUPPORTED_MODEL_PROFILES:-}"

    if [ -z "$supported_profiles" ]; then
        printf '\033[1;33m[WARN]\033[0m  No SUPPORTED_MODEL_PROFILES configured in the matched GPU config; skipping active/default profile resolution for %s\n' \
            "$active_model_file" >&2
        return 1
    fi

    active_profile="$(load_active_model_profile "$active_model_file")"
    if [ -n "$active_profile" ]; then
        if profile_supported "$active_profile"; then
            printf '%s\n' "$active_profile"
            return 0
        fi

        printf '\033[1;33m[WARN]\033[0m  Ignoring unsupported active model profile %s from %s; supported profiles: %s\n' \
            "$active_profile" "$active_model_file" "${SUPPORTED_MODEL_PROFILES:-none}" >&2
    fi

    default_profile="${DEFAULT_MODEL_PROFILE:-}"
    if [ -n "$default_profile" ]; then
        if profile_supported "$default_profile"; then
            printf '%s\n' "$default_profile"
            return 0
        fi

        printf '\033[1;33m[WARN]\033[0m  Ignoring unsupported default model profile %s; supported profiles: %s\n' \
            "$default_profile" "${SUPPORTED_MODEL_PROFILES:-none}" >&2
    fi

    return 1
}

source_model_overlay() {
    local base_dir="$1"
    local profile="$2"
    local overlay_file="$base_dir/$profile.conf"

    [ -f "$overlay_file" ] || return 1

    # shellcheck source=/dev/null
    source "$overlay_file"
}

source_model_overlay_prefer_runtime() {
    local profile="$1"

    if source_model_overlay "$DEST_DIR" "$profile"; then
        printf '%s\n' "$DEST_DIR/$profile.conf"
        return 0
    fi

    if source_model_overlay "$CONFIG_DIR" "$profile"; then
        printf '%s\n' "$CONFIG_DIR/$profile.conf"
        return 0
    fi

    return 1
}

resolve_runtime_model_path() {
    local gpu_config_file="$1"
    local active_model_file="$2"
    local profile

    [ -f "$gpu_config_file" ] || return 1

    API_KEY=""
    MODEL=""
    SUPPORTED_MODEL_PROFILES=""
    DEFAULT_MODEL_PROFILE=""
    # shellcheck source=/dev/null
    source "$gpu_config_file"

    profile="$(resolve_model_profile "$active_model_file")" || return 1

    if ! source_model_overlay_prefer_runtime "$profile" >/dev/null; then
        return 1
    fi

    [ -n "${MODEL:-}" ] || return 1
    printf '%s\n' "$MODEL"
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
for cmd in cmake git gcc-12 g++-12; do
    if command -v "$cmd" &>/dev/null; then
        ok "$cmd found"
    else
        err "$cmd not found. Install with: sudo apt install build-essential cmake g++-12 gcc-12 git"
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
    resolved_model_profile=""
    if resolved_model_profile="$(resolve_model_profile "$DEST_DIR/active-model.conf")"; then
        if resolved_overlay_file="$(source_model_overlay_prefer_runtime "$resolved_model_profile")"; then
            info "Using model profile: $resolved_model_profile"
            info "Using model overlay: $resolved_overlay_file"
        else
            warn "Model overlay not found in $DEST_DIR or $CONFIG_DIR: $resolved_model_profile.conf"
        fi
    else
        warn "No valid model profile configured. Set MODEL_PROFILE in $DEST_DIR/active-model.conf or a supported DEFAULT_MODEL_PROFILE in $CONFIG_DIR/$matched_config."
    fi
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
    case "$(model_file_state "$MODEL")" in
        installed)
            model_size=$(du -h "$MODEL" | cut -f1)
            ok "Model already downloaded: $MODEL ($model_size)"
            ;;
        empty)
            warn "Model file exists but is empty: $MODEL"
            if confirm "Re-download model to $MODEL?"; then
                mkdir -p "$MODELS_DIR"
                info "Downloading $HF_FILE (this may take a while)..."
                curl -L --fail --progress-bar \
                    "https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}" \
                    -o "$MODEL"
                ok "Model downloaded"
            else
                warn "Skipping model download. The service will fail without a valid GGUF."
            fi
            ;;
        missing)
            info "Model: ${HF_REPO}/${HF_FILE}"
            if confirm "Download model to $MODEL?"; then
                mkdir -p "$MODELS_DIR"
                info "Downloading $HF_FILE (this may take a while)..."
                curl -L --fail --progress-bar \
                    "https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}" \
                    -o "$MODEL"
                ok "Model downloaded"
            else
                warn "Skipping model download. The service will fail without it."
            fi
            ;;
    esac
else
    warn "No GPU config matched — skipping model download."
fi

echo ""

# ── Step 5: Copy config files & runtime scripts ─────────────────────────────

shopt -s nullglob
config_files=("$CONFIG_DIR"/*.conf)
shopt -u nullglob

if [ ${#config_files[@]} -eq 0 ]; then
    err "No runtime config files (config/*.conf) found in repo."
    exit 1
fi

if confirm "Copy runtime configs and scripts to $DEST_DIR? (${#config_files[@]} config file(s) + 3 script(s))"; then
    sudo mkdir -p "$DEST_DIR"
    for f in "${config_files[@]}"; do
        install_runtime_file "$f"
        ok "Copied $(basename "$f")"
    done
    install_runtime_file "$COMMON_HELPERS_SRC"
    ok "Copied shared runtime helpers"
    install_runtime_file "$LAUNCHER_SRC"
    sudo chmod +x "$DEST_DIR/llama-launcher.sh"
    ok "Copied launcher script"
    install_runtime_file "$CONFIG_DIR/select-model.sh"
    sudo chmod +x "$DEST_DIR/select-model.sh"
    ok "Copied model selector script"
    if [ -n "$matched_config" ]; then
        warn "Edit $DEST_DIR/$matched_config if you want to require an API key before exposing the service."
    fi
    warn "Existing runtime-managed files were preserved as *.bak before replacement."
    warn "Merge any intentional local overrides forward from the .bak copies before restarting the service."
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
    runtime_model_path=""
    if [ -n "${matched_config:-}" ]; then
        runtime_model_path="$(resolve_runtime_model_path "$DEST_DIR/$matched_config" "$DEST_DIR/active-model.conf" || true)"
    fi

    if [ -z "$runtime_model_path" ]; then
        warn "Could not resolve the active runtime model from $DEST_DIR."
        warn "Skipping service activation until the runtime config and overlays are complete."
    elif ! model_file_is_ready "$runtime_model_path"; then
        warn "Selected runtime model is not installed: $runtime_model_path"
        warn "Use $DEST_DIR/select-model.sh to download that profile or switch to an installed one before restarting the service."
    else
        sudo systemctl daemon-reload
        sudo systemctl enable llama-server
        sudo systemctl restart llama-server
        ok "Service enabled and restarted with the latest runtime config"
    fi
else
    warn "Skipping service activation. Start manually with: sudo systemctl enable llama-server && sudo systemctl restart llama-server"
fi

echo ""

# ── Step 8: Verify ──────────────────────────────────────────────────────────

if systemctl is-active --quiet llama-server; then
    ok "llama-server service is running"
    info "Waiting for the API to become available (model loading can take a moment)..."

    if [ -n "${matched_config:-}" ] && [ -f "$DEST_DIR/$matched_config" ]; then
        API_KEY=""
        # shellcheck source=/dev/null
        source "$DEST_DIR/$matched_config"
    fi
    if resolved_model_profile="$(resolve_model_profile "$DEST_DIR/active-model.conf")"; then
        if ! source_model_overlay "$DEST_DIR" "$resolved_model_profile"; then
            warn "Model overlay not found: $DEST_DIR/$resolved_model_profile.conf"
        fi
    fi
    port="${PORT:-8000}"
    api_key="${API_KEY:-}"

    attempts=0
    max_attempts=30
    while [ $attempts -lt $max_attempts ]; do
        probe_cmd=()
        build_models_probe_command probe_cmd "$port" "$api_key"

        if "${probe_cmd[@]}" >/dev/null 2>&1; then
            ok "API is responding!"
            echo ""
            info "Models available:"
            fetch_cmd=()
            build_models_fetch_command fetch_cmd "$port" "$api_key"
            "${fetch_cmd[@]}" | python3 -m json.tool 2>/dev/null || true
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
    if [ -n "${matched_config:-}" ]; then
        runtime_model_path="$(resolve_runtime_model_path "$DEST_DIR/$matched_config" "$DEST_DIR/active-model.conf" || true)"
        if [ -n "$runtime_model_path" ] && ! model_file_is_ready "$runtime_model_path"; then
            warn "Resolved runtime model is unavailable: $runtime_model_path ($(model_file_state "$runtime_model_path"))"
            warn "Switch to an installed profile with: sudo $DEST_DIR/select-model.sh"
        fi
    fi
fi

echo ""
info "Setup complete. Useful commands:"
printf '  %-42s # %s\n' "sudo $DEST_DIR/select-model.sh" "switch profiles or download a selected model"
printf '  %-42s # %s\n' "systemctl status llama-server" "check service status"
printf '  %-42s # %s\n' "journalctl -u llama-server -f" "follow live logs"
printf '  %-42s # %s\n' "sudo systemctl restart llama-server" "restart after config changes"
printf '  %-42s # %s\n' "sudo nano $DEST_DIR/${matched_config:-rtx-XXXX.conf}" "edit the active GPU base config"
