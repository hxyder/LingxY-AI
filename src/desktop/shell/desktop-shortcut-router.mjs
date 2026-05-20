const CAPTURE_AND_ASK_SELECTION_TIMEOUT_MS = 1600;
const CAPTURE_AND_ASK_WINDOW_TIMEOUT_MS = 850;
const CAPTURE_AND_ASK_CLIPBOARD_POLL_MS = 520;
const CAPTURE_AND_ASK_ACTIVE_PREVIEW_DELAY_MS = 360;

class ShortcutCaptureTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "ShortcutCaptureTimeoutError";
    this.code = "SHORTCUT_CAPTURE_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(promise);
  }
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new ShortcutCaptureTimeoutError(label, timeoutMs)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
    });
  });
}

function hasSelectedCaptureContext(ctx) {
  return Boolean((Array.isArray(ctx?.filePaths) && ctx.filePaths.length > 0) || ctx?.selectedText);
}

function hasActiveWindowContext(ctx) {
  return Boolean(ctx?.activeWindow && !ctx.activeWindow.blocked);
}

function buildCaptureStatusPayload(status, message, detail = {}) {
  return {
    targetWindow: "overlay",
    source_app: "uca.desktop",
    capture_mode: "hotkey_capture",
    capture_status: status,
    error: message,
    ...detail
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCaptureContext(ctx = {}) {
  return {
    processName: null,
    windowTitle: null,
    filePaths: [],
    selectedText: null,
    activeWindow: null,
    ...(ctx ?? {}),
    filePaths: Array.isArray(ctx?.filePaths) ? ctx.filePaths : []
  };
}

function firstUseful(promises = [], timeoutMs = 0) {
  return new Promise((resolve) => {
    let settled = false;
    let remaining = promises.length;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value ?? null);
    };
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => done(null), timeoutMs)
      : null;
    if (remaining === 0) {
      done(null);
      return;
    }
    for (const promise of promises) {
      Promise.resolve(promise).then((value) => {
        if (settled) return;
        if (value) {
          done(value);
          return;
        }
        remaining -= 1;
        if (remaining <= 0) done(null);
      }).catch(() => {
        if (settled) return;
        remaining -= 1;
        if (remaining <= 0) done(null);
      });
    }
  });
}

