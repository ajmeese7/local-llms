"""Serving plane: lifecycle, configs, providers, launcher, telemetry, state.

`llms.serving.*` MUST NOT import `llms.eval.*`. The eval plane talks to the
serving plane only via the OpenAI-compatible HTTP API.
"""
