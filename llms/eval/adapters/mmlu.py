"""MMLU adapter: multiple-choice across 57 subjects.

Source: https://huggingface.co/datasets/cais/mmlu (config `all`).
Each row has `question`, `choices` (4 strings), `subject`, and `answer`
(0-3 integer index). Prompt is a zero-shot template; the parser extracts
the first capital-letter A-D the model produces. Scoring is exact-match
against the gold letter.

The adapter accepts a `dataset_path` for fixture-based tests; without it,
real runs load from HuggingFace.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from llms.eval.adapter import Track
from llms.eval.adapters._datasets import iter_dataset
from llms.eval.types import Item, ParsedAnswer, Prompt, Score

_LETTERS = ("A", "B", "C", "D")
_LETTER_REGEX = re.compile(r"\b([A-D])\b")
_PROMPT_TEMPLATE = (
    "Answer the following multiple-choice question with the single letter (A, B, C, or D) "
    "of the correct option. Output only the letter.\n\n"
    "Question: {question}\n"
    "A. {choice_a}\n"
    "B. {choice_b}\n"
    "C. {choice_c}\n"
    "D. {choice_d}\n\n"
    "Answer:"
)


class MMLUAdapter:
    """57-subject academic MCQ benchmark."""

    name: str
    version: str
    track: Track

    def __init__(
        self,
        *,
        template_version: str = "v1",
        dataset_path: Path | None = None,
        hf_split: str = "test",
        hf_config: str = "all",
        max_items: int | None = None,
    ) -> None:
        self.name = "mmlu"
        self.version = "v1"
        self.track = "general_capability"
        self.template_version = template_version
        self.dataset_path = dataset_path
        self.hf_split = hf_split
        self.hf_config = hf_config
        self.max_items = max_items

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        del seed  # MMLU items are independent; ordering doesn't matter for accuracy
        wanted = _parse_subset(subset)
        items: list[Item] = []
        for raw in iter_dataset(
            dataset_path=self.dataset_path,
            hf_repo="cais/mmlu",
            hf_split=self.hf_split,
            hf_config=self.hf_config,
        ):
            item = _row_to_item(raw)
            if wanted is not None and item.metadata.get("subject") not in wanted:
                continue
            items.append(item)
            if self.max_items is not None and len(items) >= self.max_items:
                break
        return items

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        if template_version != self.template_version:
            raise ValueError(
                f"adapter pinned to template {self.template_version}, got {template_version}"
            )
        choices = item.metadata["choices"]
        assert isinstance(choices, list) and len(choices) == 4
        text = _PROMPT_TEMPLATE.format(
            question=item.prompt,
            choice_a=choices[0],
            choice_b=choices[1],
            choice_c=choices[2],
            choice_d=choices[3],
        )
        return Prompt(text=text, temperature=0.0, max_tokens=8)

    def parse(self, raw_response: str, item: Item) -> ParsedAnswer:
        del item
        text = raw_response.strip()
        if not text:
            return ParsedAnswer(raw=raw_response, value=None, parse_failed=True, parse_error="empty response")
        match = _LETTER_REGEX.search(text.upper())
        if match is None:
            return ParsedAnswer(
                raw=raw_response,
                value=None,
                parse_failed=True,
                parse_error="no A/B/C/D letter found",
            )
        return ParsedAnswer(raw=raw_response, value=match.group(1))

    def score(self, parsed: ParsedAnswer, item: Item) -> Score:
        if parsed.parse_failed or parsed.value is None:
            return Score(correct=False, partial=0.0, breakdown={"parse_failed": True})
        gold = item.expected
        correct = parsed.value == gold
        return Score(
            correct=correct,
            partial=1.0 if correct else 0.0,
            breakdown={"predicted": parsed.value, "gold": gold},
        )


def _parse_subset(subset: str | None) -> set[str] | None:
    if subset is None:
        return None
    return {token.strip() for token in subset.split(",") if token.strip()}


def _row_to_item(raw: dict[str, Any]) -> Item:
    """Both HF and our JSONL fixtures share this shape:
    `question`, `choices` (list of 4), `subject`, `answer` (int 0-3)."""
    answer_idx = int(raw["answer"])
    if not 0 <= answer_idx < len(_LETTERS):
        raise ValueError(f"MMLU answer index out of range: {answer_idx}")
    subject = str(raw.get("subject", "unknown"))
    choices = list(raw["choices"])
    if len(choices) != 4:
        raise ValueError(f"MMLU row needs exactly 4 choices, got {len(choices)}")
    item_id = str(raw.get("id") or f"{subject}-{hash(raw['question']) & 0xFFFFFFFF:08x}")
    return Item(
        id=item_id,
        category=subject,
        prompt=str(raw["question"]),
        expected=_LETTERS[answer_idx],
        metadata={
            "subject": subject,
            "choices": [str(c) for c in choices],
        },
    )


__all__ = ["MMLUAdapter"]
