#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVIDER_HELPERS="$ROOT_DIR/config/provider-common.sh"

# shellcheck source=/dev/null
source "$PROVIDER_HELPERS"

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

    provider="$(llama_provider_normalize "$provider")" || die "unsupported provider: $provider"
    require_cmd git
    require_cmd cmake
    require_cmd nvcc
    require_cmd gcc-12
    require_cmd g++-12

    local provider_dir repo nvcc_path
    local -a cmake_args=()
    provider_dir="$(llama_provider_dir "$provider")"
    repo="$(llama_provider_repo "$provider")"

    mkdir -p "$(dirname "$provider_dir")"
    if [ -d "$provider_dir/.git" ]; then
        printf '[INFO] Updating %s in %s\n' "$provider" "$provider_dir"
        git -C "$provider_dir" pull
    elif [ -d "$provider_dir" ]; then
        die "$provider_dir exists but is not a git checkout"
    else
        printf '[INFO] Cloning %s into %s\n' "$provider" "$provider_dir"
        git clone "$repo" "$provider_dir"
    fi

    if [ "$rebuild" -eq 1 ]; then
        rm -rf "$provider_dir/build"
    fi

    nvcc_path="$(command -v nvcc)"
    mapfile -t cmake_args < <(llama_provider_cmake_args "$provider")
    cmake -S "$provider_dir" -B "$provider_dir/build" "${cmake_args[@]}" \
        -DCMAKE_C_COMPILER=gcc-12 \
        -DCMAKE_CXX_COMPILER=g++-12 \
        -DCMAKE_CUDA_COMPILER="$nvcc_path" \
        -DCMAKE_CUDA_HOST_COMPILER=gcc-12
    cmake --build "$provider_dir/build" --config Release --target llama-server llama-bench -j"$jobs"

    [ -x "$(llama_provider_server_bin "$provider")" ] || die "missing llama-server after build"
    [ -x "$(llama_provider_bench_bin "$provider")" ] || die "missing llama-bench after build"
    printf '[OK] %s server: %s\n' "$provider" "$(llama_provider_server_bin "$provider")"
    printf '[OK] %s bench: %s\n' "$provider" "$(llama_provider_bench_bin "$provider")"
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
            provider="$(llama_provider_normalize "$1")" || die "unsupported provider: $1"
            printf 'dir=%s\n' "$(llama_provider_dir "$provider")"
            printf 'server=%s\n' "$(llama_provider_server_bin "$provider")"
            printf 'bench=%s\n' "$(llama_provider_bench_bin "$provider")"
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
