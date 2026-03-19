#!/usr/bin/env bash
# Detects the GPU and launches vLLM with the matching config from /etc/vllm/.
# Called by the systemd service — not intended to be run directly.

set -euo pipefail

CONFIG_DIR="/etc/vllm"
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
# Add new entries here as needed — the pattern is the substring to match
# in nvidia-smi output, and the value is the config filename.
config_file=""
if echo "$gpu_name" | grep -qi "5090"; then
    config_file="$CONFIG_DIR/rtx-5090.yaml"
elif echo "$gpu_name" | grep -qi "5060"; then  # matches both 5060 and 5060 Ti
    config_file="$CONFIG_DIR/rtx-5060.yaml"
fi

if [ -z "$config_file" ]; then
    echo "ERROR: No config found for GPU '$gpu_name'" >&2
    echo "Available configs in $CONFIG_DIR:" >&2
    ls "$CONFIG_DIR"/*.yaml 2>/dev/null >&2 || echo "  (none)" >&2
    echo "Add a config file and update this script's GPU matching logic." >&2
    exit 1
fi

if [ ! -f "$config_file" ]; then
    echo "ERROR: Config file $config_file does not exist" >&2
    exit 1
fi

echo "Using config: $config_file"

# Replace this process with vLLM
exec /home/ajmeese7/.venvs/vllm/bin/vllm serve --config "$config_file"
