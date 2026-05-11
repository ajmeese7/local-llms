"""Filesystem loader: walk config/<kind>/*.yaml and return typed bundles."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from pydantic import BaseModel, ValidationError

from llms.serving.config.errors import (
    ConfigDuplicateError,
    ConfigSyntaxError,
)
from llms.serving.config.models import (
    EndpointConfig,
    HardwareConfig,
    ProfileConfig,
    ProviderConfig,
)


@dataclass(frozen=True, slots=True)
class ConfigBundle:
    """All configs successfully loaded from a config tree."""

    root: Path
    hardware: dict[str, HardwareConfig] = field(default_factory=dict)
    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    profiles: dict[str, ProfileConfig] = field(default_factory=dict)
    endpoints: dict[str, EndpointConfig] = field(default_factory=dict)


def _yaml_files(directory: Path) -> Iterable[Path]:
    if not directory.is_dir():
        return ()
    return sorted(p for p in directory.iterdir() if p.suffix in {".yaml", ".yml"})


def _parse_one[T: BaseModel](path: Path, model_cls: type[T]) -> T:
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise ConfigSyntaxError(path, f"YAML parse failure: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigSyntaxError(path, "top-level YAML must be a mapping")
    try:
        return model_cls.model_validate(raw)
    except ValidationError as exc:
        raise ConfigSyntaxError(path, f"schema violation: {exc}") from exc


def _load_kind[T: BaseModel](
    root: Path,
    kind: str,
    model_cls: type[T],
    name_of: object,  # callable[T -> str], typed loosely to keep Pydantic happy
    seen: dict[tuple[str, str], Path],
) -> dict[str, T]:
    store: dict[str, T] = {}
    for path in _yaml_files(root / kind):
        obj = _parse_one(path, model_cls)
        name = name_of(obj)  # type: ignore[operator]
        key = (kind, name)
        if key in seen:
            raise ConfigDuplicateError(kind, name, (seen[key], path))
        seen[key] = path
        store[name] = obj
    return store


def load_bundle(root: Path) -> ConfigBundle:
    """Load every config under `root`. Duplicates raise; missing dirs are OK."""
    root = root.resolve()
    seen: dict[tuple[str, str], Path] = {}
    name_of = lambda o: o.name  # noqa: E731

    return ConfigBundle(
        root=root,
        hardware=_load_kind(root, "hardware", HardwareConfig, name_of, seen),
        providers=_load_kind(root, "providers", ProviderConfig, name_of, seen),
        profiles=_load_kind(root, "profiles", ProfileConfig, name_of, seen),
        endpoints=_load_kind(root, "endpoints", EndpointConfig, name_of, seen),
    )


__all__ = ["ConfigBundle", "load_bundle"]
