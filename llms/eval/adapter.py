"""The adapter contract every benchmark family must implement.

Each adapter owns: dataset loading, prompt rendering, response parsing, and
scoring. Adapters never speak to the serving plane directly; the runner
plumbs HTTP responses back into `parse` and `score`.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal, Protocol, runtime_checkable

from llms.eval.types import Item, ParsedAnswer, Prompt, Score

Track = Literal[
    "code_agentic",
    "multimodal",
    "general_capability",
    "reliability_factuality",
    "smoke",  # local_smoke and other internal-only adapters
]


@runtime_checkable
class BenchmarkAdapter(Protocol):
    """The four-method contract every shipped adapter satisfies."""

    name: str
    version: str
    track: Track

    def load_dataset(self, *, subset: str | None = None, seed: int = 0) -> Iterable[Item]:
        """Yield items in stable order. `subset` is adapter-defined slicing."""
        ...

    def render_prompt(self, item: Item, *, template_version: str = "v1") -> Prompt:
        """Turn an item into the prompt + sampling params the runner will send."""
        ...

    def parse(self, raw_response: str, item: Item) -> ParsedAnswer:
        """Extract the relevant content (or flag a parse failure)."""
        ...

    def score(self, parsed: ParsedAnswer, item: Item) -> Score:
        """Grade. Deterministic — no calls out to LLMs."""
        ...


__all__ = ["BenchmarkAdapter", "Track"]
