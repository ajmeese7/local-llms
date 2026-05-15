"""Detect and fetch missing model artifacts referenced by a profile.

A profile YAML carries `model_path` (and optionally `mmproj_path`) plus the
Hugging Face coordinates the launcher's preflight expects on disk. When the
files aren't there yet, the systemd unit crash-loops with
``profile.model_path: file not found`` and the eval just sees connect
timeouts. This module is the friendly side of that wall: it spots the
missing files and, when the profile has `hf_repo`/`hf_file`, downloads them.

Kept in `serving/` (not `eval/`) because the same check is useful from
`endpoint activate` (before persisting a revision that would crash-loop),
`eval run` (before issuing HTTP), or a dedicated `llms model fetch` command.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from llms.serving.config.models import ProfileConfig


@dataclass(frozen=True, slots=True)
class MissingArtifact:
    """One file the profile expects on disk but that isn't there yet."""

    label: str  # "model" | "mmproj"
    target_path: Path
    hf_repo: str | None
    hf_file: str | None

    @property
    def downloadable(self) -> bool:
        return bool(self.hf_repo and self.hf_file)


def find_missing(profile: ProfileConfig) -> list[MissingArtifact]:
    """Return every artifact the profile points at that doesn't exist on disk."""
    out: list[MissingArtifact] = []
    if profile.model_path:
        p = Path(profile.model_path).expanduser()
        if not p.exists():
            out.append(
                MissingArtifact(
                    label="model",
                    target_path=p,
                    hf_repo=profile.hf_repo,
                    hf_file=profile.hf_file,
                )
            )
    if profile.mmproj_path:
        p = Path(profile.mmproj_path).expanduser()
        if not p.exists():
            out.append(
                MissingArtifact(
                    label="mmproj",
                    target_path=p,
                    hf_repo=profile.hf_repo,
                    hf_file=profile.mmproj_hf_file,
                )
            )
    return out


def fetch(artifact: MissingArtifact) -> Path:
    """Pull `artifact.hf_file` from `artifact.hf_repo` into `target_path`.

    Uses `huggingface_hub.hf_hub_download` (already a transitive dep via
    `datasets`). Progress is rendered by the library's built-in tqdm so the
    user sees the multi-GB download moving. If the HF filename differs from
    the local target's basename, the downloaded file is renamed into place
    so the profile's `model_path` resolves correctly on the next launch.
    """
    if not artifact.downloadable:
        raise RuntimeError(
            f"{artifact.label} missing at {artifact.target_path} and profile has no "
            f"hf_repo/hf_file to download from"
        )
    # huggingface_hub is heavy; import lazily so `llms --help` stays snappy.
    from huggingface_hub import hf_hub_download

    target = artifact.target_path
    target.parent.mkdir(parents=True, exist_ok=True)
    assert artifact.hf_repo is not None and artifact.hf_file is not None
    cached = Path(
        hf_hub_download(
            repo_id=artifact.hf_repo,
            filename=artifact.hf_file,
            local_dir=str(target.parent),
        )
    )
    if cached != target:
        # hf_hub_download writes to local_dir/hf_file; rename to the profile's
        # configured basename so model_path resolves cleanly on next launch.
        cached.rename(target)
    return target


__all__ = ["MissingArtifact", "fetch", "find_missing"]
