import {
  DOCK_SIZE_PX,
  dockDefaultBounds,
  normalizeDockBounds
} from "./dock-geometry.mjs";

export const DOCK_HUD_SCROLL_LOCK_CSS = `
  html, body, #dockButton {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    overflow: clip !important;
    overscroll-behavior: none !important;
    scrollbar-width: none !important;
  }
  #dockButton {
    display: block !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    transform-origin: center center !important;
  }
  #dockButton canvas,
  canvas#orbCanvas {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
  }
  html::-webkit-scrollbar,
  body::-webkit-scrollbar,
  #dockButton::-webkit-scrollbar,
  *::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
  }
`;

export function getManagedWindowBounds(windowId, browserWindow) {
  if (windowId === "dock" && typeof browserWindow.getContentBounds === "function") {
    return browserWindow.getContentBounds();
  }
  return browserWindow.getBounds();
}

export function setManagedWindowBounds(windowId, browserWindow, bounds) {
  if (windowId === "dock" && typeof browserWindow.setContentBounds === "function") {
    browserWindow.setContentBounds(bounds);
    return;
  }
  browserWindow.setBounds(bounds);
}

export function lockWindowRendererZoom(windowDef, browserWindow) {
  if (!windowDef?.locksRendererZoom || !browserWindow?.webContents || browserWindow.webContents.isDestroyed?.()) {
    return;
  }
  // Tiny HUD windows are sized by Electron content bounds. If Chromium
  // restores or accepts page zoom above 100%, CSS boxes can exceed the
  // content viewport and native scrollbars appear.
  try { browserWindow.webContents.setZoomFactor?.(1); } catch { /* ignore */ }
  try { void browserWindow.webContents.setVisualZoomLevelLimits?.(1, 1); } catch { /* ignore */ }
}

export function equalWindowBounds(left = {}, right = {}) {
  return Math.round(left.x ?? 0) === Math.round(right.x ?? 0)
    && Math.round(left.y ?? 0) === Math.round(right.y ?? 0)
    && Math.round(left.width ?? 0) === Math.round(right.width ?? 0)
    && Math.round(left.height ?? 0) === Math.round(right.height ?? 0);
}

export function installDockHudScrollLock(browserWindow) {
  if (!browserWindow?.webContents || browserWindow.webContents.isDestroyed?.()) return;
  try {
    void browserWindow.webContents.insertCSS(DOCK_HUD_SCROLL_LOCK_CSS, { cssOrigin: "author" });
  } catch { /* ignore */ }
}

