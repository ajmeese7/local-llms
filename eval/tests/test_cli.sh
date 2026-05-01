#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"$ROOT/scripts/check-syntax.sh" >/dev/null
"$ROOT/eval/bin/eval.sh" help | grep -q "OpenAI-compatible"
"$ROOT/eval/bin/eval.sh" version | grep -q '^eval '
# Ensure primary eval CLI does not invoke launcher/provider scripts directly
! rg -n "llama-launcher|provider-common|select-model|service/bin/launcher" "$ROOT/eval/bin/eval.sh" >/dev/null
