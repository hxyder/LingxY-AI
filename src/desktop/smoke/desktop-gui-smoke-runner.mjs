export function createDesktopGuiSmokeRunner({
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
} = {}) {
  if (typeof showWindow !== "function") throw new TypeError("createDesktopGuiSmokeRunner requires showWindow.");
  if (!(windows instanceof Map)) throw new TypeError("createDesktopGuiSmokeRunner requires windows Map.");
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
    const waitForSmokeFrame = () => new Promise((resolve) => setTimeout(resolve, 40));
    const runAudioHardwareSmoke = process.env.LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE === "1";
    function captureImageStats(nativeImage) {
      const size = nativeImage?.getSize?.() ?? { width: 0, height: 0 };
      const bitmap = nativeImage?.toBitmap?.();
      if (!bitmap || size.width <= 0 || size.height <= 0) {
        return { ok: false, width: size.width, height: size.height, sampleCount: 0 };
      }
      const stride = size.width * 4;
      const stepX = Math.max(1, Math.floor(size.width / 80));
      const stepY = Math.max(1, Math.floor(size.height / 60));
      let sampleCount = 0;
      let nonWhite = 0;
      let sum = 0;
      let sumSquares = 0;
      for (let y = 0; y < size.height; y += stepY) {
        for (let x = 0; x < size.width; x += stepX) {
          const index = (y * stride) + (x * 4);
          const b = bitmap[index] ?? 0;
          const g = bitmap[index + 1] ?? 0;
          const r = bitmap[index + 2] ?? 0;
          const a = bitmap[index + 3] ?? 255;
          if (a < 8) continue;
          const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
          sampleCount += 1;
          sum += luma;
          sumSquares += luma * luma;
          if (r < 245 || g < 245 || b < 245) nonWhite += 1;
        }
      }
      const mean = sampleCount ? sum / sampleCount : 0;
      const variance = sampleCount ? (sumSquares / sampleCount) - (mean * mean) : 0;
      const nonWhiteRatio = sampleCount ? nonWhite / sampleCount : 0;
      return {
        ok: sampleCount > 0 && nonWhiteRatio > 0.02 && variance > 8,
        width: size.width,
        height: size.height,
        sampleCount,
        nonWhiteRatio,
        variance
      };
    }
    function compareImageStats(beforeImage, afterImage) {
      const beforeSize = beforeImage?.getSize?.() ?? { width: 0, height: 0 };
      const afterSize = afterImage?.getSize?.() ?? { width: 0, height: 0 };
      const before = beforeImage?.toBitmap?.();
      const after = afterImage?.toBitmap?.();
      if (!before || !after || beforeSize.width !== afterSize.width || beforeSize.height !== afterSize.height) {
        return { ok: false, diffRatio: 0, sampleCount: 0 };
      }
      const stride = beforeSize.width * 4;
      const stepX = Math.max(1, Math.floor(beforeSize.width / 80));
      const stepY = Math.max(1, Math.floor(beforeSize.height / 60));
      let sampleCount = 0;
      let changed = 0;
      let totalDelta = 0;
      for (let y = 0; y < beforeSize.height; y += stepY) {
        for (let x = 0; x < beforeSize.width; x += stepX) {
          const index = (y * stride) + (x * 4);
          const delta = Math.abs((before[index] ?? 0) - (after[index] ?? 0))
            + Math.abs((before[index + 1] ?? 0) - (after[index + 1] ?? 0))
            + Math.abs((before[index + 2] ?? 0) - (after[index + 2] ?? 0));
          sampleCount += 1;
          totalDelta += delta;
          if (delta > 36) changed += 1;
        }
      }
      const diffRatio = sampleCount ? changed / sampleCount : 0;
      const averageDelta = sampleCount ? totalDelta / sampleCount : 0;
      return {
        ok: diffRatio > 0.003 && diffRatio < 0.7 && averageDelta > 1,
        diffRatio,
        averageDelta,
        sampleCount
      };
    }
    async function sendKeyboardShortcut(targetWindow, keyCode) {
      if (!targetWindow || targetWindow.isDestroyed?.()) {
        throw new Error(`keyboard_target_missing:${keyCode}`);
      }
      targetWindow.focus?.();
      await waitForSmokeFrame();
      targetWindow.webContents.sendInputEvent({ type: "keyDown", keyCode });
      targetWindow.webContents.sendInputEvent({ type: "keyUp", keyCode });
      await waitForSmokeFrame();
    }
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
      const missingRegisteredAccelerators = shortcutIds.filter((id) => !registeredAccelerators.includes(id));
      if (missingRegisteredAccelerators.length > 0) {
        throw new Error(`global_shortcuts_not_registered:${missingRegisteredAccelerators.join(",")}`);
      }
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

      if (runAudioHardwareSmoke) {
        const audioHardwarePath = await overlayWindow.webContents.executeJavaScript(
          'window.__lingxyOverlaySmoke?.runAudioHardwarePermissionPath?.({ recordMs: 900, timeoutMs: 6000 })',
          true
        );
        if (!audioHardwarePath?.ok) {
          throw new Error(`overlay_audio_hardware_permission_capture_failed:${audioHardwarePath?.code ?? "unknown"}:${audioHardwarePath?.message ?? ""}`);
        }
        pass("overlay_audio_hardware_permission_capture", {
          chunks: audioHardwarePath.chunkCount,
          bytes: audioHardwarePath.bytes,
          mimeType: audioHardwarePath.mimeType,
          audioTrackCount: audioHardwarePath.audioTrackCount,
          durationMs: audioHardwarePath.durationMs
        });
      }

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

      overlayWindow.focus?.();
      await waitForSmokeFrame();
      const overlayTaskListInitial = await overlayWindow.webContents.executeJavaScript(`(() => {
        const dock = document.getElementById("taskListDock");
        dock?.focus();
        return {
          focusedDock: document.activeElement === dock,
          dockLabel: dock?.getAttribute("aria-label") || "",
          expanded: dock?.getAttribute("aria-expanded") || "",
          panelOpen: document.getElementById("taskListPanel")?.dataset.open || ""
        };
      })()`, true);
      if (!overlayTaskListInitial?.focusedDock || !overlayTaskListInitial?.dockLabel) {
        throw new Error("overlay_task_list_keyboard_focus_missing");
      }
      let overlayTaskListSnapshot = null;
      const waitForOverlayTaskListOpen = () => waitForDesktopGuiSmoke(async () => {
        overlayTaskListSnapshot = await overlayWindow.webContents.executeJavaScript(`(() => {
          const panel = document.getElementById("taskListPanel");
          const dock = document.getElementById("taskListDock");
          const filters = [...document.querySelectorAll("[data-task-filter]")];
          return {
            open: panel?.dataset.open === "true",
            expanded: dock?.getAttribute("aria-expanded") || "",
            filterCount: filters.length,
            activeFilter: filters.find((btn) => btn.getAttribute("aria-selected") === "true")?.dataset.taskFilter || null,
            activeTabIndex: filters.find((btn) => btn.getAttribute("aria-selected") === "true")?.tabIndex ?? null
          };
        })()`, true);
        return overlayTaskListSnapshot?.open === true
          && overlayTaskListSnapshot?.expanded === "true"
          && overlayTaskListSnapshot?.filterCount >= 3
          && overlayTaskListSnapshot?.activeTabIndex === 0;
      }, 3000);
      await sendKeyboardShortcut(overlayWindow, "Space");
      let overlayTaskListOpened = await waitForOverlayTaskListOpen();
      if (!overlayTaskListOpened) {
        await overlayWindow.webContents.executeJavaScript(`(() => {
          document.getElementById("taskListDock")?.focus();
          return true;
        })()`, true);
        await sendKeyboardShortcut(overlayWindow, "Enter");
        overlayTaskListOpened = await waitForOverlayTaskListOpen();
      }
      if (!overlayTaskListOpened) throw new Error("overlay_task_list_keyboard_open_failed");
      await overlayWindow.webContents.executeJavaScript(`(() => {
        const active = [...document.querySelectorAll("[data-task-filter]")]
          .find((btn) => btn.getAttribute("aria-selected") === "true");
        active?.focus();
        return true;
      })()`, true);
      await sendKeyboardShortcut(overlayWindow, "Right");
      const overlayTaskListAfterArrow = await overlayWindow.webContents.executeJavaScript(`(() => {
        const active = [...document.querySelectorAll("[data-task-filter]")]
          .find((btn) => btn.getAttribute("aria-selected") === "true");
        return {
          activeFilter: active?.dataset.taskFilter || null,
          activeHasFocus: document.activeElement === active,
          activeTabIndex: active?.tabIndex ?? null
        };
      })()`, true);
      if (!overlayTaskListAfterArrow?.activeHasFocus || overlayTaskListAfterArrow?.activeTabIndex !== 0) {
        throw new Error("overlay_task_list_keyboard_arrow_failed");
      }
      await sendKeyboardShortcut(overlayWindow, "Escape");
      const overlayTaskListClosed = await waitForDesktopGuiSmoke(async () => {
        const snapshot = await overlayWindow.webContents.executeJavaScript(`(() => {
          const dock = document.getElementById("taskListDock");
          return {
            panelOpen: document.getElementById("taskListPanel")?.dataset.open || "",
            expanded: dock?.getAttribute("aria-expanded") || "",
            focusRestored: document.activeElement === dock
          };
        })()`, true);
        overlayTaskListSnapshot = { ...overlayTaskListSnapshot, ...snapshot };
        return snapshot.panelOpen === "false"
          && snapshot.expanded === "false"
          && snapshot.focusRestored === true;
      }, 3000);
      if (!overlayTaskListClosed) throw new Error("overlay_task_list_keyboard_escape_failed");
      pass("overlay_task_list_keyboard_nav", {
        initialFilter: overlayTaskListSnapshot?.activeFilter,
        arrowFilter: overlayTaskListAfterArrow.activeFilter
      });

      registeredShortcutHandlers.get("open-console")?.();
      const consoleWindow = windows.get("console");
      if (!consoleWindow || consoleWindow.isDestroyed?.()) {
        throw new Error("console_window_missing");
      }
      const consoleVisible = await waitForDesktopGuiSmoke(() => consoleWindow.isVisible?.() === true, 5000);
      if (!consoleVisible) throw new Error("console_window_not_visible");
      pass("global_shortcut_open_console");

      consoleWindow.focus?.();
      await waitForSmokeFrame();
      const consoleSettingsInitial = await consoleWindow.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector('[data-tab="settings"]');
        btn?.focus();
        return {
          focused: document.activeElement === btn,
          label: btn?.getAttribute("title") || btn?.textContent?.trim() || ""
        };
      })()`, true);
      if (!consoleSettingsInitial?.focused || !consoleSettingsInitial?.label) {
        throw new Error("console_settings_keyboard_focus_missing");
      }
      await sendKeyboardShortcut(consoleWindow, "Space");
      let consoleSettingsSnapshot = null;
      const consoleSettingsActive = await waitForDesktopGuiSmoke(async () => {
        consoleSettingsSnapshot = await consoleWindow.webContents.executeJavaScript(`(() => {
          const panel = document.getElementById("panel-settings");
          const activeBtn = document.querySelector('[data-tab="settings"]');
          const navLabels = [...document.querySelectorAll("#panel-settings [data-settings-nav]")]
            .map((item) => item.textContent.trim())
            .filter(Boolean);
          return {
            active: panel?.classList.contains("active") === true,
            ariaSelected: activeBtn?.getAttribute("aria-selected") || "",
            navLabels,
            hasProviderNav: navLabels.some((label) => /AI Providers|供应商|Provider/i.test(label)),
            hasPrivacyNav: navLabels.some((label) => /Privacy|Security|隐私|安全/i.test(label))
          };
        })()`, true);
        return consoleSettingsSnapshot?.active === true
          && consoleSettingsSnapshot?.ariaSelected === "true"
          && consoleSettingsSnapshot?.hasProviderNav === true
          && consoleSettingsSnapshot?.hasPrivacyNav === true;
      }, 3000);
      if (!consoleSettingsActive) throw new Error("console_settings_keyboard_nav_failed");
      pass("console_settings_keyboard_nav", {
        navCount: consoleSettingsSnapshot.navLabels.length
      });

      await consoleWindow.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector('[data-tab="schedules"]');
        btn?.focus();
        return true;
      })()`, true);
      await sendKeyboardShortcut(consoleWindow, "Space");
      let consoleScheduleSnapshot = null;
      const consoleScheduleActive = await waitForDesktopGuiSmoke(async () => {
        consoleScheduleSnapshot = await consoleWindow.webContents.executeJavaScript(`(async () => {
          const panel = document.getElementById("panel-schedules");
          const command = document.getElementById("scheduleCommandInput");
          command?.focus();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          command?.focus();
          const labels = [...document.querySelectorAll("#scheduleForm label")]
            .map((label) => label.textContent.trim())
            .filter(Boolean);
          return {
            active: panel?.classList.contains("active") === true,
            activeElementId: document.activeElement?.id || document.activeElement?.tagName || "",
            labels,
            hasCommandLabel: labels.some((label) => /Reminder|Task|要做的事/i.test(label)),
            hasCreateButton: Boolean(document.querySelector('#scheduleForm button[type="submit"]'))
          };
        })()`, true);
        return consoleScheduleSnapshot?.active === true
          && consoleScheduleSnapshot?.hasCommandLabel === true
          && consoleScheduleSnapshot?.hasCreateButton === true;
      }, 3000);
      if (!consoleScheduleActive) {
        throw new Error(`console_schedule_form_keyboard_labels_failed:${JSON.stringify(consoleScheduleSnapshot)}`);
      }
      pass("console_schedule_form_keyboard_labels", {
        labels: consoleScheduleSnapshot.labels,
        activeElementId: consoleScheduleSnapshot.activeElementId
      });

      const consoleFirstRunProviderRecovery = await consoleWindow.webContents.executeJavaScript(
        'window.__lingxyConsoleSmoke?.runFirstRunProviderSetupRecovery?.({ issueDetail: "API key missing during first-run recovery." })',
        true
      );
      if (!consoleFirstRunProviderRecovery?.ok) {
        throw new Error(`console_first_run_provider_recovery_failed:${JSON.stringify(consoleFirstRunProviderRecovery)}`);
      }
      pass("console_first_run_provider_recovery", {
        state: consoleFirstRunProviderRecovery.state,
        openButtonLabel: consoleFirstRunProviderRecovery.openButtonLabel
      });

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
      const previewVisualInitial = await previewWin.webContents.executeJavaScript(
        'window.__lingxyPreviewSmoke?.prepareGenerateDocumentScreenshotDiff?.({ taskId: "gui-smoke-doc-visual", phase: "initial" })',
        true
      );
      if (!previewVisualInitial?.ok) {
        throw new Error("preview_generate_document_screenshot_initial_failed");
      }
      previewWin.show?.();
      previewWin.focus?.();
      await waitForSmokeFrame();
      await previewWin.webContents.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        true
      );
      const previewBounds = previewWin.getContentBounds?.() ?? previewWin.getBounds?.() ?? { width: 900, height: 680 };
      const previewCaptureRect = {
        x: 0,
        y: 0,
        width: Math.max(1, Math.floor(previewBounds.width || 900)),
        height: Math.max(1, Math.floor(previewBounds.height || 680))
      };
      const previewInitialImage = await previewWin.webContents.capturePage(previewCaptureRect);
      const previewInitialStats = captureImageStats(previewInitialImage);
      if (!previewInitialStats.ok) {
        throw new Error(`preview_generate_document_screenshot_initial_blank:${JSON.stringify(previewInitialStats)}`);
      }
      const previewVisualExpanded = await previewWin.webContents.executeJavaScript(
        'window.__lingxyPreviewSmoke?.prepareGenerateDocumentScreenshotDiff?.({ taskId: "gui-smoke-doc-visual", phase: "expanded" })',
        true
      );
      if (!previewVisualExpanded?.ok) {
        throw new Error("preview_generate_document_screenshot_expanded_failed");
      }
      await waitForSmokeFrame();
      await previewWin.webContents.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        true
      );
      const previewExpandedImage = await previewWin.webContents.capturePage(previewCaptureRect);
      const previewExpandedStats = captureImageStats(previewExpandedImage);
      const previewDiffStats = compareImageStats(previewInitialImage, previewExpandedImage);
      if (!previewExpandedStats.ok || !previewDiffStats.ok) {
        throw new Error(`preview_generate_document_screenshot_diff_failed:${JSON.stringify({ previewExpandedStats, previewDiffStats })}`);
      }
      pass("preview_generate_document_screenshot_diff", {
        initialNonWhiteRatio: Number(previewInitialStats.nonWhiteRatio.toFixed(4)),
        expandedNonWhiteRatio: Number(previewExpandedStats.nonWhiteRatio.toFixed(4)),
        diffRatio: Number(previewDiffStats.diffRatio.toFixed(4)),
        averageDelta: Number(previewDiffStats.averageDelta.toFixed(2))
      });
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
              hasDownload: labels.includes("下载更新"),
              hasLater: labels.includes("稍后")
            };
          })()`, true).catch(() => null);
          if (!snapshot?.body?.includes("9.9.9-gui-smoke")) continue;
          updaterPopupWindow = candidate;
          updaterPopupSnapshot = snapshot;
          return snapshot.showing
            && snapshot.kind === "info"
            && snapshot.hasDownload
            && snapshot.hasLater;
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

      const popupRejectFocused = await popupWindow.webContents.executeJavaScript(`(() => {
        const reject = Array.from(document.querySelectorAll("#pc-actions button"))
          .find((button) => button.textContent.trim() === "拒绝");
        reject?.focus();
        return {
          focused: document.activeElement === reject,
          label: reject?.textContent?.trim() || "",
          ariaLabel: reject?.getAttribute("aria-label") || ""
        };
      })()`, true);
      if (!popupRejectFocused?.focused || popupRejectFocused?.label !== "拒绝") {
        throw new Error("popup_approval_card_keyboard_focus_failed");
      }
      await sendKeyboardShortcut(popupWindow, "Space");
      const popupClosed = await waitForDesktopGuiSmoke(() => popupWindow.isDestroyed?.() === true, 5000);
      if (!popupClosed) throw new Error("popup_approval_card_reject_did_not_close");
      pass("popup_approval_card_keyboard_reject_closes", {
        label: popupRejectFocused.label
      });

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
  return { runDesktopGuiSmoke, writeDesktopGuiSmokeResult };
}
