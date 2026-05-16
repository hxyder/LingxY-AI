export const NOTIFICATION_BATCH_MS = 500;

export function notificationBodyLines(payload, defaultLimit = 4) {
  const body = payload.allowLongBody === true && payload.inlinePreview
    ? payload.inlinePreview
    : (payload.body ?? payload.message ?? "");
  if (!body) return [];
  const lines = String(body).split(/\r?\n/);
  if (payload.allowLongBody === true && payload.forcePopup === true) return lines;
  const limit = payload.allowLongBody === true ? 240 : payload.kind === "success" ? 80 : defaultLimit;
  if (lines.length <= limit) return lines;
  return [
    ...lines.slice(0, limit),
    `... ${lines.length - limit} more line(s). Open the conversation for the full result.`
  ];
}

export function normalizeBatchEntry(payload) {
  return {
    title: payload.title ?? "LingxY",
    lines: notificationBodyLines(payload),
    kind: payload.kind ?? "info",
    taskId: payload.taskId ?? null,
    conversationId: payload.conversationId ?? null,
    artifactPath: payload.artifactPath ?? null,
    mime: payload.mime ?? null,
    inlinePreview: payload.inlinePreview ?? null,
    openWindow: payload.openWindow ?? null,
    handoff: payload.handoff ?? null,
    allowLongBody: payload.allowLongBody ?? null,
    allowContinue: payload.allowContinue ?? null,
    forcePopup: payload.forcePopup ?? null,
    buttons: Array.isArray(payload.buttons) ? payload.buttons : null,
    addedAt: Date.now()
  };
}

