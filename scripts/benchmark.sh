#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/eval/lib/benchmark-common.sh"

BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:8080/v1}"
PROMPT="Say hello in five words."
RUNS=1
MODEL=""
CMD="${1:-}"
shift || true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
case "$CMD" in
  models) eval_bench_models "$BASE_URL" ;;
  api) [ -n "$MODEL" ] || { echo "--model is required" >&2; exit 1; }; eval_bench_api "$BASE_URL" "$MODEL" "$PROMPT" "$RUNS" ;;
  help|--help|-h|"") eval_bench_usage ;;
  *) echo "unknown command: $CMD" >&2; exit 1 ;;
esac
