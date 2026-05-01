#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(cat "$EVAL_DIR/VERSION")"
# shellcheck source=/dev/null
source "$EVAL_DIR/lib/openai_api.sh"
BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:8080/v1}"

cmd="${1:-help}"
case "$cmd" in
  list-models)
    curl -sS --fail "${BASE_URL%/}/models"
    ;;
  chat-smoke)
    model="${2:-}"
    [ -n "$model" ] || { echo "usage: eval.sh chat-smoke <model>" >&2; exit 1; }
    curl -sS --fail "${BASE_URL%/}/chat/completions" \
      -H 'Content-Type: application/json' \
      ${OPENAI_API_KEY:+-H "Authorization: Bearer $OPENAI_API_KEY"} \
      -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}"
    ;;
  version)
    printf 'eval %s\n' "$VERSION"
    ;;
  help|--help|-h)
    cat <<USAGE
Usage: eval/bin/eval.sh <command>
Commands:
  list-models            call OpenAI-compatible /v1/models
  chat-smoke <model>     call OpenAI-compatible /v1/chat/completions
  version                print eval module version
USAGE
    ;;
  *) echo "unknown command: $cmd" >&2; exit 1 ;;
esac
