#!/usr/bin/env bash
# Detects the GPU and launches llama-server with the matching config.
# Called by the systemd service — not intended to be run directly.

set -euo pipefail

CONFIG_DIR="${LLAMA_CONFIG_DIR:-/etc/llama-server}"
NVIDIA_SMI_BIN="${NVIDIA_SMI_BIN:-/usr/lib/wsl/lib/nvidia-smi}"
COMMON_HELPERS="$CONFIG_DIR/runtime-common.sh"
PROVIDER_HELPERS="$CONFIG_DIR/provider-common.sh"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

[ -f "$COMMON_HELPERS" ] || die "Shared runtime helpers not found: $COMMON_HELPERS"
# shellcheck source=/dev/null
source "$COMMON_HELPERS"
[ -f "$PROVIDER_HELPERS" ] || die "Provider helpers not found: $PROVIDER_HELPERS"
# shellcheck source=/dev/null
source "$PROVIDER_HELPERS"

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

flag_enabled() {
    case "${1:-}" in
        1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Yy]|[Oo][Nn])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
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
API_KEY=""
# shellcheck source=/dev/null
source "$config_file"

LLAMA_PROVIDER="$(llama_provider_normalize "${LLAMA_PROVIDER:-llama.cpp}")" || die "Unsupported LLAMA_PROVIDER: ${LLAMA_PROVIDER:-}"
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$(llama_provider_server_bin "$LLAMA_PROVIDER")}"

active_profile="$(load_active_model_profile "$CONFIG_DIR/active-model.conf")"
[ -n "$active_profile" ] || active_profile="${DEFAULT_MODEL_PROFILE:-}"
[ -n "$active_profile" ] || die "No MODEL_PROFILE is active and no DEFAULT_MODEL_PROFILE is set in $config_file"

[ -n "${SUPPORTED_MODEL_PROFILES:-}" ] || die "Required config field 'SUPPORTED_MODEL_PROFILES' is not set in $config_file"
profile_supported "$active_profile" || die "Model profile '$active_profile' is not supported on GPU '$gpu_name'"

overlay_file="$CONFIG_DIR/$active_profile.conf"
[ -f "$overlay_file" ] || die "Model overlay not found: $overlay_file"

PROVEN_LLAMA_PROVIDERS=""
BLOCKED_LLAMA_PROVIDERS=""
PROVIDER_COMPATIBILITY_NOTES=""

# shellcheck source=/dev/null
source "$overlay_file"

if llama_profile_provider_is_blocked "$LLAMA_PROVIDER" && ! flag_enabled "${ALLOW_BLOCKED_LLAMA_PROVIDER:-}"; then
    die "Model profile '$active_profile' blocks provider '$LLAMA_PROVIDER'. ${PROVIDER_COMPATIBILITY_NOTES:-Set ALLOW_BLOCKED_LLAMA_PROVIDER=1 only for a deliberate retest.}"
fi

if ! llama_profile_provider_is_proven "$LLAMA_PROVIDER" && ! flag_enabled "${ALLOW_UNPROVEN_LLAMA_PROVIDER:-}"; then
    die "Model profile '$active_profile' has not proven provider '$LLAMA_PROVIDER'. Proven providers: ${PROVEN_LLAMA_PROVIDERS:-none}. Set ALLOW_UNPROVEN_LLAMA_PROVIDER=1 for a deliberate retest."
fi

for required_field in MODEL ALIAS HOST PORT GPU_LAYERS CONTEXT_LENGTH PARALLEL_SLOTS FLASH_ATTENTION CACHE_TYPE_K CACHE_TYPE_V; do
    if [ -z "${!required_field:-}" ]; then
        die "Required config field '$required_field' is not set after loading $config_file and $overlay_file"
    fi
done

if ! model_file_is_ready "$MODEL"; then
    case "$(model_file_state "$MODEL")" in
        empty)
            die "Model file exists but is empty: $MODEL"
            ;;
        *)
            die "Model file not found: $MODEL"
            ;;
    esac
fi

if [ -n "${MMPROJ:-}" ] && ! model_file_is_ready "$MMPROJ"; then
    case "$(model_file_state "$MMPROJ")" in
        empty)
            die "Multimodal projector file exists but is empty: $MMPROJ"
            ;;
        *)
            die "Multimodal projector file not found: $MMPROJ"
            ;;
    esac
fi

if [ ! -x "$LLAMA_SERVER_BIN" ]; then
    die "llama-server not found at $LLAMA_SERVER_BIN"
fi

echo "Using model profile: $active_profile"
echo "Using model overlay: $overlay_file"
echo "Using provider: $LLAMA_PROVIDER"
echo "Using server binary: $LLAMA_SERVER_BIN"
echo "Final model path: $MODEL"
if flag_enabled "${JINJA:-}"; then
    echo "Using Jinja chat templates"
fi
if [ -n "${MMPROJ:-}" ]; then
    echo "Using multimodal projector: $MMPROJ"
fi
if flag_enabled "${KV_UNIFIED:-}" && llama_provider_supports_flag "$LLAMA_PROVIDER" "kv-unified"; then
    echo "Using unified KV cache"
