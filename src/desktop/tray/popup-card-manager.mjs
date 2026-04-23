// Popup-card manager — creates floating BrowserWindow cards for approval
// prompts and task-completion notices. Unlike the other shell windows, these
// are dynamic (multiple cards can stack) so they live outside the normal
// DESKTOP_SHELL_MANIFEST registration path.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "../shared/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const CARD_HTML = path.join(RENDERER_DIR, "popup-card.html");
const PRELOAD_PATH = path.join(RENDERER_DIR, "preload.cjs");

const CARD_WIDTH = 380;
const CARD_HEIGHT_MIN = 150;
const CARD_HEIGHT_MAX = 480;
const CARD_GAP = 8;
const MAX_CARDS = 5;

// Initial height estimate for the window before the renderer measures its
// real content. The renderer sends a popupCardResize IPC with the actual
// scrollHeight once paint settles, so this is only used for the first frame.
// CJK chars are ~2× wider than ASCII, so we assume ~16 chars per wrapped
// line at 356px content width.
function estimateCardHeight(payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [payload?.body].filter(Boolean);
  let logicalLines = 0;
  for (const line of lines) {
    const s = String(line ?? "");
    if (!s) { logicalLines += 1; continue; }
    // explicit newlines + wrapping at ~18 chars (CJK-safe avg)
    for (const segment of s.split(/\r?\n/)) {
      logicalLines += Math.max(1, Math.ceil(segment.length / 18));
    }
  }
  const bodyRows = Math.max(2, logicalLines);
  // chrome: 40 header + 48 actions (with possible wrap margin) = ~92px.
  // each wrapped line ~20px at 13px font / line-height 1.5.
  const estimated = 92 + bodyRows * 20;
  return Math.min(CARD_HEIGHT_MAX, Math.max(CARD_HEIGHT_MIN, estimated));
}

