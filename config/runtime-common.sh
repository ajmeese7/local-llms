#!/usr/bin/env bash

append_bearer_auth_header() {
    local array_name="$1"
    local -n cmd_ref="$array_name"
    local api_key="${2:-}"

    if [ -n "$api_key" ]; then
        cmd_ref+=(-H "Authorization: Bearer $api_key")
    fi
}

model_file_is_ready() {
    local model_path="$1"
    [ -s "$model_path" ]
}

model_file_state() {
    local model_path="$1"

    if [ -s "$model_path" ]; then
        printf 'installed\n'
    elif [ -e "$model_path" ]; then
        printf 'empty\n'
    else
        printf 'missing\n'
    fi
}

append_llama_api_key_flag() {
    local array_name="$1"
    local -n cmd_ref="$array_name"
    local api_key="${2:-}"

    if [ -n "$api_key" ]; then
        cmd_ref+=(--api-key "$api_key")
    fi
}

build_models_probe_command() {
    local array_name="$1"
    local -n cmd_ref="$array_name"
    local port="$2"
    local api_key="${3:-}"

    cmd_ref=(
        curl
        --silent
        --show-error
        --fail
        --noproxy "*"
        --connect-timeout "${LLAMA_API_CONNECT_TIMEOUT:-2}"
        --max-time "${LLAMA_API_MAX_TIME:-5}"
        "http://127.0.0.1:$port/v1/models"
    )
    append_bearer_auth_header "$array_name" "$api_key"
}

build_models_fetch_command() {
    local array_name="$1"
    local -n cmd_ref="$array_name"
    local port="$2"
    local api_key="${3:-}"

    cmd_ref=(
        curl
        --silent
        --show-error
        --noproxy "*"
        --connect-timeout "${LLAMA_API_CONNECT_TIMEOUT:-2}"
        --max-time "${LLAMA_API_MAX_TIME:-5}"
        "http://127.0.0.1:$port/v1/models"
    )
    append_bearer_auth_header "$array_name" "$api_key"
}
