"""GSM8K adapter."""

from __future__ import annotations

from pathlib import Path

from llms.eval.adapters.gsm8k import GSM8KAdapter
from llms.eval.types import Item, ParsedAnswer

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "gsm8k_mini.jsonl"


def _adapter() -> GSM8KAdapter:
    return GSM8KAdapter(dataset_path=FIXTURE)


def test_loads_four_items() -> None:
    items = list(_adapter().load_dataset())
    assert len(items) == 4
    assert items[0].expected == "8"
    assert items[2].expected == "75"


def test_render_prompt_includes_marker_instruction() -> None:
    item = next(iter(_adapter().load_dataset()))
    prompt = _adapter().render_prompt(item)
    assert "####" in prompt.text
    assert prompt.temperature == 0.0


def test_parser_finds_final_marker() -> None:
    parsed = _adapter().parse(
        "Step 1: ...\nStep 2: ...\n#### 42",
        Item(id="x", category="math", prompt="q", expected="42"),
    )
    assert parsed.value == "42"
    assert parsed.parse_failed is False


def test_parser_strips_commas() -> None:
    parsed = _adapter().parse(
        "#### 1,234,567",
        Item(id="x", category="math", prompt="q", expected="1234567"),
    )
    assert parsed.value == "1234567"


def test_parser_falls_back_to_last_number() -> None:
    parsed = _adapter().parse(
        "It works out to 5 then ultimately 17",
        Item(id="x", category="math", prompt="q", expected="17"),
    )
    assert parsed.value == "17"
    assert parsed.parse_failed is False


def test_parser_no_number_flags_failure() -> None:
    parsed = _adapter().parse(
        "I cannot solve this",
        Item(id="x", category="math", prompt="q", expected="3"),
    )
    assert parsed.parse_failed is True


def test_score_int_match() -> None:
    score = _adapter().score(
        ParsedAnswer(raw="r", value="42"),
        Item(id="x", category="math", prompt="q", expected="42"),
    )
    assert score.correct is True


def test_score_handles_decimal_equivalent_int() -> None:
    score = _adapter().score(
        ParsedAnswer(raw="r", value="42.0"),
        Item(id="x", category="math", prompt="q", expected="42"),
    )
    assert score.correct is True


def test_score_wrong_value() -> None:
    score = _adapter().score(
        ParsedAnswer(raw="r", value="13"),
        Item(id="x", category="math", prompt="q", expected="42"),
    )
    assert score.correct is False
