"""Keyword → candidate matching.

Given a user input like ``微信`` or ``vscode``, find every record in the
index that could plausibly match. Scoring uses three signals:

1. Exact match on display name or alias → score 1.0
2. Substring match on display name / alias → score 0.7
3. Fuzzy similarity (rapidfuzz token_set_ratio if available, otherwise
   stdlib difflib.SequenceMatcher) → score 0..0.6

The arbiter does the actual decision; this module just narrows from
"thousands of installed apps" down to "≤10 plausible candidates".
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

try:
    from rapidfuzz import fuzz as _fuzz  # type: ignore
    _HAS_RAPIDFUZZ = True
except ImportError:
    import difflib
    _HAS_RAPIDFUZZ = False


@dataclass
class Candidate:
    app_id: str
    display_name: str
    exe_path: str
    aliases: list[str]
    is_dev_tool: bool
    last_used_at: float | None
    use_count: int
    score: float
    reason: str  # "exact" | "substring" | "fuzzy"


def _fuzzy_score(needle: str, haystack: str) -> float:
    if not needle or not haystack:
        return 0.0
    if _HAS_RAPIDFUZZ:
        return float(_fuzz.token_set_ratio(needle, haystack)) / 100.0 * 0.6
    # difflib fallback — slightly worse for CJK but functional.
    return difflib.SequenceMatcher(None, needle.lower(), haystack.lower()).ratio() * 0.6


def _normalize(text: str) -> str:
    return text.strip().lower()


def find_candidates(query: str, index: dict[str, dict], limit: int = 10) -> list[Candidate]:
    """Return up to ``limit`` candidates sorted by score descending. The
    arbiter is responsible for tie-breaking and dev-tool filtering."""
    q = _normalize(query)
    if not q:
        return []
    scored: list[Candidate] = []
    for app_id, rec in index.items():
        display = rec.get("display_name") or ""
        aliases = [a for a in (rec.get("aliases") or []) if isinstance(a, str)]
        terms = [display, *aliases, rec.get("exe_path", "").rsplit("\\", 1)[-1].rsplit("/", 1)[-1]]
        norm_terms = [_normalize(t) for t in terms if t]
        score = 0.0
        reason = "fuzzy"
        if q in norm_terms:
            score = 1.0
            reason = "exact"
        else:
            sub_hits = [t for t in norm_terms if q in t or t in q]
            if sub_hits:
                # The shortest substring match is usually the most relevant
                # ("微信" in "微信" beats "微信" in "微信开发者工具").
                shortest = min(sub_hits, key=len)
                length_penalty = max(0.0, 1.0 - (len(shortest) - len(q)) / max(len(q), 1) * 0.3)
                score = 0.7 * length_penalty
                reason = "substring"
            else:
                fuzzy = max((_fuzzy_score(q, t) for t in norm_terms), default=0.0)
                if fuzzy < 0.45:
                    continue
                score = fuzzy
        scored.append(Candidate(
            app_id=app_id,
            display_name=display,
            exe_path=rec.get("exe_path", ""),
            aliases=aliases,
            is_dev_tool=bool(rec.get("is_dev_tool", False)),
            last_used_at=rec.get("last_used_at"),
            use_count=int(rec.get("use_count", 0)),
            score=score,
            reason=reason,
        ))
    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:limit]
