"""Shared dataset loaders for external-track adapters.

Two paths:

1. **JSONL on disk** — used by tests, sandboxes, and anyone who wants to pin
   a specific dataset slice without touching the network. One JSON object
   per line; the adapter unpacks fields itself.

2. **HuggingFace** — used by `llms eval run` against the real benchmarks.
   `datasets` is an optional dep (in the `eval` extra). When it isn't
   installed, the loader raises a clear error pointing the user at
   `uv sync --extra eval`.

Adapters call `iter_dataset()` which dispatches between the two based on
the `dataset_path` field.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any


class DatasetUnavailableError(RuntimeError):
    """The HF `datasets` lib isn't installed and no JSONL path was supplied."""


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    """Yield one row per line. Skips blanks; raises on malformed JSON."""
    with path.open(encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc


def iter_huggingface(
    repo_id: str,
    *,
    split: str,
    config: str | None = None,
    streaming: bool = False,
) -> Iterator[dict[str, Any]]:
    """Stream a HuggingFace dataset row-by-row.

    The `datasets` library is loaded lazily so it doesn't bloat the import
    graph for callers that pass JSONL paths.
    """
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise DatasetUnavailableError(
            "the 'datasets' library is required for HuggingFace loads; "
            "install with `uv sync --extra eval`"
        ) from exc

    ds = load_dataset(repo_id, name=config, split=split, streaming=streaming)
    yield from ds


def iter_dataset(
    *,
    dataset_path: Path | None,
    hf_repo: str,
    hf_split: str,
    hf_config: str | None = None,
) -> Iterable[dict[str, Any]]:
    """Pick the right source for an adapter."""
    if dataset_path is not None:
        return iter_jsonl(dataset_path)
    return iter_huggingface(hf_repo, split=hf_split, config=hf_config)


__all__ = [
    "DatasetUnavailableError",
    "iter_dataset",
    "iter_huggingface",
    "iter_jsonl",
]
