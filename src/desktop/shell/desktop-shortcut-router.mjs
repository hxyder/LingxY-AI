export function createShortcutRouter({
  showWindow,
  sendEchoShortcutWake,
  captureActiveWindowContext,
  buildShellContextPayload,
  getCaptureInFlight,
  setCaptureInFlight,
  clipboard,
  enqueueWindowMessage,
  IPC_CHANNELS,
  windows,
  loadSettings,
  resolvedServiceBaseUrl,
  requestDesktopServiceJson,
  execFileAsync,
  desktopScriptPath,
  screenshotCapturePath,
  safeError,
  appendDesktopDiagnosticError,
  safeNotify
} = {}) {
  if (typeof showWindow !== "function") throw new TypeError("createShortcutRouter requires showWindow.");
  if (typeof captureActiveWindowContext !== "function") throw new TypeError("createShortcutRouter requires captureActiveWindowContext.");
  if (typeof clipboard?.readText !== "function") throw new TypeError("createShortcutRouter requires clipboard.");

  function buildShortcutHandler(shortcut) {
    return () => {
      const payload = {
        shortcutId: shortcut.id,
        accelerator: shortcut.accelerator
      };

      if (shortcut.id === "toggle-overlay") {
        captureActiveWindowContext({ includeSelection: false }).then((ctx) => {
          const hasActiveWindow = Boolean(ctx.activeWindow && !ctx.activeWindow.blocked);
          if (!hasActiveWindow) return;
          const shellPayload = buildShellContextPayload({
            context: ctx,
            sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
            captureMode: "hotkey_preview"
          });
          enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
        }).catch(() => {});
        showWindow("overlay");
        for (const bw of windows.values()) {
          bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }
        return;
      }

      if (shortcut.id === "voice-wake") {
        captureActiveWindowContext({ includeSelection: false }).catch(() => {});
        void loadSettings().then((settings) => {
          if (settings?.echoMode) {
            sendEchoShortcutWake("voice");
            return;
          }
          showWindow("overlay");
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
        });
        return;
      }

      if (shortcut.id === "note-wake") {
        captureActiveWindowContext({ includeSelection: false }).catch(() => {});
        void loadSettings().then((settings) => {
          if (settings?.echoMode) {
            sendEchoShortcutWake("note");
            return;
          }
          showWindow("overlay");
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
        });
        return;
      }

      if (shortcut.id === "capture-and-ask") {
        if (getCaptureInFlight()) {
          return;
        }
        setCaptureInFlight(true);
        const hotKeyClipboardSnapshot = clipboard.readText() ?? "";
        const capturePromise = captureActiveWindowContext({
          includeSelection: true,
          activeWindowEnabled: false,
          allowClipboardFallback: false,
          clipboardBaseline: hotKeyClipboardSnapshot
        });
        showWindow("overlay");
        for (const bw of windows.values()) {
          bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }
        capturePromise.then(async (ctx) => {
          if (!ctx.selectedText) {
            const postClipboard = clipboard.readText() ?? "";
            const postTrimmed = postClipboard.trim();
            const preTrimmed = hotKeyClipboardSnapshot.trim();
            if (postTrimmed.length > 2 && postTrimmed !== preTrimmed) {
              ctx.selectedText = postTrimmed;
            }
          }

          const hasFiles = ctx.filePaths.length > 0;
          const hasText = Boolean(ctx.selectedText);

          if (hasFiles || hasText) {
            const shellPayload = buildShellContextPayload({
              context: ctx,
              sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
              captureMode: "hotkey_capture"
            });
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
            return;
          }

          const windowCtx = await captureActiveWindowContext({
            includeSelection: false,
            activeWindowEnabled: true,
            allowClipboardFallback: false,
            preferLastExternal: true
          });
          const hasActiveWindow = Boolean(windowCtx.activeWindow && !windowCtx.activeWindow.blocked);
          if (hasActiveWindow) {
            const shellPayload = buildShellContextPayload({
              context: windowCtx,
              sourceApp: windowCtx.processName ?? windowCtx.activeWindow?.process ?? "unknown",
              captureMode: "hotkey_capture"
            });
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
          }
        }).catch(() => {
          // The overlay is already visible. A capture failure should leave the
          // user in the composer instead of turning the hotkey into a blocking
          // desktop probe.
        }).finally(() => {
          setCaptureInFlight(false);
        });
        return;
      }

      if (shortcut.id === "capture-screenshot") {
        const screenshotScriptPath_val = desktopScriptPath("capture-screenshot.ps1");
        const screenshotPath_val = screenshotCapturePath();

        execFileAsync("powershell", [
          "-NoProfile", "-ExecutionPolicy", "Bypass",
          "-File", screenshotScriptPath_val,
          "-OutputPath", screenshotPath_val
        ], { encoding: "utf8", timeout: 8000 }).then(({ stdout }) => {
          let result;
          try { result = JSON.parse(stdout.trim()); } catch { result = { ok: false }; }
          if (result.ok) {
            showWindow("overlay");
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
              targetWindow: "overlay",
              source_app: "uca.screenshot",
              capture_mode: "hotkey_capture",
              file_paths: [screenshotPath_val]
            });
          } else {
            safeError("[LingxY] capture-screenshot: PowerShell returned ok=false", result);
            showWindow("overlay");
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
              targetWindow: "overlay",
              source_app: "uca.screenshot",
              capture_mode: "hotkey_capture",
              error: result.error ?? "截图失败，未生成图片。"
            });
          }
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
        }).catch((err) => {
          safeError("[LingxY] capture-screenshot: PowerShell failed", err?.message ?? err);
          showWindow("overlay");
          enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
            targetWindow: "overlay",
            source_app: "uca.screenshot",
            capture_mode: "hotkey_capture",
            error: err?.message ?? "截图失败，未生成图片。"
          });
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
        });
        return;
      }

      if (shortcut.id === "open-console") {
        showWindow("console");
      }
      if (shortcut.id === "toggle-presenter-mode") {
        (async () => {
          try {
            const base = (typeof resolvedServiceBaseUrl === "function" ? resolvedServiceBaseUrl() : resolvedServiceBaseUrl) ?? "http://127.0.0.1:4310";
            const current = await requestDesktopServiceJson({
              base, method: "GET", actor: "shortcut", pathname: "/security/state"
            }).catch(() => null);
            const currentPresenter = current?.security?.presenter_mode === true;
            const next = !currentPresenter;
            await requestDesktopServiceJson({
              base, method: "POST", actor: "shortcut",
              pathname: "/security/state",
              body: { presenter_mode: next }
            });
            await safeNotify({
              title: next ? "Presenter Mode 已开启" : "Presenter Mode 已关闭",
              body: next
                ? "已隐藏 dock / overlay / popup card。再次按 Ctrl+Alt+P 关闭。"
                : "桌面浮窗已恢复。",
              taskId: `presenter:${next ? "on" : "off"}`,
              dedupeKey: "presenter-mode-toggle",
              allowContinue: false
            });
          } catch (err) {
            void appendDesktopDiagnosticError("presenter_mode_toggle_failed", err, {});
          }
        })();
      }
      for (const browserWindow of windows.values()) {
        browserWindow.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
      }
    };
  }

  return { buildShortcutHandler };
}