export function createPopupCardManager({ BrowserWindow, screen, ipcMain, resolveServiceBaseUrl }) {
  const cards = new Map(); // cardId -> { window, kind, pinned, payload, resolve }
  const pendingInit = new Map();

  function buildCardUrl(cardId) {
    const url = new URL(pathToFileURL(CARD_HTML).toString());
    url.searchParams.set("cardId", cardId);
    url.searchParams.set("serviceBaseUrl", resolveServiceBaseUrl?.() ?? "");
    return url.toString();
  }

  function computeStackPosition(workArea, yCursor) {
    const x = workArea.x + workArea.width - CARD_WIDTH - 16;
    return { x, y: yCursor };
  }

  function reflowStack() {
    const { workArea } = screen.getPrimaryDisplay();
    let yCursor = workArea.y + 16;
    for (const entry of cards.values()) {
      if (entry.window.isDestroyed()) continue;
      const height = entry.height ?? CARD_HEIGHT_MIN;
      const { x, y } = computeStackPosition(workArea, yCursor);
      try {
        entry.window.setBounds({ x, y, width: CARD_WIDTH, height });
      } catch { /* window going away */ }
      yCursor += height + CARD_GAP;
    }
  }

  function dedupeKey(payload) {
    if (payload?.dedupeKey) return payload.dedupeKey;
    if (payload?.kind === "approval" && payload?.approvalId) return `approval:${payload.approvalId}`;
    if (payload?.kind === "success" && payload?.taskId) return `success:${payload.taskId}`;
    if (payload?.kind === "error" && payload?.taskId) return `error:${payload.taskId}`;
    return null;
  }

  function findExistingByDedupe(key) {
    if (!key) return null;
    for (const entry of cards.values()) {
      if (entry.dedupeKey === key) return entry;
    }
    return null;
  }

  function showCard(rawPayload = {}) {
    const payload = { ...rawPayload };
    const key = dedupeKey(payload);
    if (key) {
      const existing = findExistingByDedupe(key);
      if (existing) {
        // Re-surface the existing card; update its contents if different.
        try {
          if (!existing.window.isVisible()) existing.window.showInactive();
          existing.window.moveTop();
          existing.window.webContents.send(IPC_CHANNELS.popupCardInit, { cardId: existing.cardId, ...payload });
        } catch { /* ignore */ }
        return { accepted: true, cardId: existing.cardId, reused: true };
      }
    }

    if (cards.size >= MAX_CARDS) {
      // evict the oldest non-pinned card
      for (const [cardId, entry] of cards) {
        if (!entry.pinned) {
          closeCard(cardId, "evicted");
          break;
        }
      }
    }

    const cardId = randomUUID();
    const height = estimateCardHeight(payload);
    const { workArea } = screen.getPrimaryDisplay();
    let yCursor = workArea.y + 16;
    for (const entry of cards.values()) {
      if (entry.window.isDestroyed()) continue;
      yCursor += (entry.height ?? CARD_HEIGHT_MIN) + CARD_GAP;
    }
    const { x, y } = computeStackPosition(workArea, yCursor);

    const window = new BrowserWindow({
      width: CARD_WIDTH,
      height,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      focusable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      title: `LingxY Popup ${cardId.slice(0, 8)}`,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        preload: PRELOAD_PATH
      }
    });

    const entry = {
      cardId,
      window,
      kind: payload.kind ?? "info",
      pinned: false,
      payload,
      dedupeKey: key,
      height,
      settledAction: null
    };
    cards.set(cardId, entry);

    const initPayload = { cardId, ...payload };
    pendingInit.set(cardId, initPayload);

    window.webContents.on("did-finish-load", () => {
      window.webContents.send(IPC_CHANNELS.popupCardInit, initPayload);
      try {
        window.setAlwaysOnTop(true, "screen-saver");
      } catch { /* ignore */ }
      window.showInactive();
    });

    window.on("closed", () => {
      cards.delete(cardId);
      pendingInit.delete(cardId);
      reflowStack();
    });

    window.loadURL(buildCardUrl(cardId));
    return { accepted: true, cardId, reused: false };
  }

  function closeCard(cardId, reason = "user") {
    const entry = cards.get(cardId);
    if (!entry) return false;
    try {
      entry.window.destroy();
    } catch { /* ignore */ }
    cards.delete(cardId);
    pendingInit.delete(cardId);
    reflowStack();
    return true;
  }

  function togglePin(cardId, pinned) {
    const entry = cards.get(cardId);
    if (!entry) return false;
    entry.pinned = Boolean(pinned);
    return true;
  }

  function resizeCard(cardId, requestedHeight) {
    const entry = cards.get(cardId);
    if (!entry || entry.window.isDestroyed()) return false;
    const height = Math.min(
      CARD_HEIGHT_MAX,
      Math.max(CARD_HEIGHT_MIN, Math.ceil(Number(requestedHeight) || CARD_HEIGHT_MIN))
    );
    if (height === entry.height) return true;
    entry.height = height;
    reflowStack();
    return true;
  }

  function resolveCard(cardId, payload) {
    const entry = cards.get(cardId);
    if (!entry) return { ok: false };
    entry.settledAction = payload?.action ?? null;
    // The actual API call (approve/reject) happens in the caller; this method
    // just surfaces the action so tray/electron-main.mjs can dispatch it.
    return { ok: true, card: { cardId, kind: entry.kind, payload: entry.payload, action: entry.settledAction, meta: payload } };
  }

  function registerIpcHandlers({ onResolve } = {}) {
    ipcMain.handle(IPC_CHANNELS.popupCardShow, (_event, payload = {}) => showCard(payload));
    ipcMain.handle(IPC_CHANNELS.popupCardClose, (_event, cardId, options = {}) => {
      return closeCard(cardId, options?.reason ?? "user");
    });
    ipcMain.handle(IPC_CHANNELS.popupCardTogglePin, (_event, cardId, pinned) => togglePin(cardId, pinned));
    ipcMain.handle(IPC_CHANNELS.popupCardResize, (_event, cardId, height) => resizeCard(cardId, height));
    ipcMain.handle(IPC_CHANNELS.popupCardResolve, async (_event, cardId, meta = {}) => {
      const info = resolveCard(cardId, meta);
      if (!info.ok) return { ok: false };
      if (typeof onResolve === "function") {
        try { await onResolve(info.card); } catch { /* ignore — main logs */ }
      }
      return { ok: true };
    });
  }

  function shutdown() {
    for (const cardId of [...cards.keys()]) closeCard(cardId, "shutdown");
  }

  return {
    showCard,
    closeCard,
    togglePin,
    registerIpcHandlers,
    shutdown,
    listCards: () => [...cards.values()].map((entry) => ({
      cardId: entry.cardId,
      kind: entry.kind,
      pinned: entry.pinned
    }))
  };
}
