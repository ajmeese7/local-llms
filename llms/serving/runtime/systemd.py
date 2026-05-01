"""systemd interaction. Phase 2 keeps it read-only: print the command the
user must run after activate/rollback. Phase 7 (setup) wires real restarts
behind a confirm flag.
"""

from __future__ import annotations

SERVICE_NAME = "llama-server"


def restart_hint() -> str:
    return f"sudo systemctl restart {SERVICE_NAME}"


def status_hint() -> str:
    return f"sudo systemctl status {SERVICE_NAME}"


__all__ = ["SERVICE_NAME", "restart_hint", "status_hint"]
