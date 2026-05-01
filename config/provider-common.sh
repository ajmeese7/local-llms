#!/usr/bin/env bash

llama_provider_normalize() {
    case "${1:-llama.cpp}" in
        llama|llama.cpp|ggerganov)
            printf 'llama.cpp\n'
            ;;
        ik|ik_llama|ik_llama.cpp|ikawrakow)
            printf 'ik_llama.cpp\n'
            ;;
        *)
            return 1
            ;;
    esac
}

llama_provider_repo() {
    case "$(llama_provider_normalize "${1:-}")" in
        llama.cpp) printf 'https://github.com/ggerganov/llama.cpp.git\n' ;;
        ik_llama.cpp) printf 'https://github.com/ikawrakow/ik_llama.cpp.git\n' ;;
        *) return 1 ;;
    esac
}

llama_provider_dir() {
    case "$(llama_provider_normalize "${1:-}")" in
        llama.cpp) printf '%s/.local/share/llama.cpp\n' "$HOME" ;;
        ik_llama.cpp) printf '%s/.local/share/ik_llama.cpp\n' "$HOME" ;;
        *) return 1 ;;
    esac
}

llama_provider_server_bin() {
    printf '%s/build/bin/llama-server\n' "$(llama_provider_dir "${1:-}")"
}

llama_provider_bench_bin() {
    printf '%s/build/bin/llama-bench\n' "$(llama_provider_dir "${1:-}")"
}

llama_provider_cmake_args() {
    case "$(llama_provider_normalize "${1:-}")" in
        llama.cpp)
            printf '%s\n' -DGGML_CUDA=ON
            ;;
        ik_llama.cpp)
            printf '%s\n' -DGGML_NATIVE=ON -DGGML_CUDA=ON
            ;;
        *)
            return 1
            ;;
    esac
}

llama_provider_supports_flag() {
    local provider
    local flag="${2:-}"

    provider="$(llama_provider_normalize "${1:-}")" || return 1
    case "$provider:$flag" in
        llama.cpp:kv-unified|llama.cpp:spec-default)
            return 0
            ;;
        ik_llama.cpp:kv-unified|ik_llama.cpp:spec-default)
            return 1
            ;;
        *)
            return 1
            ;;
    esac
}

llama_provider_list_contains() {
    local needle
    local item

    needle="$(llama_provider_normalize "${1:-}")" || return 1
    for item in ${2:-}; do
        if [ "$(llama_provider_normalize "$item" 2>/dev/null || true)" = "$needle" ]; then
            return 0
        fi
    done

    return 1
}

llama_profile_provider_is_blocked() {
    local provider="$1"
    [ -n "${BLOCKED_LLAMA_PROVIDERS:-}" ] || return 1
    llama_provider_list_contains "$provider" "$BLOCKED_LLAMA_PROVIDERS"
}

llama_profile_provider_is_proven() {
    local provider="$1"
    [ -n "${PROVEN_LLAMA_PROVIDERS:-}" ] || return 0
    llama_provider_list_contains "$provider" "$PROVEN_LLAMA_PROVIDERS"
}
