#!/usr/bin/env bash
# Detects the GPU and launches llama-server with the matching config.
# Called by the systemd service — not intended to be run directly.

set -euo pipefail

CONFIG_DIR="/etc/llama-server"
LLAMA_SERVER="$HOME/.local/share/llama.cpp/build/bin/llama-server"
NVIDIA_SMI="/usr/lib/wsl/lib/nvidia-smi"

# Fallback to PATH if the WSL-specific path doesn't exist
if [ ! -x "$NVIDIA_SMI" ]; then
    NVIDIA_SMI="nvidia-smi"
fi

# Query GPU name from nvidia-smi (e.g. "NVIDIA GeForce RTX 5090")
gpu_name=$("$NVIDIA_SMI" --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)

if [ -z "$gpu_name" ]; then
    echo "ERROR: Could not detect GPU via nvidia-smi" >&2
    exit 1
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
    echo "ERROR: Config file $config_file does not exist" >&2
    exit 1
fi

echo "Using config: $config_file"

# Source the config (sets MODEL, HOST, PORT, API_KEY, etc.)
# shellcheck source=/dev/null
source "$config_file"

if [ ! -f "$MODEL" ]; then
    echo "ERROR: Model file not found: $MODEL" >&2
    echo "Run setup.sh to download it, or set MODEL= in $config_file." >&2
    exit 1
fi

if [ ! -x "$LLAMA_SERVER" ]; then
    echo "ERROR: llama-server not found at $LLAMA_SERVER" >&2
    echo "Run setup.sh to build llama.cpp, or update the path." >&2
    exit 1
fi

echo "Starting llama-server with model: $MODEL"

# Replace this process with llama-server
exec "$LLAMA_SERVER" \
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