async function waitForClipboardChange({
  clipboard,
  baseline = "",
  timeoutMs = CAPTURE_AND_ASK_CLIPBOARD_POLL_MS,
  intervalMs = 60
} = {}) {
  if (typeof clipboard?.readText !== "function") return "";
  const startedAt = Date.now();
  const preTrimmed = String(baseline ?? "").trim();
  while (Date.now() - startedAt <= timeoutMs) {
    const text = clipboard.readText() ?? "";
    const trimmed = text.trim();
    if (trimmed.length > 2 && trimmed !== preTrimmed) {
      return trimmed;
    }
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    await wait(Math.min(intervalMs, remainingMs));
  }
  return "";
}

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
  safeNotify,
  captureAndAskSelectionTimeoutMs = CAPTURE_AND_ASK_SELECTION_TIMEOUT_MS,
  captureAndAskWindowTimeoutMs = CAPTURE_AND_ASK_WINDOW_TIMEOUT_MS,
  captureAndAskClipboardPollMs = CAPTURE_AND_ASK_CLIPBOARD_POLL_MS,
  captureAndAskActivePreviewDelayMs = CAPTURE_AND_ASK_ACTIVE_PREVIEW_DELAY_MS
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
        showWindow("overlay", { focus: false });
        for (const bw of windows.values()) {
          bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }

        (async () => {
          const startedAt = Date.now();
          let selectionTimedOut = false;
          let activePreviewContext = null;
          let activePreviewDelivered = false;
          let selectedDelivered = false;

          const sendContext = (ctx, { focus = true } = {}) => {
            const shellPayload = buildShellContextPayload({
              context: ctx,
              sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
              captureMode: "hotkey_capture"
            });
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
              ...shellPayload,
              capture_elapsed_ms: Date.now() - startedAt
            });
            showWindow("overlay", focus ? {} : { focus: false, moveTop: true });
          };

          const selectionFromCapture = withTimeout(
            captureActiveWindowContext({
              includeSelection: true,
              activeWindowEnabled: false,
              allowClipboardFallback: false,
              clipboardBaseline: hotKeyClipboardSnapshot,
              timeoutMs: captureAndAskSelectionTimeoutMs
            }),
            captureAndAskSelectionTimeoutMs,
            "selection capture"
          ).then((ctx) => {
            const normalized = normalizeCaptureContext(ctx);
            return hasSelectedCaptureContext(normalized) ? normalized : null;
          }).catch((err) => {
            selectionTimedOut = err?.code === "SHORTCUT_CAPTURE_TIMEOUT";
            safeError?.("[LingxY] capture-and-ask selection capture failed", err?.message ?? err);
            void appendDesktopDiagnosticError?.("capture_and_ask_selection_failed", err, {
              timedOut: selectionTimedOut,
              shortcutId: shortcut.id
            });
            return null;
          });

          const selectionFromClipboard = waitForClipboardChange({
            clipboard,
            baseline: hotKeyClipboardSnapshot,
            timeoutMs: captureAndAskClipboardPollMs
          }).then((selectedText) => selectedText
            ? normalizeCaptureContext({ selectedText })
            : null);

          const activePreview = (async () => {
            await wait(captureAndAskActivePreviewDelayMs);
            if (selectedDelivered) return null;
            try {
              const windowCtx = normalizeCaptureContext(await withTimeout(
                captureActiveWindowContext({
                  includeSelection: false,
                  activeWindowEnabled: true,
                  allowClipboardFallback: false,
                  preferLastExternal: true,
                  timeoutMs: captureAndAskWindowTimeoutMs
                }),
                captureAndAskWindowTimeoutMs,
                "active-window fallback"
              ));
              if (hasActiveWindowContext(windowCtx)) {
                if (selectedDelivered) return null;
                activePreviewContext = windowCtx;
                activePreviewDelivered = true;
                sendContext(windowCtx);
              }
            } catch (err) {
              safeError?.("[LingxY] capture-and-ask active-window fallback failed", err?.message ?? err);
              void appendDesktopDiagnosticError?.("capture_and_ask_active_window_fallback_failed", err, {
                timedOut: err?.code === "SHORTCUT_CAPTURE_TIMEOUT",
                shortcutId: shortcut.id
              });
            }
            return activePreviewContext;
          })();

          const selectedCtx = await firstUseful([
            selectionFromCapture,
            selectionFromClipboard
          ], captureAndAskSelectionTimeoutMs + 80);

          if (hasSelectedCaptureContext(selectedCtx)) {
            selectedDelivered = true;
            sendContext(selectedCtx);
            return;
          }

          await activePreview;
          if (activePreviewDelivered || hasActiveWindowContext(activePreviewContext)) {
            showWindow("overlay");
            return;
          }

          void appendDesktopDiagnosticError?.("capture_and_ask_empty", null, {
            shortcutId: shortcut.id,
            selectionTimeoutMs: captureAndAskSelectionTimeoutMs,
            clipboardPollMs: captureAndAskClipboardPollMs,
            windowFallbackTimeoutMs: captureAndAskWindowTimeoutMs,
            elapsedMs: Date.now() - startedAt
          });
          enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, buildCaptureStatusPayload(
            selectionTimedOut ? "timeout" : "empty",
            selectionTimedOut
              ? "捕获当前选择超时。请保持内容选中后再试，或直接在输入框里粘贴/提问。"
              : "没有捕获到选中内容。请保持内容选中后重试，或直接在输入框里粘贴/提问。",
            {
              elapsed_ms: Date.now() - startedAt,
              timeout_ms: selectionTimedOut ? captureAndAskSelectionTimeoutMs : null
            }
          ));
          showWindow("overlay");
        })().catch((err) => {
          safeError?.("[LingxY] capture-and-ask failed", err?.message ?? err);
          void appendDesktopDiagnosticError?.("capture_and_ask_failed", err, {
            timedOut: err?.code === "SHORTCUT_CAPTURE_TIMEOUT",
            shortcutId: shortcut.id
          });
          enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, buildCaptureStatusPayload(
            "failed",
            "捕获当前选择失败。请保持内容选中后重试，或直接在输入框里粘贴/提问。"
          ));
          showWindow("overlay");
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
