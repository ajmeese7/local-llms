#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(
  "$ROOT_DIR/setup.sh"
  "$ROOT_DIR/config/llama-launcher.sh"
  "$ROOT_DIR/config/select-model.sh"
  "$ROOT_DIR/config/provider-common.sh"
  "$ROOT_DIR/service/bin/service.sh"
  "$ROOT_DIR/service/bin/launcher.sh"
  "$ROOT_DIR/eval/bin/eval.sh"
  "$ROOT_DIR/eval/bin/benchmark.sh"
  "$ROOT_DIR/scripts/benchmark.sh"
)
bash -n "${FILES[@]}"
echo "syntax ok"
