import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";
import { createWindowSessionState } from "../shared/window-session-state.mjs";
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
} from "../shared/desktop-payload-normalizers.mjs";
import {
  buildRendererFileUrl,
  buildWindowUrl,
  PRELOAD_PATH,
  resolveWindowOptions
} from "./desktop-window-config.mjs";
import { createDesktopWindowBounds } from "./desktop-window-bounds.mjs";
import { installWindowLifecycleHandlers } from "../shell/desktop-window-lifecycle.mjs";
import { createDesktopWindowActions } from "../shell/desktop-window-actions.mjs";
import { createShortcutRouter } from "../shell/desktop-shortcut-router.mjs";
import { createLinkBrowserWindowManager } from "../shell/desktop-link-browser-window.mjs";
import { createPreviewWindowManager } from "../shell/desktop-preview-window-manager.mjs";
import { createDesktopGuiSmokeRunner } from "../smoke/desktop-gui-smoke-runner.mjs";
import { installMediaPermissionHandlers } from "../shell/desktop-permission-handler.mjs";
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
import { registerPreviewIpc } from "../main/ipc/register-preview-ipc.mjs";
import { registerUpdaterIpc } from "../main/ipc/register-updater-ipc.mjs";
import { registerDiagnosticsIpc } from "../main/ipc/register-diagnostics-ipc.mjs";
import { registerShellOpenUrlIpc } from "../main/ipc/register-shell-open-url-ipc.mjs";
import { registerMcpIpc } from "../main/ipc/register-mcp-ipc.mjs";
import { registerSchedulerIpc } from "../main/ipc/register-scheduler-ipc.mjs";
import { registerProviderConfigIpc } from "../main/ipc/register-provider-config-ipc.mjs";
import { registerSkillIpc } from "../main/ipc/register-skill-ipc.mjs";
import { registerRuntimeConfigIpc } from "../main/ipc/register-runtime-config-ipc.mjs";
import { registerEmailIpc } from "../main/ipc/register-email-ipc.mjs";
import { registerNotesProjectIpc } from "../main/ipc/register-notes-project-ipc.mjs";
import { registerConnectedAccountIpc } from "../main/ipc/register-connected-account-ipc.mjs";
import { registerShellWindowIpc } from "../main/ipc/register-shell-window-ipc.mjs";
import { registerAdminIpc } from "../main/ipc/register-admin-ipc.mjs";
import { registerOfficeIpc } from "../main/ipc/register-office-ipc.mjs";
import { registerPdfIpc } from "../main/ipc/register-pdf-ipc.mjs";
import { registerApprovalIpc } from "../main/ipc/register-approval-ipc.mjs";
import { registerTaskIpc } from "../main/ipc/register-task-ipc.mjs";
import { registerAudioServiceIpc } from "../main/ipc/register-audio-service-ipc.mjs";
import { registerShellLocalIpc } from "../main/ipc/register-shell-local-ipc.mjs";
import { registerPopupCardIpc } from "../main/ipc/register-popup-card-ipc.mjs";
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
  const windowSession = createWindowSessionState();
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

  let activeWindowProbeEnabledCache = true;
  let activeWindowProbeFeatureRefreshInFlight = null;
  let activeWindowProbeFeatureLastRefreshAt = 0;

  function refreshActiveWindowProbeFeature({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - activeWindowProbeFeatureLastRefreshAt < 30_000) {
      return Promise.resolve(activeWindowProbeEnabledCache);
    }
    if (activeWindowProbeFeatureRefreshInFlight) {
      return activeWindowProbeFeatureRefreshInFlight;
    }
    activeWindowProbeFeatureRefreshInFlight = checkRemoteFeatureEnabled({
      serviceBaseUrl: resolvedServiceBaseUrl,
      featureId: "active_window_probe",
      timeoutMs: 750
    }).then((enabled) => {
      activeWindowProbeEnabledCache = enabled;
      activeWindowProbeFeatureLastRefreshAt = Date.now();
      return enabled;
    }).catch(() => activeWindowProbeEnabledCache)
      .finally(() => {
        activeWindowProbeFeatureRefreshInFlight = null;
      });
    return activeWindowProbeFeatureRefreshInFlight;
  }

  async function captureActiveWindowContext({
    includeSelection = true,
    activeWindowEnabled = true,
    allowClipboardFallback = true,
    clipboardBaseline = null,
    preferLastExternal = false,
    maxExternalAgeMs = 10 * 60_000,
    timeoutMs = 3000
  } = {}) {
    const boundedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(650, Math.min(3000, Number(timeoutMs)))
      : 3000;
    const contextPromise = runCaptureActiveWindowContext({
      runPowerShell: runPowerShellScript,
      clipboardFallback: () => clipboard.readText() ?? "",
      timeoutMs: boundedTimeoutMs,
      activeWindowEnabled: activeWindowEnabled && activeWindowProbeEnabledCache,
      includeSelection,
      allowClipboardFallback,
      clipboardBaseline
    });
    void refreshActiveWindowProbeFeature();
    const context = await contextPromise;

    // Keep the clipboard watcher in sync when capture-context.ps1 surfaced
    // selected text so dock pulse behaviour does not replay stale clipboard
    // contents after an explicit capture.
    if (context.selectedText) {
      setLastClipboardText(context.selectedText);
    }

    let effectiveContext = preferLastExternalWindowContext(context, {
      preferLastExternal,
      maxExternalAgeMs
    });
    if (looksLikeShellWindowContext(effectiveContext)
        && (!Array.isArray(effectiveContext.filePaths) || effectiveContext.filePaths.length === 0)
        && !effectiveContext.selectedText) {
      effectiveContext = {
        ...effectiveContext,
        activeWindow: null
      };
    }

    if (!Array.isArray(effectiveContext.filePaths) || effectiveContext.filePaths.length === 0) {
      rememberExternalWindowContext(effectiveContext);
    }
    return effectiveContext;
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
      windowSession.bindWindow(windowDef.id, { surface: windowDef.id });
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

      installMediaPermissionHandlers({ session, safeError });

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
        createBrandedBrowserWindow: brandIcons.createBrandedBrowserWindow,
        windowSession
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
            if (card.action === "updater:download") {
              try {
                await autoUpdaterController?.downloadUpdate?.();
              } catch (err) {
                void appendDesktopDiagnosticError("auto_updater_download_from_card_failed", err, {});
              }
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
      // Fresh installs stay `off` until the Console update button
      // records an explicit preference and invokes "Check now". That
      // keeps launch quiet and avoids network calls to GitHub Releases
      // before a user action.
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

      const previewWindowManager = createPreviewWindowManager({
        BrowserWindow,
        brandIcons,
        buildRendererFileUrl,
        PRELOAD_PATH,
        resolvedServiceBaseUrl: () => resolvedServiceBaseUrl ?? "",
        quitting: () => quitting,
        windowSession,
        previewInitChannel: IPC_CHANNELS.previewWindowInit
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

  const { runDesktopGuiSmoke, writeDesktopGuiSmokeResult } = createDesktopGuiSmokeRunner({
    DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT,
    showWindow,
    windows,
    registeredShortcutHandlers,
    globalShortcut,
    DESKTOP_SHELL_MANIFEST,
    guiSmokeExplorerSourcePath,
    guiSmokeHandoffPath,
    handoffDir,
    mkdir,
    writeFile,
    openPreviewWindowForSmoke,
    openLinkBrowserForSmoke,
    linkBrowserWindows,
    notifyAutoUpdater,
    registeredPopupCardManager,
    BrowserWindow,
    app,
  });

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
