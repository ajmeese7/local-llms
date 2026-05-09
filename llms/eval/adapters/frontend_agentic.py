"""Front-end + agentic eval suite (17 prompts).

Patterned after Kyle Hessling's Qwopus3.6 evaluation: 5 web-design briefs,
6 canvas/WebGL one-shots, 6 agentic reasoning tasks (multi-step planning,
self-critique, code debug, structured extraction with and without thinking,
tool-use JSON). Substring rubric scoring — same shape as `local_smoke` —
which means design/canvas scores are loose presence checks, not quality
signals. Agentic items grade tightly on expected JSON values, deque usage,
fix patterns, etc.

Subset selector accepts either:
  - a category name: `design`, `canvas`, `agentic`
  - a comma-separated list of item ids
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from importlib import resources

from llms.eval.adapter import Track
from llms.eval.types import Item, ParsedAnswer, Prompt, Score

_CATEGORY_TOKENS = {"design", "canvas", "agentic"}


class FrontendAgenticAdapter:
    """17-prompt design + canvas + agentic suite, substring-rubric scored."""

    name: str
    version: str
    track: Track

    def __init__(self, *, template_version: str = "v1") -> None:
        self.name = "frontend_agentic"
        self.version = "v1"
        self.track = "general_capability"
        self.template_version = template_version
        self._items = list(_load_items(template_version))

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        del seed  # deterministic ordering
        if subset is None:
            return list(self._items)
        tokens = {token.strip() for token in subset.split(",") if token.strip()}
        if tokens & _CATEGORY_TOKENS:
            return [item for item in self._items if item.category in tokens]
        return [item for item in self._items if item.id in tokens]

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        if template_version != self.template_version:
            raise ValueError(
                f"adapter pinned to template {self.template_version}, got {template_version}"
            )
        meta = item.metadata
        temperature_opt = _as_float(meta.get("temperature"), default=0.3)
        temperature = temperature_opt if temperature_opt is not None else 0.3
        top_p = _as_float(meta.get("top_p"), default=None)
        max_tokens = _as_int(meta.get("max_tokens"), default=4096)
        thinking_raw = meta.get("thinking")
        enable_thinking: bool | None = thinking_raw if isinstance(thinking_raw, bool) else None
        return Prompt(
            text=item.prompt,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            enable_thinking=enable_thinking,
        )

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
    package = "llms.eval.prompts.frontend_agentic"
    filename = f"{template_version}.json"
    text = resources.files(package).joinpath(filename).read_text(encoding="utf-8")
    raw = json.loads(text)
    items: list[Item] = []
    for entry in raw:
        metadata: dict[str, object] = {
            "temperature": float(entry.get("temperature", 0.3)),
            "max_tokens": int(entry.get("max_tokens", 4096)),
        }
        if "top_p" in entry:
            metadata["top_p"] = float(entry["top_p"])
        if "thinking" in entry:
            metadata["thinking"] = bool(entry["thinking"])
        items.append(
            Item(
                id=str(entry["id"]),
                category=str(entry.get("category", "default")),
                prompt=str(entry["prompt"]),
                expected=entry.get("checks"),
                metadata=metadata,
            )
        )
    return items


def _as_float(raw: object, *, default: float | None) -> float | None:
    if isinstance(raw, bool):
        return float(raw)
    if isinstance(raw, int):
        return float(raw)
    if isinstance(raw, float):
        return raw
    return default


def _as_int(raw: object, *, default: int) -> int:
    if isinstance(raw, bool):
        return int(raw)
    if isinstance(raw, int):
        return raw
    return default


__all__ = ["FrontendAgenticAdapter"]
