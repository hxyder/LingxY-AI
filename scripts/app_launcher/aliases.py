"""User-defined aliases. The user can edit ``aliases.json`` directly to
short-circuit matching for ambiguous names. Two shapes are accepted:

```json
{
  "微信": "E:\\WeChat\\WeChat.exe",
  "PS": "Adobe Photoshop"
}
```

A value that ends in ``.exe`` (or contains a path separator) is treated as
a *direct path* — the launcher skips matching entirely and runs that file.
Any other value is treated as an *alias to a display name* — matching runs
against the resolved display name instead of the original input.

The launcher also writes back here whenever the user explicitly resolves
an ambiguity (e.g. picks "WeChat" over "WeChat developer tools" when
asked); that selection becomes a new alias so the prompt never appears
twice for the same input.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from store_paths import ALIASES_PATH, ensure_dirs


def _is_pathish(value: str) -> bool:
    if not value:
        return False
    if re.search(r"[\\/]", value):
        return True
    return value.lower().endswith(".exe")


def load_aliases() -> dict[str, str]:
    if not ALIASES_PATH.exists():
        return {}
    try:
        data = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v) for k, v in data.items()}
    except (OSError, json.JSONDecodeError):
        return {}


def write_aliases(aliases: dict[str, str]) -> Path:
    ensure_dirs()
    ALIASES_PATH.write_text(
        json.dumps(aliases, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return ALIASES_PATH


def resolve_alias(name: str) -> tuple[Optional[str], Optional[str]]:
    """Look up ``name`` in the alias file. Returns ``(direct_path, redirect_name)``:

    - ``(path, None)``  → user pinned this name to an exe path; bypass match.
    - ``(None, target)`` → use ``target`` as the matching key instead of ``name``.
    - ``(None, None)``   → no alias, matcher proceeds on the raw input.
    """
    aliases = load_aliases()
    value = aliases.get(name) or aliases.get(name.strip())
    if value is None:
        return (None, None)
    if _is_pathish(value):
        return (value, None)
    return (None, value)


def remember_choice(input_name: str, exe_path: str) -> None:
    """Persist a user choice so future invocations of the same input land
    on the same exe. Called by the arbiter after the user disambiguates."""
    aliases = load_aliases()
    aliases[input_name] = exe_path
    write_aliases(aliases)
