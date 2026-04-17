#!/usr/bin/env bash
# Detects the GPU and launches llama-server with the matching config.
# Called by the systemd service — not intended to be run directly.

set -euo pipefail

CONFIG_DIR="${LLAMA_CONFIG_DIR:-/etc/llama-server}"
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$HOME/.local/share/llama.cpp/build/bin/llama-server}"
NVIDIA_SMI_BIN="${NVIDIA_SMI_BIN:-/usr/lib/wsl/lib/nvidia-smi}"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

profile_supported() {
    local needle="$1"
    local profile

    for profile in $SUPPORTED_MODEL_PROFILES; do
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

# Fallback to PATH if the WSL-specific path doesn't exist
if [ ! -x "$NVIDIA_SMI_BIN" ]; then
    NVIDIA_SMI_BIN="nvidia-smi"
fi

# Query GPU name from nvidia-smi (e.g. "NVIDIA GeForce RTX 5090")
gpu_name=$("$NVIDIA_SMI_BIN" --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)

if [ -z "$gpu_name" ]; then
    die "Could not detect GPU via nvidia-smi"
fi

echo "Detected GPU: $gpu_name"

# Match GPU name to a config file.
# Add new entries here as needed.
config_file=""
if echo "$gpu_name" | grep -qi "5090"; then
    config_file="$CONFIG_DIR/rtx-5090.conf"
elif echo "$gpu_name" | grep -qi "5060"; then  # matches both 5060 and 5060 Ti
    config_file="$CONFIG_DIR/rtx-5060.conf"
fi

if [ -z "$config_file" ]; then
    echo "ERROR: No config found for GPU '$gpu_name'" >&2
    echo "Available configs in $CONFIG_DIR:" >&2
    ls "$CONFIG_DIR"/*.conf 2>/dev/null >&2 || echo "  (none)" >&2
    echo "Add a config file and update this script's GPU matching logic." >&2
    exit 1
fi

if [ ! -f "$config_file" ]; then
    die "Config file $config_file does not exist"
fi

echo "Using GPU config: $config_file"

# Source the GPU config (sets hardware defaults, secrets, and profile metadata).
# shellcheck source=/dev/null
source "$config_file"

active_profile="$(load_active_model_profile "$CONFIG_DIR/active-model.conf")"
[ -n "$active_profile" ] || active_profile="${DEFAULT_MODEL_PROFILE:-}"
[ -n "$active_profile" ] || die "No MODEL_PROFILE is active and no DEFAULT_MODEL_PROFILE is set in $config_file"

[ -n "${SUPPORTED_MODEL_PROFILES:-}" ] || die "Required config field 'SUPPORTED_MODEL_PROFILES' is not set in $config_file"
profile_supported "$active_profile" || die "Model profile '$active_profile' is not supported on GPU '$gpu_name'"

overlay_file="$CONFIG_DIR/$active_profile.conf"
[ -f "$overlay_file" ] || die "Model overlay not found: $overlay_file"

# shellcheck source=/dev/null
source "$overlay_file"

for required_field in MODEL ALIAS HOST PORT API_KEY GPU_LAYERS CONTEXT_LENGTH PARALLEL_SLOTS FLASH_ATTENTION CACHE_TYPE_K CACHE_TYPE_V; do
    if [ -z "${!required_field:-}" ]; then
        die "Required config field '$required_field' is not set after loading $config_file and $overlay_file"
    fi
done

if [ ! -f "$MODEL" ]; then
    die "Model file not found: $MODEL"
fi

if [ ! -x "$LLAMA_SERVER_BIN" ]; then
    die "llama-server not found at $LLAMA_SERVER_BIN"
fi

echo "Using model profile: $active_profile"
echo "Using model overlay: $overlay_file"
echo "Final model path: $MODEL"
echo "Starting llama-server with model: $MODEL"

# Replace this process with llama-server
exec "$LLAMA_SERVER_BIN" \
    -m "$MODEL" \
    --alias "$ALIAS" \
    --host "$HOST" \
    --port "$PORT" \
    --api-key "$API_KEY" \
    -ngl "$GPU_LAYERS" \
    -c "$CONTEXT_LENGTH" \
    -np "$PARALLEL_SLOTS" \
    -fa "$FLASH_ATTENTION" \
    --cache-type-k "$CACHE_TYPE_K" \
    --cache-type-v "$CACHE_TYPE_V"
