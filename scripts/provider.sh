#!/usr/bin/env bash
# Build llama.cpp / ik_llama.cpp from source with CUDA. Used by setup.sh
# and standalone for rebuild-on-demand. Provider metadata mirrors what
# the python registry knows; if you add a new provider here, also add
# config/providers/<name>.yaml.

set -euo pipefail

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage:
  scripts/provider.sh list
  scripts/provider.sh path PROVIDER
  scripts/provider.sh install PROVIDER [options]

Providers:
  llama.cpp
  ik_llama.cpp

Options for install:
  --rebuild            Remove build/ before compiling
  --jobs N             Build jobs, default: 1
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

provider_normalize() {
    case "${1:-llama.cpp}" in
        llama|llama.cpp|ggerganov)         printf 'llama.cpp\n' ;;
        ik|ik_llama|ik_llama.cpp|ikawrakow) printf 'ik_llama.cpp\n' ;;
        *) return 1 ;;
    esac
}

provider_repo() {
    case "$1" in
        llama.cpp)    printf 'https://github.com/ggerganov/llama.cpp.git\n' ;;
        ik_llama.cpp) printf 'https://github.com/ikawrakow/ik_llama.cpp.git\n' ;;
    esac
}

provider_dir() {
    case "$1" in
        llama.cpp)    printf '%s/.local/share/llama.cpp\n' "$HOME" ;;
        ik_llama.cpp) printf '%s/.local/share/ik_llama.cpp\n' "$HOME" ;;
    esac
}

provider_server_bin() {
    printf '%s/build/bin/llama-server\n' "$(provider_dir "$1")"
}

provider_bench_bin() {
    printf '%s/build/bin/llama-bench\n' "$(provider_dir "$1")"
}

provider_cmake_args() {
    case "$1" in
        llama.cpp)    printf '%s\n' -DGGML_CUDA=ON ;;
        ik_llama.cpp) printf '%s\n' -DGGML_NATIVE=ON -DGGML_CUDA=ON ;;
    esac
}

install_provider() {
    local provider="$1"
    shift

    local rebuild=0
    local jobs=1
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --rebuild) rebuild=1; shift ;;
            --jobs) jobs="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown install option: $1" ;;
        esac
    done

    provider="$(provider_normalize "$provider")" || die "unsupported provider: $provider"
    require_cmd git
    require_cmd cmake
    require_cmd nvcc
    require_cmd gcc-12
    require_cmd g++-12

    local provider_path repo nvcc_path
    local -a cmake_args=()
    provider_path="$(provider_dir "$provider")"
    repo="$(provider_repo "$provider")"

    mkdir -p "$(dirname "$provider_path")"
    if [ -d "$provider_path/.git" ]; then
        printf '[INFO] Updating %s in %s\n' "$provider" "$provider_path"
        git -C "$provider_path" pull
    elif [ -d "$provider_path" ]; then
        die "$provider_path exists but is not a git checkout"
    else
        printf '[INFO] Cloning %s into %s\n' "$provider" "$provider_path"
        git clone "$repo" "$provider_path"
    fi

    if [ "$rebuild" -eq 1 ]; then
        rm -rf "$provider_path/build"
    fi

    nvcc_path="$(command -v nvcc)"
    mapfile -t cmake_args < <(provider_cmake_args "$provider")
    cmake -S "$provider_path" -B "$provider_path/build" "${cmake_args[@]}" \
        -DCMAKE_C_COMPILER=gcc-12 \
        -DCMAKE_CXX_COMPILER=g++-12 \
        -DCMAKE_CUDA_COMPILER="$nvcc_path" \
        -DCMAKE_CUDA_HOST_COMPILER=gcc-12
    cmake --build "$provider_path/build" --config Release --target llama-server llama-bench -j"$jobs"

    [ -x "$(provider_server_bin "$provider")" ] || die "missing llama-server after build"
    [ -x "$(provider_bench_bin "$provider")" ] || die "missing llama-bench after build"
    printf '[OK] %s server: %s\n' "$provider" "$(provider_server_bin "$provider")"
    printf '[OK] %s bench: %s\n' "$provider" "$(provider_bench_bin "$provider")"
}

main() {
    [ "$#" -gt 0 ] || { usage; exit 0; }
    local cmd="$1"
    shift

    case "$cmd" in
        list)
            printf 'llama.cpp\nik_llama.cpp\n'
            ;;
        path)
            [ "$#" -eq 1 ] || die "path requires PROVIDER"
            provider="$(provider_normalize "$1")" || die "unsupported provider: $1"
            printf 'dir=%s\n' "$(provider_dir "$provider")"
            printf 'server=%s\n' "$(provider_server_bin "$provider")"
            printf 'bench=%s\n' "$(provider_bench_bin "$provider")"
            ;;
        install)
            [ "$#" -ge 1 ] || die "install requires PROVIDER"
            provider="$1"
            shift
            install_provider "$provider" "$@"
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            die "unknown subcommand: $cmd"
            ;;
    esac
}

main "$@"
