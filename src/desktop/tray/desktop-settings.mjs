import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { DOCK_SIZE_PX } from "./dock-geometry.mjs";

export const WINDOW_ALWAYS_ON_TOP_DEFAULTS = Object.freeze({
  dock: true,
  overlay: false,
  console: false,
  "echo-bubble": true
});

export const WINDOW_SIZE_LIMITS = Object.freeze({
  dock: { minWidth: DOCK_SIZE_PX, minHeight: DOCK_SIZE_PX, maxWidth: DOCK_SIZE_PX, maxHeight: DOCK_SIZE_PX },
  overlay: { minWidth: 420, minHeight: 360, maxWidth: 1400, maxHeight: 1200 }
});

export function defaultDesktopSettingsPath() {
  return path.join(os.homedir(), "AppData", "Local", "UCA", "settings.json");
}

export function mergeSettingsDefaults(raw = {}) {
  return {
    echoMode: false,
    echoWake: {
      displayName: "linxi",
      phrases: [],
      includeDefault: true
    },
    windowPreferences: {},
    ...raw,
    echoWake: {
      displayName: raw?.echoWake?.displayName || "linxi",
      phrases: Array.isArray(raw?.echoWake?.phrases) ? raw.echoWake.phrases : [],
      includeDefault: raw?.echoWake?.includeDefault !== false
    },
    windowPreferences: {
      ...(raw?.windowPreferences ?? {})
    }
  };
}

export function createDesktopSettingsStore({
  settingsPath = defaultDesktopSettingsPath(),
  broadcastSettings = () => {},
  safeError = console.error
} = {}) {
  let settingsCache = null;

  async function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const text = await readFile(settingsPath, "utf8");
      settingsCache = mergeSettingsDefaults(JSON.parse(text));
    } catch {
      settingsCache = mergeSettingsDefaults();
    }
    return settingsCache;
  }

  async function saveSettings() {
    try {
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settingsCache ?? {}, null, 2), "utf8");
    } catch (err) {
      safeError("[LingxY] failed to persist settings:", err?.message ?? err);
    }
  }

  async function updateSettings(patch) {
    const current = await loadSettings();
    settingsCache = mergeSettingsDefaults({
      ...current,
      ...patch,
      windowPreferences: {
        ...(current?.windowPreferences ?? {}),
        ...(patch?.windowPreferences ?? {})
      },
      echoWake: patch?.echoWake
        ? mergeSettingsDefaults({ echoWake: patch.echoWake }).echoWake
        : current?.echoWake
    });
    await saveSettings();
    broadcastSettings(settingsCache);
    return settingsCache;
  }

  function getCachedSettings() {
    return settingsCache;
  }

  function getWindowPreferences(windowId) {
    return settingsCache?.windowPreferences?.[windowId] ?? {};
  }

  function isWindowAlwaysOnTop(windowId) {
    if (windowId === "dock") return true;
    const prefs = getWindowPreferences(windowId);
    if (typeof prefs.alwaysOnTop === "boolean") return prefs.alwaysOnTop;
    return WINDOW_ALWAYS_ON_TOP_DEFAULTS[windowId] ?? false;
  }

  function getWindowSizeLimits(windowId) {
    return WINDOW_SIZE_LIMITS[windowId] ?? { minWidth: 320, minHeight: 240, maxWidth: 2000, maxHeight: 1600 };
  }

  function persistWindowPreferences(windowId, patch = {}) {
    void (async () => {
      const current = await loadSettings();
      const existing = current.windowPreferences?.[windowId] ?? {};
      await updateSettings({
        windowPreferences: {
          [windowId]: {
            ...existing,
            ...patch
          }
        }
      });
    })();
  }

  return {
    settingsPath,
    loadSettings,
    updateSettings,
    getCachedSettings,
    getWindowPreferences,
    isWindowAlwaysOnTop,
    getWindowSizeLimits,
    persistWindowPreferences
  };
}
