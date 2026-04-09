export const CONTEXT_MENU_DEFINITIONS = Object.freeze([
  {
    id: "uca.summarize-selection",
    title: "用 UCA 总结",
    contexts: ["selection"]
  },
  {
    id: "uca.translate-selection",
    title: "用 UCA 翻译",
    contexts: ["selection"]
  },
  {
    id: "uca.fetch-link",
    title: "用 UCA 抓取并总结",
    contexts: ["link"]
  },
  {
    id: "uca.inspect-image",
    title: "用 UCA 分析图片",
    contexts: ["image"]
  }
]);

export const DEFAULT_OVERLAY_SETTINGS = Object.freeze({
  enabled: true,
  displayMode: "smart",
  minLength: 5,
  longSelectionMinLength: 32,
  autoHideMs: 5000,
  previewDelayMs: 300,
  debounceMs: 150,
  stabilityMs: 200,
  blockedDomains: ["mail.google.com", "outlook.live.com"],
  blacklistMode: "suffix"
});

export function createContextMenuDefinitions() {
  return CONTEXT_MENU_DEFINITIONS.map((item) => ({ ...item }));
}

async function ensureOverlayDefaults(chromeApi = chrome) {
  const stored = await chromeApi.storage.local.get(["ucaOverlaySettings", "ucaOverlaySecurityState"]);
  if (!stored.ucaOverlaySettings) {
    await chromeApi.storage.local.set({
      ucaOverlaySettings: DEFAULT_OVERLAY_SETTINGS
    });
  }
  if (!stored.ucaOverlaySecurityState) {
    await chromeApi.storage.local.set({
      ucaOverlaySecurityState: {
        presenterMode: false
      }
    });
  }
}

export function buildNativeRequest({ menuItemId, info, tab, selectionState }) {
  const actionByMenuId = {
    "uca.summarize-selection": {
      userCommand: "请总结这段网页内容",
      sourceType: "text_selection"
    },
    "uca.translate-selection": {
      userCommand: "请翻译这段网页内容",
      sourceType: "text_selection"
    },
    "uca.fetch-link": {
      userCommand: "请抓取并总结这个链接",
      sourceType: "link"
    },
    "uca.inspect-image": {
      userCommand: "请分析这张图片",
      sourceType: "image"
    }
  };

  const selected = actionByMenuId[menuItemId];
  if (!selected) {
    throw new Error(`Unsupported context menu action: ${menuItemId}`);
  }

  return {
    protocolVersion: "1.0",
    requestId: crypto.randomUUID(),
    action: "submit_capture",
    payload: {
      userCommand: selected.userCommand,
      capture: {
        sourceType: selected.sourceType,
        browser: "chrome.exe",
        url: info.linkUrl ?? info.pageUrl ?? tab?.url,
        pageTitle: tab?.title,
        text: selectionState?.text ?? info.selectionText ?? "",
        selectionText: selectionState?.text ?? info.selectionText ?? "",
        contextBefore: selectionState?.contextBefore ?? "",
        contextAfter: selectionState?.contextAfter ?? "",
        anchorText: info.linkText ?? "",
        imageUrl: info.srcUrl ?? "",
        tabId: tab?.id
      }
    }
  };
}

export function registerExtensionRuntime(chromeApi = chrome) {
  chromeApi.runtime.onInstalled.addListener(async () => {
    for (const item of createContextMenuDefinitions()) {
      chromeApi.contextMenus.create(item);
    }
    await ensureOverlayDefaults(chromeApi);
  });

  chromeApi.contextMenus.onClicked.addListener(async (info, tab) => {
    const [{ result: selectionState } = {}] = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ucaSelectionState ?? null
    });

    const request = buildNativeRequest({
      menuItemId: info.menuItemId,
      info,
      tab,
      selectionState
    });

    chromeApi.runtime.sendNativeMessage("com.uca.host", request);
  });

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "uca.overlay.getSettings") {
      chromeApi.storage.local.get(["ucaOverlaySettings", "ucaOverlaySecurityState"]).then((data) => {
        sendResponse({
          settings: data.ucaOverlaySettings ?? DEFAULT_OVERLAY_SETTINGS,
          securityState: data.ucaOverlaySecurityState ?? { presenterMode: false }
        });
      });
      return true;
    }

    if (message?.type === "uca.overlay.updateSettings") {
      const merged = {
        ...DEFAULT_OVERLAY_SETTINGS,
        ...(message.patch ?? {})
      };
      chromeApi.storage.local.set({
        ucaOverlaySettings: merged
      }).then(() => sendResponse({ ok: true, settings: merged }));
      return true;
    }

    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  registerExtensionRuntime(chrome);
}
