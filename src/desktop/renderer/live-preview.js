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
//   window.livePreview.openForTool({ toolName, args })
//   window.livePreview.appendDelta({ toolName, partialJson })
//   window.livePreview.commit({ toolName, success, artifactPath, mime, observation })
//   window.livePreview.openForFile({ filePath, mime })
//   window.livePreview.close()
//
// The previous in-panel DOM (lp-panel, lp-chip, lp-backdrop, size
// toggles, auto-collapse) is retired with the overlay embedding.

(function initLivePreviewProxy() {
  const FILE_GEN_TOOLS = new Set(["write_file", "generate_document", "edit_file"]);

  function ensureShell() {
    return typeof window !== "undefined" ? window.ucaShell : null;
  }

  function openForTool({ toolName, args } = {}) {
    if (!FILE_GEN_TOOLS.has(toolName)) return false;
    const shell = ensureShell();
    if (!shell?.showPreviewWindow) return false;
    shell.showPreviewWindow({ kind: "tool", toolName, args: args ?? {} });
    return true;
  }

  function appendDelta({ toolName, partialJson } = {}) {
    const shell = ensureShell();
    if (!shell?.appendPreviewDelta) return false;
    shell.appendPreviewDelta({ toolName, partialJson: partialJson ?? "" });
    return true;
  }

  function commit(payload = {}) {
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
    isFileGenTool: (toolName) => FILE_GEN_TOOLS.has(toolName),
    openForTool,
    openForFile,
    appendDelta,
    commit,
    close
  };
})();
