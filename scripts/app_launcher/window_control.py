"""Windows window enumeration and activation.

All pywin32-dependent code lives here. Other modules can import the module
safely — if pywin32 isn't installed, the public functions return
structured ``{ok: False, reason: "no_pywin32"}`` results and the caller
falls back to a plain Start-Process-style launch.

Public API:

- :func:`find_windows_for_exe(exe_path)` — list visible/hidden top-level
  windows whose owning process executable matches ``exe_path``.
- :func:`activate_window(hwnd)` — attempt to bring ``hwnd`` to the
  foreground, handling the common Windows restrictions around
  ``SetForegroundWindow``.
- :func:`launch_and_wait(exe_path, timeout_s=10)` — spawn the app and
  poll for a main window for up to ``timeout_s``. Returns the hwnd once
  visible or ``None`` on timeout.
- :func:`resolve_action(exe_path)` — classify the current state of the
  app (running-visible / running-minimized / running-tray / not-running)
  and return the action that should follow.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

try:
    import win32con          # type: ignore
    import win32gui          # type: ignore
    import win32process      # type: ignore
    import psutil            # type: ignore
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False


def _get_process_exe(pid: int) -> str | None:
    try:
        return psutil.Process(pid).exe()
    except Exception:
        return None


def find_windows_for_exe(exe_path: str) -> list[dict]:
    """Enumerate top-level windows whose owner process has ``exe_path``.
    Returns a list of ``{hwnd, title, class, visible, minimized, pid}``."""
    if not HAS_WIN32:
        return []
    target = Path(exe_path).resolve(strict=False)
    matches: list[dict] = []

    def _cb(hwnd, _):
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            owner_exe = _get_process_exe(pid)
            if not owner_exe:
                return True
            if Path(owner_exe).resolve(strict=False) != target:
                return True
            title = win32gui.GetWindowText(hwnd)
            klass = win32gui.GetClassName(hwnd)
            visible = bool(win32gui.IsWindowVisible(hwnd))
            minimized = bool(win32gui.IsIconic(hwnd))
            # Skip invisible tool windows (Shell_TrayWnd etc.) that would
            # hijack focus if activated. The caller wants a *main* window.
            if not visible and not minimized:
                # Some tray-only apps hide their main window entirely. Keep
                # it as a fallback candidate but deprioritize.
                matches.append({
                    "hwnd": hwnd, "title": title, "class": klass,
                    "visible": False, "minimized": False, "pid": pid, "rank": 0,
                })
                return True
            matches.append({
                "hwnd": hwnd, "title": title, "class": klass,
                "visible": visible, "minimized": minimized, "pid": pid,
                "rank": (2 if visible else 1),
            })
        except Exception:
            pass
        return True

    win32gui.EnumWindows(_cb, None)
    # Highest rank = most likely main window. Tie-break: has a non-empty title.
    matches.sort(key=lambda m: (m.get("rank", 0), bool(m.get("title"))), reverse=True)
    return matches


def activate_window(hwnd: int) -> dict:
    """Bring ``hwnd`` to the foreground. Windows imposes restrictions on
    ``SetForegroundWindow`` from non-focused processes; we use the
    AttachThreadInput trick + a harmless keybd_event as the
    AllowSetForegroundWindow shim."""
    if not HAS_WIN32:
        return {"ok": False, "reason": "no_pywin32"}
    try:
        import win32api  # type: ignore
        # If minimized, restore first.
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        # Unhide tray-hidden windows.
        if not win32gui.IsWindowVisible(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        # The classic Alt-tap trick so SetForegroundWindow has permission.
        win32api.keybd_event(0x12, 0, 0, 0)  # ALT down
        try:
            win32gui.SetForegroundWindow(hwnd)
        finally:
            win32api.keybd_event(0x12, 0, 2, 0)  # ALT up
        win32gui.BringWindowToTop(hwnd)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "reason": "activation_failed", "detail": str(e)}


def resolve_action(exe_path: str) -> dict:
    """Decide what to do based on the current state of ``exe_path``:

    - not_running     → caller should ``launch_and_wait``
    - running_hidden  → caller should call ``activate_window`` on the
                         first returned window
    - running_min     → same (activate_window already handles SW_RESTORE)
    - running_visible → activate_window (brings existing window forward)
    """
    if not HAS_WIN32:
        return {"state": "unknown", "windows": [], "reason": "no_pywin32"}
    windows = find_windows_for_exe(exe_path)
    if not windows:
        return {"state": "not_running", "windows": []}
    # Prefer the highest-ranked window; re-check its state.
    top = windows[0]
    if top["visible"] and not top["minimized"]:
        state = "running_visible"
    elif top["minimized"]:
        state = "running_min"
    else:
        state = "running_hidden"
    return {"state": state, "windows": windows}


def launch_and_wait(exe_path: str, timeout_s: float = 10.0) -> dict:
    """Spawn the target. Poll for a main window for up to ``timeout_s``.
    Returns ``{ok, hwnd?, pid?, elapsed_ms}``."""
    start = time.time()
    try:
        # shell=False + absolute path; pass no args. CREATE_NEW_PROCESS_GROUP
        # so Ctrl-C in our parent shell doesn't propagate to the app.
        creationflags = 0
        if HAS_WIN32:
            import win32process as _  # noqa: F401
            creationflags = 0x00000200  # CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(
            [exe_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            close_fds=True,
        )
    except Exception as e:
        return {"ok": False, "reason": "spawn_failed", "detail": str(e)}
    if not HAS_WIN32:
        return {"ok": True, "pid": proc.pid, "elapsed_ms": int((time.time() - start) * 1000)}

    deadline = start + timeout_s
    while time.time() < deadline:
        windows = find_windows_for_exe(exe_path)
        if windows:
            top = windows[0]
            return {
                "ok": True, "pid": proc.pid, "hwnd": top["hwnd"],
                "elapsed_ms": int((time.time() - start) * 1000),
            }
        time.sleep(0.3)
    # Timed out waiting for a window — still a "successful" launch since the
    # process is running; the app might just take longer (Office launches etc.)
    return {
        "ok": True, "pid": proc.pid, "hwnd": None,
        "elapsed_ms": int((time.time() - start) * 1000),
        "note": "window_not_ready_within_timeout",
    }
