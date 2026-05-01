"""End-to-end: the shipped config tree lints clean."""

from __future__ import annotations

from pathlib import Path

from llms.serving.config.lint import lint

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_ROOT = REPO_ROOT / "config"


def test_shipped_config_lints_clean() -> None:
    bundle, problems = lint(CONFIG_ROOT)
    assert problems == [], f"expected no lint problems, got: {problems}"
    assert len(bundle.hardware) >= 1
    assert len(bundle.providers) >= 1
    assert len(bundle.profiles) >= 1
    assert len(bundle.endpoints) >= 1
