export function installWindowLifecycleHandlers({
  browserWindow,
  windowDef,
  quitting,
  DOCK_WINDOW_ID,
  IPC_CHANNELS,
  readyWindows,
  windows,
  resolvedServiceBaseUrl,
  getNoteRecordingState,
  BrowserWindow,
  getManagedWindowBounds,
  lockWindowRendererZoom,
  installDockHudScrollLock,
  enforceDockWindowInvariants,
  persistWindowPreferences,
  clearWindowMessages,
  flushWindowMessages,
  safeError,
  safeWarn
} = {}) {
  if (!browserWindow?.on || !browserWindow?.webContents?.on) {
    throw new TypeError("installWindowLifecycleHandlers requires a valid BrowserWindow instance.");
  }
  if (!windowDef?.id) {
    throw new TypeError("installWindowLifecycleHandlers requires windowDef with .id.");
  }
  if (typeof quitting !== "function") {
    throw new TypeError("installWindowLifecycleHandlers requires quitting as a getter function.");
  }

  browserWindow.on("close", (event) => {
    if (!quitting()) {
      event.preventDefault();
      browserWindow.hide();
    }
  });

  browserWindow.on("focus", () => {
    browserWindow.webContents.send(IPC_CHANNELS.shellWindowFocused, {
      windowId: windowDef.id
    });
  });

  // Overlay click-outside behaviour: when the overlay loses focus AND
  // the user has truly left the application (no other internal window
  // took focus — popup-card / preview / settings / dock are all
  // BrowserWindow instances and would show up in getFocusedWindow),
  // ask the renderer to run its dismiss flow. Defer one tick so the
  // OS can finish moving focus before we sample it.
  if (windowDef.id === "overlay") {
    browserWindow.on("blur", () => {
      setTimeout(() => {
        if (browserWindow.isDestroyed()) return;
        if (!browserWindow.isVisible()) return;
        // null → no LingxY window has focus → user is in another app.
        // Non-null → a sibling internal window (popup-card etc.) took
        // focus, so leave the overlay open underneath.
        if (BrowserWindow.getFocusedWindow() != null) return;
        try {
          browserWindow.webContents.send(IPC_CHANNELS.overlayAutoHide, {});
        } catch (error) {
          safeWarn("[overlay] auto-hide IPC send failed:", error?.message ?? error);
        }
      }, 80);
    });
  }

  browserWindow.on("closed", () => {
    readyWindows.delete(windowDef.id);
    clearWindowMessages(windowDef.id);
    windows.delete(windowDef.id);
  });

  let boundsPersistTimer = null;
  const scheduleBoundsPersist = () => {
    if (!["overlay", "console", "dock"].includes(windowDef.id)) return;
    if (boundsPersistTimer) clearTimeout(boundsPersistTimer);
    boundsPersistTimer = setTimeout(() => {
      if (browserWindow.isDestroyed()) return;
      persistWindowPreferences(windowDef.id, { bounds: getManagedWindowBounds(windowDef.id, browserWindow) });
    }, 180);
  };

  browserWindow.on("move", scheduleBoundsPersist);
  browserWindow.on("resize", () => {
    if (windowDef.id === DOCK_WINDOW_ID) {
      enforceDockWindowInvariants(browserWindow);
    }
    scheduleBoundsPersist();
  });

  if (windowDef.locksRendererZoom) {
    browserWindow.webContents.on("zoom-changed", (event) => {
      event.preventDefault?.();
      lockWindowRendererZoom(windowDef, browserWindow);
    });
    browserWindow.webContents.on("before-input-event", (event, input = {}) => {
      if (input.type !== "keyDown") return;
      const meta = Boolean(input.control || input.meta);
      const key = `${input.key ?? ""}`.toLowerCase();
      const code = `${input.code ?? ""}`;
      const isZoomKey = ["+", "=", "-", "0"].includes(key)
        || code === "NumpadAdd"
        || code === "NumpadSubtract";
      if (meta && isZoomKey) {
        event.preventDefault?.();
        lockWindowRendererZoom(windowDef, browserWindow);
      }
    });
  }

  if (windowDef.id === DOCK_WINDOW_ID) {
    browserWindow.webContents.on("dom-ready", () => {
      installDockHudScrollLock(browserWindow);
      enforceDockWindowInvariants(browserWindow);
    });
  }

  browserWindow.webContents.on("did-finish-load", () => {
    lockWindowRendererZoom(windowDef, browserWindow);
    readyWindows.add(windowDef.id);
    if (windowDef.id === DOCK_WINDOW_ID) {
      installDockHudScrollLock(browserWindow);
      enforceDockWindowInvariants(browserWindow);
    }
    browserWindow.webContents.send(IPC_CHANNELS.shellReady, {
      windowId: windowDef.id,
      route: windowDef.route,
      serviceBaseUrl: resolvedServiceBaseUrl()
    });
    if (windowDef.id === "dock") {
      browserWindow.webContents.send("uca:note-recording-state", getNoteRecordingState());
    }
    flushWindowMessages(windowDef.id);
  });

  // UCA-050: surface renderer load failures so they're not silent
  browserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (errorCode !== -3) { // -3 = ERR_ABORTED (normal on hide/navigate)
      safeError(`[LingxY] Window "${windowDef.id}" failed to load: ${errorDescription} (${errorCode})`);
    }
  });
}