export function createDesktopNotificationCenter({
  getWindows,
  getPopupCardManager,
  Notification,
  brandIcons,
  safeWarn,
  appendDiagnostic
} = {}) {
  const notificationBatches = new Map();

  function flushBatch(taskId) {
    const batch = notificationBatches.get(taskId);
    if (!batch) return;
    clearTimeout(batch.timer);
    notificationBatches.delete(taskId);
    if (!batch.entries.length) return;
    const popupCardManager = getPopupCardManager?.();
    if (!popupCardManager) return;
    try {
      if (batch.entries.length === 1) {
        const only = batch.entries[0];
        popupCardManager.showCard({
          kind: only.kind === "info" ? "info" : only.kind,
          title: only.title,
          lines: only.lines,
          taskId,
          conversationId: only.conversationId ?? null,
          autoHideMs: 8000,
          artifactPath: only.artifactPath,
          mime: only.mime,
          inlinePreview: only.inlinePreview,
          openWindow: only.openWindow,
          allowContinue: only.allowContinue,
          forcePopup: only.forcePopup,
          dedupeKey: `notify:${taskId}`
        });
      } else {
        popupCardManager.showCard({
          kind: "batched",
          title: `${batch.primaryTitle} (${batch.entries.length})`,
          taskId,
          conversationId: batch.entries.find((entry) => entry.conversationId)?.conversationId ?? null,
          entries: batch.entries,
          autoHideMs: 12000,
          dedupeKey: `batched:${taskId}`
        });
      }
    } catch (err) {
      safeWarn("[LingxY] batched popup-card flush failed:", err?.message ?? err);
    }
  }

  function queueBatchedNotification(payload) {
    const taskId = payload.taskId ?? "_no_task_";
    let batch = notificationBatches.get(taskId);
    if (!batch) {
      batch = { entries: [], timer: null, primaryTitle: payload.title ?? "LingxY" };
      notificationBatches.set(taskId, batch);
    }
    batch.entries.push(normalizeBatchEntry(payload));
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flushBatch(taskId), NOTIFICATION_BATCH_MS);
  }

  function showDesktopNotification(payload = {}) {
    const windows = getWindows?.() ?? new Map();
    const uiOpen = ["overlay", "console"].some((id) => {
      const win = windows.get(id);
      return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
    });
    if (payload.kind === "success" && uiOpen && payload.forcePopup !== true) {
      return { shown: false, reason: "primary_ui_visible" };
    }

    const popupCardManager = getPopupCardManager?.();
    if (popupCardManager) {
      try {
        const skipBatch =
          payload.skipBatch === true ||
          payload.kind === "error" ||
          payload.kind === "approval" ||
          (payload.forcePopup === true && payload.allowLongBody === true) ||
          !payload.taskId;
        if (skipBatch) {
          popupCardManager.showCard({
            kind: payload.kind ?? "info",
            title: payload.title ?? "LingxY",
            lines: notificationBodyLines(payload),
            taskId: payload.taskId ?? null,
            conversationId: payload.conversationId ?? null,
            autoHideMs: payload.autoHideMs ?? 8000,
            artifactPath: payload.artifactPath ?? null,
            mime: payload.mime ?? null,
            inlinePreview: payload.inlinePreview ?? null,
            openWindow: payload.openWindow ?? null,
            handoff: payload.handoff ?? null,
            allowContinue: payload.allowContinue ?? null,
            buttons: Array.isArray(payload.buttons) ? payload.buttons : null,
            dedupeKey: payload.dedupeKey
              ?? (payload.taskId ? `notify:${payload.taskId}` : undefined)
          });
          return { shown: true, delivery: "popup_card" };
        }
        queueBatchedNotification(payload);
        return { shown: true, delivery: "popup_card_batched" };
      } catch (err) {
        safeWarn("[LingxY] popup-card notify failed, falling back:", err?.message ?? err);
      }
    }

    if (!Notification?.isSupported?.()) {
      return { shown: false, reason: "unsupported" };
    }

    const notification = brandIcons.createBrandedNotification(Notification, {
      title: payload.title ?? "LingxY",
      body: payload.body ?? payload.message ?? "",
      silent: false
    });
    notification.show();
    return { shown: true, delivery: "native_notification" };
  }

  async function safeNotify(payload = {}) {
    return showDesktopNotification({
      kind: payload.kind ?? "info",
      ...payload
    });
  }

  async function notifyAutoUpdater({ kind, payload } = {}) {
    if (kind === "update-available") {
      const version = payload?.info?.version ?? "";
      const isDownloading = payload?.autoDownload === true;
      await safeNotify({
        title: isDownloading ? "正在下载更新" : "发现新版本",
        body: isDownloading
          ? `LingxY ${version} 正在下载。下载完成后会提示你重启更新。`
          : `LingxY ${version} 可下载。点击下载后，完成时再选择是否重启。`,
        taskId: `updater:available:${payload?.info?.version ?? "unknown"}`,
        dedupeKey: `updater:available:${payload?.info?.version ?? "unknown"}`,
        allowContinue: false,
        skipBatch: true,
        buttons: isDownloading
          ? [
              { id: "settings", actionKey: "updater:settings", label: "打开设置" },
              { id: "dismiss", actionKey: "dismiss", label: "稍后" }
            ]
          : [
              { id: "download", actionKey: "updater:download", label: "下载更新", primary: true },
              { id: "dismiss", actionKey: "dismiss", label: "稍后" }
            ]
      });
      return;
    }
    if (kind === "update-ready") {
      await safeNotify({
        title: "新版本已下载",
        body: `LingxY ${payload?.info?.version ?? ""} 已就绪。重启即可生效。`,
        taskId: `updater:ready:${payload?.info?.version ?? "unknown"}`,
        dedupeKey: `updater:ready:${payload?.info?.version ?? "unknown"}`,
        allowContinue: false,
        skipBatch: true,
        buttons: [
          { id: "apply", actionKey: "updater:apply", label: "重启更新", primary: true },
          { id: "settings", actionKey: "updater:settings", label: "打开设置" },
          { id: "dismiss", actionKey: "dismiss", label: "稍后" }
        ]
      });
      return;
    }
    if (kind === "update-error") {
      void appendDiagnostic?.("auto_updater_user_facing", new Error(payload?.message ?? "unknown"), { phase: payload?.phase });
    }
  }

  return {
    showDesktopNotification,
    safeNotify,
    notifyAutoUpdater,
    flushBatch
  };
}
