#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"$ROOT/scripts/check-syntax.sh" >/dev/null
"$ROOT/service/bin/service.sh" help | grep -q "launch"
"$ROOT/service/bin/service.sh" version | grep -q '^service '
