#!/usr/bin/env bash
# Interactive selector for model profiles supported by the detected GPU.
# This is a standalone operational command, not part of the launcher path.

set -euo pipefail

CONFIG_DIR="${LLAMA_CONFIG_DIR:-/etc/llama-server}"
ACTIVE_MODEL_FILE="$CONFIG_DIR/active-model.conf"
NVIDIA_SMI_BIN="${NVIDIA_SMI_BIN:-/usr/lib/wsl/lib/nvidia-smi}"
COMMON_HELPERS="$CONFIG_DIR/runtime-common.sh"
SERVICE_NAME="${LLAMA_SERVICE_NAME:-llama-server}"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

confirm() {
    local prompt="$1"
    local reply
    printf '\033[1;36m[???]\033[0m  %s [y/N] ' "$prompt"
    read -r reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

[ -f "$COMMON_HELPERS" ] || die "Shared runtime helpers not found: $COMMON_HELPERS"
# shellcheck source=/dev/null
source "$COMMON_HELPERS"

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

resolve_service_user() {
    local service_user=""

    if command -v systemctl >/dev/null 2>&1; then
        service_user="$(systemctl show -p User --value "$SERVICE_NAME" 2>/dev/null || true)"
    fi

    if [ -z "$service_user" ] && [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
        service_user="$(sed -n 's/^User=//p' "/etc/systemd/system/${SERVICE_NAME}.service" | head -1)"
    fi

    [ -n "$service_user" ] || service_user="${USER:-}"
    printf '%s\n' "$service_user"
}

resolve_service_home() {
    local service_user="$1"
    local service_home=""

    if command -v systemctl >/dev/null 2>&1; then
        service_home="$(systemctl show -p WorkingDirectory --value "$SERVICE_NAME" 2>/dev/null || true)"
    fi

    if [ -z "$service_home" ] && [ -n "$service_user" ]; then
        service_home="$(getent passwd "$service_user" | cut -d: -f6)"
    fi

    [ -n "$service_home" ] || service_home="${HOME:-}"
    printf '%s\n' "$service_home"
}

run_as_service_user() {
    local script="$1"
    shift

    if [ "$(id -un)" = "$RUNTIME_USER" ]; then
        HOME="$RUNTIME_HOME" bash -lc "$script" _ "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo -u "$RUNTIME_USER" env HOME="$RUNTIME_HOME" bash -lc "$script" _ "$@"
    else
        die "Running commands as $RUNTIME_USER requires sudo; rerun with sudo"
    fi
}

load_overlay_metadata() {
    local profile="$1"
    local overlay_file="$CONFIG_DIR/$profile.conf"
    local original_home="${HOME:-}"

    [ -f "$overlay_file" ] || return 1

    HOME="$RUNTIME_HOME"
    MODEL=""
    MMPROJ=""
    HF_REPO=""
    HF_FILE=""
    MMPROJ_HF_REPO=""
    MMPROJ_HF_FILE=""
    ALIAS=""
    # shellcheck source=/dev/null
    source "$overlay_file"
    HOME="$original_home"
    [ -n "${MODEL:-}" ] || return 1
    return 0
}

load_overlay_model_path() {
    local profile="$1"

    load_overlay_metadata "$profile" || return 1
    printf '%s\n' "$MODEL"
}

download_artifact_file() {
    local label="$1"
    local artifact_path="$2"
    local hf_repo="$3"
    local hf_file="$4"
    local artifact_state
    local prompt

    artifact_state="$(model_file_state "$artifact_path")"
    case "$artifact_state" in
        installed)
            return 0
            ;;
        empty)
            prompt="Re-download $label to $artifact_path?"
            ;;
        missing)
            prompt="Download $label to $artifact_path?"
            ;;
        *)
            die "Unknown artifact state '$artifact_state' for $artifact_path"
            ;;
    esac

    [ -n "$hf_repo" ] || die "$label is not installed and no Hugging Face repo is configured"
    [ -n "$hf_file" ] || die "$label is not installed and no Hugging Face file is configured"

    if ! confirm "$prompt"; then
        return 1
    fi

    run_as_service_user 'mkdir -p "$(dirname "$1")"' "$artifact_path"
    run_as_service_user 'curl -L --fail --progress-bar "https://huggingface.co/$2/resolve/main/$3" -o "$1"' "$artifact_path" "$hf_repo" "$hf_file"

    if ! model_file_is_ready "$artifact_path"; then
        die "Download completed but artifact is still unavailable: $artifact_path"
    fi

    echo "Downloaded $label: $artifact_path"
    return 0
}

