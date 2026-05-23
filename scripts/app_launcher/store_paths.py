"""Resolves the on-disk locations of the launcher's persistent state files.

Index, usage history, and user aliases all live under
``%APPDATA%\\LingxY\\app_launcher\\`` so the Node side and Python side share
a stable path. Falls back to ``~/.lingxy/app_launcher/`` if APPDATA is unset
(e.g. on Linux where this whole subsystem won't really run, but we keep the
imports clean).
"""
from __future__ import annotations

import os
from pathlib import Path


def _data_root() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "LingxY" / "app_launcher"
    return Path.home() / ".lingxy" / "app_launcher"


DATA_ROOT: Path = _data_root()
INDEX_PATH: Path = DATA_ROOT / "index.json"
USAGE_PATH: Path = DATA_ROOT / "usage.json"
ALIASES_PATH: Path = DATA_ROOT / "aliases.json"


def ensure_dirs() -> None:
    """Create the data directory tree if it doesn't exist yet. Cheap to
    call on every entrypoint; idempotent."""
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
