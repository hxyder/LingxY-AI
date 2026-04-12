import path from "node:path";
import { mkdir, readdir, readFile, unlink, watch } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";

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

  if (windowDef.id === "overlay" || windowDef.id === "notification") {
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

  const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, screen, clipboard, session } = electron;
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
    const target = windows.get("notification");
    if (target) {
      const { workArea } = screen.getPrimaryDisplay();
      const [width, height] = target.getSize();
      target.setPosition(
        Math.max(workArea.x, Math.round(workArea.x + workArea.width - width - 18)),
        Math.max(workArea.y, Math.round(workArea.y + workArea.height - height - 18))
      );
      target.setAlwaysOnTop(true, "screen-saver");
      target.showInactive();
      target.moveTop();
      enqueueWindowMessage("notification", IPC_CHANNELS.shellNotificationReceived, payload);
      return { shown: true, delivery: "bottom_toast" };
    }

    if (!Notification?.isSupported?.()) {
      return { shown: false, reason: "unsupported" };
    }

    const notification = new Notification({
      title: payload.title ?? "UCA",
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
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args
    ], { encoding: "utf8", timeout: timeoutMs });
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

  async function captureActiveWindowContext() {
    const activeWindowEnabled = await isRemoteFeatureEnabled("active_window_probe");
    const context = await runCaptureActiveWindowContext({
      runPowerShell: runPowerShellScript,
      clipboardFallback: () => clipboard.readText() ?? "",
      timeoutMs: 3000,
      activeWindowEnabled
    });

    // Keep the clipboard watcher in sync when capture-context.ps1 surfaced
    // selected text. Before UCA-047 this was done inline; the helper now
    // owns the merge but we still have to update this closure's mutable
    // `lastClipboardText` for dock pulse behaviour.
    if (context.selectedText) {
      lastClipboardText = context.selectedText;
    }

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
          // and confused users who just wanted an empty input.
          showWindow("overlay");
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
          return;
        }

        if (shortcut.id === "voice-wake") {
          // Open overlay and immediately start voice input.
          showWindow("overlay");
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
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
          captureActiveWindowContext().then((ctx) => {
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
            const result = JSON.parse(stdout.trim());
            if (result.ok) {
              showWindow("overlay");
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
                targetWindow: "overlay",
                source_app: "uca.screenshot",
                capture_mode: "hotkey_capture",
                file_paths: [screenshotPath]
              });
            } else {
              showWindow("overlay");
            }
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          }).catch(() => {
            showWindow("overlay");
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
        ? `UCA · 今日完成 ${completed} 个任务`
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
          if (isLocal && (permission === "media" || permission === "audioCapture" || permission === "microphone")) {
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
          return isLocal && (permission === "media" || permission === "audioCapture" || permission === "microphone");
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
      app.on("second-instance", (_event, argv) => {
        handleLaunchArgs(argv).catch((error) => {
          safeError("Failed to process second-instance args", error);
        });
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
