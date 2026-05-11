export function createLinkBrowserWindowManager({
  BrowserWindow,
  screen,
  shell,
  createBrandedBrowserWindow,
  normalizeOpenableUrl,
  getCachedSettings,
  persistWindowPreferences,
  linkBrowserWindows,
  getRuntime
} = {}) {
  if (!BrowserWindow) throw new TypeError("createLinkBrowserWindowManager requires BrowserWindow.");
  if (typeof createBrandedBrowserWindow !== "function") throw new TypeError("createLinkBrowserWindowManager requires createBrandedBrowserWindow.");
  if (typeof normalizeOpenableUrl !== "function") throw new TypeError("createLinkBrowserWindowManager requires normalizeOpenableUrl.");
  if (!(linkBrowserWindows instanceof Set)) throw new TypeError("createLinkBrowserWindowManager requires linkBrowserWindows Set.");

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
    const win = createBrandedBrowserWindow(BrowserWindow, {
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
    win.on("close", flushPersistNow);
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

  function readLinkOpenPreference() {
    try {
      const config = getRuntime()?.configStore?.load?.() ?? {};
      const mode = String(config?.ui?.linkOpenMode ?? "").trim().toLowerCase();
      if (["system", "lingxy_browser", "ask"].includes(mode)) return mode;
    } catch { /* fall through */ }
    return "system";
  }

  return { showLinkBrowserWindow, readLinkOpenPreference };
}
