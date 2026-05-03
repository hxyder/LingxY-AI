"""Disambiguation rules for the launcher.

Given a candidate list (from :mod:`matcher`), pick the best one or escalate
to "ask the user" when no rule produces a confident decision.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from matcher import Candidate

DEV_QUERY_HINTS = ("dev", "developer", "tool", "sdk", "开发", "调试")


@dataclass
class Decision:
    kind: Literal["use", "ask"]
    candidate: Candidate | None = None
    candidates: list[Candidate] | None = None
    reason: str = ""


def _exclude_dev_tools(candidates: list[Candidate]) -> list[Candidate]:
    """If we have a mix of dev-tools and consumer apps, drop the dev-tools.
    "微信" should not surface "微信开发者工具" as the top hit."""
    if not candidates:
        return candidates
    consumer = [c for c in candidates if not c.is_dev_tool]
    if consumer and len(consumer) < len(candidates):
        return consumer
    return candidates


def _by_history(candidates: list[Candidate]) -> Candidate | None:
    """Highest use_count wins, ties broken by last_used_at. Returns None
    if no candidate has any usage history (caller falls through)."""
    used = [c for c in candidates if c.use_count > 0]
    if not used:
        return None
    used.sort(key=lambda c: (c.use_count, c.last_used_at or 0), reverse=True)
    top = used[0]
    # If the top has a clear lead (>= 2× any other), take it.
    if len(used) == 1:
        return top
    runner_up = used[1]
    if top.use_count >= 2 * max(runner_up.use_count, 1):
        return top
    return None


def _confidence_gap(candidates: list[Candidate]) -> float:
    """Score gap between the top two candidates, in [0, 1]."""
    if len(candidates) < 2:
        return 1.0
    return candidates[0].score - candidates[1].score


def _query_allows_dev_tool(query: str) -> bool:
    q = (query or "").strip().lower()
    return any(hint in q for hint in DEV_QUERY_HINTS)


def decide(candidates: list[Candidate], query: str = "") -> Decision:
    """Run the rule chain. See module docstring."""
    if not candidates:
        return Decision(kind="ask", candidates=[], reason="no_candidates")

    # Rule 1: single candidate → use directly.
    if len(candidates) == 1:
        only = candidates[0]
        if only.is_dev_tool and not _query_allows_dev_tool(query):
            return Decision(kind="ask", candidates=[only], reason="only_dev_tool_candidate")
        return Decision(kind="use", candidate=only, reason="single_candidate")

    # Rule 2: exact-name unique → use directly.
    exact = [c for c in candidates if c.reason == "exact"]
    if len(exact) == 1:
        if exact[0].is_dev_tool and not _query_allows_dev_tool(query):
            return Decision(kind="ask", candidates=exact, reason="exact_dev_tool_needs_confirmation")
        return Decision(kind="use", candidate=exact[0], reason="exact_unique")

    # Rule 3: drop dev-tools when there's a consumer alternative.
    filtered = _exclude_dev_tools(candidates)
    if len(filtered) == 1:
        return Decision(kind="use", candidate=filtered[0], reason="excluded_dev_tools")

    # Rule 4: user history dominates.
    historical = _by_history(filtered)
    if historical:
        return Decision(kind="use", candidate=historical, reason="user_history")

    # Rule 5: confidence-based — top score with a clear gap.
    if _confidence_gap(filtered) >= 0.2:
        return Decision(kind="use", candidate=filtered[0], reason="confidence_gap")

    # Otherwise, escalate. Cap returned list at 5 to keep the user UI sane.
    return Decision(kind="ask", candidates=filtered[:5], reason="ambiguous")
