"""GSM8K adapter: grade-school math word problems with numeric answers.

Source: https://huggingface.co/datasets/openai/gsm8k (config `main`, split `test`).
Each row has `question` and `answer` (CoT + `#### <int>`). Prompt asks for
step-by-step reasoning ending with `#### <number>`. The parser pulls out
the final integer; the scorer compares as Python ints, ignoring commas.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from llms.eval.adapter import Track
from llms.eval.adapters._datasets import iter_dataset
from llms.eval.types import Item, ParsedAnswer, Prompt, Score

_GOLD_REGEX = re.compile(r"####\s*(-?[\d,]+(?:\.\d+)?)")
_PRED_FINAL_REGEX = re.compile(r"####\s*(-?[\d,]+(?:\.\d+)?)")
_PRED_LAST_NUMBER_REGEX = re.compile(r"(-?[\d,]+(?:\.\d+)?)")
_PROMPT_TEMPLATE = (
    "Solve this math problem step by step. End your answer with a line of the form "
    "`#### <integer>`.\n\n"
    "Question: {question}\n\n"
    "Answer:"
)


class GSM8KAdapter:
    """Grade-school math (GSM8K) — exact-match on the final integer."""

    name: str
    version: str
    track: Track

    def __init__(
        self,
        *,
        template_version: str = "v1",
        dataset_path: Path | None = None,
        hf_split: str = "test",
        hf_config: str = "main",
        max_items: int | None = None,
        max_tokens: int = 512,
    ) -> None:
        self.name = "gsm8k"
        self.version = "v1"
        self.track = "general_capability"
        self.template_version = template_version
        self.dataset_path = dataset_path
        self.hf_split = hf_split
        self.hf_config = hf_config
        self.max_items = max_items
        self.max_tokens = max_tokens

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        del subset, seed  # GSM8K has one flat split with no subjects
        items: list[Item] = []
        for raw in iter_dataset(
            dataset_path=self.dataset_path,
            hf_repo="gsm8k",
            hf_split=self.hf_split,
            hf_config=self.hf_config,
        ):
            items.append(_row_to_item(raw))
            if self.max_items is not None and len(items) >= self.max_items:
                break
        return items

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        if template_version != self.template_version:
            raise ValueError(
                f"adapter pinned to template {self.template_version}, got {template_version}"
            )
        return Prompt(
            text=_PROMPT_TEMPLATE.format(question=item.prompt),
            temperature=0.0,
            max_tokens=self.max_tokens,
        )

    def parse(self, raw_response: str, item: Item) -> ParsedAnswer:
        del item
        match = _PRED_FINAL_REGEX.search(raw_response)
        if match is None:
            # Soft fallback: take the last number in the response. Common
            # when the model forgets the `####` formatting.
            numbers = _PRED_LAST_NUMBER_REGEX.findall(raw_response)
            if not numbers:
                return ParsedAnswer(
                    raw=raw_response,
                    value=None,
                    parse_failed=True,
                    parse_error="no number found in response",
                )
            value = _normalize_number(numbers[-1])
        else:
            value = _normalize_number(match.group(1))
        return ParsedAnswer(raw=raw_response, value=value)

    def score(self, parsed: ParsedAnswer, item: Item) -> Score:
        if parsed.parse_failed or parsed.value is None:
            return Score(correct=False, partial=0.0, breakdown={"parse_failed": True})
        gold = item.expected
        correct = _numerically_equal(parsed.value, gold)
        return Score(
            correct=correct,
            partial=1.0 if correct else 0.0,
            breakdown={"predicted": parsed.value, "gold": gold},
        )


def _row_to_item(raw: dict[str, Any]) -> Item:
    question = str(raw["question"])
    answer_text = str(raw["answer"])
    match = _GOLD_REGEX.search(answer_text)
    if match is None:
        raise ValueError("GSM8K row missing `#### <number>` final answer marker")
    gold = _normalize_number(match.group(1))
    item_id = str(raw.get("id") or f"gsm8k-{hash(question) & 0xFFFFFFFF:08x}")
    return Item(
        id=item_id,
        category="math",
        prompt=question,
        expected=gold,
        metadata={"answer_chain": answer_text},
    )


def _normalize_number(text: str) -> str:
    """Strip commas; keep the sign and any decimal."""
    return text.replace(",", "").strip()


def _numerically_equal(a: object, b: object) -> bool:
    """Compare two stringified numbers; ints == matching ints; floats with epsilon."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    try:
        fa, fb = float(a), float(b)
    except ValueError:
        return a == b
    if fa.is_integer() and fb.is_integer():
        return int(fa) == int(fb)
    return abs(fa - fb) < 1e-9


__all__ = ["GSM8KAdapter"]
