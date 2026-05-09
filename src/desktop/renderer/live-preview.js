// Live preview — overlay/console-side proxy (UCA-182 Phase 14 rewrite).
//
// As of Phase 14 the actual preview no longer paints inside the
// overlay window. It lives in a dedicated BrowserWindow anchored to
// the right edge of the primary display (see preview-window.html /
// preview-window.js / electron-main.mjs).
//
// This file keeps the same `window.livePreview` global API so all
// existing callers (overlay.js task-event loop, artifact buttons in
// overlay + console, showToast continue flow) keep working — but
// every call now forwards to the preview window via IPC.
//
// Public surface (unchanged):
//   window.livePreview.isFileGenTool(name)
//   window.livePreview.openForTool({ toolName, args, taskId })
//   window.livePreview.appendDelta({ toolName, partialJson, taskId })
//   window.livePreview.commit({ toolName, taskId, success, artifactPath, mime, observation })
//   window.livePreview.openForFile({ filePath, mime })
//   window.livePreview.close()
//
// The previous in-panel DOM (lp-panel, lp-chip, lp-backdrop, size
// toggles, auto-collapse) is retired with the overlay embedding.

(function initLivePreviewProxy() {
  const PREVIEWABLE_ARTIFACT_TOOLS = new Set([
    "write_file",
    "generate_document",
    "edit_file",
    "render_diagram",
    "render_svg"
  ]);

  function ensureShell() {
    return typeof window !== "undefined" ? window.ucaShell : null;
  }

  const pendingPreviewDeltas = new Map();
  let previewDeltaRaf = 0;

  function schedulePreviewDeltaFlush() {
    if (previewDeltaRaf) return;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    previewDeltaRaf = schedule(() => {
      previewDeltaRaf = 0;
      flushPreviewDeltas();
    });
  }

  function flushPreviewDeltas() {
    const shell = ensureShell();
    if (!shell?.appendPreviewDelta || pendingPreviewDeltas.size === 0) return false;
    const batch = [...pendingPreviewDeltas.values()];
    pendingPreviewDeltas.clear();
    for (const payload of batch) {
      shell.appendPreviewDelta(payload);
    }
    return true;
  }

  function openForTool({ toolName, args, taskId } = {}) {
    if (!PREVIEWABLE_ARTIFACT_TOOLS.has(toolName)) return false;
    const shell = ensureShell();
    if (!shell?.showPreviewWindow) return false;
    shell.showPreviewWindow({ kind: "tool", toolName, args: args ?? {}, taskId: taskId ?? null });
    return true;
  }

  function appendDelta({ toolName, partialJson, taskId } = {}) {
    const shell = ensureShell();
    if (!shell?.appendPreviewDelta) return false;
    const payload = { toolName, partialJson: partialJson ?? "", taskId: taskId ?? null };
    const key = `${payload.taskId ?? "active"}:${toolName ?? ""}`;
    pendingPreviewDeltas.set(key, payload);
    schedulePreviewDeltaFlush();
    return true;
  }

  function commit(payload = {}) {
    flushPreviewDeltas();
    const shell = ensureShell();
    if (!shell?.commitPreviewWindow) return false;
    shell.commitPreviewWindow(payload);
    return true;
  }

  function openForFile({ filePath, mime } = {}) {
    if (!filePath) return false;
    const shell = ensureShell();
    if (!shell?.showPreviewWindow) return false;
    shell.showPreviewWindow({ kind: "open-file", filePath, mime: mime ?? null });
    return true;
  }

  function close() {
    const shell = ensureShell();
    if (!shell?.closePreviewWindow) return false;
    shell.closePreviewWindow();
    return true;
  }

  window.livePreview = {
    isFileGenTool: (toolName) => PREVIEWABLE_ARTIFACT_TOOLS.has(toolName),
    openForTool,
    openForFile,
    appendDelta,
    commit,
    close
  };
})();
