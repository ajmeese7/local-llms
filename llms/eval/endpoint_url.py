"""Pick the URL the runner should hit.

The eval plane is an HTTP client; it must not import serving runtime code.
This helper builds a base URL from a resolved RuntimeConfig (which is itself
pure data). The runner accepts an explicit URL override too — that's the
usual path when targeting a hosted endpoint or remote inference box.
"""

from __future__ import annotations

from llms.serving.config.models import RuntimeConfig


def base_url_from_runtime(rt: RuntimeConfig) -> str:
    """Build `http://host:port` from the resolved runtime config.

    Local boxes typically bind to 0.0.0.0; collapse that to 127.0.0.1 for
    the eval client so we hit the loopback path the kernel can short-circuit.
    """
    host = rt.host
    if host in {"0.0.0.0", "::"}:
        host = "127.0.0.1"
    return f"http://{host}:{rt.port}"


__all__ = ["base_url_from_runtime"]
