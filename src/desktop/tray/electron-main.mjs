import path from "node:path";
import { mkdir, readdir, readFile, unlink, watch, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";
import { createPopupCardManager } from "./popup-card-manager.mjs";

// Guard against EPIPE — stderr/stdout may be a broken pipe when the parent
// process (Explorer shell, Windows shortcut, etc.) has already closed. Any
// unguarded console.error/warn in an async handler would crash the main
// process with "Error: EPIPE: broken pipe, write".
function safeError(...args) {
  try { if (process.stderr?.writable !== false) console.error(...args); } catch { /* swallow */ }
}
function safeWarn(...args) {
  try { if (process.stderr?.writable !== false) console.warn(...args); } catch { /* swallow */ }
}
import {
  captureActiveWindowContext as runCaptureActiveWindowContext,
  buildShellContextPayload
} from "./active-window-context.mjs";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const PRELOAD_PATH = path.join(RENDERER_DIR, "preload.cjs");

function buildWindowUrl(windowDef, serviceBaseUrl) {
  const filePath = path.join(RENDERER_DIR, `${windowDef.id}.html`);
  const url = new URL(pathToFileURL(filePath).toString());
  url.searchParams.set("windowId", windowDef.id);
  url.searchParams.set("route", windowDef.route);
  url.searchParams.set("serviceBaseUrl", serviceBaseUrl);
  return url.toString();
}

function resolveWindowOptions(windowDef) {
  if (windowDef.id === "dock") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "overlay") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "echo-bubble") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      focusable: false,  // never steal focus from the user's active app
      closable: false
    };
  }

  return {
    autoHideMenuBar: true
  };
}

