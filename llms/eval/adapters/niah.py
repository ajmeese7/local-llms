"""Needle-in-haystack long-context recall.

A deterministic, no-network factuality probe: insert a unique fact into a
long filler text at a controlled position, then ask the model to recall
the fact. Runs across a `(length, depth)` grid; one item per pair. The
score is True when the unique key appears in the response.

Length is measured in filler-words, not tokens, since the operator's
choice of model decides tokenization. The default grid is small enough to
finish in a couple of minutes against a 5090; increase via the constructor
when running serious long-context evals.
"""

from __future__ import annotations

import random
from collections.abc import Iterable
from typing import ClassVar

from llms.eval.adapter import Track
from llms.eval.types import Item, ParsedAnswer, Prompt, Score

_FILLER_SENTENCES = (
    "The maintainer schedules quarterly index reviews to keep storage costs predictable.",
    "Cache hit rates dropped after the migration but recovered once the warm-up window completed.",
    "Engineers tagged the rollback playbook with hardware-specific runbook references.",
    "Operational notes encourage explicit timezone literals for every scheduled task.",
    "The latest deploy added structured logging fields for downstream pipeline traceability.",
    "Backups verified successfully against the cold-storage redundancy partner.",
    "Latency budgets were renegotiated after the upstream vendor renamed their region tags.",
    "On-call rotations now include a paired observer for the first week of any new shift.",
    "Shadow-mode rollouts continue until the platform team signs off on dashboards.",
    "Capacity planning sessions reference both current and historic GPU utilization curves.",
)


class NIAHAdapter:
    """Long-context retrieval over synthesized haystacks."""

    DEFAULT_LENGTHS: ClassVar[tuple[int, ...]] = (200, 1000, 4000)
    DEFAULT_DEPTHS: ClassVar[tuple[float, ...]] = (0.0, 0.5, 1.0)

    name: str
    version: str
    track: Track

    def __init__(
        self,
        *,
        template_version: str = "v1",
        lengths: tuple[int, ...] | None = None,
        depths: tuple[float, ...] | None = None,
        seed: int = 1729,
        max_tokens: int = 64,
    ) -> None:
        self.name = "niah"
        self.version = "v1"
        self.track = "reliability_factuality"
        self.template_version = template_version
        self.lengths = lengths or self.DEFAULT_LENGTHS
        self.depths = depths or self.DEFAULT_DEPTHS
        self.seed = seed
        self.max_tokens = max_tokens

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        del subset, seed
        rng = random.Random(self.seed)
        items: list[Item] = []
        for length in self.lengths:
            for depth in self.depths:
                code = _make_secret_code(rng)
                haystack, needle_position = _build_haystack(
                    length_words=length, depth=depth, code=code, rng=rng
                )
                item_id = f"niah-len{length}-depth{int(depth * 100):03d}"
                prompt_text = _PROMPT_TEMPLATE.format(haystack=haystack)
                items.append(
                    Item(
                        id=item_id,
                        category=f"len{length}",
                        prompt=prompt_text,
                        expected=code,
                        metadata={
                            "length_words": length,
                            "depth": depth,
                            "needle_position": needle_position,
                        },
                    )
                )
        return items

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        if template_version != self.template_version:
            raise ValueError(
                f"adapter pinned to template {self.template_version}, got {template_version}"
            )
        return Prompt(text=item.prompt, temperature=0.0, max_tokens=self.max_tokens)

    def parse(self, raw_response: str, item: Item) -> ParsedAnswer:
        del item
        text = raw_response.strip()
        if not text:
            return ParsedAnswer(
                raw=raw_response,
                value=None,
                parse_failed=True,
                parse_error="empty response",
            )
        return ParsedAnswer(raw=raw_response, value=text)

    def score(self, parsed: ParsedAnswer, item: Item) -> Score:
        if parsed.parse_failed or parsed.value is None:
            return Score(correct=False, partial=0.0, breakdown={"parse_failed": True})
        gold = item.expected
        haystack_match = isinstance(gold, str) and gold in str(parsed.value)
        return Score(
            correct=haystack_match,
            partial=1.0 if haystack_match else 0.0,
            breakdown={"needle": gold, "found": haystack_match},
        )


_PROMPT_TEMPLATE = (
    "You will receive a long operational note. Somewhere inside it there is a single line "
    "that begins with `Important fact:` and contains a unique secret access code. "
    "Read the note, then output only that secret access code. Do not explain.\n\n"
    "<note>\n{haystack}\n</note>\n\n"
    "Secret access code:"
)


def _make_secret_code(rng: random.Random) -> str:
    """E.g., `XJ-71823`. Rare in normal English so the parser has signal."""
    letters = "".join(rng.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=2))
    digits = "".join(rng.choices("0123456789", k=5))
    return f"{letters}-{digits}"


def _build_haystack(
    *,
    length_words: int,
    depth: float,
    code: str,
    rng: random.Random,
) -> tuple[str, int]:
    """Return (text, needle_word_position). Filler is sampled from the canned set."""
    sentences: list[str] = []
    word_count = 0
    while word_count < length_words:
        sentence = rng.choice(_FILLER_SENTENCES)
        sentences.append(sentence)
        word_count += len(sentence.split())
    target_position = max(0, min(int(depth * len(sentences)), len(sentences)))
    needle = f"Important fact: the secret access code is {code}."
    sentences.insert(target_position, needle)
    return "\n".join(sentences), target_position


__all__ = ["NIAHAdapter"]