export function createDesktopWindowBounds({
  screen,
  dockWindowId = "dock",
  getWindowPreferences,
  getWindowSizeLimits
} = {}) {
  if (!screen) throw new TypeError("createDesktopWindowBounds requires screen.");
  if (typeof getWindowPreferences !== "function") {
    throw new TypeError("createDesktopWindowBounds requires getWindowPreferences.");
  }
  if (typeof getWindowSizeLimits !== "function") {
    throw new TypeError("createDesktopWindowBounds requires getWindowSizeLimits.");
  }

  function clampWindowBounds(windowId, bounds = {}, options = {}) {
    const fallbackWorkArea = screen.getPrimaryDisplay().workArea;
    if (windowId === dockWindowId) {
      const tentativeDockBounds = {
        x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : fallbackWorkArea.x,
        y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : fallbackWorkArea.y,
        width: Number.isFinite(bounds.width) ? Math.round(bounds.width) : DOCK_SIZE_PX,
        height: Number.isFinite(bounds.height) ? Math.round(bounds.height) : DOCK_SIZE_PX
      };
      const dockDisplay = screen.getDisplayMatching?.(tentativeDockBounds) ?? screen.getPrimaryDisplay();
      return normalizeDockBounds(tentativeDockBounds, dockDisplay, {
        fallbackArea: fallbackWorkArea,
        migrateLegacy: Boolean(options.migrateLegacy),
        snap: options.mode === "move"
      });
    }
    const limits = getWindowSizeLimits(windowId);
    const width = Math.max(limits.minWidth, Math.min(limits.maxWidth, Math.round(bounds.width ?? limits.minWidth)));
    const height = Math.max(limits.minHeight, Math.min(limits.maxHeight, Math.round(bounds.height ?? limits.minHeight)));
    const tentative = {
      x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : fallbackWorkArea.x,
      y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : fallbackWorkArea.y,
      width,
      height
    };
    const matchingDisplay = screen.getDisplayMatching?.(tentative) ?? screen.getPrimaryDisplay();
    const workArea = matchingDisplay.workArea ?? fallbackWorkArea;
    const overlayMove = windowId === "overlay" && options.mode === "move";
    const visibleMargin = overlayMove ? 96 : 0;
    const minX = overlayMove ? workArea.x - width + visibleMargin : workArea.x;
    const minY = overlayMove ? workArea.y - height + visibleMargin : workArea.y;
    const maxX = overlayMove
      ? workArea.x + workArea.width - visibleMargin
      : workArea.x + Math.max(0, workArea.width - width);
    const maxY = overlayMove
      ? workArea.y + workArea.height - visibleMargin
      : workArea.y + Math.max(0, workArea.height - height);
    let x = Math.max(minX, Math.min(maxX, tentative.x));
    let y = Math.max(minY, Math.min(maxY, tentative.y));
    return {
      x,
      y,
      width,
      height
    };
  }

  function getDefaultWindowBounds(windowDef, browserWindow) {
    const { workArea } = screen.getPrimaryDisplay();
    const [currentWidth, currentHeight] = browserWindow.getSize();
    const width = currentWidth || windowDef.width;
    const height = currentHeight || windowDef.height;
    if (windowDef.id === dockWindowId) {
      return dockDefaultBounds(screen.getPrimaryDisplay(), { fallbackArea: workArea });
    }
    if (windowDef.id === "overlay") {
      return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.max(workArea.y, workArea.y + workArea.height - height - 16),
        width,
        height
      };
    }
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + Math.max(0, workArea.height - height) / 2),
      width,
      height
    };
  }

  function resolveWindowBounds(windowDef, browserWindow) {
    const prefs = getWindowPreferences(windowDef.id);
    const defaults = getDefaultWindowBounds(windowDef, browserWindow);
    if (prefs?.bounds && Number.isFinite(prefs.bounds.x) && Number.isFinite(prefs.bounds.y) && Number.isFinite(prefs.bounds.width) && Number.isFinite(prefs.bounds.height)) {
      // Dock is a fixed-size 48x48 orb. Some past sessions persisted the
      // Electron BrowserWindow default 320x240 into settings.json. Preserve
      // the old size long enough for dock geometry migration to project legacy
      // right/bottom-edge intent onto the current content bounds.
      const bounds = prefs.bounds;
      return clampWindowBounds(windowDef.id, bounds, { migrateLegacy: windowDef.id === dockWindowId });
    }
    return clampWindowBounds(windowDef.id, defaults);
  }

  function enforceDockWindowInvariants(browserWindow, bounds = null) {
    if (!browserWindow || browserWindow.isDestroyed?.()) return null;
    const limits = getWindowSizeLimits(dockWindowId);
    try { browserWindow.setResizable?.(false); } catch { /* ignore */ }
    try { browserWindow.setMinimumSize?.(limits.minWidth, limits.minHeight); } catch { /* ignore */ }
    try { browserWindow.setMaximumSize?.(limits.maxWidth, limits.maxHeight); } catch { /* ignore */ }
    lockWindowRendererZoom({ locksRendererZoom: true }, browserWindow);
    const currentBounds = bounds ?? getManagedWindowBounds(dockWindowId, browserWindow);
    const nextBounds = clampWindowBounds(dockWindowId, {
      ...currentBounds,
      width: limits.minWidth,
      height: limits.minHeight
    });
    if (equalWindowBounds(currentBounds, nextBounds)) return null;
    setManagedWindowBounds(dockWindowId, browserWindow, nextBounds);
    return nextBounds;
  }

  return {
    clampWindowBounds,
    enforceDockWindowInvariants,
    getDefaultWindowBounds,
    getManagedWindowBounds,
    installDockHudScrollLock,
    lockWindowRendererZoom,
    resolveWindowBounds,
    setManagedWindowBounds
  };
}