export function createElectronShellRuntime({
  electron,
  serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310"
} = {}) {
  if (!electron) {
    throw new Error("Electron bindings are required to create the shell runtime.");
  }

  const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, screen, clipboard, session, desktopCapturer } = electron;
  const windows = new Map();
  const readyWindows = new Set();
  const pendingWindowMessages = new Map();
  const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
  const handoffFilePattern = /^prompt-handoff-.*\.json$/i;
  const processedHandoffFiles = new Set();
  const notificationDir = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "UCA", "notifications");
  const notificationFilePattern = /^notification-.*\.json$/i;
  const processedNotificationFiles = new Set();
  let tray = null;
  let quitting = false;
  let resolvedServiceBaseUrl = serviceBaseUrl;
  let handoffWatcher = null;
  let notificationWatcher = null;
  let noteRecordingState = { active: false };
  let lastExternalWindowContext = null;
  let registeredPopupCardManager = null;
  // UCA-182 Phase 14: dedicated preview BrowserWindow anchored to the
  // right edge of the primary display. Created lazily on first show
  // so apps that never preview a file don't pay the memory cost.
  let previewWindow = null;
  let previewWindowPinned = false;

  // Desktop shell settings (echo mode, future flags). Persisted as JSON in
  // AppData/Local/UCA/settings.json. Loaded lazily on first access; callers
  // mutate via updateSettings() which also broadcasts to interested windows.
  const settingsPath = path.join(os.homedir(), "AppData", "Local", "UCA", "settings.json");
  let settingsCache = null;
  async function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const text = await readFile(settingsPath, "utf8");
      settingsCache = { echoMode: false, ...JSON.parse(text) };
    } catch {
      settingsCache = { echoMode: false };
    }
    return settingsCache;
  }
  async function saveSettings() {
    try {
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settingsCache ?? {}, null, 2), "utf8");
    } catch (err) {
      safeError("[UCA] failed to persist settings:", err?.message ?? err);
    }
  }
  async function updateSettings(patch) {
    const current = await loadSettings();
    settingsCache = { ...current, ...patch };
    await saveSettings();
    for (const browserWindow of windows.values()) {
      if (!browserWindow.webContents?.isDestroyed?.()) {
        browserWindow.webContents.send("uca:shell-settings-changed", settingsCache);
      }
    }
    return settingsCache;
  }
  let activeWindowMemoryPollInFlight = false;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function looksLikeShellWindowContext(context) {
    const activeWindow = context?.activeWindow;
    const processName = `${activeWindow?.process ?? context?.processName ?? ""}`.toLowerCase();
    const title = `${activeWindow?.title ?? context?.windowTitle ?? ""}`.toLowerCase();
    return processName.includes("electron")
      || processName.includes("universal-context-agent")
      || processName === "uca"
      || title === "uca"
      || title.includes("uca overlay")
      || title.includes("uca dock")
      || title.includes("universal context agent")
      || (processName === "node" && title.includes("uca"));
  }

  function rememberExternalWindowContext(context) {
    if (!context?.activeWindow || context.activeWindow.blocked) return;
    if (looksLikeShellWindowContext(context)) return;
    lastExternalWindowContext = {
      context,
      updatedAt: Date.now()
    };
  }

  function preferLastExternalWindowContext(context, options = {}) {
    if (!options?.preferLastExternal) return context;
    if (!looksLikeShellWindowContext(context)) return context;
    const maxAgeMs = Number(options.maxExternalAgeMs ?? 10 * 60_000);
    if (!lastExternalWindowContext?.context) return context;
    if (Date.now() - lastExternalWindowContext.updatedAt > maxAgeMs) return context;
    return lastExternalWindowContext.context;
  }

  function startActiveWindowMemoryPoll() {
    setInterval(() => {
      if (activeWindowMemoryPollInFlight) return;
      activeWindowMemoryPollInFlight = true;
      captureActiveWindowContext({ includeSelection: false })
        .catch(() => {})
        .finally(() => { activeWindowMemoryPollInFlight = false; });
    }, 3000);
  }

  function buildOverlayPayloadFromFiles(filePaths, sourceApp = "uca.dock", captureMode = "dock_drop") {
    return {
      source_app: sourceApp,
      capture_mode: captureMode,
      file_paths: filePaths,
      targetWindow: "overlay"
    };
  }

  function enqueueWindowMessage(windowId, channel, payload) {
    const target = windows.get(windowId);
    if (target && readyWindows.has(windowId)) {
      target.webContents.send(channel, payload);
      return;
    }

    const queued = pendingWindowMessages.get(windowId) ?? [];
    queued.push({ channel, payload });
    pendingWindowMessages.set(windowId, queued);
  }

  function flushWindowMessages(windowId) {
    const target = windows.get(windowId);
    const queued = pendingWindowMessages.get(windowId) ?? [];
    if (!target || queued.length === 0) {
      return;
    }

    for (const message of queued) {
      target.webContents.send(message.channel, message.payload);
    }
    pendingWindowMessages.delete(windowId);
  }

  function showDesktopNotification(payload = {}) {
    // UCA-182 Phase 8: all in-app notifications now route through the
    // popup-card stack (top-right). The legacy "notification" bottom
    // window and the native OS toast are gone; users consistently see
    // a single style of card that they can pin, dismiss or click to
    // act on. Native OS notification remains a last-resort fallback
    // for scenarios where the popup-card manager hasn't been wired up
    // yet (e.g. during early startup).
    if (registeredPopupCardManager) {
      try {
        const body = payload.body ?? payload.message ?? "";
        registeredPopupCardManager.showCard({
          kind: "info",
          title: payload.title ?? "LingxY",
          lines: body ? String(body).split(/\n+/).slice(0, 4) : [],
          taskId: payload.taskId ?? null,
          autoHideMs: payload.autoHideMs ?? 8000,
          dedupeKey: payload.dedupeKey ?? (payload.taskId ? `notify:${payload.taskId}` : undefined)
        });
        return { shown: true, delivery: "popup_card" };
      } catch (err) {
        safeWarn("[UCA] popup-card notify failed, falling back:", err?.message ?? err);
      }
    }

    if (!Notification?.isSupported?.()) {
      return { shown: false, reason: "unsupported" };
    }

    const notification = new Notification({
      title: payload.title ?? "LingxY",
      body: payload.body ?? payload.message ?? "",
      silent: false
    });
    notification.show();
    return { shown: true, delivery: "native_notification" };
  }

  function getArgValue(argv, flagName) {
    const index = argv.findIndex((item) => item === flagName);
    if (index < 0 || index + 1 >= argv.length) {
      return null;
    }
    return argv[index + 1];
  }

  async function handleLaunchArgs(argv = []) {
    const requestedServiceBaseUrl = getArgValue(argv, "--uca-service-url");
    if (requestedServiceBaseUrl) {
      resolvedServiceBaseUrl = requestedServiceBaseUrl;
    }

    const handoffFile = getArgValue(argv, "--uca-handoff-file");
    if (handoffFile) {
      await consumeHandoffFile(handoffFile);
      return true;
    }

    if (argv.includes("--uca-open-overlay")) {
      showWindow("overlay");
      return true;
    }

    return false;
  }

  async function consumeHandoffFile(handoffFile) {
    if (!handoffFilePattern.test(path.basename(handoffFile))) {
      return false;
    }
    if (processedHandoffFiles.has(handoffFile)) {
      return false;
    }

    processedHandoffFiles.add(handoffFile);
    try {
      const raw = await readFile(handoffFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(handoffFile).catch(() => {});
      showWindow("overlay");
      enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
        ...payload,
        targetWindow: "overlay"
      });
      return true;
    } finally {
      processedHandoffFiles.delete(handoffFile);
    }
  }

  async function drainHandoffDirectory() {
    try {
      const entries = await readdir(handoffDir, { withFileTypes: true });
      const handoffFiles = entries
        .filter((entry) => entry.isFile() && handoffFilePattern.test(entry.name))
        .map((entry) => path.join(handoffDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const handoffFile of handoffFiles) {
        await consumeHandoffFile(handoffFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to drain explorer handoff directory", error);
      }
    }
  }

  async function startHandoffWatcher() {
    await drainHandoffDirectory();

    try {
      handoffWatcher = watch(handoffDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to watch explorer handoff directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of handoffWatcher) {
          if (!event.filename || !handoffFilePattern.test(event.filename)) {
            continue;
          }
          await consumeHandoffFile(path.join(handoffDir, event.filename));
        }
      } catch (error) {
        if (!quitting && error?.name !== "AbortError") {
          safeError("Explorer handoff watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError("Explorer handoff watcher task failed", error);
    });
  }

  async function consumeNotificationFile(notificationFile) {
    if (!notificationFilePattern.test(path.basename(notificationFile))) {
      return false;
    }
    if (processedNotificationFiles.has(notificationFile)) {
      return false;
    }

    processedNotificationFiles.add(notificationFile);
    try {
      const raw = await readFile(notificationFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(notificationFile).catch(() => {});
      showDesktopNotification(payload);
      return true;
    } finally {
      processedNotificationFiles.delete(notificationFile);
    }
  }

  async function drainNotificationDirectory() {
    try {
      await mkdir(notificationDir, { recursive: true });
      const entries = await readdir(notificationDir, { withFileTypes: true });
      const notificationFiles = entries
        .filter((entry) => entry.isFile() && notificationFilePattern.test(entry.name))
        .map((entry) => path.join(notificationDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const notificationFile of notificationFiles) {
        await consumeNotificationFile(notificationFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to drain notification directory", error);
      }
    }
  }

  async function startNotificationWatcher() {
    await drainNotificationDirectory();

    try {
      await mkdir(notificationDir, { recursive: true });
      notificationWatcher = watch(notificationDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to watch notification directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of notificationWatcher) {
          if (!event.filename || !notificationFilePattern.test(event.filename)) {
            continue;
          }
          await consumeNotificationFile(path.join(notificationDir, event.filename));
        }
      } catch (error) {
        if (!quitting && error?.name !== "AbortError") {
          safeError("Notification watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError("Notification watcher task failed", error);
    });
  }

  async function requestMorningDigestCheck() {
    if (typeof fetch !== "function") {
      return;
    }
    try {
      await fetch(`${resolvedServiceBaseUrl}/email/digest/check`, { method: "POST" });
    } catch (error) {
      safeWarn("Morning digest check failed", error?.message ?? error);
    }
  }

  const scriptsDir = path.join(__dirname, "..", "..", "..", "scripts");

  // Shared PowerShell runner used by both capture-context.ps1 and
  // active-window-probe.ps1. Returns `{stdout, stderr}` the same way
  // execFile does, so the helper in `active-window-context.mjs` can stay
  // Electron-free (and therefore testable from verify scripts).
  async function runPowerShellScript({ script, args = [], timeoutMs = 3000 }) {
    const scriptPath = path.join(scriptsDir, script);
    return execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args
    ], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  }

  async function isRemoteFeatureEnabled(featureId) {
    if (typeof fetch !== "function") return false;
    try {
      const response = await fetch(`${resolvedServiceBaseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const payload = await response.json();
      return payload?.config?.features?.[featureId]?.enabled !== false;
    } catch {
      // Network error or timeout: default to disabled to avoid silently enabling features
      return false;
    }
  }

  async function captureActiveWindowContext({ includeSelection = true } = {}) {
    const activeWindowEnabled = await isRemoteFeatureEnabled("active_window_probe");
    const context = await runCaptureActiveWindowContext({
      runPowerShell: runPowerShellScript,
      clipboardFallback: () => clipboard.readText() ?? "",
      timeoutMs: 3000,
      activeWindowEnabled,
      includeSelection
    });

    // Keep the clipboard watcher in sync when capture-context.ps1 surfaced
    // selected text. Before UCA-047 this was done inline; the helper now
    // owns the merge but we still have to update this closure's mutable
    // `lastClipboardText` for dock pulse behaviour.
    if (context.selectedText) {
      lastClipboardText = context.selectedText;
    }

    rememberExternalWindowContext(context);
    return context;
  }

  let lastClipboardText = "";
  let clipboardPollTimer = null;
  let captureInFlight = false; // debounce guard for capture-and-ask hotkey

  function startClipboardWatcher() {
    lastClipboardText = clipboard.readText() ?? "";
    clipboardPollTimer = setInterval(() => {
      try {
        const current = clipboard.readText() ?? "";
        if (current && current !== lastClipboardText && current.trim().length >= 4) {
          lastClipboardText = current;
          // notify dock to pulse
          const dock = windows.get("dock");
          if (dock && readyWindows.has("dock")) {
            dock.webContents.send(IPC_CHANNELS.shellClipboardChanged, {
              length: current.length,
              preview: current.slice(0, 60)
            });
          }
        }
      } catch { /* ignore clipboard read errors */ }
    }, 800);
  }

  function stopClipboardWatcher() {
    if (clipboardPollTimer) {
      clearInterval(clipboardPollTimer);
      clipboardPollTimer = null;
    }
  }

  function createWindows() {
    for (const windowDef of DESKTOP_SHELL_MANIFEST.windows) {
      if (windows.has(windowDef.id)) {
        continue;
      }
      const browserWindow = new BrowserWindow({
        width: windowDef.width,
        height: windowDef.height,
        show: !windowDef.startsHidden,
        title: windowDef.title,
        ...resolveWindowOptions(windowDef),
        webPreferences: {
          sandbox: false,
          contextIsolation: true,
          preload: PRELOAD_PATH
        }
      });
      browserWindow.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          browserWindow.hide();
        }
      });
      browserWindow.on("focus", () => {
        browserWindow.webContents.send(IPC_CHANNELS.shellWindowFocused, {
          windowId: windowDef.id
        });
      });
      browserWindow.on("closed", () => {
        readyWindows.delete(windowDef.id);
        pendingWindowMessages.delete(windowDef.id);
        windows.delete(windowDef.id);
      });
      browserWindow.webContents.on("did-finish-load", () => {
        readyWindows.add(windowDef.id);
        browserWindow.webContents.send(IPC_CHANNELS.shellReady, {
          windowId: windowDef.id,
          route: windowDef.route,
          serviceBaseUrl: resolvedServiceBaseUrl
        });
        if (windowDef.id === "dock") {
          browserWindow.webContents.send("uca:note-recording-state", noteRecordingState);
        }
        flushWindowMessages(windowDef.id);
      });
      // UCA-050: surface renderer load failures so they're not silent
      browserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        if (errorCode !== -3) { // -3 = ERR_ABORTED (normal on hide/navigate)
          safeError(`[UCA] Window "${windowDef.id}" failed to load: ${errorDescription} (${errorCode})`);
        }
      });
      browserWindow.loadURL(buildWindowUrl(windowDef, resolvedServiceBaseUrl));
      if (windowDef.id === "dock") {
        const { workArea } = screen.getPrimaryDisplay();
        const [width, height] = browserWindow.getSize();
        browserWindow.setPosition(
          Math.max(workArea.x, workArea.x + workArea.width - width - 28),
          Math.max(workArea.y, workArea.y + workArea.height - height - 56)
        );
      }
      windows.set(windowDef.id, browserWindow);
    }
  }

  function showWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    if (target.isMinimized()) {
      target.restore();
    }
    if (windowId === "overlay") {
      const { workArea } = screen.getPrimaryDisplay();
      const [width, height] = target.getSize();
      target.setPosition(
        Math.round(workArea.x + (workArea.width - width) / 2),
        Math.max(workArea.y, workArea.y + workArea.height - height - 16)
      );
    }
    target.setAlwaysOnTop(true, "screen-saver");
    target.show();
    target.moveTop();
    target.focus();
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

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      const registered = globalShortcut.register(shortcut.accelerator, () => {
        const payload = {
          shortcutId: shortcut.id,
          accelerator: shortcut.accelerator
        };

        if (shortcut.id === "toggle-overlay") {
          // Clean open — no auto-capture. Earlier behaviour ran a PowerShell
          // selection capture that could mojibake non-ASCII text in stdout
          // and confused users who just wanted an empty input. We still keep
          // the active browser/file window as a lightweight hint so the
          // renderer can answer "summarize this page/video" once the user asks.
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
            // Open overlay and immediately start voice input.
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
            // Open overlay and immediately start voice-note recording (dual channel:
            // mic + system audio). Same wiring as voice-wake; overlay decides mode.
            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          });
          return;
        }

        if (shortcut.id === "capture-and-ask") {
          // Explicit "grab whatever the user is looking at" hotkey. Files
          // pass through cleanly; selected text only attaches when it
          // round-trips through stdout without encoding loss. UCA-047 also
          // runs the active-window-probe in parallel to add URL / document
          // path hints so the overlay can offer "analyse this page" /
          // "summarise this document" quick-actions even when there's no
          // clipboard selection.
          //
          // UCA-050: guard against rapid double-press racing two concurrent
          // captureActiveWindowContext() promises that could each try to
          // enqueue a different context payload to the overlay.
          if (captureInFlight) {
            showWindow("overlay");
            return;
          }
          captureInFlight = true;
          // Snapshot clipboard synchronously right now — before any async work
          // that might shift focus or delay the SimulateCopy execution. This
          // lets us detect whether SimulateCopy completed late (Add-Type JIT
          // on first run can take 500–2000ms, so the clipboard update may
          // arrive after the PowerShell script's own read but before we show
          // the overlay).
          const hotKeyClipboardSnapshot = clipboard.readText() ?? "";
          captureActiveWindowContext().then((ctx) => {
            // If the in-script clipboard read missed the SimulateCopy result
            // (timing race on first run), check whether the clipboard changed
            // since the hotkey fired and adopt the new value.
            if (!ctx.selectedText) {
              const postClipboard = clipboard.readText() ?? "";
              const postTrimmed = postClipboard.trim();
              const preTrimmed = hotKeyClipboardSnapshot.trim();
              if (postTrimmed.length > 2 && postTrimmed !== preTrimmed) {
                ctx.selectedText = postTrimmed;
              }
            }

            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }

            const hasFiles = ctx.filePaths.length > 0;
            const hasText = Boolean(ctx.selectedText);
            const hasActiveWindow = Boolean(ctx.activeWindow && !ctx.activeWindow.blocked);

            if (hasFiles || hasText || hasActiveWindow) {
              const shellPayload = buildShellContextPayload({
                context: ctx,
                sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
                captureMode: "hotkey_capture"
              });
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
            }
          }).catch(() => {
            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          }).finally(() => {
            captureInFlight = false;
          });
          return;
        }

        if (shortcut.id === "capture-screenshot") {
          const screenshotScriptPath = path.join(__dirname, "..", "..", "..", "scripts", "capture-screenshot.ps1");
          const screenshotPath = path.join(os.tmpdir(), "UCA", "screenshots", `capture-${Date.now()}.png`);

          execFileAsync("powershell", [
            "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", screenshotScriptPath,
            "-OutputPath", screenshotPath
          ], { encoding: "utf8", timeout: 8000 }).then(({ stdout }) => {
            let result;
            try { result = JSON.parse(stdout.trim()); } catch { result = { ok: false }; }
            if (result.ok) {
              showWindow("overlay");
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
                targetWindow: "overlay",
                source_app: "uca.screenshot",
                capture_mode: "hotkey_capture",
                file_paths: [screenshotPath]
              });
            } else {
              safeError("[UCA] capture-screenshot: PowerShell returned ok=false", result);
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
            safeError("[UCA] capture-screenshot: PowerShell failed", err?.message ?? err);
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
        for (const browserWindow of windows.values()) {
          browserWindow.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }
      });
      if (!registered) {
        safeError(`[UCA] Failed to register shortcut ${shortcut.id} (${shortcut.accelerator}). It may be used by another app.`);
      }
    }
  }

  function createTray() {
    tray = new Tray(buildTrayIcon(0));
    tray.setToolTip(DESKTOP_SHELL_MANIFEST.trayTooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: "Open Console",
        click() {
          showWindow("console");
        }
      },
      {
        label: "Open Overlay",
        click() {
          showWindow("overlay");
        }
      },
      {
        label: "Quit",
        click() {
          app.quit();
        }
      }
    ]));
  }

  // UCA-069: Generate a tray icon with optional badge number using SVG data URL.
  function buildTrayIcon(count) {
    const hasBadge = count > 0;
    const label = count > 99 ? "99+" : count > 0 ? String(count) : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <!-- orb base -->
      <circle cx="16" cy="16" r="14" fill="url(#base)"/>
      <defs>
        <radialGradient id="base" cx="40%" cy="35%">
          <stop offset="0%" stop-color="#6366f1"/>
          <stop offset="60%" stop-color="#312e81"/>
          <stop offset="100%" stop-color="#0f0f1a"/>
        </radialGradient>
      </defs>
      <!-- glass highlight -->
      <ellipse cx="12" cy="10" rx="5" ry="3" fill="rgba(255,255,255,0.3)" transform="rotate(-20,12,10)"/>
      ${hasBadge ? `
      <!-- badge circle -->
      <circle cx="24" cy="8" r="${label.length > 1 ? 9 : 7}" fill="#22c55e"/>
      <text x="24" y="${label.length > 1 ? 12 : 12}" text-anchor="middle"
        font-family="system-ui,sans-serif" font-size="${label.length > 1 ? 7 : 9}"
        font-weight="bold" fill="white">${label}</text>` : ""}
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    return nativeImage.createFromDataURL(dataUrl);
  }

  async function updateTrayBadge() {
    if (!tray) return;
    try {
      const resp = await fetch(`${resolvedServiceBaseUrl}/tasks`);
      if (!resp.ok) return;
      const data = await resp.json();
      const tasks = data.tasks ?? [];
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();
      const completed = tasks.filter((t) => {
        if (t.capture_mode === "scheduler" || t.source_app === "uca.scheduler") return false;
        if (t.status !== "success" && t.status !== "partial_success") return false;
        const ms = new Date(t.updated_at ?? t.created_at).getTime();
        return Number.isFinite(ms) && ms >= todayMs;
      }).length;

      tray.setImage(buildTrayIcon(completed));
      tray.setToolTip(completed > 0
        ? `LingxY · 今日完成 ${completed} 个任务`
        : DESKTOP_SHELL_MANIFEST.trayTooltip);
    } catch { /* service not ready */ }
  }

  return {
    async start() {
      await app.whenReady();

      // Grant microphone access to our own renderer windows so the Web
      // Speech API (used by the overlay's voice input) doesn't fail with
      // `not-allowed`. Permission is only granted to file:// or http://127.0.0.1
      // URLs that we serve ourselves — never to arbitrary remote origins.
      try {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
          const requestingUrl = webContents?.getURL?.() ?? "";
          const isLocal = requestingUrl.startsWith("file://")
            || requestingUrl.startsWith("http://127.0.0.1")
            || requestingUrl.startsWith("http://localhost");
          const isAudioOrDisplay = permission === "media"
            || permission === "audioCapture"
            || permission === "microphone"
            || permission === "displayCapture";
          if (isLocal && isAudioOrDisplay) {
            callback(true);
            return;
          }
          callback(false);
        });
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
          const url = requestingOrigin ?? webContents?.getURL?.() ?? "";
          const isLocal = url.startsWith("file://")
            || url.startsWith("http://127.0.0.1")
            || url.startsWith("http://localhost");
          const isAudioOrDisplay = permission === "media"
            || permission === "audioCapture"
            || permission === "microphone"
            || permission === "displayCapture";
          return isLocal && isAudioOrDisplay;
        });
      } catch (error) {
        safeError("Failed to install permission handler", error);
      }

      createWindows();
      createTray();
      registerShortcuts();
      await startHandoffWatcher();
      await startNotificationWatcher();
      setTimeout(() => {
        requestMorningDigestCheck().catch(() => {});
      }, 1500);
      // UCA-069: update tray badge after service is likely ready, then every 30s
      setTimeout(() => { updateTrayBadge().catch(() => {}); }, 5000);
      setInterval(() => { updateTrayBadge().catch(() => {}); }, 30_000);
      startClipboardWatcher();
      startActiveWindowMemoryPoll();
      app.on("second-instance", (_event, argv) => {
        handleLaunchArgs(argv).catch((error) => {
          safeError("Failed to process second-instance args", error);
        });
      });
      // Expose the primary screen's desktopCapturer source ID to renderers so
      // they can capture system audio via getUserMedia + chromeMediaSource:
      // 'desktop', bypassing the getDisplayMedia screen-picker dialog entirely.
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

      ipcMain.handle("uca:capture-active-window-context", async (event, options = {}) => {
        try {
          let context = await captureActiveWindowContext({
            includeSelection: options?.includeSelection !== false
          });
          if (options?.excludeShellWindow && looksLikeShellWindowContext(context)) {
            const sourceWindow = BrowserWindow.fromWebContents(event.sender);
            const wasVisible = sourceWindow?.isVisible?.() ?? false;
            if (sourceWindow && wasVisible) {
              sourceWindow.hide();
              try {
                await wait(160);
                context = await captureActiveWindowContext({
                  includeSelection: options?.includeSelection !== false
                });
              } finally {
                if (typeof sourceWindow.showInactive === "function") sourceWindow.showInactive();
                else sourceWindow.show();
              }
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
        noteRecordingState = {
          active: Boolean(payload.active),
          elapsedMs: Number(payload.elapsedMs ?? 0),
          elapsed: payload.elapsed ?? "00:00",
          hasMicTranscript: Boolean(payload.hasMicTranscript),
          hasSystemAudio: Boolean(payload.hasSystemAudio),
          updatedAt: Date.now()
        };
        const dock = windows.get("dock");
        if (dock && readyWindows.has("dock")) {
          dock.webContents.send("uca:note-recording-state", noteRecordingState);
        }
        return noteRecordingState;
      });

      ipcMain.handle("uca:get-note-recording-state", () => noteRecordingState);

      // UCA-182 Phase 4: resolve the pdfjs-dist worker's on-disk path
      // to a file:// URL so the renderer can spin up the worker without
      // having to fetch it from the runtime server or bundle it. The
      // legacy build ships an ESM worker that Electron can import
      // directly via GlobalWorkerOptions.workerSrc.
      ipcMain.handle("uca:get-pdf-worker-url", async () => {
        const workerPath = path.join(
          app.getAppPath(),
          "node_modules",
          "pdfjs-dist",
          "legacy",
          "build",
          "pdf.worker.mjs"
        );
        const mainPath = path.join(
          app.getAppPath(),
          "node_modules",
          "pdfjs-dist",
          "legacy",
          "build",
          "pdf.mjs"
        );
        return {
          workerUrl: pathToFileURL(workerPath).toString(),
          mainUrl: pathToFileURL(mainPath).toString()
        };
      });

      ipcMain.handle("uca:get-settings", async () => loadSettings());
      ipcMain.handle("uca:set-echo-mode", async (_event, enabled) => {
        return updateSettings({ echoMode: Boolean(enabled) });
      });

      // Right-click on the dock orb asks the main process to show a native
      // context menu. Done here (not in the renderer) so we get native
      // look-and-feel, keyboard-nav, and the menu survives window-focus
      // changes cleanly.
      ipcMain.handle("uca:show-dock-menu", async () => {
        const current = await loadSettings();
        const dockWin = windows.get("dock");
        if (!dockWin || dockWin.webContents?.isDestroyed?.()) return;
        const menu = Menu.buildFromTemplate([
          {
            label: "正常模式",
            type: "radio",
            checked: !current.echoMode,
            click() { void updateSettings({ echoMode: false }); }
          },
          {
            label: "Echo 模式（常开唤醒）",
            type: "radio",
            checked: Boolean(current.echoMode),
            click() { void updateSettings({ echoMode: true }); }
          },
          { type: "separator" },
          {
            label: "录入我的唤醒词（3 次）...",
            enabled: Boolean(current.echoMode),
            click() {
              const dock = windows.get("dock");
              if (dock && !dock.webContents?.isDestroyed?.()) {
                dock.webContents.send("uca:start-wake-enrollment", { at: Date.now() });
              }
            }
          },
          {
            label: "清除个人唤醒词样本",
            enabled: Boolean(current.echoMode),
            async click() {
              try {
                const dir = path.resolve(process.cwd(), "models", "user-keywords");
                const files = await readdir(dir).catch(() => []);
                await Promise.all(files
                  .filter((f) => f.endsWith(".txt") || f.endsWith(".webm") || f.endsWith(".wav") || f.endsWith(".json"))
                  .map((f) => unlink(path.join(dir, f)).catch(() => null)));
                const dock = windows.get("dock");
                if (dock && !dock.webContents?.isDestroyed?.()) {
                  dock.webContents.send("uca:echo-bubble-show", {
                    text: "✓ 个人唤醒词样本已清除",
                    kind: "info", durationMs: 1800
                  });
                }
              } catch (err) {
                safeWarn("[UCA] clear-user-keywords failed:", err?.message ?? err);
              }
            }
          },
          { type: "separator" },
          {
            label: "打开 Dock 开发者工具（查看 Echo 日志）",
            click() {
              const dock = windows.get("dock");
              if (dock && !dock.webContents?.isDestroyed?.()) {
                try { dock.webContents.openDevTools({ mode: "detach" }); } catch { /* ignore */ }
              }
            }
          },
          { type: "separator" },
          { label: "打开主控台", click() { showWindow("console"); } },
          { label: "打开对话框", click() { showWindow("overlay"); } },
          { type: "separator" },
          { label: "退出 LingxY", click() { app.quit(); } }
        ]);
        menu.popup({ window: dockWin });
      });

      // Echo mode coordination — the dock renderer owns the wake-word
      // recognizer and reports wake events here so we can hand them off to
      // the overlay (which owns the existing voice/note capture state).
      // Echo mode stays HUD-only: the dock orb and echo bubble carry state,
      // and the overlay is only shown when the user explicitly clicks the dock.
      ipcMain.handle("uca:echo-wake", async (_event, payload = {}) => {
        enqueueWindowMessage("overlay", "uca:echo-wake", {
          kind: payload.kind ?? "voice",
          transcript: payload.transcript ?? "",
          triggeredAt: Date.now()
        });
        return { accepted: true };
      });

      // Session-scoped Ctrl+Enter. Overlay registers this at the start of
      // an echo-initiated voice/note session and unregisters on finish, so
      // the shortcut never interferes with other apps outside the session.
      // The accelerator is forwarded to the overlay renderer as a virtual
      // IPC event, letting it run the same handleUserSend / finishNote
      // paths it already uses for Enter.
      ipcMain.handle("uca:register-ctrl-enter", (_event, tag = "echo-session") => {
        if (globalShortcut.isRegistered("CommandOrControl+Return")) return { accepted: true };
        const ok = globalShortcut.register("CommandOrControl+Return", () => {
          for (const browserWindow of windows.values()) {
            if (!browserWindow.webContents?.isDestroyed?.()) {
              browserWindow.webContents.send("uca:ctrl-enter", { tag });
            }
          }
        });
        return { accepted: Boolean(ok) };
      });
      ipcMain.handle("uca:unregister-ctrl-enter", () => {
        try { globalShortcut.unregister("CommandOrControl+Return"); } catch { /* ignore */ }
        // Echo session has ended — tell the dock so it can resume wake-word
        // listening immediately instead of waiting for its 20s fallback timer.
        const dock = windows.get("dock");
        if (dock && !dock.webContents?.isDestroyed?.()) {
          dock.webContents.send("uca:echo-session-end", { at: Date.now() });
        }
        return { accepted: true };
      });

      // Show the echo-bubble HUD near the dock. Positions the bubble to the
      // left of the dock window (or right, if there's no room on the left)
      // and pushes the payload to the bubble renderer.
      ipcMain.handle("uca:echo-bubble-show", async (_event, payload = {}) => {
        const bubbleWin = windows.get("echo-bubble");
        const dockWin = windows.get("dock");
        if (!bubbleWin || !dockWin) return { accepted: false };
        try {
          const dockBounds = dockWin.getBounds();
          const display = screen.getDisplayMatching(dockBounds);
          const bubbleSize = bubbleWin.getSize();
          const margin = 8;
          let x = dockBounds.x - bubbleSize[0] - margin;
          // If not enough room on the left, place to the right instead.
          if (x < display.workArea.x) {
            x = dockBounds.x + dockBounds.width + margin;
          }
          const y = dockBounds.y + Math.round((dockBounds.height - bubbleSize[1]) / 2);
          bubbleWin.setBounds({ x, y, width: bubbleSize[0], height: bubbleSize[1] });
          if (!bubbleWin.isVisible()) {
            bubbleWin.showInactive();  // never steal focus
          }
          bubbleWin.setAlwaysOnTop(true, "screen-saver");
          bubbleWin.moveTop();
          if (readyWindows.has("echo-bubble")) {
            bubbleWin.webContents.send("uca:echo-bubble-show", payload);
          } else {
            enqueueWindowMessage("echo-bubble", "uca:echo-bubble-show", payload);
          }
        } catch (err) {
          safeWarn("[UCA] echo-bubble-show failed:", err?.message ?? err);
        }
        return { accepted: true };
      });

      // ── Popup cards (approval + task completion) ──
      const popupCardManager = createPopupCardManager({
        BrowserWindow,
        screen,
        ipcMain,
        resolveServiceBaseUrl: () => resolvedServiceBaseUrl
      });
      popupCardManager.registerIpcHandlers({
        onResolve: async (card) => {
          try {
            if (card.kind === "approval" && card.payload?.approvalId) {
              const approvalId = card.payload.approvalId;
              const action = card.action === "approve" ? "approve" : card.action === "reject" ? "reject" : null;
              if (!action) return;
              const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
              await fetch(`${base}/approvals/${approvalId}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actor: "popup-card" })
              }).catch((err) => safeWarn("[UCA] approval resolve failed:", err?.message ?? err));
            }
          } catch (err) {
            safeWarn("[UCA] popup-card onResolve failed:", err?.message ?? err);
          }
          // Broadcast the resolution so the overlay (which may be showing an
          // inline twin of the same approval) can mark its copy as handled.
          try {
            const overlayWin = windows.get("overlay");
            if (overlayWin && !overlayWin.webContents?.isDestroyed?.()) {
              overlayWin.webContents.send(IPC_CHANNELS.popupCardResolved, {
                cardId: card.cardId,
                kind: card.kind,
                action: card.action,
                approvalId: card.payload?.approvalId ?? null,
                taskId: card.payload?.taskId ?? null,
                // UCA-182 Phase 8: forward arbitrary meta (artifactPath,
                // inlinePreview, mime, ...) so the overlay's resolve
                // listener can wire success-kind buttons to the right
                // file / clipboard actions without another IPC hop.
                meta: card.meta ?? null
              });
            }
          } catch (err) {
            safeWarn("[UCA] popup-card resolved-broadcast failed:", err?.message ?? err);
          }
        }
      });
      registeredPopupCardManager = popupCardManager;

      // UCA-182 Phase 14: preview window lifecycle. Created on demand,
      // positioned to cover the right ~42% of the primary workArea.
      // We keep the window between uses (hide, not destroy) so the
      // next preview can paint without reloading the HTML + scripts.
      function computePreviewBounds() {
        const { workArea } = screen.getPrimaryDisplay();
        const width = Math.max(720, Math.min(Math.round(workArea.width * 0.42), 1100));
        const height = Math.max(480, workArea.height - 32);
        const x = workArea.x + workArea.width - width - 16;
        const y = workArea.y + 16;
        return { x, y, width, height };
      }
      function ensurePreviewWindow() {
        if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;
        const bounds = computePreviewBounds();
        const baseUrl = resolvedServiceBaseUrl ?? "";
        const url = pathToFileURL(path.join(RENDERER_DIR, "preview-window.html")).toString()
          + `?serviceBaseUrl=${encodeURIComponent(baseUrl)}`;
        previewWindow = new BrowserWindow({
          ...bounds,
          show: false,
          frame: false,
          transparent: false,
          alwaysOnTop: false,
          resizable: true,
          movable: true,
          skipTaskbar: false,
          title: "LingxY Preview",
          backgroundColor: "#ffffff",
          webPreferences: {
            sandbox: false,
            contextIsolation: true,
            preload: PRELOAD_PATH
          }
        });
        previewWindow.on("close", (event) => {
          // Hide instead of destroy so state survives across opens.
          // `quitting` is the module-scoped flag set in the before-quit
          // handler so we don't keep blocking the app shutdown.
          if (!quitting) {
            event.preventDefault();
            previewWindow.hide();
          }
        });
        previewWindow.on("closed", () => { previewWindow = null; });
        previewWindow.loadURL(url);
        return previewWindow;
      }
      function showPreviewWindowIfHidden() {
        const win = ensurePreviewWindow();
        if (!win.isVisible()) {
          // Re-compute bounds in case the user moved to a different
          // display since last open.
          try { win.setBounds(computePreviewBounds()); } catch { /* ignore */ }
          win.showInactive();
        } else {
          try { win.moveTop(); } catch { /* ignore */ }
        }
        return win;
      }
      function sendToPreview(channel, payload) {
        const win = showPreviewWindowIfHidden();
        const deliver = () => {
          if (win.isDestroyed()) return;
          win.webContents.send(channel, payload);
        };
        // If the window is still loading, wait for did-finish-load once.
        if (win.webContents.isLoading()) {
          win.webContents.once("did-finish-load", deliver);
        } else {
          deliver();
        }
      }

      ipcMain.handle(IPC_CHANNELS.previewWindowShow, (_event, payload = {}) => {
        sendToPreview(IPC_CHANNELS.previewWindowInit, payload);
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowAppendDelta, (_event, payload = {}) => {
        if (!previewWindow || previewWindow.isDestroyed() || !previewWindow.isVisible()) {
          // Deltas before show are noise; drop silently.
          return { ok: false, reason: "not_shown" };
        }
        previewWindow.webContents.send(IPC_CHANNELS.previewWindowDelta, payload);
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowCommit, (_event, payload = {}) => {
        sendToPreview(IPC_CHANNELS.previewWindowCommitted, payload);
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowClose, () => {
        if (previewWindow && !previewWindow.isDestroyed()) previewWindow.hide();
        return { ok: true };
      });
      ipcMain.handle("uca:preview-window-pin", (_event, flag) => {
        previewWindowPinned = Boolean(flag);
        if (previewWindow && !previewWindow.isDestroyed()) {
          try { previewWindow.setAlwaysOnTop(previewWindowPinned, "screen-saver"); } catch { /* ignore */ }
        }
        return previewWindowPinned;
      });

      ipcMain.handle(IPC_CHANNELS.shellStatus, () => ({
        serviceBaseUrl: resolvedServiceBaseUrl,
        windowIds: [...windows.keys()],
        windows: DESKTOP_SHELL_MANIFEST.windows.map((windowDef) => ({
          id: windowDef.id,
          title: windowDef.title,
          route: windowDef.route,
          visible: windows.get(windowDef.id)?.isVisible() ?? false
        }))
      }));
      ipcMain.handle(IPC_CHANNELS.shellShowWindow, (_event, windowId) => showWindow(windowId));
      ipcMain.handle(IPC_CHANNELS.shellHideWindow, (_event, windowId) => hideWindow(windowId));
      ipcMain.handle(IPC_CHANNELS.shellSubmitDroppedFiles, async (_event, filePaths = []) => {
        const acceptedFilePaths = filePaths.filter((filePath) => typeof filePath === "string" && filePath.length > 0);
        if (acceptedFilePaths.length === 0) {
          return { accepted: false, reason: "no_files" };
        }
        showWindow("overlay");
        enqueueWindowMessage(
          "overlay",
          IPC_CHANNELS.shellContextReceived,
          buildOverlayPayloadFromFiles(acceptedFilePaths)
        );
        return {
          accepted: true,
          fileCount: acceptedFilePaths.length
        };
      });
      ipcMain.handle(IPC_CHANNELS.shellMoveWindowBy, (_event, { windowId, deltaX, deltaY } = {}) => {
        const target = windows.get(windowId);
        if (!target) return false;
        const [x, y] = target.getPosition();
        target.setPosition(Math.round(x + (deltaX ?? 0)), Math.round(y + (deltaY ?? 0)));
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
      app.on("activate", () => {
        // UCA-050: also recreate if all existing windows are destroyed/crashed
        const aliveWindows = [...windows.values()].filter(
          (w) => !w.isDestroyed() && !w.webContents.isCrashed()
        );
        if (BrowserWindow.getAllWindows().length === 0 || aliveWindows.length === 0) {
          windows.clear();
          readyWindows.clear();
          createWindows();
        }
      });
      app.on("before-quit", () => {
        quitting = true;
        stopClipboardWatcher();
        handoffWatcher?.return?.().catch?.(() => {});
        notificationWatcher?.return?.().catch?.(() => {});
        registeredPopupCardManager?.shutdown?.();
      });
      await handleLaunchArgs(process.argv);
      return {
        serviceBaseUrl: resolvedServiceBaseUrl,
        windows: [...windows.keys()],
        trayReady: Boolean(tray)
      };
    }
  };
}

export async function initializeElectronShellRuntime({
  electron,
  serviceBaseUrl
} = {}) {
  if (!electron?.app) {
    throw new Error("Electron app bindings are required to initialize the shell runtime.");
  }

  if (!electron.app.requestSingleInstanceLock()) {
    electron.app.quit();
    return null;
  }

  const runtime = createElectronShellRuntime({
    electron,
    serviceBaseUrl
  });
  await runtime.start();
  return runtime;
}
