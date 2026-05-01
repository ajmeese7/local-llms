"""Local smoke benchmark.

Ports the keyword-rubric harness from `benchmark-5090-suite.sh:370-422`. Five
hand-written prompts cover coding, ops troubleshooting, creative writing
constraints, and long-context recall. Each prompt has a list of "any" check
groups; the score is the fraction of groups that match (case-insensitive
substring on the response). `correct` is True when every group matches.

This adapter exists so the runner has something to drive end-to-end on the
operator's own box. External-track adapters (mmlu, gsm8k, swe-rebench, ...)
land in their own modules in Phase 5.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from importlib import resources

from llms.eval.adapter import Track
from llms.eval.types import Item, ParsedAnswer, Prompt, Score


class LocalSmokeAdapter:
    """Five-prompt smoke check graded by keyword rubrics."""

    name: str
    version: str
    track: Track

    def __init__(self, *, template_version: str = "v1") -> None:
        self.name = "local_smoke"
        self.version = "v1"
        self.track = "smoke"
        self.template_version = template_version
        self._items = list(_load_items(template_version))

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        del seed  # deterministic ordering; rubric scoring needs no shuffling
        if subset is None:
            return list(self._items)
        wanted = {token.strip() for token in subset.split(",") if token.strip()}
        return [item for item in self._items if item.id in wanted]

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        if template_version != self.template_version:
            raise ValueError(
                f"adapter pinned to template {self.template_version}, got {template_version}"
            )
        meta = item.metadata
        temperature_raw = meta.get("temperature", 0.0)
        max_tokens_raw = meta.get("max_tokens", 1024)
        temperature = (
            float(temperature_raw) if isinstance(temperature_raw, int | float | str) else 0.0
        )
        max_tokens = int(max_tokens_raw) if isinstance(max_tokens_raw, int | str) else 1024
        return Prompt(text=item.prompt, temperature=temperature, max_tokens=max_tokens)

    def parse(self, raw_response: str, item: Item) -> ParsedAnswer:
        del item
        return ParsedAnswer(raw=raw_response, value=raw_response, parse_failed=False)

    def score(self, parsed: ParsedAnswer, item: Item) -> Score:
        check_groups = item.expected
        if not isinstance(check_groups, list):
            return Score(correct=False, partial=0.0, breakdown={"reason": "no checks"})

        haystack = (parsed.raw or "").lower()
        hits: list[str] = []
        misses: list[list[str]] = []
        for group in check_groups:
            assert isinstance(group, list), "checks must be a list of OR-groups"
            matched = next((needle for needle in group if needle.lower() in haystack), None)
            if matched is not None:
                hits.append(matched)
            else:
                misses.append(group)

        total = len(check_groups)
        partial = len(hits) / total if total else 0.0
        return Score(
            correct=len(misses) == 0 and total > 0,
            partial=partial,
            breakdown={
                "hits": hits,
                "misses": misses,
                "total_groups": total,
            },
        )


def _load_items(template_version: str) -> list[Item]:
    package = "llms.eval.prompts.local_smoke"
    filename = f"{template_version}.json"
    text = resources.files(package).joinpath(filename).read_text(encoding="utf-8")
    raw = json.loads(text)
    items: list[Item] = []
    for entry in raw:
        items.append(
            Item(
                id=str(entry["id"]),
                category=str(entry.get("category", "default")),
                prompt=str(entry["prompt"]),
                expected=entry.get("checks"),
                metadata={
                    "temperature": float(entry.get("temperature", 0.0)),
                    "max_tokens": int(entry.get("max_tokens", 1024)),
                },
            )
        )
    return items


__all__ = ["LocalSmokeAdapter"]
