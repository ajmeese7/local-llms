"""Needle-in-haystack adapter."""

from __future__ import annotations

from llms.eval.adapters.niah import NIAHAdapter
from llms.eval.types import Item, ParsedAnswer


def _adapter() -> NIAHAdapter:
    return NIAHAdapter(lengths=(50, 200), depths=(0.0, 0.5, 1.0), seed=42)


def test_grid_size() -> None:
    items = list(_adapter().load_dataset())
    assert len(items) == 6  # 2 lengths x 3 depths


def test_each_item_has_unique_code() -> None:
    items = list(_adapter().load_dataset())
    codes = {item.expected for item in items}
    assert len(codes) == len(items)


def test_haystack_contains_needle() -> None:
    items = list(_adapter().load_dataset())
    for item in items:
        assert isinstance(item.expected, str)
        assert item.expected in item.prompt


def test_depth_zero_inserts_at_start() -> None:
    items = list(_adapter().load_dataset())
    first = next(item for item in items if item.metadata["depth"] == 0.0)
    sentences = first.prompt.split("\n")
    needle_idx = next(i for i, s in enumerate(sentences) if "Important fact" in s)
    # Allow needle to land in the first quarter for "depth=0".
    assert needle_idx < len(sentences) / 4 + 1


def test_render_prompt_passes_through() -> None:
    adapter = _adapter()
    item = next(iter(adapter.load_dataset()))
    prompt = adapter.render_prompt(item)
    assert prompt.temperature == 0.0
    assert "Secret access code:" in prompt.text


def test_score_substring_match() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="XJ-71823")
    parsed = ParsedAnswer(raw="The code is XJ-71823 right there.", value="The code is XJ-71823 right there.")
    score = adapter.score(parsed, item)
    assert score.correct is True
    assert score.partial == 1.0


def test_score_miss() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="XJ-71823")
    parsed = ParsedAnswer(raw="No idea.", value="No idea.")
    score = adapter.score(parsed, item)
    assert score.correct is False


def test_seed_determinism() -> None:
    a = list(NIAHAdapter(seed=99).load_dataset())
    b = list(NIAHAdapter(seed=99).load_dataset())
    assert [item.expected for item in a] == [item.expected for item in b]


def test_parse_empty_response_flags_failure() -> None:
    adapter = _adapter()
    parsed = adapter.parse("   ", Item(id="x", category="t", prompt="q", expected="XX-00000"))
    assert parsed.parse_failed is True
