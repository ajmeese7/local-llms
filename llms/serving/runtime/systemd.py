"""systemd interaction. Read-only today: print the command the user must
run after activate/rollback. Auto-restart behind a confirm flag is on the
roadmap.
"""

from __future__ import annotations

SERVICE_NAME = "llama-server"


def restart_hint() -> str:
    return f"sudo systemctl restart {SERVICE_NAME}"


def status_hint() -> str:
    return f"sudo systemctl status {SERVICE_NAME}"


__all__ = ["SERVICE_NAME", "restart_hint", "status_hint"]
