"""Shared fixtures.

We pin HOME to a stable value so YAML path expansion (e.g., `~/models/...`)
produces deterministic strings in render-snapshot tests across machines.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from llms.serving.config.loader import ConfigBundle, load_bundle

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_ROOT = REPO_ROOT / "config"
TEST_HOME = "/home/test"


@pytest.fixture(autouse=True)
def _stable_home(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Force a deterministic HOME for every test."""
    monkeypatch.setenv("HOME", TEST_HOME)
    # Under the test HOME, no real .gguf files exist on disk. Skip the
    # missing-model check by default so unrelated CLI tests don't hit it.
    # Tests that specifically exercise the check delete this env var.
    monkeypatch.setenv("LLMS_SKIP_MODEL_CHECK", "1")
    yield


@pytest.fixture
def shipped_bundle() -> ConfigBundle:
    """The actual `config/` tree shipped with the repo."""
    return load_bundle(CONFIG_ROOT)
