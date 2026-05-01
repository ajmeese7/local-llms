"""LocalSmokeAdapter: dataset loads, scoring matches keyword rubric."""

from __future__ import annotations

from llms.eval.adapters.local_smoke import LocalSmokeAdapter
from llms.eval.types import Item, ParsedAnswer


def test_adapter_loads_five_prompts() -> None:
    adapter = LocalSmokeAdapter()
    items = list(adapter.load_dataset())
    assert len(items) == 5
    ids = {item.id for item in items}
    assert ids == {
        "coding_bugfix",
        "coding_shell",
        "assistant_ops",
        "creative_constraints",
        "long_context_recall",
    }


def test_subset_filter() -> None:
    adapter = LocalSmokeAdapter()
    items = list(adapter.load_dataset(subset="assistant_ops, creative_constraints"))
    assert {item.id for item in items} == {"assistant_ops", "creative_constraints"}


def test_render_prompt_uses_metadata() -> None:
    adapter = LocalSmokeAdapter()
    items = list(adapter.load_dataset(subset="creative_constraints"))
    prompt = adapter.render_prompt(items[0])
    # creative_constraints sets temperature=0.7 in the v1 prompts
    assert prompt.temperature == 0.7
    assert prompt.max_tokens > 0


def test_scoring_all_groups_hit_marks_correct() -> None:
    adapter = LocalSmokeAdapter()
    item = Item(
        id="x",
        category="t",
        prompt="ignored",
        expected=[["alpha"], ["beta", "BETA"]],
    )
    parsed = ParsedAnswer(raw="alpha and BETA appear here", value=None)
    score = adapter.score(parsed, item)
    assert score.correct is True
    assert score.partial == 1.0
    assert score.breakdown["total_groups"] == 2


def test_scoring_partial_credit() -> None:
    adapter = LocalSmokeAdapter()
    item = Item(id="x", category="t", prompt="ignored", expected=[["a"], ["b"], ["c"]])
    parsed = ParsedAnswer(raw="found a only", value=None)
    score = adapter.score(parsed, item)
    assert score.correct is False
    assert abs(score.partial - (1 / 3)) < 1e-9


def test_scoring_no_checks() -> None:
    adapter = LocalSmokeAdapter()
    item = Item(id="x", category="t", prompt="ignored", expected=None)
    parsed = ParsedAnswer(raw="anything", value=None)
    score = adapter.score(parsed, item)
    assert score.correct is False
    assert score.partial == 0.0
