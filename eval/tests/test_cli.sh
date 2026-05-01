#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash -n "$ROOT/eval/bin/eval.sh" "$ROOT/eval/lib/openai_api.sh"
"$ROOT/eval/bin/eval.sh" version | grep -q '^eval '
