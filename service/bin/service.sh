#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(cat "$SERVICE_DIR/VERSION")"

case "${1:-}" in
  launch)
    shift
    exec "$SCRIPT_DIR/launcher.sh" "$@"
    ;;
  version)
    printf 'service %s\n' "$VERSION"
    ;;
  help|--help|-h|"")
    cat <<USAGE
Usage: service/bin/service.sh <command>

Commands:
  launch      start llama-server using layered configs
  version     print service module version
USAGE
    ;;
  *)
    echo "Unknown command: $1" >&2
    exit 1
    ;;
esac
