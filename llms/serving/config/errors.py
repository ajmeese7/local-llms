"""Typed errors raised by config loading, resolution, and lint."""

from __future__ import annotations

from pathlib import Path


class ConfigError(Exception):
    """Base error. Subclasses carry enough context to point users at a file."""


class ConfigSyntaxError(ConfigError):
    """YAML failed to parse or violated the Pydantic schema."""

    def __init__(self, path: Path, detail: str) -> None:
        super().__init__(f"{path}: {detail}")
        self.path = path
        self.detail = detail


class ConfigDuplicateError(ConfigError):
    """Two configs of the same kind share a name."""

    def __init__(self, kind: str, name: str, paths: tuple[Path, Path]) -> None:
        super().__init__(f"duplicate {kind} '{name}' in {paths[0]} and {paths[1]}")
        self.kind = kind
        self.name = name
        self.paths = paths


class ConfigReferenceError(ConfigError):
    """A config references another config that doesn't exist."""

    def __init__(self, source: str, kind: str, name: str) -> None:
        super().__init__(f"{source} references unknown {kind} '{name}'")
        self.source = source
        self.kind = kind
        self.name = name


class CapabilityError(ConfigError):
    """A profile requires a capability the chosen provider lacks."""

    def __init__(self, profile: str, provider: str, capability: str, reason: str) -> None:
        super().__init__(
            f"profile '{profile}' requires '{capability}' but provider '{provider}' "
            f"does not support it ({reason})"
        )
        self.profile = profile
        self.provider = provider
        self.capability = capability
        self.reason = reason


class ProviderCompatError(ConfigError):
    """Profile blocks the chosen provider, or the provider is not in proven list."""

    def __init__(self, profile: str, provider: str, status: str, notes: str | None) -> None:
        suffix = f": {notes}" if notes else ""
        super().__init__(f"profile '{profile}' marks provider '{provider}' as {status}{suffix}")
        self.profile = profile
        self.provider = provider
        self.status = status
        self.notes = notes
