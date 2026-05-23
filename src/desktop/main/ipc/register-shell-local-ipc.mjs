export function registerShellLocalIpc({
  ipcMain,
  IPC_CHANNELS,
  BrowserWindow,
  desktopCapturer,
  screen,
  globalShortcut,
  getServiceBaseUrl,
  desktopActorForSender,
  requestDesktopServiceJson,
  loadSettings,
  updateSettings,
  getNoteRecordingState,
  setNoteRecordingState,
  getWindow,
  forEachWindow,
  isWindowReady,
  captureActiveWindowContext,
  looksLikeShellWindowContext,
  preferLastExternalWindowContext,
  buildShellContextPayload,
  wait,
  showDockContextMenu,
  enqueueWindowMessage,
  getManagedWindowBounds,
  DOCK_WINDOW_ID,
  execFileAsync,
  desktopScriptPath,
  screenshotCapturePath,
  safeError,
  safeWarn
}) {
  if (!ipcMain?.handle) throw new TypeError("registerShellLocalIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerShellLocalIpc requires IPC_CHANNELS.");
  if (!BrowserWindow?.fromWebContents) throw new TypeError("registerShellLocalIpc requires BrowserWindow.");
  if (!desktopCapturer?.getSources) throw new TypeError("registerShellLocalIpc requires desktopCapturer.");
  if (!screen?.getPrimaryDisplay || !screen?.getDisplayMatching) throw new TypeError("registerShellLocalIpc requires screen.");
  if (!globalShortcut?.register) throw new TypeError("registerShellLocalIpc requires globalShortcut.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerShellLocalIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerShellLocalIpc requires desktopActorForSender.");
  if (typeof requestDesktopServiceJson !== "function") {
    throw new TypeError("registerShellLocalIpc requires requestDesktopServiceJson.");
  }
  if (typeof loadSettings !== "function") throw new TypeError("registerShellLocalIpc requires loadSettings.");
  if (typeof updateSettings !== "function") throw new TypeError("registerShellLocalIpc requires updateSettings.");
  if (typeof getNoteRecordingState !== "function") throw new TypeError("registerShellLocalIpc requires getNoteRecordingState.");
  if (typeof setNoteRecordingState !== "function") throw new TypeError("registerShellLocalIpc requires setNoteRecordingState.");
  if (typeof getWindow !== "function") throw new TypeError("registerShellLocalIpc requires getWindow.");
  if (typeof forEachWindow !== "function") throw new TypeError("registerShellLocalIpc requires forEachWindow.");
  if (typeof isWindowReady !== "function") throw new TypeError("registerShellLocalIpc requires isWindowReady.");
  if (typeof captureActiveWindowContext !== "function") throw new TypeError("registerShellLocalIpc requires captureActiveWindowContext.");
  if (typeof looksLikeShellWindowContext !== "function") {
    throw new TypeError("registerShellLocalIpc requires looksLikeShellWindowContext.");
  }
  if (typeof preferLastExternalWindowContext !== "function") {
    throw new TypeError("registerShellLocalIpc requires preferLastExternalWindowContext.");
  }
  if (typeof buildShellContextPayload !== "function") throw new TypeError("registerShellLocalIpc requires buildShellContextPayload.");
  if (typeof wait !== "function") throw new TypeError("registerShellLocalIpc requires wait.");
  if (typeof showDockContextMenu !== "function") throw new TypeError("registerShellLocalIpc requires showDockContextMenu.");
  if (typeof enqueueWindowMessage !== "function") throw new TypeError("registerShellLocalIpc requires enqueueWindowMessage.");
  if (typeof getManagedWindowBounds !== "function") throw new TypeError("registerShellLocalIpc requires getManagedWindowBounds.");
  if (typeof execFileAsync !== "function") throw new TypeError("registerShellLocalIpc requires execFileAsync.");
  if (typeof desktopScriptPath !== "function") throw new TypeError("registerShellLocalIpc requires desktopScriptPath.");
  if (typeof screenshotCapturePath !== "function") throw new TypeError("registerShellLocalIpc requires screenshotCapturePath.");

  function normalizeScreenshotBounds(bounds = null) {
    if (!bounds || typeof bounds !== "object") return null;
    const left = Math.round(Number(bounds.left));
    const top = Math.round(Number(bounds.top));
    const width = Math.round(Number(bounds.width));
    const height = Math.round(Number(bounds.height));
    if (![left, top, width, height].every(Number.isFinite)) return null;
    if (width < 24 || height < 24) return null;
    return {
      left,
      top,
      width: Math.min(width, 12000),
      height: Math.min(height, 12000)
    };
  }

  async function captureScreenshotFile({ bounds = null } = {}) {
    const screenshotScriptPath = desktopScriptPath("capture-screenshot.ps1");
    const screenshotPath = screenshotCapturePath();
    const args = [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", screenshotScriptPath,
      "-OutputPath", screenshotPath
    ];
    const normalizedBounds = normalizeScreenshotBounds(bounds);
    if (normalizedBounds) {
      args.push(
        "-Left", String(normalizedBounds.left),
        "-Top", String(normalizedBounds.top),
        "-Width", String(normalizedBounds.width),
        "-Height", String(normalizedBounds.height)
      );
    }
    const { stdout } = await execFileAsync("powershell", args, {
      encoding: "utf8",
      timeout: 8000
    });
    let payload = null;
    try { payload = JSON.parse(stdout.trim()); } catch { payload = { ok: false, error: "invalid_screenshot_output" }; }
    return {
      ...payload,
      path: payload?.path ?? screenshotPath,
      bounds: normalizedBounds
    };
  }

  ipcMain.handle("uca:get-note-recording-state", () => getNoteRecordingState());
  ipcMain.handle("uca:get-settings", async () => loadSettings());

  ipcMain.handle("uca:get-desktop-audio-source", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
      });
      const primaryDisplay = screen.getPrimaryDisplay();
      const primarySource = sources.find((source) => `${source.display_id}` === `${primaryDisplay.id}`);
      return (primarySource ?? sources[0])?.id ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.shellCaptureWindowScreenshot, async (event, options = {}) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    const shouldHideShell = options?.excludeShellWindow !== false;
    const wasVisible = sourceWindow?.isVisible?.() ?? false;
    let activeWindow = options?.activeWindow && typeof options.activeWindow === "object"
      ? options.activeWindow
      : null;
    try {
      if (sourceWindow && wasVisible && shouldHideShell) {
        sourceWindow.hide();
        await wait(160);
      }
      if (!activeWindow && options?.captureActiveWindow !== false) {
        const context = await captureActiveWindowContext({
          includeSelection: false,
          activeWindowEnabled: true,
          allowClipboardFallback: false,
          preferLastExternal: true,
          maxExternalAgeMs: 2 * 60_000,
          timeoutMs: Number.isFinite(options?.timeoutMs) ? Number(options.timeoutMs) : 1600
        });
        activeWindow = context?.activeWindow ?? null;
      }
      const result = await captureScreenshotFile({
        bounds: options?.bounds ?? activeWindow?.bounds ?? null
      });
      if (!result?.ok) {
        safeError?.("[LingxY] capture-window-screenshot failed", result?.error ?? result);
        return { ok: false, error: result?.error ?? "screenshot_failed" };
      }
      return {
        ok: true,
        path: result.path,
        width: result.width ?? result.bounds?.width ?? null,
        height: result.height ?? result.bounds?.height ?? null,
        bounds: result.bounds ?? null,
        activeWindow
      };
    } catch (error) {
      safeError?.("[LingxY] capture-window-screenshot threw", error?.message ?? error);
      return { ok: false, error: error?.message ?? "screenshot_failed" };
    } finally {
      if (sourceWindow && wasVisible && shouldHideShell) {
        if (typeof sourceWindow.showInactive === "function") sourceWindow.showInactive();
        else sourceWindow.show();
      }
    }
  });

  ipcMain.handle("uca:capture-active-window-context", async (event, options = {}) => {
    try {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      const shouldHideShell = Boolean(options?.excludeShellWindow && sourceWindow?.isVisible?.());
      if (shouldHideShell) {
        sourceWindow.hide();
        await wait(220);
      }
      let context;
      try {
        context = await captureActiveWindowContext({
          includeSelection: options?.includeSelection !== false,
          activeWindowEnabled: options?.activeWindowEnabled !== false,
          allowClipboardFallback: options?.allowClipboardFallback !== false,
          clipboardBaseline: typeof options?.clipboardBaseline === "string" ? options.clipboardBaseline : null,
          timeoutMs: Number.isFinite(options?.timeoutMs) ? Number(options.timeoutMs) : undefined
        });
      } finally {
        if (shouldHideShell) {
          if (typeof sourceWindow.showInactive === "function") sourceWindow.showInactive();
          else sourceWindow.show();
        }
      }
      context = preferLastExternalWindowContext(context, options);
      return buildShellContextPayload({
        context,
        sourceApp: context.processName ?? context.activeWindow?.process ?? "unknown",
        captureMode: options?.captureMode ?? "note_recording"
      });
    } catch {
      return null;
    }
  });

  ipcMain.handle("uca:note-recording-state", (_event, payload = {}) => {
    const noteRecordingState = setNoteRecordingState({
      active: Boolean(payload.active),
      elapsedMs: Number(payload.elapsedMs ?? 0),
      elapsed: payload.elapsed ?? "00:00",
      hasMicTranscript: Boolean(payload.hasMicTranscript),
      hasSystemAudio: Boolean(payload.hasSystemAudio),
      updatedAt: Date.now()
    });
    const dock = getWindow("dock");
    if (dock && isWindowReady("dock")) {
      dock.webContents.send("uca:note-recording-state", noteRecordingState);
    }
    return noteRecordingState;
  });

  ipcMain.handle("uca:set-echo-mode", async (_event, enabled) => {
    return updateSettings({ echoMode: Boolean(enabled) });
  });

  ipcMain.handle(IPC_CHANNELS.echoWakeProfileUpdate, async (_event, profile = {}) => {
    return updateSettings({ echoWake: profile && typeof profile === "object" ? profile : {} });
  });

  ipcMain.handle(IPC_CHANNELS.echoDiagnostics, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const settings = await loadSettings();
    const [kws, enrollment, transcription] = await Promise.all([
      requestDesktopServiceJson({
        base,
        pathname: "/echo/kws/status",
        method: "GET",
        actor
      }).catch((error) => ({
        ok: false,
        reason: "kws_status_unavailable",
        message: error?.message ?? String(error)
      })),
      requestDesktopServiceJson({
        base,
        pathname: "/echo/enrollment/status",
        method: "GET",
        actor
      }).catch((error) => ({
        ok: false,
        reason: "enrollment_status_unavailable",
        message: error?.message ?? String(error)
      })),
      requestDesktopServiceJson({
        base,
        pathname: "/note/transcribe/status",
        method: "GET",
        actor
      }).catch((error) => ({
        ok: false,
        reason: "transcription_status_unavailable",
        message: error?.message ?? String(error)
      }))
    ]);
    return {
      ok: true,
      echoMode: Boolean(settings?.echoMode),
      echoWake: settings?.echoWake ?? {},
      kws,
      enrollment,
      transcription
    };
  });

  ipcMain.handle(IPC_CHANNELS.echoWakeEnrollmentStart, async () => {
    const dock = getWindow("dock");
    if (!dock || dock.webContents?.isDestroyed?.()) {
      return { ok: false, reason: "dock_unavailable", message: "Dock is not available." };
    }
    dock.webContents.send("uca:start-wake-enrollment", { at: Date.now(), source: "settings" });
    return { ok: true };
  });

  ipcMain.handle("uca:show-dock-menu", async () => {
    await showDockContextMenu();
  });

  ipcMain.handle("uca:echo-wake", async (_event, payload = {}) => {
    enqueueWindowMessage("overlay", "uca:echo-wake", {
      kind: payload.kind ?? "voice",
      transcript: payload.transcript ?? "",
      preserveContext: Boolean(payload.preserveContext),
      triggeredAt: Date.now()
    });
    return { accepted: true };
  });

  ipcMain.handle("uca:register-ctrl-enter", (_event, tag = "echo-session") => {
    const accelerators = ["CommandOrControl+Return", "Return"];
    let accepted = true;
    for (const accelerator of accelerators) {
      if (globalShortcut.isRegistered(accelerator)) continue;
      const ok = globalShortcut.register(accelerator, () => {
        forEachWindow((browserWindow) => {
          if (!browserWindow.webContents?.isDestroyed?.()) {
            browserWindow.webContents.send("uca:ctrl-enter", { tag, accelerator });
          }
        });
      });
      accepted = accepted && Boolean(ok);
    }
    return { accepted };
  });

  ipcMain.handle("uca:unregister-ctrl-enter", () => {
    for (const accelerator of ["CommandOrControl+Return", "Return"]) {
      try { globalShortcut.unregister(accelerator); } catch { /* ignore */ }
    }
    const dock = getWindow("dock");
    if (dock && !dock.webContents?.isDestroyed?.()) {
      dock.webContents.send("uca:echo-session-end", { at: Date.now() });
    }
    return { accepted: true };
  });

  ipcMain.handle("uca:echo-bubble-show", async (_event, payload = {}) => {
    const bubbleWin = getWindow("echo-bubble");
    const dockWin = getWindow("dock");
    if (!bubbleWin || !dockWin) return { accepted: false };
    try {
      const dockBounds = getManagedWindowBounds(DOCK_WINDOW_ID, dockWin);
      const display = screen.getDisplayMatching(dockBounds);
      const bubbleSize = bubbleWin.getSize();
      const margin = 8;
      let x = dockBounds.x - bubbleSize[0] - margin;
      if (x < display.workArea.x) {
        x = dockBounds.x + dockBounds.width + margin;
      }
      const y = dockBounds.y + Math.round((dockBounds.height - bubbleSize[1]) / 2);
      bubbleWin.setBounds({ x, y, width: bubbleSize[0], height: bubbleSize[1] });
      if (!bubbleWin.isVisible()) {
        bubbleWin.showInactive();
      }
      bubbleWin.setAlwaysOnTop(true, "screen-saver");
      bubbleWin.moveTop();
      if (isWindowReady("echo-bubble")) {
        bubbleWin.webContents.send("uca:echo-bubble-show", payload);
      } else {
        enqueueWindowMessage("echo-bubble", "uca:echo-bubble-show", payload);
      }
    } catch (err) {
      safeWarn("[LingxY] echo-bubble-show failed:", err?.message ?? err);
    }
    return { accepted: true };
  });
}
