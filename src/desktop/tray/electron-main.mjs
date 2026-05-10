import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";
import { createPersistentRuntime } from "../../service/core/persistent-runtime.mjs";
import { createPopupCardManager } from "./popup-card-manager.mjs";
import { BRAND_AUMID, createBrandIconResolver } from "./brand-icons.mjs";
import { createAutoUpdater, DEFAULT_UPDATE_STRATEGY, UPDATE_STRATEGIES } from "./auto-updater.mjs";
import {
  DESKTOP_CONSOLE_ACTOR,
  desktopActorForSender as resolveDesktopActorForSender
} from "./desktop-actor.mjs";
import {
  postDesktopServiceBinary,
  postDesktopServiceBinaryStream,
  postDesktopServiceJson,
  requestDesktopServiceJson
} from "./desktop-service-client.mjs";
import {
  appendDesktopDiagnosticError,
  installDesktopDiagnostics,
  safeError,
  safeWarn
} from "./desktop-diagnostics.mjs";
import { createDesktopSettingsStore } from "./desktop-settings.mjs";
import {
  buildApprovalDecisionBody,
  normalizeApprovalDecisionPayload,
  normalizePlainObject
} from "./desktop-payload-normalizers.mjs";
import {
  buildRendererFileUrl,
  buildWindowUrl,
  PRELOAD_PATH,
  resolveWindowOptions
} from "./desktop-window-config.mjs";
import { createDesktopWindowBounds } from "./desktop-window-bounds.mjs";
import {
  buildOverlayPayloadFromFiles,
  ECHO_DOCK_DROP_VOICE_READY_MS
} from "./desktop-overlay-payloads.mjs";
import { createWindowMessageQueue } from "./desktop-window-messages.mjs";
import {
  desktopScriptPath,
  EXPLORER_HANDOFF_FILE_PATTERN,
  explorerHandoffDir,
  guiSmokeExplorerSourcePath,
  guiSmokeHandoffPath,
  guiSmokeUserDataDir,
  NOTIFICATION_FILE_PATTERN,
  notificationDir as resolveNotificationDir,
  screenshotCapturePath
} from "./desktop-paths.mjs";
import {
  execFileAsync,
  runPowerShellScript
} from "./desktop-powershell.mjs";
import {
  serviceIsHealthy as checkServiceHealth,
  servicePortFromUrl,
  shouldHostEmbeddedService,
  waitForServiceHealth
} from "./desktop-service-runtime.mjs";
import { createDesktopNotificationCenter } from "./desktop-notifications.mjs";
import { createExplorerHandoffWatcher } from "./desktop-handoff-watcher.mjs";
import { createDesktopNotificationWatcher } from "./desktop-notification-watcher.mjs";
import { requestMorningDigestCheck as runMorningDigestCheck } from "./desktop-morning-digest.mjs";
import { isRemoteFeatureEnabled as checkRemoteFeatureEnabled } from "./desktop-remote-features.mjs";
import {
  createDockContextMenuController,
  createInitialTrayMenu
} from "./desktop-dock-menu.mjs";
import { updateDesktopTrayBadge } from "./desktop-tray-badge.mjs";
import { parseDesktopLaunchArgs } from "./desktop-launch-args.mjs";
import {
  createExternalWindowContextMemory,
  looksLikeShellWindowContext
} from "./desktop-external-window-context.mjs";
import { createActiveWindowMemoryPoll } from "./desktop-active-window-memory-poll.mjs";
import { createDesktopClipboardWatcher } from "./desktop-clipboard-watcher.mjs";
import { registerPreviewIpc } from "./ipc/register-preview-ipc.mjs";
import { registerUpdaterIpc } from "./ipc/register-updater-ipc.mjs";
import { registerDiagnosticsIpc } from "./ipc/register-diagnostics-ipc.mjs";
import { registerShellOpenUrlIpc } from "./ipc/register-shell-open-url-ipc.mjs";
import { registerMcpIpc } from "./ipc/register-mcp-ipc.mjs";
import { registerSchedulerIpc } from "./ipc/register-scheduler-ipc.mjs";
import { registerProviderConfigIpc } from "./ipc/register-provider-config-ipc.mjs";
import { registerSkillIpc } from "./ipc/register-skill-ipc.mjs";
import { registerRuntimeConfigIpc } from "./ipc/register-runtime-config-ipc.mjs";
import { registerEmailIpc } from "./ipc/register-email-ipc.mjs";
import { registerNotesProjectIpc } from "./ipc/register-notes-project-ipc.mjs";
import { registerConnectedAccountIpc } from "./ipc/register-connected-account-ipc.mjs";
import { registerShellWindowIpc } from "./ipc/register-shell-window-ipc.mjs";
import { registerAdminIpc } from "./ipc/register-admin-ipc.mjs";
import { registerOfficeIpc } from "./ipc/register-office-ipc.mjs";
import { registerPdfIpc } from "./ipc/register-pdf-ipc.mjs";
import { registerApprovalIpc } from "./ipc/register-approval-ipc.mjs";
import { registerTaskIpc } from "./ipc/register-task-ipc.mjs";
import { registerAudioServiceIpc } from "./ipc/register-audio-service-ipc.mjs";
import { registerShellLocalIpc } from "./ipc/register-shell-local-ipc.mjs";
import { registerPopupCardIpc } from "./ipc/register-popup-card-ipc.mjs";
import {
  captureActiveWindowContext as runCaptureActiveWindowContext,
  buildShellContextPayload
} from "./active-window-context.mjs";

const DOCK_WINDOW_ID = "dock";
const DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT = Date.now();

