"""Evaluation plane: dataset adapters, prompts, scoring, manifests, reports.

`llms.eval.*` may consume manifest/config types from `llms.serving` for
introspection but MUST NOT call serving runtime code; runs go through the
OpenAI-compatible HTTP API.
"""
