#!/usr/bin/env bash
# Interactive selector for model profiles supported by the detected GPU.
# This is a standalone operational command, not part of the launcher path.

set -euo pipefail

CONFIG_DIR="${LLAMA_CONFIG_DIR:-/etc/llama-server}"
ACTIVE_MODEL_FILE="$CONFIG_DIR/active-model.conf"
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

select_gpu_config() {
    local gpu_name="$1"

    if echo "$gpu_name" | grep -qi "5090"; then
        printf '%s\n' "$CONFIG_DIR/rtx-5090.conf"
    elif echo "$gpu_name" | grep -qi "5060"; then
        printf '%s\n' "$CONFIG_DIR/rtx-5060.conf"
    fi
}

write_active_model_profile() {
    local selected_profile="$1"

    if [ "${EUID:-$(id -u)}" -eq 0 ]; then
        mkdir -p "$CONFIG_DIR"
        printf 'MODEL_PROFILE=%s\n' "$selected_profile" > "$ACTIVE_MODEL_FILE"
    elif command -v sudo >/dev/null 2>&1; then
        sudo mkdir -p "$CONFIG_DIR"
        printf 'MODEL_PROFILE=%s\n' "$selected_profile" | sudo tee "$ACTIVE_MODEL_FILE" >/dev/null
    else
        die "Writing $ACTIVE_MODEL_FILE requires elevated privileges; rerun with sudo or create the file as root"
    fi
}

# Fallback to PATH if the WSL-specific path doesn't exist.
if [ ! -x "$NVIDIA_SMI_BIN" ]; then
    NVIDIA_SMI_BIN="nvidia-smi"
fi

gpu_name=$("$NVIDIA_SMI_BIN" --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
[ -n "$gpu_name" ] || die "Could not detect GPU via nvidia-smi"

echo "Detected GPU: $gpu_name"

config_file="$(select_gpu_config "$gpu_name")"
[ -n "$config_file" ] || {
    echo "ERROR: No config found for GPU '$gpu_name'" >&2
    echo "Available configs in $CONFIG_DIR:" >&2
    ls "$CONFIG_DIR"/*.conf 2>/dev/null >&2 || echo "  (none)" >&2
    echo "Add a config file and update this script's GPU matching logic." >&2
    exit 1
}

[ -f "$config_file" ] || die "Config file $config_file does not exist"

echo "Using GPU config: $config_file"

# shellcheck source=/dev/null
source "$config_file"

[ -n "${SUPPORTED_MODEL_PROFILES:-}" ] || die "Required config field 'SUPPORTED_MODEL_PROFILES' is not set in $config_file"

current_profile="$(load_active_model_profile "$ACTIVE_MODEL_FILE")"
current_profile_source="active"
if [ -z "$current_profile" ] && [ -n "${DEFAULT_MODEL_PROFILE:-}" ]; then
    current_profile="$DEFAULT_MODEL_PROFILE"
    current_profile_source="default"
fi

if [ -n "$current_profile" ]; then
    if [ "$current_profile_source" = "default" ]; then
        echo "Current active profile: $current_profile (default)"
    else
        echo "Current active profile: $current_profile"
    fi
else
    echo "Current active profile: (none)"
fi

echo
echo "Available model profiles for $gpu_name:"

index=1
for profile in $SUPPORTED_MODEL_PROFILES; do
    marker=""
    if [ "$profile" = "${current_profile:-}" ]; then
        marker=" (current)"
    fi
    printf '  %d) %s%s\n' "$index" "$profile" "$marker"
    index=$((index + 1))
done

[ "$index" -gt 1 ] || die "No model profiles are configured for GPU '$gpu_name' in $config_file"

read -r -p "Select a model profile [1-$((index - 1))]: " choice

case "$choice" in
    ''|*[!0-9]*)
        die "Selection must be a number between 1 and $((index - 1))"
        ;;
esac

selected_profile=""
current_index=1
for profile in $SUPPORTED_MODEL_PROFILES; do
    if [ "$current_index" = "$choice" ]; then
        selected_profile="$profile"
        break
    fi
    current_index=$((current_index + 1))
done

[ -n "$selected_profile" ] || die "Selection must be a number between 1 and $((index - 1))"

write_active_model_profile "$selected_profile"

echo "Wrote $ACTIVE_MODEL_FILE"
echo "Selected profile: $selected_profile"

read -r -p "Restart llama-server now? [y/N] " reply
case "$reply" in
    [Yy]|[Yy][Ee][Ss])
        if [ "${EUID:-$(id -u)}" -eq 0 ]; then
            systemctl restart llama-server
        elif command -v sudo >/dev/null 2>&1; then
            sudo systemctl restart llama-server
        elif command -v systemctl >/dev/null 2>&1; then
            die "systemctl requires elevated privileges; rerun with sudo to restart llama-server"
        else
            die "systemctl is not available; cannot restart llama-server"
        fi
        ;;
esac
