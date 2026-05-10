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
import { installWindowLifecycleHandlers } from "./desktop-window-lifecycle.mjs";
import { createDesktopWindowActions } from "./desktop-window-actions.mjs";
import { createShortcutRouter } from "./desktop-shortcut-router.mjs";
import { createLinkBrowserWindowManager } from "./desktop-link-browser-window.mjs";
import { createPreviewWindowManager } from "./desktop-preview-window-manager.mjs";
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
    showWindow,
    hideWindow,
    openOverlayVoice,
    sendEchoShortcutWake
  } = createDesktopWindowActions({
    windows,
    DESKTOP_SHELL_MANIFEST,
    DOCK_WINDOW_ID,
    getWindowPreferences,
    setManagedWindowBounds,
    resolveWindowBounds,
    enforceDockWindowInvariants,
    applyWindowPresentation,
    enqueueWindowMessage,
    IPC_CHANNELS
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
      installWindowLifecycleHandlers({
        browserWindow, windowDef,
        quitting: () => quitting,
        DOCK_WINDOW_ID, IPC_CHANNELS,
        readyWindows, windows,
        resolvedServiceBaseUrl: () => resolvedServiceBaseUrl,
        getNoteRecordingState: () => noteRecordingState,
        BrowserWindow,
        getManagedWindowBounds, lockWindowRendererZoom,
        installDockHudScrollLock, enforceDockWindowInvariants,
        persistWindowPreferences, clearWindowMessages, flushWindowMessages,
        safeError, safeWarn
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

  const { buildShortcutHandler } = createShortcutRouter({
    showWindow,
    sendEchoShortcutWake,
    captureActiveWindowContext,
    buildShellContextPayload,
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight: (val) => { captureInFlight = val; },
    clipboard,
    enqueueWindowMessage,
    IPC_CHANNELS,
    windows,
    loadSettings,
    resolvedServiceBaseUrl: () => resolvedServiceBaseUrl,
    requestDesktopServiceJson,
    execFileAsync,
    desktopScriptPath,
    screenshotCapturePath,
    safeError,
    appendDesktopDiagnosticError,
    safeNotify
  });

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      const shortcutHandler = buildShortcutHandler(shortcut);
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

      const previewWindowManager = createPreviewWindowManager({
        BrowserWindow,
        brandIcons,
        buildRendererFileUrl,
        PRELOAD_PATH,
        resolvedServiceBaseUrl: () => resolvedServiceBaseUrl ?? "",
        quitting: () => quitting,
      });

      const { sendToPreview, getPreviewWindow, hidePreviewWindow, setPreviewWindowPinned } = previewWindowManager;

      const previewIpc = registerPreviewIpc({
        ipcMain,
        IPC_CHANNELS,
        sendToPreview,
        getPreviewWindow,
        hidePreviewWindow,
        setPreviewWindowPinned,
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

      const linkBrowserManager = createLinkBrowserWindowManager({
        BrowserWindow,
        screen,
        shell,
        createBrandedBrowserWindow: brandIcons.createBrandedBrowserWindow,
        normalizeOpenableUrl,
        getCachedSettings,
        persistWindowPreferences,
        linkBrowserWindows,
        getRuntime: () => runtime
      });
      const { showLinkBrowserWindow, readLinkOpenPreference } = linkBrowserManager;
      openLinkBrowserForSmoke = showLinkBrowserWindow;

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
