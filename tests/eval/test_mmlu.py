"""MMLU adapter behaviors. Fixture-driven so no HF download needed."""

from __future__ import annotations

from pathlib import Path

from llms.eval.adapters.mmlu import MMLUAdapter
from llms.eval.types import Item, ParsedAnswer

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "mmlu_mini.jsonl"


def _adapter() -> MMLUAdapter:
    return MMLUAdapter(dataset_path=FIXTURE)


def test_loads_five_items() -> None:
    items = list(_adapter().load_dataset())
    assert len(items) == 5
    assert items[0].id == "mmlu-1"
    assert items[0].category == "world_facts"
    assert items[0].expected == "B"  # Paris is index 1


def test_subset_filter_by_subject() -> None:
    items = list(_adapter().load_dataset(subset="math, biology"))
    assert {item.category for item in items} == {"math", "biology"}
    assert len(items) == 2


def test_max_items_cap() -> None:
    adapter = MMLUAdapter(dataset_path=FIXTURE, max_items=3)
    assert len(list(adapter.load_dataset())) == 3


def test_render_prompt_has_all_choices() -> None:
    item = next(iter(_adapter().load_dataset(subset="math")))
    prompt = _adapter().render_prompt(item)
    assert "Question:" in prompt.text
    assert "A. 4" in prompt.text
    assert "D. 9" in prompt.text
    assert prompt.temperature == 0.0
    assert prompt.max_tokens == 8


def test_parser_extracts_first_letter() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="B")
    parsed = adapter.parse("The answer is B.", item)
    assert parsed.value == "B"
    assert parsed.parse_failed is False


def test_parser_handles_lowercase() -> None:
    adapter = _adapter()
    parsed = adapter.parse("c", Item(id="x", category="t", prompt="q", expected="C"))
    assert parsed.value == "C"


def test_parser_flags_no_letter() -> None:
    adapter = _adapter()
    parsed = adapter.parse(
        "I don't know", Item(id="x", category="t", prompt="q", expected="A")
    )
    assert parsed.parse_failed is True
    assert parsed.value is None


def test_score_correct_letter() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="B")
    score = adapter.score(ParsedAnswer(raw="B", value="B"), item)
    assert score.correct is True
    assert score.partial == 1.0


def test_score_wrong_letter() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="B")
    score = adapter.score(ParsedAnswer(raw="A", value="A"), item)
    assert score.correct is False
    assert score.partial == 0.0


def test_score_parse_failure_is_zero() -> None:
    adapter = _adapter()
    item = Item(id="x", category="t", prompt="q", expected="B")
    score = adapter.score(
        ParsedAnswer(raw="?", value=None, parse_failed=True), item
    )
    assert score.correct is False
    assert score.partial == 0.0
    assert score.breakdown["parse_failed"] is True
