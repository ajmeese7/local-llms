#!/usr/bin/env bash
set -euo pipefail

strip_trailing_slash() { printf '%s\n' "${1%/}"; }

openai_curl() {
  local base_url="$1"; shift
  local api_key="${OPENAI_API_KEY:-}"
  local -a headers=(-H 'Content-Type: application/json')
  if [ -n "$api_key" ]; then headers+=(-H "Authorization: Bearer $api_key"); fi
  curl -sS --fail --connect-timeout "${REQUEST_TIMEOUT_SECONDS:-10}" --max-time "${REQUEST_TIMEOUT_SECONDS:-10}" "${headers[@]}" "$@" "$(strip_trailing_slash "$base_url")$1"
}
