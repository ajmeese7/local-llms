"""Loader: shipped bundle parses, duplicates raise, syntax errors raise."""

from __future__ import annotations

from pathlib import Path

import pytest

from llms.serving.config.errors import ConfigDuplicateError, ConfigSyntaxError
from llms.serving.config.loader import load_bundle


def test_shipped_bundle_loads(shipped_bundle: object) -> None:
    bundle = shipped_bundle  # type: ignore[assignment]
    assert "rtx-5090" in bundle.hardware  # type: ignore[attr-defined]
    assert "rtx-5060" in bundle.hardware  # type: ignore[attr-defined]
    assert "llama.cpp" in bundle.providers  # type: ignore[attr-defined]
    assert "ik_llama.cpp" in bundle.providers  # type: ignore[attr-defined]
    assert "qwen36-27b" in bundle.profiles  # type: ignore[attr-defined]
    assert "chat-default" in bundle.endpoints  # type: ignore[attr-defined]


def test_missing_dirs_are_ok(tmp_path: Path) -> None:
    bundle = load_bundle(tmp_path)
    assert bundle.hardware == {}
    assert bundle.providers == {}


def test_duplicate_name_raises(tmp_path: Path) -> None:
    profiles = tmp_path / "profiles"
    profiles.mkdir()
    body = "kind: profile\nname: dup\nalias: D\nmodel_path: /tmp/x.gguf\n"
    (profiles / "a.yaml").write_text(body)
    (profiles / "b.yaml").write_text(body)
    with pytest.raises(ConfigDuplicateError):
        load_bundle(tmp_path)


def test_syntax_error_raises(tmp_path: Path) -> None:
    profiles = tmp_path / "profiles"
    profiles.mkdir()
    (profiles / "broken.yaml").write_text("kind: profile\nname:\n  - not-a-string\n")
    with pytest.raises(ConfigSyntaxError):
        load_bundle(tmp_path)


def test_yaml_error_raises(tmp_path: Path) -> None:
    profiles = tmp_path / "profiles"
    profiles.mkdir()
    (profiles / "broken.yaml").write_text("::: not yaml :::")
    with pytest.raises(ConfigSyntaxError):
        load_bundle(tmp_path)