export function createElectronShellRuntime({
  electron,
  serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310"
} = {}) {
  if (!electron) {
    throw new Error("Electron bindings are required to create the shell runtime.");
  }

  const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, screen, clipboard, session, desktopCapturer, crashReporter, dialog, shell } = electron;
  installDesktopDiagnostics({ app, crashReporter });
  const brandIcons = createBrandIconResolver({ app, nativeImage });
  // Windows taskbar groups by AppUserModelID. Without this call our
  // windows would inherit Electron's default AUMID, which is the
  // root cause of the "blue electron orb" taskbar/title icon R
  // reported even after the SVG/HTML brand mark was switched.
  if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
    app.setAppUserModelId(BRAND_AUMID);
  }
  const windows = new Map();
  const readyWindows = new Set();
  const handoffDir = explorerHandoffDir();
  const handoffFilePattern = EXPLORER_HANDOFF_FILE_PATTERN;
  const notificationDir = resolveNotificationDir();
  const notificationFilePattern = NOTIFICATION_FILE_PATTERN;
  let tray = null;
  let quitting = false;
  let resolvedServiceBaseUrl = serviceBaseUrl;
  let embeddedServiceRuntime = null;
  let noteRecordingState = { active: false };
  let registeredPopupCardManager = null;
  let dockDisplayRepairInstalled = false;
  // UCA-182 Phase 14: dedicated preview BrowserWindow anchored to the
  // right edge of the primary display. Created lazily on first show
  // so apps that never preview a file don't pay the memory cost.
  let previewWindow = null;
  let previewWindowPinned = false;
  const linkBrowserWindows = new Set();
  let openLinkBrowserForSmoke = null;
  let openPreviewWindowForSmoke = null;
  const registeredShortcutHandlers = new Map();
  const {
    clearWindowMessages,
    enqueueWindowMessage,
    flushWindowMessages
  } = createWindowMessageQueue({
    getWindow: (windowId) => windows.get(windowId),
    isWindowReady: (windowId) => readyWindows.has(windowId)
  });

  function desktopActorForSender(sender) {
    return resolveDesktopActorForSender(sender, windows);
  }

  async function serviceIsHealthy() {
    return checkServiceHealth(resolvedServiceBaseUrl);
  }

  async function ensureEmbeddedServiceRuntime() {
    if (await serviceIsHealthy()) return null;
    if (!shouldHostEmbeddedService(resolvedServiceBaseUrl)) return null;
    if (embeddedServiceRuntime) return embeddedServiceRuntime;
    embeddedServiceRuntime = createPersistentRuntime({
      port: servicePortFromUrl(resolvedServiceBaseUrl)
    });
    let listening;
    try {
      listening = await embeddedServiceRuntime.start();
    } catch (error) {
      embeddedServiceRuntime = null;
      if (await waitForServiceHealth(() => resolvedServiceBaseUrl)) return null;
      throw error;
    }
    resolvedServiceBaseUrl = listening.baseUrl ?? resolvedServiceBaseUrl;
    return embeddedServiceRuntime;
  }

  const desktopSettings = createDesktopSettingsStore({
    safeError,
    broadcastSettings: (settings) => {
      for (const browserWindow of windows.values()) {
        if (!browserWindow.webContents?.isDestroyed?.()) {
          browserWindow.webContents.send("uca:shell-settings-changed", settings);
        }
      }
    }
  });
  const {
    loadSettings,
    updateSettings,
    getCachedSettings,
    getWindowPreferences,
    isWindowAlwaysOnTop,
    getWindowSizeLimits,
    persistWindowPreferences
  } = desktopSettings;

  const {
    clampWindowBounds,
    enforceDockWindowInvariants,
    getManagedWindowBounds,
    installDockHudScrollLock,
    lockWindowRendererZoom,
    resolveWindowBounds,
    setManagedWindowBounds
  } = createDesktopWindowBounds({
    screen,
    dockWindowId: DOCK_WINDOW_ID,
    getWindowPreferences,
    getWindowSizeLimits
  });
  const {
    showDockContextMenu
  } = createDockContextMenuController({
    Menu,
    getWindow: (windowId) => windows.get(windowId),
    getServiceBaseUrl: () => resolvedServiceBaseUrl,
    loadSettings,
    updateSettings,
    showWindow,
    quitApp: () => app.quit(),
    safeWarn
  });

  function applyWindowPresentation(windowId, browserWindow) {
    const alwaysOnTop = isWindowAlwaysOnTop(windowId);
    browserWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const {
    rememberExternalWindowContext,
    preferLastExternalWindowContext
  } = createExternalWindowContextMemory();

  // 83.2 — Notification batching.
  //
  // A single user submission can fire 4+ shellNotify calls in quick succession
  // (task_created, inline_result, artifact_ready, success). Before the batch
  // layer each of those became its own top-right card, drowning the screen.
  //
  // Strategy:
  //   - Keep an in-memory buffer keyed by taskId. Each non-error info-style
  //     notification pushes an entry onto the task's buffer and resets a
  //     500ms debounce timer.
  //   - When the timer fires OR a priority notification (error/approval)
  const desktopNotifications = createDesktopNotificationCenter({
    getWindows: () => windows,
    getPopupCardManager: () => registeredPopupCardManager,
    Notification,
    brandIcons,
    safeWarn,
    appendDiagnostic: appendDesktopDiagnosticError
  });
  const {
    showDesktopNotification,
    safeNotify,
    notifyAutoUpdater
  } = desktopNotifications;
  const {
    consumeHandoffFile,
    startHandoffWatcher,
    stopHandoffWatcher
  } = createExplorerHandoffWatcher({
    handoffDir,
    handoffFilePattern,
    showWindow,
    enqueueWindowMessage,
    shellContextReceivedChannel: IPC_CHANNELS.shellContextReceived,
    safeError
  });
  const {
    startNotificationWatcher,
    stopNotificationWatcher
  } = createDesktopNotificationWatcher({
    notificationDir,
    notificationFilePattern,
    showDesktopNotification,
    safeError
  });

  async function handleLaunchArgs(argv = []) {
    const {
      serviceBaseUrl: requestedServiceBaseUrl,
      handoffFile,
      openOverlay
    } = parseDesktopLaunchArgs(argv);
    if (requestedServiceBaseUrl) {
      resolvedServiceBaseUrl = requestedServiceBaseUrl;
    }

    if (handoffFile) {
      await consumeHandoffFile(handoffFile);
      return true;
    }

    if (openOverlay) {
      showWindow("overlay");
      return true;
    }

    return false;
  }

  async function requestMorningDigestCheck() {
    return runMorningDigestCheck({
      serviceBaseUrl: resolvedServiceBaseUrl,
      requestDesktopServiceJson,
      safeWarn
    });
  }

  async function captureActiveWindowContext({
    includeSelection = true,
    allowClipboardFallback = true,
    clipboardBaseline = null
  } = {}) {
    const activeWindowEnabled = await checkRemoteFeatureEnabled({
      serviceBaseUrl: resolvedServiceBaseUrl,
      featureId: "active_window_probe"
    });
    const context = await runCaptureActiveWindowContext({
      runPowerShell: runPowerShellScript,
      clipboardFallback: () => clipboard.readText() ?? "",
      timeoutMs: 3000,
      activeWindowEnabled,
      includeSelection,
      allowClipboardFallback,
      clipboardBaseline
    });

    // Keep the clipboard watcher in sync when capture-context.ps1 surfaced
    // selected text so dock pulse behaviour does not replay stale clipboard
    // contents after an explicit capture.
    if (context.selectedText) {
      setLastClipboardText(context.selectedText);
    }

    rememberExternalWindowContext(context);
    return context;
  }

  const {
    startActiveWindowMemoryPoll
  } = createActiveWindowMemoryPoll({ captureActiveWindowContext });

  let captureInFlight = false; // debounce guard for capture-and-ask hotkey
  const {
    setLastClipboardText,
    startClipboardWatcher,
    stopClipboardWatcher
  } = createDesktopClipboardWatcher({
    clipboard,
    getDockWindow: () => {
      const dock = windows.get("dock");
      return dock && readyWindows.has("dock") ? dock : null;
    },
    shellClipboardChangedChannel: IPC_CHANNELS.shellClipboardChanged
  });

  function createWindows() {
    for (const windowDef of DESKTOP_SHELL_MANIFEST.windows) {
      if (windows.has(windowDef.id)) {
        continue;
      }
      const browserWindow = brandIcons.createBrandedBrowserWindow(BrowserWindow, {
        width: windowDef.width,
        height: windowDef.height,
        show: !windowDef.startsHidden,
        title: windowDef.title,
        ...resolveWindowOptions(windowDef),
        webPreferences: {
          sandbox: false,
          contextIsolation: true,
          preload: PRELOAD_PATH,
          ...(windowDef.locksRendererZoom ? { zoomFactor: 1 } : {})
        }
      });
      const initialBounds = resolveWindowBounds(windowDef, browserWindow);
      setManagedWindowBounds(windowDef.id, browserWindow, initialBounds);
      if (windowDef.id === DOCK_WINDOW_ID) {
        enforceDockWindowInvariants(browserWindow, initialBounds);
        persistWindowPreferences(DOCK_WINDOW_ID, { bounds: getManagedWindowBounds(DOCK_WINDOW_ID, browserWindow) });
      }
      lockWindowRendererZoom(windowDef, browserWindow);
      applyWindowPresentation(windowDef.id, browserWindow);
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
          safeError(`[LingxY] Window "${windowDef.id}" failed to load: ${errorDescription} (${errorCode})`);
        }
      });
      browserWindow.loadURL(buildWindowUrl(windowDef, resolvedServiceBaseUrl));
      windows.set(windowDef.id, browserWindow);
    }
  }

  function repairDockWindowForDisplayChange(reason = "display") {
    const dock = windows.get(DOCK_WINDOW_ID);
    if (!dock || dock.isDestroyed?.()) return;
    const nextBounds = enforceDockWindowInvariants(dock);
    if (nextBounds) {
      safeWarn(`[LingxY] repaired dock HUD bounds after ${reason}`);
      persistWindowPreferences(DOCK_WINDOW_ID, { bounds: nextBounds });
    }
  }

  function installDockDisplayRepair() {
    if (dockDisplayRepairInstalled) return;
    dockDisplayRepairInstalled = true;
    screen.on("display-metrics-changed", () => repairDockWindowForDisplayChange("display-metrics-changed"));
    screen.on("display-added", () => repairDockWindowForDisplayChange("display-added"));
    screen.on("display-removed", () => repairDockWindowForDisplayChange("display-removed"));
  }

  function showWindow(windowId) {
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
    target.show();
    try { target.moveTop(); } catch { /* ignore */ }
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

  function openOverlayVoice(payload = {}) {
    const mode = payload?.mode === "note" ? "note" : "voice";
    const shortcutId = mode === "note" ? "note-wake" : "voice-wake";
    const shown = showWindow("overlay");
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

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      const shortcutHandler = () => {
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
          captureActiveWindowContext({
            allowClipboardFallback: false,
            clipboardBaseline: hotKeyClipboardSnapshot
          }).then((ctx) => {
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

            const hasFiles = ctx.filePaths.length > 0;
            const hasText = Boolean(ctx.selectedText);
            const hasActiveWindow = Boolean(ctx.activeWindow && !ctx.activeWindow.blocked);

            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }

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
          const screenshotScriptPath = desktopScriptPath("capture-screenshot.ps1");
          const screenshotPath = screenshotCapturePath();

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
          // R-feedback 2026-05-07: shortcut was registered in
          // manifest.mjs but no handler — accelerator did nothing.
          // Toggle via the runtime config endpoint so other surfaces
          // (Console security panel, broker) stay in sync. Best-effort
          // — failure logs to diagnostics, doesn't bubble.
          (async () => {
            try {
              const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
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
      registeredShortcutHandlers.set(shortcut.id, shortcutHandler);
      const registered = globalShortcut.register(shortcut.accelerator, shortcutHandler);
      if (!registered) {
        safeError(`[LingxY] Failed to register shortcut ${shortcut.id} (${shortcut.accelerator}). It may be used by another app.`);
      }
    }
  }

  function createTray() {
    tray = new Tray(brandIcons.composeTrayIcon({ count: 0, size: 32 }));
    tray.setToolTip(DESKTOP_SHELL_MANIFEST.trayTooltip);
    tray.setContextMenu(createInitialTrayMenu({
      Menu,
      showWindow,
      quitApp: () => app.quit()
    }));
  }

  // C18 #B5 round-3: tray icon now goes through brandIcons.composeTrayIcon
  // (canonical PNG base + optional count badge). The legacy indigo
  // radial-gradient "orb" was a UCA-069-era placeholder that survived
  // round-2's SVG-domain refresh — round-3 closes the native domain.
  async function updateTrayBadge() {
    return updateDesktopTrayBadge({
      tray,
      serviceBaseUrl: resolvedServiceBaseUrl,
      brandIcons,
      trayTooltip: DESKTOP_SHELL_MANIFEST.trayTooltip
    });
  }

  function writeDesktopGuiSmokeResult(result) {
    try {
      process.stdout?.write?.(`LINGXY_GUI_SMOKE_RESULT ${JSON.stringify(result)}\n`);
    } catch { /* ignore broken pipes */ }
  }

  async function waitForDesktopGuiSmoke(predicate, timeoutMs = 5000, intervalMs = 80) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return true;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    if (lastError) throw lastError;
    return false;
  }

  async function runDesktopGuiSmoke() {
    const checks = [];
    const pass = (name, extra = {}) => checks.push({ name, ok: true, ...extra });
    const smokeRunStartedAt = Date.now();
    let firstWindowReadyMs = null;
    const buildPerfReport = () => {
      const completedAt = Date.now();
      return {
        process_started_at: new Date(DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT).toISOString(),
        smoke_started_at: new Date(smokeRunStartedAt).toISOString(),
        smoke_completed_at: new Date(completedAt).toISOString(),
        startup_ms: firstWindowReadyMs ?? Math.max(0, smokeRunStartedAt - DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT),
        first_window_ready_ms: firstWindowReadyMs ?? Math.max(0, smokeRunStartedAt - DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT),
        interaction_ms: Math.max(0, completedAt - smokeRunStartedAt),
        total_ms: Math.max(0, completedAt - DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT),
        check_count: checks.length
      };
    };
    try {
      showWindow("overlay");
      const overlayWindow = windows.get("overlay");
      if (!overlayWindow || overlayWindow.isDestroyed?.()) {
        throw new Error("overlay_window_missing");
      }
      const overlayVisible = await waitForDesktopGuiSmoke(() => overlayWindow.isVisible?.() === true, 5000);
      if (!overlayVisible) throw new Error("overlay_window_not_visible");
      firstWindowReadyMs = Math.max(0, Date.now() - DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT);
      pass("overlay_visible");

      const overlaySmokeHookReady = await waitForDesktopGuiSmoke(async () => {
        if (overlayWindow.isDestroyed?.()) return false;
        return overlayWindow.webContents.executeJavaScript(
          'typeof window.__lingxyOverlaySmoke?.getShortcutReceipts === "function"',
          true
        );
      }, 5000);
      if (!overlaySmokeHookReady) throw new Error("overlay_smoke_hook_not_ready");

      const shortcutIds = DESKTOP_SHELL_MANIFEST.shortcuts.map((shortcut) => shortcut.id);
      const missingShortcutHandlers = shortcutIds.filter((id) => typeof registeredShortcutHandlers.get(id) !== "function");
      if (missingShortcutHandlers.length > 0) {
        throw new Error(`global_shortcut_handlers_missing:${missingShortcutHandlers.join(",")}`);
      }
      pass("global_shortcut_handlers_installed", { count: shortcutIds.length });

      const registeredAccelerators = DESKTOP_SHELL_MANIFEST.shortcuts
        .filter((shortcut) => globalShortcut.isRegistered?.(shortcut.accelerator))
        .map((shortcut) => shortcut.id);
      pass("global_shortcuts_registration_observed", {
        registered: registeredAccelerators.length,
        total: shortcutIds.length
      });

      registeredShortcutHandlers.get("toggle-overlay")?.();
      const toggleOverlayReceipt = await waitForDesktopGuiSmoke(async () => {
        const receipts = await overlayWindow.webContents.executeJavaScript(
          'window.__lingxyOverlaySmoke?.getShortcutReceipts?.() ?? []',
          true
        );
        return Array.isArray(receipts) && receipts.some((entry) => entry.shortcutId === "toggle-overlay");
      }, 5000);
      if (!toggleOverlayReceipt) throw new Error("global_shortcut_toggle_overlay_not_received");
      pass("global_shortcut_toggle_overlay");

      const explorerSmokePath = guiSmokeExplorerSourcePath();
      const explorerHandoffPath = guiSmokeHandoffPath(handoffDir);
      await mkdir(handoffDir, { recursive: true });
      await writeFile(explorerHandoffPath, JSON.stringify({
        source_app: "explorer.exe",
        capture_mode: "shell_menu",
        file_paths: [explorerSmokePath]
      }), "utf8");
      let explorerHandoffState = null;
      const explorerHandoffVisible = await waitForDesktopGuiSmoke(async () => {
        explorerHandoffState = await overlayWindow.webContents.executeJavaScript(
          'window.__lingxyOverlaySmoke?.getPendingFileSelection?.() ?? null',
          true
        );
        return Array.isArray(explorerHandoffState?.filePaths)
          && explorerHandoffState.filePaths.includes(explorerSmokePath)
          && Array.isArray(explorerHandoffState?.openablePaths)
          && explorerHandoffState.openablePaths.includes(explorerSmokePath);
      }, 7000);
      if (!explorerHandoffVisible) throw new Error("explorer_handoff_file_context_missing");
      pass("explorer_handoff_file_context", {
        captureMode: explorerHandoffState?.captureMode,
        fileCount: explorerHandoffState?.filePaths?.length ?? 0
      });
      pass("explorer_handoff_file_openable");

      const voiceMediaRecorderPath = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runVoiceMediaRecorderPath?.({ chunks: 2 })',
        true
      );
      if (!voiceMediaRecorderPath?.ok) {
        throw new Error("overlay_voice_mediarecorder_path_failed");
      }
      pass("overlay_voice_mediarecorder_path", {
        chunks: voiceMediaRecorderPath.chunkCount,
        mimeType: voiceMediaRecorderPath.mimeType,
        timeslice: voiceMediaRecorderPath.startTimeslice
      });

      const noteMicMediaRecorderPath = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runNoteMicMediaRecorderPath?.({ chunks: 2 })',
        true
      );
      if (!noteMicMediaRecorderPath?.ok) {
        throw new Error("overlay_note_mic_mediarecorder_path_failed");
      }
      pass("overlay_note_mic_mediarecorder_path", {
        chunks: noteMicMediaRecorderPath.chunkCount,
        mimeType: noteMicMediaRecorderPath.mimeType,
        timeslice: noteMicMediaRecorderPath.startTimeslice
      });

      const cancelBridgeReady = await waitForDesktopGuiSmoke(async () => {
        if (overlayWindow.isDestroyed?.()) return false;
        return overlayWindow.webContents.executeJavaScript(
          'typeof window.ucaShell?.cancelTask === "function"',
          true
        );
      }, 5000);
      if (!cancelBridgeReady) throw new Error("task_cancel_bridge_missing");
      const cancelResult = await overlayWindow.webContents.executeJavaScript(
        'window.ucaShell.cancelTask("gui-smoke-cancel", { force: true })',
        true
      );
      if (cancelResult?.task?.status !== "cancelled" || cancelResult?.task?.force !== true) {
        throw new Error("task_cancel_ipc_bridge_failed");
      }
      pass("task_cancel_ipc_bridge", {
        status: cancelResult.task.status,
        force: cancelResult.task.force
      });

      const stopButtonCancel = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runStopButtonCancel?.({ taskId: "gui-smoke-stop-button" })',
        true
      );
      if (!stopButtonCancel?.ok) {
        throw new Error("overlay_stop_button_cancel_failed");
      }
      pass("overlay_stop_button_cancel", {
        beforeLabel: stopButtonCancel.beforeLabel,
        afterLabel: stopButtonCancel.afterLabel
      });

      const overlayInlineRetry = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runInlineErrorRetry?.({ taskId: "gui-smoke-overlay-inline-retry" })',
        true
      );
      if (!overlayInlineRetry?.ok) {
        throw new Error("overlay_inline_error_retry_failed");
      }
      pass("overlay_inline_error_retry", {
        beforeLabel: overlayInlineRetry.beforeLabel,
        afterLabel: overlayInlineRetry.afterLabel
      });

      const overlayLlmUsageTimeline = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runLlmUsageTimeline?.({ taskId: "gui-smoke-overlay-llm-usage" })',
        true
      );
      if (!overlayLlmUsageTimeline?.ok) {
        throw new Error("overlay_llm_usage_timeline_failed");
      }
      pass("overlay_llm_usage_timeline");

      const streamLoad = await overlayWindow.webContents.executeJavaScript(
        'window.__lingxyOverlaySmoke?.runTextDeltaLoad?.({ chunks: 1200, chunkText: "x", taskId: "gui-smoke-stream" })',
        true
      );
      if (!streamLoad?.ok) {
        throw new Error("overlay_stream_delta_load_failed");
      }
      if (Number(streamLoad.duration_ms) > 3000) {
        throw new Error(`overlay_stream_delta_load_slow:${streamLoad.duration_ms}`);
      }
      if (Number(streamLoad.streaming_bubbles) !== 1) {
        throw new Error(`overlay_stream_delta_load_uncoalesced:${streamLoad.streaming_bubbles}`);
      }
      pass("overlay_stream_delta_load", {
        chunks: streamLoad.chunks,
        rendered_chars: streamLoad.rendered_chars,
        duration_ms: streamLoad.duration_ms
      });

      registeredShortcutHandlers.get("open-console")?.();
      const consoleWindow = windows.get("console");
      if (!consoleWindow || consoleWindow.isDestroyed?.()) {
        throw new Error("console_window_missing");
      }
      const consoleVisible = await waitForDesktopGuiSmoke(() => consoleWindow.isVisible?.() === true, 5000);
      if (!consoleVisible) throw new Error("console_window_not_visible");
      pass("global_shortcut_open_console");
      const consoleStreamLoad = await waitForDesktopGuiSmoke(async () => {
        if (consoleWindow.isDestroyed?.()) return false;
        const result = await consoleWindow.webContents.executeJavaScript(
          'window.__lingxyConsoleSmoke?.runTextDeltaLoad?.({ chunks: 1200, chunkText: "x", taskId: "gui-smoke-console-stream" })',
          true
        );
        if (!result?.ok) return false;
        if (Number(result.duration_ms) > 3000) {
          throw new Error(`console_stream_delta_load_slow:${result.duration_ms}`);
        }
        if (Number(result.streaming_bubbles) !== 1) {
          throw new Error(`console_stream_delta_load_uncoalesced:${result.streaming_bubbles}`);
        }
        pass("console_stream_delta_load", {
          chunks: result.chunks,
          rendered_chars: result.rendered_chars,
          duration_ms: result.duration_ms
        });
        return true;
      }, 5000);
      if (!consoleStreamLoad) throw new Error("console_stream_delta_load_failed");

      const consoleStopButtonCancel = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runStopButtonCancel?.({ taskId: "gui-smoke-console-stop-button" })',
        true
      );
      if (!consoleStopButtonCancel?.ok) {
        throw new Error("console_stop_button_cancel_failed");
      }
      pass("console_stop_button_cancel", {
        beforeLabel: consoleStopButtonCancel.beforeLabel,
        afterLabel: consoleStopButtonCancel.afterLabel
      });

      const consoleConversationIsolation = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runConversationIsolation?.({ taskId: "gui-smoke-console-isolated-task" })',
        true
      );
      if (!consoleConversationIsolation?.ok) {
        throw new Error("console_conversation_isolation_failed");
      }
      pass("console_conversation_isolation", {
        taskId: consoleConversationIsolation.taskId,
        leaked: consoleConversationIsolation.leaked,
        sendButtonText: consoleConversationIsolation.sendButtonText
      });

      const consoleTaskDetailCancel = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runTaskDetailCancel?.({ taskId: "gui-smoke-console-detail-cancel" })',
        true
      );
      if (!consoleTaskDetailCancel?.ok) {
        throw new Error("console_task_detail_cancel_failed");
      }
      pass("console_task_detail_cancel", {
        label: consoleTaskDetailCancel.label
      });

      const consoleInlineRetry = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runInlineErrorRetry?.({ taskId: "gui-smoke-console-inline-retry" })',
        true
      );
      if (!consoleInlineRetry?.ok) {
        throw new Error("console_inline_error_retry_failed");
      }
      pass("console_inline_error_retry", {
        beforeLabel: consoleInlineRetry.beforeLabel,
        afterLabel: consoleInlineRetry.afterLabel
      });

      const consoleChatBranchFork = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runConversationBranchControls?.({ conversationId: "gui-smoke-conv" })',
        true
      );
      if (!consoleChatBranchFork?.ok) {
        throw new Error(`console_chat_branch_fork_failed:${consoleChatBranchFork?.reason ?? "unknown"}`);
      }
      pass("console_chat_branch_fork", {
        beforeConversationId: consoleChatBranchFork.beforeConversationId,
        afterConversationId: consoleChatBranchFork.afterConversationId,
        branchActions: consoleChatBranchFork.afterActionCount
      });

      const consoleChatBranchRewind = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runConversationBranchControls?.({ conversationId: "gui-smoke-conv", mode: "rewind" })',
        true
      );
      if (!consoleChatBranchRewind?.ok) {
        throw new Error(`console_chat_branch_rewind_failed:${consoleChatBranchRewind?.reason ?? "unknown"}`);
      }
      pass("console_chat_branch_rewind", {
        beforeConversationId: consoleChatBranchRewind.beforeConversationId,
        afterConversationId: consoleChatBranchRewind.afterConversationId,
        branchActions: consoleChatBranchRewind.afterActionCount
      });

      const consoleChatBranchEdit = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runConversationBranchControls?.({ conversationId: "gui-smoke-conv", mode: "edit", editContent: "GUI smoke edited branch message" })',
        true
      );
      if (!consoleChatBranchEdit?.ok) {
        throw new Error(`console_chat_branch_edit_failed:${consoleChatBranchEdit?.reason ?? "unknown"}`);
      }
      pass("console_chat_branch_edit", {
        beforeConversationId: consoleChatBranchEdit.beforeConversationId,
        afterConversationId: consoleChatBranchEdit.afterConversationId,
        branchActions: consoleChatBranchEdit.afterActionCount,
        editedVisible: consoleChatBranchEdit.editedVisible
      });

      if (typeof openPreviewWindowForSmoke !== "function") {
        throw new Error("preview_window_smoke_hook_missing");
      }
      const previewWin = openPreviewWindowForSmoke({
        toolName: "write_file",
        args: { path: "gui-smoke-preview.txt" },
        taskId: "gui-smoke-preview-stream"
      });
      const previewVisible = await waitForDesktopGuiSmoke(() =>
        previewWin && !previewWin.isDestroyed?.() && previewWin.isVisible?.() === true,
      5000);
      if (!previewVisible) throw new Error("preview_window_not_visible");
      const previewStreamLoad = await waitForDesktopGuiSmoke(async () => {
        if (previewWin.isDestroyed?.()) return false;
        const result = await previewWin.webContents.executeJavaScript(
          'window.__lingxyPreviewSmoke?.runToolInputDeltaLoad?.({ chunks: 1200, chunkText: "x", taskId: "gui-smoke-preview-stream" })',
          true
        );
        if (!result?.ok) return false;
        if (Number(result.duration_ms) > 5000) {
          throw new Error(`preview_tool_input_delta_load_slow:${result.duration_ms}`);
        }
        pass("preview_tool_input_delta_load", {
          chunks: result.chunks,
          rendered_chars: result.rendered_chars,
          duration_ms: result.duration_ms
        });
        return true;
      }, 7000);
      if (!previewStreamLoad) throw new Error("preview_tool_input_delta_load_failed");
      const previewInitialDraft = await waitForDesktopGuiSmoke(async () => {
        if (previewWin.isDestroyed?.()) return false;
        const result = await previewWin.webContents.executeJavaScript(
          'window.__lingxyPreviewSmoke?.runGenerateDocumentInitialDraftPreview?.({ taskId: "gui-smoke-doc-draft" })',
          true
        );
        if (!result?.ok) return false;
        pass("preview_generate_document_initial_draft", {
          status: result.status,
          title: result.title
        });
        return true;
      }, 5000);
      if (!previewInitialDraft) throw new Error("preview_generate_document_initial_draft_failed");
      const previewDraftFamilyMatrix = await waitForDesktopGuiSmoke(async () => {
        if (previewWin.isDestroyed?.()) return false;
        const result = await previewWin.webContents.executeJavaScript(
          'window.__lingxyPreviewSmoke?.runGenerateDocumentDraftFamilyMatrix?.({ taskId: "gui-smoke-doc-family" })',
          true
        );
        if (!result?.ok) return false;
        pass("preview_generate_document_draft_family_matrix", {
          kinds: (result.results ?? []).map((item) => item.kind).join(",")
        });
        return true;
      }, 8000);
      if (!previewDraftFamilyMatrix) throw new Error("preview_generate_document_draft_family_matrix_failed");
      const previewTaskBinding = await waitForDesktopGuiSmoke(async () => {
        if (previewWin.isDestroyed?.()) return false;
        const result = await previewWin.webContents.executeJavaScript(
          'window.__lingxyPreviewSmoke?.runTaskBindingIsolation?.({ taskId: "gui-smoke-session-a", otherTaskId: "gui-smoke-session-b" })',
          true
        );
        if (!result?.ok) return false;
        pass("preview_task_binding_isolation", {
          taskId: result.taskId,
          foreignDeltaIgnored: result.foreign_delta_ignored,
          foreignCommitIgnored: result.foreign_commit_ignored
        });
        return true;
      }, 5000);
      if (!previewTaskBinding) throw new Error("preview_task_binding_isolation_failed");

      const beforeCount = linkBrowserWindows.size;
      const smokeUrl = "data:text/html;charset=utf-8," + encodeURIComponent(`
        <!doctype html>
        <html>
          <head><title>LingxY GUI Smoke Link</title></head>
          <body><main><h1>LingxY GUI Smoke Link</h1></main></body>
        </html>
      `);
      if (typeof openLinkBrowserForSmoke !== "function") {
        throw new Error("link_browser_smoke_hook_missing");
      }
      openLinkBrowserForSmoke(smokeUrl);
      const linkWindowReady = await waitForDesktopGuiSmoke(() => linkBrowserWindows.size > beforeCount, 5000);
      if (!linkWindowReady) throw new Error("link_browser_window_not_created");
      const linkWindow = [...linkBrowserWindows].find((candidate) => !candidate.isDestroyed?.());
      if (!linkWindow) throw new Error("link_browser_window_missing");
      pass("link_browser_created", {
        closable: typeof linkWindow.isClosable === "function" ? linkWindow.isClosable() : true
      });

      const closeControlInjected = await waitForDesktopGuiSmoke(async () => {
        if (linkWindow.isDestroyed?.()) return false;
        return linkWindow.webContents.executeJavaScript(
          'Boolean(document.getElementById("lingxy-link-browser-close-host"))',
          true
        );
      }, 5000);
      if (!closeControlInjected) throw new Error("link_browser_close_control_missing");
      pass("link_browser_close_control_injected");

      await linkWindow.webContents.executeJavaScript(
        'window.location.href = "lingxy://close-link-browser"; true',
        true
      );
      const closed = await waitForDesktopGuiSmoke(() => linkWindow.isDestroyed?.() === true, 5000);
      if (!closed) throw new Error("link_browser_close_navigation_failed");
      pass("link_browser_close_navigation");

      const scheduledNotice = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runScheduleCompletionNotice?.({ taskId: "gui-smoke-scheduled-artifact" })',
        true
      );
      if (!scheduledNotice?.ok) {
        throw new Error("popup_scheduled_artifact_notice_failed");
      }
      let scheduledPopupWindow = null;
      let scheduledPopupSnapshot = null;
      const scheduledPopupReady = await waitForDesktopGuiSmoke(async () => {
        for (const candidate of BrowserWindow.getAllWindows()) {
          if (candidate.isDestroyed?.()) continue;
          const url = candidate.webContents?.getURL?.() ?? "";
          if (!url.includes("popup-card")) continue;
          const snapshot = await candidate.webContents.executeJavaScript(`(() => {
            const labels = [...document.querySelectorAll("#pc-actions button")]
              .map((button) => (button.textContent || "").trim())
              .filter(Boolean);
            return {
              showing: Boolean(document.getElementById("pc-card")?.classList.contains("show")),
              kind: document.getElementById("pc-card")?.getAttribute("data-kind") || "",
              title: document.getElementById("pc-title")?.textContent || "",
              body: document.getElementById("pc-body")?.textContent || "",
              labels,
              hasPreview: labels.includes("预览"),
              hasReveal: labels.includes("打开文件夹"),
              hasCopy: labels.includes("复制"),
              hasContinue: labels.includes("继续追问")
            };
          })()`, true).catch(() => null);
          if (!snapshot?.body?.includes("GUI Smoke Scheduled Artifact")) continue;
          scheduledPopupWindow = candidate;
          scheduledPopupSnapshot = snapshot;
          return snapshot.showing
            && snapshot.kind === "success"
            && snapshot.hasPreview
            && snapshot.hasReveal
            && snapshot.hasCopy
            && snapshot.hasContinue;
        }
        return false;
      }, 5000);
      if (!scheduledPopupReady) {
        throw new Error("popup_scheduled_artifact_card_missing");
      }
      pass("popup_scheduled_artifact_card_visible", {
        title: scheduledPopupSnapshot.title,
        kind: scheduledPopupSnapshot.kind
      });
      pass("popup_scheduled_artifact_card_controls", {
        labels: scheduledPopupSnapshot.labels
      });
      await scheduledPopupWindow.webContents.executeJavaScript(
        'document.getElementById("pc-close")?.click(); true',
        true
      );
      const scheduledPopupClosed = await waitForDesktopGuiSmoke(
        () => scheduledPopupWindow?.isDestroyed?.() === true,
        5000
      );
      if (!scheduledPopupClosed) throw new Error("popup_scheduled_artifact_card_close_failed");
      pass("popup_scheduled_artifact_card_close");

      const scheduledPlainNotice = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runScheduleCompletionNotice?.({ taskId: "gui-smoke-scheduled-plain", artifactPath: null, summary: "GUI Smoke Scheduled Plain Result", artifacts: [] })',
        true
      );
      if (!scheduledPlainNotice?.ok) {
        throw new Error("popup_scheduled_plain_notice_failed");
      }
      let scheduledPlainPopupWindow = null;
      let scheduledPlainSnapshot = null;
      const scheduledPlainPopupReady = await waitForDesktopGuiSmoke(async () => {
        for (const candidate of BrowserWindow.getAllWindows()) {
          if (candidate.isDestroyed?.()) continue;
          const url = candidate.webContents?.getURL?.() ?? "";
          if (!url.includes("popup-card")) continue;
          const snapshot = await candidate.webContents.executeJavaScript(`(() => {
            const labels = [...document.querySelectorAll("#pc-actions button")]
              .map((button) => (button.textContent || "").trim())
              .filter(Boolean);
            return {
              showing: Boolean(document.getElementById("pc-card")?.classList.contains("show")),
              kind: document.getElementById("pc-card")?.getAttribute("data-kind") || "",
              title: document.getElementById("pc-title")?.textContent || "",
              body: document.getElementById("pc-body")?.textContent || "",
              labels,
              hasDetail: labels.includes("查看详情"),
              hasContinue: labels.includes("继续追问")
            };
          })()`, true).catch(() => null);
          if (!snapshot?.body?.includes("GUI Smoke Scheduled Plain Result")) continue;
          scheduledPlainPopupWindow = candidate;
          scheduledPlainSnapshot = snapshot;
          return snapshot.showing
            && snapshot.kind === "success"
            && snapshot.hasDetail
            && snapshot.hasContinue;
        }
        return false;
      }, 5000);
      if (!scheduledPlainPopupReady) {
        throw new Error("popup_scheduled_plain_card_missing");
      }
      pass("popup_scheduled_plain_card_visible", {
        title: scheduledPlainSnapshot.title,
        kind: scheduledPlainSnapshot.kind
      });
      pass("popup_scheduled_plain_card_controls", {
        labels: scheduledPlainSnapshot.labels
      });
      await scheduledPlainPopupWindow.webContents.executeJavaScript(
        'document.getElementById("pc-close")?.click(); true',
        true
      );
      const scheduledPlainPopupClosed = await waitForDesktopGuiSmoke(
        () => scheduledPlainPopupWindow?.isDestroyed?.() === true,
        5000
      );
      if (!scheduledPlainPopupClosed) throw new Error("popup_scheduled_plain_card_close_failed");
      pass("popup_scheduled_plain_card_close");

      const scheduledFailureNotice = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runScheduleCompletionNotice?.({ taskId: "gui-smoke-scheduled-failed", artifactPath: null, status: "failed", summary: "GUI Smoke Scheduled Failure", artifacts: [] })',
        true
      );
      if (!scheduledFailureNotice?.ok) {
        throw new Error("popup_scheduled_failure_notice_failed");
      }
      let scheduledFailurePopupWindow = null;
      let scheduledFailureSnapshot = null;
      const scheduledFailurePopupReady = await waitForDesktopGuiSmoke(async () => {
        for (const candidate of BrowserWindow.getAllWindows()) {
          if (candidate.isDestroyed?.()) continue;
          const url = candidate.webContents?.getURL?.() ?? "";
          if (!url.includes("popup-card")) continue;
          const snapshot = await candidate.webContents.executeJavaScript(`(() => {
            const labels = [...document.querySelectorAll("#pc-actions button")]
              .map((button) => (button.textContent || "").trim())
              .filter(Boolean);
            return {
              showing: Boolean(document.getElementById("pc-card")?.classList.contains("show")),
              kind: document.getElementById("pc-card")?.getAttribute("data-kind") || "",
              title: document.getElementById("pc-title")?.textContent || "",
              body: document.getElementById("pc-body")?.textContent || "",
              labels,
              hasLog: labels.includes("查看日志"),
              hasDetail: labels.includes("查看详情"),
              hasClose: labels.includes("关闭")
            };
          })()`, true).catch(() => null);
          if (!snapshot?.body?.includes("GUI Smoke Scheduled Failure")) continue;
          scheduledFailurePopupWindow = candidate;
          scheduledFailureSnapshot = snapshot;
          return snapshot.showing
            && snapshot.kind === "error"
            && snapshot.hasLog
            && snapshot.hasDetail
            && snapshot.hasClose;
        }
        return false;
      }, 5000);
      if (!scheduledFailurePopupReady) {
        throw new Error("popup_scheduled_failure_card_missing");
      }
      pass("popup_scheduled_failure_card_visible", {
        title: scheduledFailureSnapshot.title,
        kind: scheduledFailureSnapshot.kind
      });
      pass("popup_scheduled_failure_card_controls", {
        labels: scheduledFailureSnapshot.labels
      });
      await scheduledFailurePopupWindow.webContents.executeJavaScript(
        'document.getElementById("pc-close")?.click(); true',
        true
      );
      const scheduledFailurePopupClosed = await waitForDesktopGuiSmoke(
        () => scheduledFailurePopupWindow?.isDestroyed?.() === true,
        5000
      );
      if (!scheduledFailurePopupClosed) throw new Error("popup_scheduled_failure_card_close_failed");
      pass("popup_scheduled_failure_card_close");

      await notifyAutoUpdater({
        kind: "update-available",
        payload: {
          info: {
            version: "9.9.9-gui-smoke",
            releaseDate: "2026-05-08T00:00:00.000Z"
          },
          autoDownload: false
        }
      });
      let updaterPopupWindow = null;
      let updaterPopupSnapshot = null;
      const updaterPopupReady = await waitForDesktopGuiSmoke(async () => {
        for (const candidate of BrowserWindow.getAllWindows()) {
          if (candidate.isDestroyed?.()) continue;
          const url = candidate.webContents?.getURL?.() ?? "";
          if (!url.includes("popup-card")) continue;
          const snapshot = await candidate.webContents.executeJavaScript(`(() => {
            const labels = [...document.querySelectorAll("#pc-actions button")]
              .map((button) => (button.textContent || "").trim())
              .filter(Boolean);
            return {
              showing: Boolean(document.getElementById("pc-card")?.classList.contains("show")),
              kind: document.getElementById("pc-card")?.getAttribute("data-kind") || "",
              title: document.getElementById("pc-title")?.textContent || "",
              body: document.getElementById("pc-body")?.textContent || "",
              labels,
              hasSettings: labels.includes("打开设置"),
              hasClose: labels.includes("关闭")
            };
          })()`, true).catch(() => null);
          if (!snapshot?.body?.includes("9.9.9-gui-smoke")) continue;
          updaterPopupWindow = candidate;
          updaterPopupSnapshot = snapshot;
          return snapshot.showing
            && snapshot.kind === "info"
            && snapshot.hasSettings
            && snapshot.hasClose;
        }
        return false;
      }, 5000);
      if (!updaterPopupReady) {
        throw new Error("popup_updater_available_card_missing");
      }
      pass("popup_updater_available_card_visible", {
        title: updaterPopupSnapshot.title,
        kind: updaterPopupSnapshot.kind
      });
      pass("popup_updater_available_card_controls", {
        labels: updaterPopupSnapshot.labels
      });
      await updaterPopupWindow.webContents.executeJavaScript(
        'document.getElementById("pc-close")?.click(); true',
        true
      );
      const updaterPopupClosed = await waitForDesktopGuiSmoke(
        () => updaterPopupWindow?.isDestroyed?.() === true,
        5000
      );
      if (!updaterPopupClosed) throw new Error("popup_updater_available_card_close_failed");
      pass("popup_updater_available_card_close");

      if (!registeredPopupCardManager?.showCard) {
        throw new Error("popup_card_manager_missing");
      }
      const approvalCard = registeredPopupCardManager.showCard({
        kind: "approval",
        title: "GUI Smoke Approval",
        lines: [
          "This approval card is rendered by the real popup-card window.",
          "The smoke verifies visible controls and close behavior without calling the service approval API."
        ],
        taskId: "gui-smoke-task",
        conversationId: "gui-smoke-conversation",
        openWindow: "overlay",
        autoHideMs: 0,
        dedupeKey: `gui-smoke-approval-${Date.now()}`
      });
      if (!approvalCard?.accepted || !approvalCard.cardId) {
        throw new Error("popup_approval_card_not_accepted");
      }
      const findPopupWindow = () => BrowserWindow.getAllWindows().find((candidate) =>
        !candidate.isDestroyed?.()
        && (candidate.webContents?.getURL?.() ?? "").includes(`cardId=${approvalCard.cardId}`)
      );
      const popupWindowReady = await waitForDesktopGuiSmoke(() => {
        return findPopupWindow()?.isVisible?.() === true;
      }, 5000);
      if (!popupWindowReady) throw new Error("popup_approval_card_not_visible");
      const popupWindow = findPopupWindow();
      if (!popupWindow) throw new Error("popup_approval_window_missing");
      pass("popup_approval_card_visible");

      let popupControls = null;
      const popupControlsReady = await waitForDesktopGuiSmoke(async () => {
        if (popupWindow.isDestroyed?.()) return false;
        popupControls = await popupWindow.webContents.executeJavaScript(`(() => {
          const labels = [...document.querySelectorAll("#pc-actions button")]
            .map((button) => (button.textContent || "").trim())
            .filter(Boolean);
          return {
            showing: Boolean(document.getElementById("pc-card")?.classList.contains("show")),
            hasClose: Boolean(document.getElementById("pc-close")),
            hasReject: labels.includes("拒绝"),
            hasApprove: labels.includes("通过"),
            hasDetail: labels.includes("打开对话框") || labels.includes("查看详情"),
            labels
          };
        })()`, true);
        return popupControls?.showing
          && popupControls?.hasClose
          && popupControls?.hasReject
          && popupControls?.hasApprove
          && popupControls?.hasDetail;
      }, 5000);
      if (!popupControlsReady) {
        throw new Error("popup_approval_card_controls_missing");
      }
      pass("popup_approval_card_controls", { labels: popupControls.labels });

      await popupWindow.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll("#pc-actions button")).find((button) => button.textContent.trim() === "拒绝")?.click(); true',
        true
      );
      const popupClosed = await waitForDesktopGuiSmoke(() => popupWindow.isDestroyed?.() === true, 5000);
      if (!popupClosed) throw new Error("popup_approval_card_reject_did_not_close");
      pass("popup_approval_card_reject_closes");

      writeDesktopGuiSmokeResult({ ok: true, checks, perf: buildPerfReport() });
      app.quit();
    } catch (error) {
      writeDesktopGuiSmokeResult({
        ok: false,
        error: error?.message ?? String(error),
        checks,
        perf: buildPerfReport()
      });
      app.exit(1);
    }
  }

  return {
    async start() {
      await app.whenReady();
      await brandIcons.initialize();
      try {
        await ensureEmbeddedServiceRuntime();
      } catch (error) {
        safeError("[LingxY] failed to start local runtime service:", error?.message ?? error);
        void appendDesktopDiagnosticError("embedded_runtime_start_failed", error, {
          serviceBaseUrl: resolvedServiceBaseUrl
        });
      }

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

      await loadSettings();
      registerShellLocalIpc({
        ipcMain,
        IPC_CHANNELS,
        BrowserWindow,
        desktopCapturer,
        screen,
        globalShortcut,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        requestDesktopServiceJson,
        loadSettings,
        updateSettings,
        getNoteRecordingState: () => noteRecordingState,
        setNoteRecordingState: (state) => {
          noteRecordingState = state;
          return noteRecordingState;
        },
        getWindow: (windowId) => windows.get(windowId),
        forEachWindow: (callback) => {
          for (const browserWindow of windows.values()) callback(browserWindow);
        },
        isWindowReady: (windowId) => readyWindows.has(windowId),
        captureActiveWindowContext,
        looksLikeShellWindowContext,
        preferLastExternalWindowContext,
        buildShellContextPayload,
        wait,
        showDockContextMenu,
        enqueueWindowMessage,
        getManagedWindowBounds,
        DOCK_WINDOW_ID,
        safeWarn
      });
      createWindows();
      installDockDisplayRepair();
      createTray();
      registerShortcuts();
      if (process.env.LINGXY_ELECTRON_GUI_SMOKE === "1") {
        await mkdir(handoffDir, { recursive: true }).catch(() => {});
      }
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
      if (process.env.LINGXY_ELECTRON_GUI_SMOKE === "1") {
        setTimeout(() => {
          runDesktopGuiSmoke().catch((error) => {
            writeDesktopGuiSmokeResult({
              ok: false,
              error: error?.message ?? String(error)
            });
            app.exit(1);
          });
        }, 250);
      }
      app.on("second-instance", (_event, argv) => {
        handleLaunchArgs(argv).catch((error) => {
          safeError("Failed to process second-instance args", error);
        });
      });
      registerPdfIpc({ ipcMain, app });

      // ── Popup cards (approval + task completion) ──
      const popupCardManager = createPopupCardManager({
        BrowserWindow,
        screen,
        resolveServiceBaseUrl: () => resolvedServiceBaseUrl,
        createBrandedBrowserWindow: brandIcons.createBrandedBrowserWindow
      });
      registerPopupCardIpc({
        ipcMain,
        IPC_CHANNELS,
        popupCardManager,
        onResolve: async (card) => {
          try {
            if (card.action === "updater:settings") {
              showWindow("console");
              enqueueWindowMessage("console", IPC_CHANNELS.shellNavigateConsole, { tabId: "settings" });
              return;
            }
            if (card.action === "updater:apply") {
              try {
                autoUpdaterController?.applyUpdate?.({ silent: false, restart: true });
              } catch (err) {
                void appendDesktopDiagnosticError("auto_updater_apply_from_card_failed", err, {});
              }
              return;
            }
            // P0-1 first-run consent: button click → record strategy
            // in config + trigger first scheduled check if non-off.
            if (card.payload?.consentCard) {
              const action = String(card.action ?? "").trim();
              const choice = action.startsWith("consent:")
                ? action.slice("consent:".length)
                : "off";
              if (UPDATE_STRATEGIES.includes(choice)) {
                try {
                  embeddedServiceRuntime?.runtime?.configStore?.patch?.({
                    updates: { strategy: choice, consentRecordedAt: new Date().toISOString() }
                  });
                } catch (err) {
                  safeWarn("[LingxY] consent persist failed:", err?.message ?? err);
                }
                if (choice !== "off" && autoUpdaterController) {
                  autoUpdaterController.checkForUpdates({ trigger: "scheduled" }).catch(() => {});
                }
              }
              return;  // consent path is fully handled here.
            }
            if (card.kind === "approval" && card.payload?.approvalId) {
              const approvalId = card.payload.approvalId;
              const action = card.action === "approve" ? "approve" : card.action === "reject" ? "reject" : null;
              if (!action) return;
              const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
              const actor = "popup_card";
              await requestDesktopServiceJson({
                base,
                method: "POST",
                actor,
                pathname: `/approvals/${encodeURIComponent(approvalId)}/${action}`,
                body: buildApprovalDecisionBody(
                  normalizeApprovalDecisionPayload(card.payload),
                  actor,
                  action
                )
              }).catch((err) => safeWarn("[LingxY] approval resolve failed:", err?.message ?? err));
            }
            if (card.action === "open_overlay") {
              showWindow("overlay");
            }
          } catch (err) {
            safeWarn("[LingxY] popup-card onResolve failed:", err?.message ?? err);
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
                conversationId: card.payload?.conversationId ?? card.meta?.conversationId ?? null,
                title: card.payload?.title ?? null,
                lines: card.payload?.lines ?? null,
                body: card.payload?.body ?? null,
                // UCA-182 Phase 8: forward arbitrary meta (artifactPath,
                // inlinePreview, mime, ...) so the overlay's resolve
                // listener can wire success-kind buttons to the right
                // file / clipboard actions without another IPC hop.
                meta: card.meta ?? null
              });
            }
          } catch (err) {
            safeWarn("[LingxY] popup-card resolved-broadcast failed:", err?.message ?? err);
          }
        }
      });
      registeredPopupCardManager = popupCardManager;

      // ──── P0-1 auto-updater wiring ────
      // Lazy-loaded so Electron 'app' is available at module init time
      // and so dev runs (npm run start:desktop, no real publish feed)
      // don't crash if electron-updater throws on construction.
      // Strategy persists in runtime config (config.updates.strategy).
      // First-run flow: if config has no consentRecordedAt yet, we
      // show a one-time popup-card asking for consent. Until the user
      // makes a choice the effective strategy is `off` (no network
      // call to GitHub Releases).
      let autoUpdaterController = null;
      try {
        const updaterModule = await import("electron-updater");
        // electron-updater is published as CJS; ESM dynamic import
        // wraps it in `default`. Native-ESM future also possible.
        // Try both shapes — without this fallback, autoUpdater stays
        // undefined and createAutoUpdater throws (P0-1 dev-mode bug
        // R reported 2026-05-07).
        const autoUpdater = updaterModule.autoUpdater
          ?? updaterModule.default?.autoUpdater
          ?? null;
        if (!autoUpdater) {
          throw new Error("electron-updater module did not export `autoUpdater` (neither as named export nor on default)");
        }
        autoUpdaterController = createAutoUpdater({
          autoUpdater,
          getStrategy: () => {
            try {
              const config = embeddedServiceRuntime?.runtime?.configStore?.load?.() ?? {};
              const stored = String(config?.updates?.strategy ?? "").toLowerCase();
              if (UPDATE_STRATEGIES.includes(stored) && config?.updates?.consentRecordedAt) {
                return stored;
              }
            } catch { /* fall through to off */ }
            return DEFAULT_UPDATE_STRATEGY;
          },
          notify: async ({ kind, payload }) => {
            try {
              await notifyAutoUpdater({ kind, payload });
            } catch (err) {
              safeWarn("[LingxY] auto-updater notify failed:", err?.message ?? err);
            }
          },
          appendDiagnostic: (event, error, ctx) => {
            void appendDesktopDiagnosticError(event, error, ctx);
          },
          logger: { info: safeError, warn: safeWarn, error: safeError }
        });
      } catch (err) {
        safeWarn("[LingxY] electron-updater unavailable (running unpacked dev?):", err?.message ?? err);
        void appendDesktopDiagnosticError("auto_updater_unavailable", err, {});
      }

      registerUpdaterIpc({
        ipcMain,
        IPC_CHANNELS,
        updateStrategies: UPDATE_STRATEGIES,
        getAutoUpdaterController: () => autoUpdaterController,
        patchUpdateStrategy: (next) => {
          embeddedServiceRuntime?.runtime?.configStore?.patch?.({
            updates: { strategy: next, consentRecordedAt: new Date().toISOString() }
          });
        }
      });

      // First-run consent: fire a popup-card AFTER service runtime
      // is up so configStore is reachable. The card is shown only if
      // there's no recorded consent yet. The actual strategy gets
      // recorded in `onResolve` (registered above with the popup-card
      // manager) when the user clicks one of the action buttons.
      //
      // Round-7 R-feedback fix: previously called `popupCardManager
      // .show?.()` — the manager exposes `showCard`, not `show`, so
      // the consent popup never rendered. The fire-and-resolve
      // pattern matches how approvals work (showCard returns
      // immediately; onResolve fires later when the user clicks).
      setTimeout(() => {
        try {
          const config = embeddedServiceRuntime?.runtime?.configStore?.load?.() ?? {};
          if (config?.updates?.consentRecordedAt) return;
          popupCardManager.showCard?.({
            kind: "info",
            title: "自动检查更新？",
            body: "LingxY 可以从 GitHub Releases 自动检查新版本。检查会向 GitHub 暴露你的 IP 与浏览器标识；除此之外没有任何遥测路由经过 LingxY 服务器。",
            // Round-7 fix: button shape uses `id` + `actionKey` so
            // popup-card.js's renderActions() picks them up. Each
            // click sends popupCardResolve with `action: <id>` which
            // the onResolve handler below maps to a strategy string.
            buttons: [
              { id: "auto", actionKey: "consent:auto", label: "检查 + 下载（auto）" },
              { id: "notify", actionKey: "consent:notify", label: "仅通知（notify）", primary: true },
              { id: "manual", actionKey: "consent:manual", label: "仅手动（manual）" },
              { id: "off", actionKey: "consent:off", label: "完全关闭（off）" }
            ],
            allowContinue: false,
            dedupeKey: "updater:consent",
            // Tag so onResolve knows this is a consent card.
            consentCard: true
          });
        } catch (err) {
          safeWarn("[LingxY] first-run updater consent failed:", err?.message ?? err);
        }
      }, 5000).unref?.();

      // UCA-182 Phase 14: preview window lifecycle. Created on demand,
      // positioned as a real, movable review window rather than a narrow
      // side sliver so generated documents can be inspected comfortably.
      // We keep the window between uses (hide, not destroy) so the
      // next preview can paint without reloading the HTML + scripts.
      function computePreviewBounds() {
        const { workArea } = screen.getPrimaryDisplay();
        const width = Math.max(980, Math.min(Math.round(workArea.width * 0.76), 1500));
        const height = Math.max(640, Math.min(Math.round(workArea.height * 0.84), 1040));
        const x = workArea.x + Math.max(0, Math.round((workArea.width - width) / 2));
        const y = workArea.y + Math.max(0, Math.round((workArea.height - height) / 2));
        return { x, y, width, height };
      }
      function ensurePreviewWindow() {
        if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;
        const bounds = computePreviewBounds();
        const baseUrl = resolvedServiceBaseUrl ?? "";
        const url = buildRendererFileUrl("preview-window.html")
          + `?serviceBaseUrl=${encodeURIComponent(baseUrl)}`;
        previewWindow = brandIcons.createBrandedBrowserWindow(BrowserWindow, {
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
      // Deliver to the preview window with loading-aware queueing.
      // Problem this fixes: after showPreviewWindowIfHidden() the window
      // is isVisible() = true but DOM scripts haven't run yet; any
      // webContents.send() lands on a window without event listeners and
      // the message is lost. We buffer by channel until did-finish-load
      // fires, and for delta frames we coalesce (only keep the latest
      // payload — partial_json is already cumulative).
      const previewPendingByChannel = new Map();
      let previewFlushBound = false;
      function flushPreviewPending() {
        if (!previewWindow || previewWindow.isDestroyed()) {
          previewPendingByChannel.clear();
          return;
        }
        for (const [channel, payload] of previewPendingByChannel) {
          try { previewWindow.webContents.send(channel, payload); } catch { /* ignore */ }
        }
        previewPendingByChannel.clear();
      }
      function sendToPreview(channel, payload, { coalesce = false } = {}) {
        const win = showPreviewWindowIfHidden();
        if (win.webContents.isLoading()) {
          // Buffer. For delta (coalesce), replace any prior frame on
          // the same channel so we only deliver the latest.
          if (coalesce) {
            previewPendingByChannel.set(channel, payload);
          } else if (previewPendingByChannel.has(channel)) {
            // For non-delta frames we still overwrite by channel; the
            // latest init / committed is what the window cares about.
            previewPendingByChannel.set(channel, payload);
          } else {
            previewPendingByChannel.set(channel, payload);
          }
          if (!previewFlushBound) {
            previewFlushBound = true;
            win.webContents.once("did-finish-load", () => {
              previewFlushBound = false;
              flushPreviewPending();
            });
          }
          return;
        }
        try { win.webContents.send(channel, payload); } catch { /* ignore */ }
      }

      const previewIpc = registerPreviewIpc({
        ipcMain,
        IPC_CHANNELS,
        sendToPreview,
        getPreviewWindow: () => previewWindow,
        hidePreviewWindow: () => {
          if (previewWindow && !previewWindow.isDestroyed()) previewWindow.hide();
        },
        setPreviewWindowPinned: (flag) => {
          previewWindowPinned = Boolean(flag);
          if (previewWindow && !previewWindow.isDestroyed()) {
            try { previewWindow.setAlwaysOnTop(previewWindowPinned, "screen-saver"); } catch { /* ignore */ }
          }
          return previewWindowPinned;
        }
      });
      openPreviewWindowForSmoke = previewIpc.openPreviewWindowForSmoke;

      function normalizeOpenableUrl(value) {
        try {
          const parsed = new URL(String(value ?? "").trim());
          if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
          return parsed.toString();
        } catch {
          return null;
        }
      }

      // Persistence key for the LingxY Browser window. All link-browser
      // windows share this single bounds entry — opening multiple
      // popups in quick succession is fine; the LAST close wins for
      // position memory. (Per-URL persistence would cluster on first
      // visits and feel random; one stable position matches user
      // intent: "open my reading panel where I left it".)
      const LINK_BROWSER_PREF_ID = "link_browser";

      function readLinkBrowserBounds() {
        const prefs = getCachedSettings()?.windowPreferences?.[LINK_BROWSER_PREF_ID] ?? {};
        const persisted = prefs.bounds;
        if (
          persisted
          && Number.isFinite(persisted.x)
          && Number.isFinite(persisted.y)
          && Number.isFinite(persisted.width)
          && Number.isFinite(persisted.height)
          && persisted.width >= 480
          && persisted.height >= 360
        ) {
          // Codex round-1: pick the display nearest the persisted bounds
          // (multi-monitor); only fall back to primary if matching fails.
          // First clamp size to the target work area, THEN clamp x/y so
          // the WHOLE window fits — the previous "200x150 visible" rule
          // could leave the window mostly off-screen.
          const targetDisplay = screen.getDisplayMatching?.({
            x: persisted.x,
            y: persisted.y,
            width: persisted.width,
            height: persisted.height
          }) ?? screen.getPrimaryDisplay();
          const wa = targetDisplay.workArea;
          const width = Math.min(persisted.width, wa.width);
          const height = Math.min(persisted.height, wa.height);
          return {
            width,
            height,
            x: Math.max(wa.x, Math.min(persisted.x, wa.x + wa.width - width)),
            y: Math.max(wa.y, Math.min(persisted.y, wa.y + wa.height - height))
          };
        }
        const { workArea } = screen.getPrimaryDisplay();
        const width = Math.max(920, Math.min(Math.round(workArea.width * 0.58), 1280));
        const height = Math.max(620, Math.min(workArea.height - 48, 900));
        return {
          width,
          height,
          x: workArea.x + Math.max(12, Math.round((workArea.width - width) / 2)),
          y: workArea.y + 24
        };
      }

      function showLinkBrowserWindow(url) {
        const initialBounds = readLinkBrowserBounds();
        const win = brandIcons.createBrandedBrowserWindow(BrowserWindow, {
          ...initialBounds,
          show: false,
          frame: true,
          resizable: true,
          movable: true,
          minimizable: true,
          maximizable: true,
          closable: true,
          alwaysOnTop: false,
          skipTaskbar: false,
          title: "LingxY Browser",
          backgroundColor: "#ffffff",
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
          }
        });
        linkBrowserWindows.add(win);
        win.on("closed", () => linkBrowserWindows.delete(win));
        function closeLinkBrowserWindow() {
          if (!win.isDestroyed?.()) {
            try { win.close(); } catch { /* ignore */ }
          }
        }
        async function injectLinkBrowserCloseControl() {
          if (win.isDestroyed?.() || win.webContents?.isDestroyed?.()) return;
          try {
            await win.webContents.executeJavaScript(`
              (() => {
                const hostId = "lingxy-link-browser-close-host";
                document.getElementById(hostId)?.remove();
                const host = document.createElement("div");
                host.id = hostId;
                host.style.position = "fixed";
                host.style.top = "12px";
                host.style.right = "12px";
                host.style.zIndex = "2147483647";
                host.style.pointerEvents = "auto";
                const root = host.attachShadow({ mode: "closed" });
                const style = document.createElement("style");
                style.textContent = \`
                  button {
                    all: initial;
                    box-sizing: border-box;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    min-height: 32px;
                    padding: 0 10px;
                    border-radius: 8px;
                    border: 1px solid rgba(15, 23, 42, 0.18);
                    background: rgba(255, 255, 255, 0.96);
                    color: #111827;
                    font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22);
                    cursor: pointer;
                    user-select: none;
                    -webkit-font-smoothing: antialiased;
                  }
                  button:hover { background: #f8fafc; border-color: rgba(15, 23, 42, 0.28); }
                  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
                  .mark {
                    display: inline-grid;
                    place-items: center;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #111827;
                    color: white;
                    font-size: 14px;
                    line-height: 18px;
                  }
                \`;
                const button = document.createElement("button");
                button.type = "button";
                button.title = "关闭 LingxY 链接窗口";
                button.setAttribute("aria-label", "关闭 LingxY 链接窗口");
                button.innerHTML = '<span class="mark" aria-hidden="true">×</span><span>关闭</span>';
                button.addEventListener("click", (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  window.location.href = "lingxy://close-link-browser";
                });
                root.append(style, button);
                document.documentElement.appendChild(host);
              })();
            `, true);
          } catch { /* ignore pages that reject DOM injection */ }
        }
        win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
          const safeUrl = normalizeOpenableUrl(nextUrl);
          if (safeUrl && /^https?:/i.test(safeUrl)) {
            showLinkBrowserWindow(safeUrl);
          } else if (safeUrl) {
            void shell.openExternal(safeUrl);
          }
          return { action: "deny" };
        });
        win.webContents.on("will-navigate", (event, nextUrl) => {
          if (String(nextUrl ?? "").startsWith("lingxy://close-link-browser")) {
            event.preventDefault();
            closeLinkBrowserWindow();
            return;
          }
          const safeUrl = normalizeOpenableUrl(nextUrl);
          if (!safeUrl) event.preventDefault();
        });
        win.webContents.on("before-input-event", (_event, input = {}) => {
          if (input.type === "keyDown" && input.key === "Escape") {
            closeLinkBrowserWindow();
          }
        });

        // UX polish: window title reflects the live page title rather
        // than the static "LingxY Browser" string. Falls back to the
        // host name when the page hasn't set a title yet (or is in the
        // middle of navigating). Keeps the "LingxY ·" prefix so the
        // window is still recognisable as our browser in the taskbar.
        function applyDynamicTitle() {
          if (win.isDestroyed?.()) return;
          let suffix = "";
          try {
            const pageTitle = (win.webContents.getTitle?.() ?? "").trim();
            if (pageTitle) {
              suffix = pageTitle;
            } else {
              const currentUrl = win.webContents.getURL?.() ?? "";
              suffix = currentUrl ? new URL(currentUrl).hostname : "";
            }
          } catch { /* ignore */ }
          try {
            win.setTitle(suffix ? `LingxY · ${suffix}` : "LingxY Browser");
          } catch { /* ignore */ }
        }
        win.webContents.on("page-title-updated", applyDynamicTitle);
        win.webContents.on("did-navigate", applyDynamicTitle);
        win.webContents.on("did-navigate", () => { void injectLinkBrowserCloseControl(); });
        win.webContents.on("did-finish-load", () => {
          applyDynamicTitle();
          void injectLinkBrowserCloseControl();
        });

        // Persist bounds whenever the user moves or resizes the window
        // so the next open lands where they left it. True trailing-edge
        // debounce: every resize/move event RESETS the timer so only
        // the final bounds get written. Codex round-1 caught the
        // earlier `if (persistTimer) return` shape — that was a
        // leading-edge throttle which dropped the user's final position
        // when they closed the window before the throttle period
        // elapsed.
        let persistTimer = null;
        function flushPersistNow() {
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = null;
          if (win.isDestroyed?.()) return;
          try {
            const bounds = win.getBounds();
            persistWindowPreferences(LINK_BROWSER_PREF_ID, { bounds });
          } catch { /* ignore */ }
        }
        function schedulePersist() {
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = setTimeout(() => {
            persistTimer = null;
            if (win.isDestroyed?.()) return;
            try {
              const bounds = win.getBounds();
              persistWindowPreferences(LINK_BROWSER_PREF_ID, { bounds });
            } catch { /* ignore */ }
          }, 400);
        }
        win.on("resize", schedulePersist);
        win.on("move", schedulePersist);
        // `close` fires synchronously *before* the window is destroyed
        // so getBounds() still works; `closed` fires after destroy.
        // Flush any pending bounds write here so a fast close after a
        // drag doesn't lose the final position.
        win.on("close", flushPersistNow);
        // Show + bring-to-front only after the page is loading, so the
        // user sees a real navigation rather than a blank chrome flash.
        // The dock is the only alwaysOnTop window in the app, but it is
        // tiny (48x48) so the link browser still dominates the viewport.
        // Codex review: ready-to-show is not guaranteed to fire on every
        // load (paintWhenInitiallyHidden quirks, slow remote resources).
        // Belt-and-braces with an 8 s fallback timer so the window is
        // never left invisible without recourse.
        let shownOnce = false;
        const showOnce = () => {
          if (shownOnce) return;
          shownOnce = true;
          try { win.show(); win.focus(); } catch { /* ignore */ }
        };
        win.once("ready-to-show", showOnce);
        const fallbackShowTimer = setTimeout(showOnce, 8000);
        win.on("closed", () => {
          clearTimeout(fallbackShowTimer);
          if (persistTimer) clearTimeout(persistTimer);
        });
        win.loadURL(url);
        return { ok: true, mode: "lingxy_browser" };
      }
      openLinkBrowserForSmoke = showLinkBrowserWindow;

      function readLinkOpenPreference() {
        try {
          const config = runtime?.configStore?.load?.() ?? {};
          const mode = String(config?.ui?.linkOpenMode ?? "").trim().toLowerCase();
          if (["system", "lingxy_browser", "ask"].includes(mode)) return mode;
        } catch { /* fall through */ }
        return "system";
      }

      registerShellOpenUrlIpc({
        ipcMain,
        IPC_CHANNELS,
        BrowserWindow,
        brandIcons,
        dialog,
        shell,
        normalizeOpenableUrl,
        readLinkOpenPreference,
        showLinkBrowserWindow
      });
      registerMcpIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        postDesktopServiceJson,
        requestDesktopServiceJson
      });
      registerApprovalIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        requestDesktopServiceJson,
        normalizeApprovalDecisionPayload,
        buildApprovalDecisionBody
      });
      registerAdminIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson
      });
      registerDiagnosticsIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson,
        appendDesktopDiagnosticError,
        normalizePlainObject
      });
      registerSchedulerIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson,
        requestDesktopServiceJson
      });
      registerProviderConfigIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson,
        requestDesktopServiceJson
      });
      registerSkillIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson,
        requestDesktopServiceJson
      });
      registerRuntimeConfigIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson
      });
      registerEmailIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson,
        requestDesktopServiceJson
      });
      registerNotesProjectIpc({
        ipcMain,
        IPC_CHANNELS,
        BrowserWindow,
        dialog,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson
      });
      registerOfficeIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceJson
      });
      registerAudioServiceIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        postDesktopServiceBinary,
        postDesktopServiceBinaryStream
      });
      registerConnectedAccountIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        requestDesktopServiceJson
      });
      registerTaskIpc({
        ipcMain,
        IPC_CHANNELS,
        getServiceBaseUrl: () => resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        desktopActorForSender,
        requestDesktopServiceJson
      });

      registerShellWindowIpc({
        ipcMain,
        IPC_CHANNELS,
        buildShellStatus: () => ({
          serviceBaseUrl: resolvedServiceBaseUrl,
          windowIds: [...windows.keys()],
          windows: DESKTOP_SHELL_MANIFEST.windows.map((windowDef) => ({
            id: windowDef.id,
            title: windowDef.title,
            route: windowDef.route,
            visible: windows.get(windowDef.id)?.isVisible() ?? false,
            minimized: windows.get(windowDef.id)?.isMinimized?.() ?? false,
            focused: windows.get(windowDef.id)?.isFocused?.() ?? false
          }))
        }),
        showWindow,
        hideWindow,
        openOverlayVoice,
        loadSettings,
        enqueueWindowMessage,
        buildOverlayPayloadFromFiles,
        getWindow: (windowId) => windows.get(windowId),
        getManagedWindowBounds,
        clampWindowBounds,
        setManagedWindowBounds,
        persistWindowPreferences,
        enforceDockWindowInvariants,
        showDesktopNotification,
        DOCK_WINDOW_ID,
        ECHO_DOCK_DROP_VOICE_READY_MS
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
        stopHandoffWatcher();
        stopNotificationWatcher();
        registeredPopupCardManager?.shutdown?.();
        embeddedServiceRuntime?.stop?.().catch?.(() => {});
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

  if (process.env.LINGXY_ELECTRON_GUI_SMOKE === "1") {
    const smokeUserDataDir = process.env.LINGXY_ELECTRON_GUI_SMOKE_USER_DATA_DIR
      ?? guiSmokeUserDataDir();
    try {
      await mkdir(smokeUserDataDir, { recursive: true });
      electron.app.setPath("userData", smokeUserDataDir);
    } catch { /* keep Electron's default path if isolation cannot be set */ }
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
