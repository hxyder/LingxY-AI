"""Records user choices so the launcher gets smarter over time.

Two pieces of state in ``usage.json``:

1. Per-app counters: ``{app_id: {use_count, last_used_at}}`` — feeds
   :func:`arbiter._by_history` so frequent apps win disambiguation.
2. Per-command preferences: ``{command: {chosen_app_id, count, total}}``
   — used for "if the user always picks WeChat over WeChat dev tools
   for the input '微信', stop asking."

Both are written together to ``usage.json`` and read back during indexing
(see ``indexer.write_index``).
"""
from __future__ import annotations

import json
import time
from typing import Any

from store_paths import USAGE_PATH, ensure_dirs


def _load() -> dict[str, Any]:
    if not USAGE_PATH.exists():
        return {}
    try:
        return json.loads(USAGE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save(state: dict[str, Any]) -> None:
    ensure_dirs()
    USAGE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def record_use(app_id: str) -> None:
    """Bump per-app use_count and last_used_at."""
    state = _load()
    rec = state.get(app_id) or {"use_count": 0, "last_used_at": None}
    rec["use_count"] = int(rec.get("use_count", 0)) + 1
    rec["last_used_at"] = time.time()
    state[app_id] = rec
    _save(state)


def record_command_choice(command: str, app_id: str, was_correct: bool = True) -> None:
    """Record the user's pick for a given input command. ``was_correct``
    can be ``False`` when we detect the user immediately reversed the
    last decision (closed the wrong app, opened the right one) — in
    that case we *decrement* the previous choice's score rather than
    bumping the new one."""
    state = _load()
    history_root = state.setdefault("__commands__", {})
    cmd_rec = history_root.get(command) or {"choices": {}, "total": 0}
    choices = cmd_rec.setdefault("choices", {})
    delta = 1 if was_correct else -1
    choices[app_id] = max(0, int(choices.get(app_id, 0)) + delta)
    cmd_rec["total"] = sum(choices.values())
    history_root[command] = cmd_rec
    _save(state)


def preferred_app_for_command(command: str, threshold: float = 0.8) -> str | None:
    """If the user has historically chosen the same app ≥ ``threshold``
    of the time for this exact command, return that app_id. Otherwise
    None (caller falls back to the matcher/arbiter)."""
    state = _load()
    cmd_rec = state.get("__commands__", {}).get(command)
    if not cmd_rec:
        return None
    total = int(cmd_rec.get("total", 0))
    if total < 3:  # too little data to be confident
        return None
    choices = cmd_rec.get("choices", {})
    best_app, best_count = max(choices.items(), key=lambda kv: kv[1], default=(None, 0))
    if not best_app:
        return None
    if best_count / max(total, 1) >= threshold:
        return best_app
    return None
