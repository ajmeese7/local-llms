#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash -n "$ROOT/service/bin/service.sh" "$ROOT/service/bin/launcher.sh" "$ROOT/service/lib/provider.sh" "$ROOT/service/lib/runtime-common.sh"
"$ROOT/service/bin/service.sh" version | grep -q '^service '
