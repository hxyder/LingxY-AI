import path from "node:path";
import { readdir, unlink } from "node:fs/promises";

export function createInitialTrayMenu({
  Menu,
  showWindow,
  quitApp
} = {}) {
  return Menu.buildFromTemplate([
    {
      label: "Open Console",
      click() {
        showWindow("console");
      }
    },
    {
      label: "Open Overlay",
      click() {
        showWindow("overlay");
      }
    },
    {
      label: "Quit",
      click() {
        quitApp();
      }
    }
  ]);
}

export function createDockContextMenuController({
  Menu,
  getWindow,
  getServiceBaseUrl,
  loadSettings,
  updateSettings,
  showWindow,
  quitApp,
  safeWarn
} = {}) {
  function notifyDockWindow(channel, payload) {
    const dock = getWindow("dock");
    if (dock && !dock.webContents?.isDestroyed?.()) {
      dock.webContents.send(channel, payload);
      return true;
    }
    return false;
  }

  async function fetchEchoTtsMenuState() {
    const fallback = { preference: { enabled: true }, engineUnavailable: false };
    const serviceBaseUrl = getServiceBaseUrl();
    if (!serviceBaseUrl) return fallback;
    try {
      const ttsResp = await fetch(`${serviceBaseUrl}/echo/tts/preference`, {
        method: "GET",
        headers: { "x-uca-actor": "desktop_shell" },
        signal: AbortSignal.timeout(500)
      });
      if (!ttsResp.ok) return fallback;
      const ttsData = await ttsResp.json().catch(() => ({}));
      return {
        preference: ttsData.preference ?? fallback.preference,
        engineUnavailable: Boolean(ttsData.engineUnavailable)
      };
    } catch {
      return fallback;
    }
  }

  async function setEchoTtsEnabled(enabled) {
    const serviceBaseUrl = getServiceBaseUrl();
    if (!serviceBaseUrl) return;
    try {
      await fetch(`${serviceBaseUrl}/echo/tts/preference`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-uca-actor": "desktop_shell" },
        body: JSON.stringify({ enabled })
      });
    } catch { /* surfaced visually next time the menu opens */ }
  }

  async function clearUserKeywordSamples() {
    try {
      const dir = path.resolve(process.cwd(), "models", "user-keywords");
      const files = await readdir(dir).catch(() => []);
      await Promise.all(files
        .filter((fileName) => fileName.endsWith(".txt")
          || fileName.endsWith(".webm")
          || fileName.endsWith(".wav")
          || fileName.endsWith(".json"))
        .map((fileName) => unlink(path.join(dir, fileName)).catch(() => null)));
      notifyDockWindow("uca:echo-bubble-show", {
        text: "✓ 个人唤醒词样本已清除",
        kind: "info",
        durationMs: 1800
      });
    } catch (err) {
      safeWarn?.("[LingxY] clear-user-keywords failed:", err?.message ?? err);
    }
  }

  function buildDockContextMenu({ current, ttsPreference, ttsEngineUnavailable }) {
    return Menu.buildFromTemplate([
      {
        label: "正常模式",
        type: "radio",
        checked: !current.echoMode,
        click() { void updateSettings({ echoMode: false }); }
      },
      {
        label: "Echo 模式（常开唤醒）",
        type: "radio",
        checked: Boolean(current.echoMode),
        click() { void updateSettings({ echoMode: true }); }
      },
      { type: "separator" },
      {
        label: ttsEngineUnavailable
          ? "语音回复（系统 TTS 不可用）"
          : "语音回复",
        type: "checkbox",
        checked: Boolean(ttsPreference.enabled) && !ttsEngineUnavailable,
        enabled: !ttsEngineUnavailable,
        click(menuItem) { void setEchoTtsEnabled(menuItem.checked); }
      },
      { type: "separator" },
      {
        label: "录入我的唤醒词（3 次）...",
        enabled: Boolean(current.echoMode),
        click() {
          notifyDockWindow("uca:start-wake-enrollment", { at: Date.now() });
        }
      },
      {
        label: "清除个人唤醒词样本",
        enabled: Boolean(current.echoMode),
        click() {
          void clearUserKeywordSamples();
        }
      },
      { type: "separator" },
      {
        label: "打开 Dock 开发者工具（查看 Echo 日志）",
        click() {
          const dock = getWindow("dock");
          if (dock && !dock.webContents?.isDestroyed?.()) {
            try { dock.webContents.openDevTools({ mode: "detach" }); } catch { /* ignore */ }
          }
        }
      },
      { type: "separator" },
      { label: "打开主控台", click() { showWindow("console"); } },
      { label: "打开对话框", click() { showWindow("overlay"); } },
      { type: "separator" },
      { label: "退出 LingxY", click() { quitApp(); } }
    ]);
  }

  async function showDockContextMenu() {
    const current = await loadSettings();
    const dockWin = getWindow("dock");
    if (!dockWin || dockWin.webContents?.isDestroyed?.()) return;
    const { preference, engineUnavailable } = await fetchEchoTtsMenuState();
    const menu = buildDockContextMenu({
      current,
      ttsPreference: preference,
      ttsEngineUnavailable: engineUnavailable
    });
    menu.popup({ window: dockWin });
  }

  return {
    buildDockContextMenu,
    clearUserKeywordSamples,
    fetchEchoTtsMenuState,
    notifyDockWindow,
    setEchoTtsEnabled,
    showDockContextMenu
  };
}
