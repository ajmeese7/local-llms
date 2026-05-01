"""Provider registry lookup behaviors."""

from __future__ import annotations

import pytest

from llms.serving.config.errors import ConfigReferenceError
from llms.serving.config.loader import ConfigBundle
from llms.serving.providers.registry import find_provider, list_providers


def test_alias_lookup(shipped_bundle: ConfigBundle) -> None:
    assert find_provider(shipped_bundle, "llama.cpp").name == "llama.cpp"
    assert find_provider(shipped_bundle, "ggerganov").name == "llama.cpp"
    assert find_provider(shipped_bundle, "IK").name == "ik_llama.cpp"


def test_unknown_raises(shipped_bundle: ConfigBundle) -> None:
    with pytest.raises(ConfigReferenceError):
        find_provider(shipped_bundle, "vllm")


def test_list_sorted(shipped_bundle: ConfigBundle) -> None:
    names = [p.name for p in list_providers(shipped_bundle)]
    assert names == sorted(names)
