function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`registerShellWindowIpc requires ${name}.`);
}

export function registerShellWindowIpc({
  ipcMain,
  IPC_CHANNELS,
  buildShellStatus,
  showWindow,
  hideWindow,
  openOverlayVoice,
  loadSettings,
  enqueueWindowMessage,
  buildOverlayPayloadFromFiles,
  getWindow,
  getManagedWindowBounds,
  clampWindowBounds,
  setManagedWindowBounds,
  persistWindowPreferences,
  enforceDockWindowInvariants,
  showDesktopNotification,
  DOCK_WINDOW_ID,
  ECHO_DOCK_DROP_VOICE_READY_MS
}) {
  if (!ipcMain?.handle) throw new TypeError("registerShellWindowIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerShellWindowIpc requires IPC_CHANNELS.");
  requireFunction(buildShellStatus, "buildShellStatus");
  requireFunction(showWindow, "showWindow");
  requireFunction(hideWindow, "hideWindow");
  requireFunction(openOverlayVoice, "openOverlayVoice");
  requireFunction(loadSettings, "loadSettings");
  requireFunction(enqueueWindowMessage, "enqueueWindowMessage");
  requireFunction(buildOverlayPayloadFromFiles, "buildOverlayPayloadFromFiles");
  requireFunction(getWindow, "getWindow");
  requireFunction(getManagedWindowBounds, "getManagedWindowBounds");
  requireFunction(clampWindowBounds, "clampWindowBounds");
  requireFunction(setManagedWindowBounds, "setManagedWindowBounds");
  requireFunction(persistWindowPreferences, "persistWindowPreferences");
  requireFunction(enforceDockWindowInvariants, "enforceDockWindowInvariants");
  requireFunction(showDesktopNotification, "showDesktopNotification");

  ipcMain.handle(IPC_CHANNELS.shellStatus, () => buildShellStatus());
  ipcMain.handle(IPC_CHANNELS.shellShowWindow, (_event, windowId) => showWindow(windowId));
  ipcMain.handle(IPC_CHANNELS.shellHideWindow, (_event, windowId) => hideWindow(windowId));
  ipcMain.handle(IPC_CHANNELS.shellOpenOverlayVoice, (_event, payload = {}) => openOverlayVoice(payload));
  ipcMain.handle(IPC_CHANNELS.shellSubmitDroppedFiles, async (_event, filePaths = []) => {
    const acceptedFilePaths = filePaths.filter((filePath) => typeof filePath === "string" && filePath.length > 0);
    if (acceptedFilePaths.length === 0) {
      return { accepted: false, reason: "no_files" };
    }
    const settings = await loadSettings();
    // Dropping onto the dock is mode-aware:
    // - Echo mode: keep the orb calm; the hidden overlay receives the
    //   pending files and the user can press V to ask without opening chat.
    // - Normal mode: open the overlay because the user expects a visible
    //   composer after dropping files.
    if (!settings?.echoMode) {
      showWindow("overlay");
    }
    enqueueWindowMessage(
      "overlay",
      IPC_CHANNELS.shellContextReceived,
      buildOverlayPayloadFromFiles(acceptedFilePaths, "uca.dock", "dock_drop", {
        mode: settings?.echoMode ? "echo" : "normal",
        surface: settings?.echoMode ? "echo_receipt" : "overlay",
        voiceContinueTtlMs: settings?.echoMode ? ECHO_DOCK_DROP_VOICE_READY_MS : 0
      })
    );
    return {
      accepted: true,
      fileCount: acceptedFilePaths.length,
      mode: settings?.echoMode ? "echo" : "normal",
      surface: settings?.echoMode ? "echo_receipt" : "overlay",
      voiceContinueTtlMs: settings?.echoMode ? ECHO_DOCK_DROP_VOICE_READY_MS : 0
    };
  });

  ipcMain.handle(IPC_CHANNELS.shellMoveWindowBy, (_event, { windowId, deltaX, deltaY } = {}) => {
    const target = getWindow(windowId);
    if (!target) return false;
    const currentBounds = getManagedWindowBounds(windowId, target);
    const nextBounds = clampWindowBounds(windowId, {
      ...currentBounds,
      x: currentBounds.x + (Number(deltaX) || 0),
      y: currentBounds.y + (Number(deltaY) || 0)
    }, { mode: "move" });
    setManagedWindowBounds(windowId, target, nextBounds);
    persistWindowPreferences(windowId, { bounds: nextBounds });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.shellResizeWindowBy, (_event, { windowId, deltaWidth, deltaHeight } = {}) => {
    const target = getWindow(windowId);
    if (!target) return false;
    if (windowId === DOCK_WINDOW_ID) {
      const repaired = enforceDockWindowInvariants(target);
      if (repaired) persistWindowPreferences(windowId, { bounds: repaired });
      return true;
    }
    const currentBounds = getManagedWindowBounds(windowId, target);
    const nextBounds = clampWindowBounds(windowId, {
      ...currentBounds,
      width: currentBounds.width + (Number(deltaWidth) || 0),
      height: currentBounds.height + (Number(deltaHeight) || 0)
    });
    setManagedWindowBounds(windowId, target, nextBounds);
    persistWindowPreferences(windowId, { bounds: nextBounds });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.shellSetIgnoreMouseEvents, (_event, { windowId, ignore, forward } = {}) => {
    const target = getWindow(windowId);
    if (!target || target.isDestroyed()) return false;
    target.setIgnoreMouseEvents(Boolean(ignore), { forward: forward !== false });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.shellNotify, (_event, payload = {}) => {
    return showDesktopNotification(payload);
  });

  ipcMain.handle(IPC_CHANNELS.shellNavigateConsole, (_event, payload = {}) => {
    const tabId = typeof payload?.tabId === "string" ? payload.tabId : "settings";
    showWindow("console");
    enqueueWindowMessage("console", IPC_CHANNELS.shellNavigateConsole, { tabId });
    return { ok: true, tabId };
  });
}
