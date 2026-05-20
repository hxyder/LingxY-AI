export function createDesktopWindowActions({
  windows,
  DESKTOP_SHELL_MANIFEST,
  DOCK_WINDOW_ID,
  getWindowPreferences,
  setManagedWindowBounds,
  resolveWindowBounds,
  enforceDockWindowInvariants,
  applyWindowPresentation,
  enqueueWindowMessage,
  IPC_CHANNELS,
  foregroundRestoreMs = 900
} = {}) {
  if (!(windows instanceof Map)) {
    throw new TypeError("createDesktopWindowActions requires windows Map.");
  }
  if (!DESKTOP_SHELL_MANIFEST?.windows) {
    throw new TypeError("createDesktopWindowActions requires DESKTOP_SHELL_MANIFEST with .windows.");
  }
  if (typeof applyWindowPresentation !== "function") {
    throw new TypeError("createDesktopWindowActions requires applyWindowPresentation.");
  }
  const foregroundRestoreTimers = new Map();

  function clearForegroundRestoreTimer(windowId) {
    const timer = foregroundRestoreTimers.get(windowId);
    if (timer) {
      clearTimeout(timer);
      foregroundRestoreTimers.delete(windowId);
    }
  }

  function scheduleForegroundRestore(windowId, target) {
    if (!Number.isFinite(foregroundRestoreMs) || foregroundRestoreMs <= 0) {
      return;
    }
    clearForegroundRestoreTimer(windowId);
    const timer = setTimeout(() => {
      foregroundRestoreTimers.delete(windowId);
      if (typeof target.isDestroyed === "function" && target.isDestroyed()) {
        return;
      }
      applyWindowPresentation(windowId, target);
    }, foregroundRestoreMs);
    if (typeof timer?.unref === "function") {
      timer.unref();
    }
    foregroundRestoreTimers.set(windowId, timer);
  }

  function showWindow(windowId, options = {}) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    if (target.isMinimized()) {
      target.restore();
    }
    const windowDef = DESKTOP_SHELL_MANIFEST.windows.find((candidate) => candidate.id === windowId);
    if (windowDef && !getWindowPreferences(windowId)?.bounds) {
      setManagedWindowBounds(windowId, target, resolveWindowBounds(windowDef, target));
    }
    if (windowId === DOCK_WINDOW_ID) {
      enforceDockWindowInvariants(target);
    }
    applyWindowPresentation(windowId, target);
    if (options?.forceForeground === true && typeof target.setAlwaysOnTop === "function") {
      try {
        target.setAlwaysOnTop(true, "screen-saver");
        scheduleForegroundRestore(windowId, target);
      } catch { /* ignore */ }
    }
    const shouldFocus = options?.focus !== false;
    if (!shouldFocus && typeof target.showInactive === "function") {
      target.showInactive();
    } else {
      target.show();
    }
    if (shouldFocus || options?.moveTop === true || options?.forceForeground === true) {
      try { target.moveTop(); } catch { /* ignore */ }
    }
    if (shouldFocus) {
      target.focus();
    }
    // Keep the dock orb above all other UCA windows so it remains draggable
    // even when the overlay is open on top.
    if (windowId !== "dock") {
      const dock = windows.get("dock");
      if (dock && dock.isVisible()) {
        dock.setAlwaysOnTop(true, "screen-saver");
        dock.showInactive();
        dock.moveTop();
      }
    }
    return true;
  }

  function hideWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    target.hide();
    return true;
  }

  function openOverlayVoice(payload = {}) {
    const mode = payload?.mode === "note" ? "note" : "voice";
    const shortcutId = mode === "note" ? "note-wake" : "voice-wake";
    const shown = showWindow("overlay", { forceForeground: true });
    enqueueWindowMessage("overlay", IPC_CHANNELS.shortcutTriggered, {
      shortcutId,
      accelerator: mode === "note" ? "Ctrl+Shift+N" : "Ctrl+Shift+V",
      source: "shell_bridge",
      mode,
      autoStart: payload?.autoStart !== false,
      preserveContext: Boolean(payload?.preserveContext)
    });
    return {
      ok: Boolean(shown),
      mode,
      shortcutId
    };
  }

  function sendEchoShortcutWake(kind = "voice") {
    const payload = {
      kind,
      transcript: "shortcut",
      source: "shortcut",
      triggeredAt: Date.now()
    };
    const dock = windows.get("dock");
    if (dock && !dock.webContents?.isDestroyed?.()) {
      dock.webContents.send("uca:echo-shortcut-wake", payload);
      return true;
    }
    enqueueWindowMessage("overlay", "uca:echo-wake", payload);
    return false;
  }

  return { showWindow, hideWindow, openOverlayVoice, sendEchoShortcutWake };
}
