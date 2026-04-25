"""Top-level launcher entry. CLI shape:

    python launcher.py open       --name "微信" [--json]
    python launcher.py candidates --name "微信" [--json]
    python launcher.py index      [--rescan] [--json]
    python launcher.py feedback   --command "微信" --chose <app_id> [--correct true|false]

For 83.6 (this PR) ``open`` runs in **dry-run** mode — it resolves the
target but does NOT actually call subprocess.Popen / window control. That
arrives in 83.7. Dry-run lets us validate the index/match/arbitrate chain
on real machines before adding the Win32 side effects.

Output (when ``--json`` is passed) is a single JSON object on stdout, no
prose, so the Node side can ``JSON.parse`` it directly. Errors set a
non-zero exit code AND print ``{"ok": false, "reason": "..."}``.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path

# Force UTF-8 on stdout/stderr so Chinese display names don't mojibake on
# terminals whose default codepage isn't 65001. The Node caller parses
# JSON from this output — UTF-8 must be stable regardless of host console.
if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
if hasattr(sys.stderr, "reconfigure"):
    try: sys.stderr.reconfigure(encoding="utf-8")
    except Exception: pass

from aliases import resolve_alias
from arbiter import decide
from indexer import build_index, load_index, write_index
from learner import preferred_app_for_command, record_use
from matcher import find_candidates
from store_paths import INDEX_PATH
from window_control import (
    HAS_WIN32,
    activate_window,
    launch_and_wait,
    resolve_action,
)


def _ensure_index() -> dict[str, dict]:
    """Load the cached index; rebuild if missing."""
    index = load_index()
    if not index:
        index = build_index()
        write_index(index)
    return index


def _candidate_payload(c) -> dict:
    return {
        "app_id": c.app_id,
        "display_name": c.display_name,
        "exe_path": c.exe_path,
        "is_dev_tool": c.is_dev_tool,
        "score": round(c.score, 3),
        "reason": c.reason,
        "use_count": c.use_count,
        "last_used_at": c.last_used_at,
    }


def _resolve_target(name: str) -> dict:
    """Shared resolution step used by both dry-run and real-launch paths.
    Returns either {resolved: True, exe_path, ...} or {ambiguous: True,
    candidates: [...]} or {error: "..."}."""
    direct_path, redirect = resolve_alias(name)
    if direct_path and Path(direct_path).exists():
        return {
            "resolved": True,
            "exe_path": direct_path,
            "display_name": name,
            "app_id": direct_path.lower(),
            "decision_reason": "user_alias_path",
        }
    query = redirect or name
    preferred = preferred_app_for_command(query)
    index = _ensure_index()
    if preferred and preferred in index:
        rec = index[preferred]
        return {
            "resolved": True,
            "exe_path": rec.get("exe_path"),
            "display_name": rec.get("display_name"),
            "app_id": preferred,
            "decision_reason": "user_history_threshold",
        }
    candidates = find_candidates(query, index, limit=10)
    decision = decide(candidates)
    if decision.kind == "ask":
        return {
            "ambiguous": True,
            "candidates": decision.candidates or [],
            "decision_reason": decision.reason,
        }
    c = decision.candidate
    if not c:
        return {"error": "no_candidate", "decision_reason": decision.reason}
    return {
        "resolved": True,
        "exe_path": c.exe_path,
        "display_name": c.display_name,
        "app_id": c.app_id,
        "decision_reason": decision.reason,
    }


def open_app(name: str, *, dry_run: bool = True) -> dict:
    """Resolve the target app for ``name`` and (when ``dry_run`` is False)
    launch/activate it based on its current running state.

    Returns:
      - ``{ok: True, action: "launched"|"focused"|"restored"|"unhid"|"would_launch", ...}``
        on success.
      - ``{ok: True, action: "ambiguous", candidates: [...]}`` when the
        arbiter can't decide — the agent-loop upstream should surface
        this as a clarification question.
      - ``{ok: False, reason, ...}`` on hard errors (no candidate,
        spawn failure, Win32 unavailable).
    """
    started = time.time()
    r = _resolve_target(name)
    elapsed = lambda: int((time.time() - started) * 1000)  # noqa: E731

    if r.get("error"):
        return {"ok": False, "reason": r["error"], "decision_reason": r.get("decision_reason"),
                "dry_run": dry_run, "elapsed_ms": elapsed()}

    if r.get("ambiguous"):
        return {"ok": True, "action": "ambiguous",
                "candidates": [_candidate_payload(c) for c in (r["candidates"] or [])],
                "decision_reason": r["decision_reason"],
                "dry_run": dry_run, "elapsed_ms": elapsed()}

    exe_path = r["exe_path"]
    base = {
        "ok": True,
        "display_name": r["display_name"],
        "app_id": r["app_id"],
        "decision_reason": r["decision_reason"],
        "dry_run": dry_run,
    }

    if dry_run:
        return {**base, "action": "would_launch", "exe_path": exe_path, "elapsed_ms": elapsed()}

    # ── Real launch path (83.7) ───────────────────────────────────────
    # Decide based on current state. find/activate falls back to launch.
    state = resolve_action(exe_path)
    windows = state.get("windows") or []
    if state["state"] == "not_running":
        res = launch_and_wait(exe_path, timeout_s=10)
        if not res.get("ok"):
            return {**base, "ok": False, "reason": res.get("reason", "launch_failed"),
                    "detail": res.get("detail"), "exe_path": exe_path, "elapsed_ms": elapsed()}
        # Record usage once we're confident the app is up.
        record_use(r["app_id"])
        action = "launched"
        hwnd = res.get("hwnd")
        # If a window appeared, bring it to foreground (the spawn can land
        # behind our own window otherwise).
        if hwnd:
            activate_window(hwnd)
        return {**base, "action": action, "exe_path": exe_path, "pid": res.get("pid"),
                "hwnd": hwnd, "elapsed_ms": elapsed()}

    # Already running. Pick the best window and activate.
    hwnd = windows[0]["hwnd"] if windows else None
    if not hwnd:
        # Shouldn't happen — state says running but no windows — fall back to a launch.
        res = launch_and_wait(exe_path, timeout_s=6)
        return {**base, "action": "launched" if res.get("ok") else "launch_failed",
                "exe_path": exe_path, "pid": res.get("pid"),
                "elapsed_ms": elapsed()}
    act = activate_window(hwnd)
    record_use(r["app_id"])
    action_map = {
        "running_visible": "focused",
        "running_min":     "restored",
        "running_hidden":  "unhid",
    }
    return {
        **base,
        "action": action_map.get(state["state"], "focused"),
        "exe_path": exe_path,
        "hwnd": hwnd,
        "activate_ok": act.get("ok", False),
        "elapsed_ms": elapsed(),
    }


def _print(payload: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False))
        return
    if not payload.get("ok"):
        print(f"FAILED: {payload.get('reason')} (rule={payload.get('decision_reason')})")
        return
    if "candidates" in payload and payload.get("action") in (None, "ambiguous"):
        cs = payload.get("candidates") or []
        kind = payload.get("decision_kind") or payload.get("action") or "candidates"
        print(f"{kind.upper()} — {len(cs)} candidate(s) ({payload.get('decision_reason')}):")
        for c in cs:
            tag = " [dev]" if c["is_dev_tool"] else ""
            print(f"  {c['score']:>5.2f}  {c['display_name']:<28}{tag}  {c['exe_path']}")
        return
    if "action" in payload:
        print(f"{payload['action'].upper()}: {payload.get('display_name')} "
              f"(rule={payload.get('decision_reason')}, {payload.get('elapsed_ms')}ms)")
        if payload.get("exe_path"):
            print(f"  exe: {payload['exe_path']}")
        return
    # Fallback for `index` command and the like.
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="launcher")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_open = sub.add_parser("open", help="Resolve and launch/activate an app")
    p_open.add_argument("--name", required=True)
    p_open.add_argument("--json", action="store_true")
    p_open.add_argument("--dry-run", action="store_true",
                        help="Resolve only; do not spawn or activate.")

    p_cand = sub.add_parser("candidates", help="Match-only, no launch")
    p_cand.add_argument("--name", required=True)
    p_cand.add_argument("--json", action="store_true")

    p_idx = sub.add_parser("index", help="Build or refresh the index")
    p_idx.add_argument("--rescan", action="store_true")
    p_idx.add_argument("--json", action="store_true")

    p_fb = sub.add_parser("feedback", help="Record a user choice for learning")
    p_fb.add_argument("--command", required=True)
    p_fb.add_argument("--chose", required=True)
    p_fb.add_argument("--correct", choices=["true", "false"], default="true")
    p_fb.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)

    if args.cmd == "open":
        result = open_app(args.name, dry_run=bool(args.dry_run))
        _print(result, args.json)
        return 0 if result.get("ok") else 1

    if args.cmd == "candidates":
        index = _ensure_index()
        cands = find_candidates(args.name, index)
        decision = decide(cands)
        payload = {
            "ok": True,
            "candidates": [_candidate_payload(c) for c in cands],
            "decision_reason": decision.reason,
            "decision_kind": decision.kind,
        }
        _print(payload, args.json)
        return 0

    if args.cmd == "index":
        if args.rescan or not INDEX_PATH.exists():
            started = time.time()
            index = build_index()
            write_index(index)
            elapsed = time.time() - started
        else:
            index = load_index()
            elapsed = 0.0
        payload = {"ok": True, "count": len(index), "elapsed_s": round(elapsed, 3), "index_path": str(INDEX_PATH)}
        _print(payload, args.json)
        return 0

    if args.cmd == "feedback":
        from learner import record_command_choice, record_use
        record_command_choice(args.command, args.chose, was_correct=(args.correct == "true"))
        if args.correct == "true":
            record_use(args.chose)
        payload = {"ok": True, "stored": True}
        _print(payload, args.json)
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