download_profile_model() {
    local profile="$1"
    local mmproj_repo

    load_overlay_metadata "$profile" || die "Could not load metadata for profile $profile"
    [ -n "$HF_REPO" ] || die "Profile $profile does not define HF_REPO"
    [ -n "$HF_FILE" ] || die "Profile $profile does not define HF_FILE"

    download_artifact_file "$profile model" "$MODEL" "$HF_REPO" "$HF_FILE" || return 1

    if [ -n "${MMPROJ:-}" ]; then
        mmproj_repo="${MMPROJ_HF_REPO:-$HF_REPO}"
        download_artifact_file "$profile mmproj" "$MMPROJ" "$mmproj_repo" "${MMPROJ_HF_FILE:-}" || return 1
    fi

    return 0
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

RUNTIME_USER="$(resolve_service_user)"
RUNTIME_HOME="$(resolve_service_home "$RUNTIME_USER")"

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
    install_marker="unknown"
    if [ "$profile" = "${current_profile:-}" ]; then
        marker=" (current)"
    fi
    if load_overlay_metadata "$profile"; then
        case "$(model_file_state "$MODEL")" in
            installed)
                install_marker="installed"
                ;;
            empty)
                install_marker="empty file"
                ;;
            missing)
                install_marker="missing"
                ;;
        esac
        if [ -n "${MMPROJ:-}" ] && ! model_file_is_ready "$MMPROJ"; then
            install_marker="$install_marker, mmproj $(model_file_state "$MMPROJ")"
        fi
    fi
    printf '  %d) %s [%s]%s\n' "$index" "$profile" "$install_marker" "$marker"
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

if selected_model_path="$(load_overlay_model_path "$selected_profile")"; then
    case "$(model_file_state "$selected_model_path")" in
        installed)
            echo "Model path: $selected_model_path"
            load_overlay_metadata "$selected_profile"
            if [ -n "${MMPROJ:-}" ] && ! model_file_is_ready "$MMPROJ"; then
                echo "Multimodal projector path: $MMPROJ"
                download_profile_model "$selected_profile" || die "Selection cancelled; active profile unchanged."
            fi
            ;;
        empty|missing)
            echo "Model path: $selected_model_path"
            download_profile_model "$selected_profile" || die "Selection cancelled; active profile unchanged."
            ;;
    esac
fi

write_active_model_profile "$selected_profile"

echo "Wrote $ACTIVE_MODEL_FILE"
echo "Selected profile: $selected_profile"

read -r -p "Restart llama-server now? [y/N] " reply
case "$reply" in
    [Yy]|[Yy][Ee][Ss])
        if [ -n "${selected_model_path:-}" ] && ! model_file_is_ready "$selected_model_path"; then
            die "Selected profile is still not installed: $selected_model_path"
        fi
        if [ "${EUID:-$(id -u)}" -eq 0 ]; then
            systemctl daemon-reload
            systemctl restart llama-server
        elif command -v sudo >/dev/null 2>&1; then
            sudo systemctl daemon-reload
            sudo systemctl restart llama-server
        elif command -v systemctl >/dev/null 2>&1; then
            die "systemctl requires elevated privileges; rerun with sudo to restart llama-server"
        else
            die "systemctl is not available; cannot restart llama-server"
        fi
        ;;
esac
