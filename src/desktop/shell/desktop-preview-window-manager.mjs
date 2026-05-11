import { screen } from "electron";

export function createPreviewWindowManager({
  BrowserWindow,
  brandIcons,
  buildRendererFileUrl,
  PRELOAD_PATH,
  resolvedServiceBaseUrl,
  quitting
} = {}) {
  if (!BrowserWindow) throw new TypeError("createPreviewWindowManager requires BrowserWindow.");
  if (!brandIcons?.createBrandedBrowserWindow) throw new TypeError("createPreviewWindowManager requires brandIcons.");
  if (typeof buildRendererFileUrl !== "function") throw new TypeError("createPreviewWindowManager requires buildRendererFileUrl.");
  if (typeof PRELOAD_PATH !== "string") throw new TypeError("createPreviewWindowManager requires PRELOAD_PATH.");
  if (typeof resolvedServiceBaseUrl !== "function") throw new TypeError("createPreviewWindowManager requires resolvedServiceBaseUrl getter.");
  if (typeof quitting !== "function") throw new TypeError("createPreviewWindowManager requires quitting getter.");

  let previewWindow = null;
  let previewWindowPinned = false;

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
    const baseUrl = resolvedServiceBaseUrl() ?? "";
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
      if (!quitting()) {
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
      try { win.setBounds(computePreviewBounds()); } catch { /* ignore */ }
      win.showInactive();
    } else {
      try { win.moveTop(); } catch { /* ignore */ }
    }
    return win;
  }

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
      previewPendingByChannel.set(channel, payload);
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

  function getPreviewWindow() { return previewWindow; }

  function hidePreviewWindow() {
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.hide();
  }

  function setPreviewWindowPinned(flag) {
    previewWindowPinned = Boolean(flag);
    if (previewWindow && !previewWindow.isDestroyed()) {
      try { previewWindow.setAlwaysOnTop(previewWindowPinned, "screen-saver"); } catch { /* ignore */ }
    }
    return previewWindowPinned;
  }

  return {
    sendToPreview,
    getPreviewWindow,
    hidePreviewWindow,
    setPreviewWindowPinned
  };
}
