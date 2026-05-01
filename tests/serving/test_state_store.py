"""SQLite state store: revisions, active pointer, FK constraints."""

from __future__ import annotations

from pathlib import Path

import pytest

from llms.serving.state.store import StateStore


@pytest.fixture
def store(tmp_path: Path) -> StateStore:
    return StateStore(path=tmp_path / "state.db")


def test_first_use_creates_schema(store: StateStore) -> None:
    assert store.path.exists()
    assert store.list_revisions() == []
    assert store.all_active() == {}


def test_append_revision_sets_active(store: StateStore) -> None:
    rev = store.append_revision(hardware="rtx-5090", endpoint_name="chat-default", reason="boot")
    assert rev.id == 1
    assert rev.endpoint_name == "chat-default"
    assert rev.reason == "boot"
    assert store.all_active_endpoints() == {"rtx-5090": "chat-default"}


def test_subsequent_activate_overrides_active(store: StateStore) -> None:
    store.append_revision(hardware="hw1", endpoint_name="alpha", reason="r1")
    second = store.append_revision(hardware="hw1", endpoint_name="beta", reason="r2")
    active = store.all_active()
    assert active["hw1"].id == second.id
    assert active["hw1"].endpoint_name == "beta"


def test_history_per_hardware(store: StateStore) -> None:
    store.append_revision(hardware="hw1", endpoint_name="a")
    store.append_revision(hardware="hw1", endpoint_name="b")
    store.append_revision(hardware="hw2", endpoint_name="z")
    hw1 = store.list_revisions(hardware="hw1")
    assert [r.endpoint_name for r in hw1] == ["b", "a"]  # newest first
    hw2 = store.list_revisions(hardware="hw2")
    assert [r.endpoint_name for r in hw2] == ["z"]


def test_list_filter_by_endpoint(store: StateStore) -> None:
    store.append_revision(hardware="hw", endpoint_name="alpha")
    store.append_revision(hardware="hw", endpoint_name="beta")
    store.append_revision(hardware="hw", endpoint_name="alpha")
    revs = store.list_revisions(endpoint_name="alpha")
    assert len(revs) == 2
    assert all(r.endpoint_name == "alpha" for r in revs)


def test_get_revision_roundtrip(store: StateStore) -> None:
    rev = store.append_revision(hardware="hw", endpoint_name="ep", reason="r")
    fetched = store.get_revision(rev.id)
    assert fetched is not None
    assert fetched.id == rev.id
    assert fetched.created_at == rev.created_at


def test_get_revision_missing_returns_none(store: StateStore) -> None:
    assert store.get_revision(999) is None


def test_actor_recorded(store: StateStore) -> None:
    rev = store.append_revision(hardware="hw", endpoint_name="ep", actor="overrider")
    assert rev.actor == "overrider"


def test_persists_across_instances(tmp_path: Path) -> None:
    a = StateStore(path=tmp_path / "state.db")
    a.append_revision(hardware="hw", endpoint_name="ep")
    b = StateStore(path=tmp_path / "state.db")
    assert b.all_active_endpoints() == {"hw": "ep"}
