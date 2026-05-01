"""Lookup helpers over the loaded provider set."""

from __future__ import annotations

from llms.serving.config.errors import ConfigReferenceError
from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import ProviderConfig


def find_provider(bundle: ConfigBundle, identifier: str) -> ProviderConfig:
    """Return the provider matching `identifier` (canonical name or alias)."""
    for provider in bundle.providers.values():
        if provider.matches(identifier):
            return provider
    raise ConfigReferenceError("provider lookup", "provider", identifier)


def list_providers(bundle: ConfigBundle) -> list[ProviderConfig]:
    return sorted(bundle.providers.values(), key=lambda p: p.name)


__all__ = ["find_provider", "list_providers"]
