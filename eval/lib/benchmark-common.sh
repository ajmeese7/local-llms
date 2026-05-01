#!/usr/bin/env bash
set -euo pipefail

eval_bench_usage() {
  cat <<USAGE
Usage:
  benchmark.sh api --model <model> [--base-url <url>] [--prompt <text>] [--runs <n>]
  benchmark.sh models [--base-url <url>]
USAGE
}

eval_bench_models() {
  local base_url="$1"
  curl -sS --fail "${base_url%/}/models"
}

eval_bench_api() {
  local base_url="$1" model="$2" prompt="$3" runs="$4"
  local i
  for ((i=1;i<=runs;i++)); do
    curl -sS --fail "${base_url%/}/chat/completions" \
      -H 'Content-Type: application/json' \
      ${OPENAI_API_KEY:+-H "Authorization: Bearer $OPENAI_API_KEY"} \
      -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"$prompt\"}],\"max_tokens\":64}" >/dev/null
    printf 'run %d/%d ok\n' "$i" "$runs"
  done
}