elif flag_enabled "${KV_UNIFIED:-}"; then
    echo "Skipping unsupported unified KV cache for provider: $LLAMA_PROVIDER"
fi
if flag_enabled "${SPEC_DEFAULT:-}" && llama_provider_supports_flag "$LLAMA_PROVIDER" "spec-default"; then
    echo "Using default speculative decoding config"
elif flag_enabled "${SPEC_DEFAULT:-}"; then
    echo "Using expanded speculative decoding defaults for provider: $LLAMA_PROVIDER"
elif [ -n "${SPEC_TYPE:-}" ] || [ -n "${SPEC_NGRAM_SIZE_N:-}" ] || [ -n "${SPEC_NGRAM_SIZE_M:-}" ] || [ -n "${SPEC_NGRAM_MIN_HITS:-}" ] || [ -n "${DRAFT_MAX:-}" ] || [ -n "${DRAFT_MIN:-}" ]; then
    echo "Using speculative decoding overrides: spec_type=${SPEC_TYPE:-<default>} spec_ngram_size_n=${SPEC_NGRAM_SIZE_N:-<default>} spec_ngram_size_m=${SPEC_NGRAM_SIZE_M:-<default>} spec_ngram_min_hits=${SPEC_NGRAM_MIN_HITS:-<default>} draft_max=${DRAFT_MAX:-<default>} draft_min=${DRAFT_MIN:-<default>}"
fi
if [ -n "${TEMPERATURE:-}" ] || [ -n "${TOP_P:-}" ] || [ -n "${TOP_K:-}" ] || [ -n "${MIN_P:-}" ] || [ -n "${PRESENCE_PENALTY:-}" ] || [ -n "${REPEAT_PENALTY:-}" ]; then
    echo "Using runtime overrides: temp=${TEMPERATURE:-<default>} top_p=${TOP_P:-<default>} top_k=${TOP_K:-<default>} min_p=${MIN_P:-<default>} presence_penalty=${PRESENCE_PENALTY:-<default>} repeat_penalty=${REPEAT_PENALTY:-<default>}"
fi
echo "Starting llama-server with model: $MODEL"

cmd=(
    "$LLAMA_SERVER_BIN"
    -m "$MODEL"
    --alias "$ALIAS"
    --host "$HOST"
    --port "$PORT"
    -ngl "$GPU_LAYERS"
    -c "$CONTEXT_LENGTH"
    -np "$PARALLEL_SLOTS"
    -fa "$FLASH_ATTENTION"
    --cache-type-k "$CACHE_TYPE_K"
    --cache-type-v "$CACHE_TYPE_V"
)
append_llama_api_key_flag cmd "${API_KEY:-}"

flag_enabled "${JINJA:-}" && cmd+=( --jinja )
[ -n "${MMPROJ:-}" ] && cmd+=( --mmproj "$MMPROJ" )
if flag_enabled "${KV_UNIFIED:-}" && llama_provider_supports_flag "$LLAMA_PROVIDER" "kv-unified"; then
    cmd+=( --kv-unified )
fi
if flag_enabled "${SPEC_DEFAULT:-}" && llama_provider_supports_flag "$LLAMA_PROVIDER" "spec-default"; then
    cmd+=( --spec-default )
elif flag_enabled "${SPEC_DEFAULT:-}"; then
    cmd+=( --spec-type ngram-mod --spec-ngram-size-n 24 --draft-max 64 --draft-min 48 )
else
    [ -n "${SPEC_TYPE:-}" ] && cmd+=( --spec-type "$SPEC_TYPE" )
    [ -n "${SPEC_NGRAM_SIZE_N:-}" ] && cmd+=( --spec-ngram-size-n "$SPEC_NGRAM_SIZE_N" )
    [ -n "${SPEC_NGRAM_SIZE_M:-}" ] && cmd+=( --spec-ngram-size-m "$SPEC_NGRAM_SIZE_M" )
    [ -n "${SPEC_NGRAM_MIN_HITS:-}" ] && cmd+=( --spec-ngram-min-hits "$SPEC_NGRAM_MIN_HITS" )
    [ -n "${DRAFT_MAX:-}" ] && cmd+=( --draft-max "$DRAFT_MAX" )
    [ -n "${DRAFT_MIN:-}" ] && cmd+=( --draft-min "$DRAFT_MIN" )
fi

# Some profiles publish known-good decoding defaults. Only pass them through
# when the selected overlay sets them.
[ -n "${TEMPERATURE:-}" ] && cmd+=( --temp "$TEMPERATURE" )
[ -n "${TOP_P:-}" ] && cmd+=( --top-p "$TOP_P" )
[ -n "${TOP_K:-}" ] && cmd+=( --top-k "$TOP_K" )
[ -n "${MIN_P:-}" ] && cmd+=( --min-p "$MIN_P" )
[ -n "${PRESENCE_PENALTY:-}" ] && cmd+=( --presence-penalty "$PRESENCE_PENALTY" )
[ -n "${REPEAT_PENALTY:-}" ] && cmd+=( --repeat-penalty "$REPEAT_PENALTY" )

# Replace this process with llama-server
exec "${cmd[@]}"
