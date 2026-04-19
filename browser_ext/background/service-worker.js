export const CONTEXT_MENU_DEFINITIONS = Object.freeze([
  {
    id: "uca.summarize-selection",
    title: "用 LingxY 总结",
    contexts: ["selection"]
  },
  {
    id: "uca.translate-selection",
    title: "用 LingxY 翻译",
    contexts: ["selection"]
  },
  {
    id: "uca.fetch-link",
    title: "用 LingxY 抓取并总结",
    contexts: ["link"]
  },
  {
    id: "uca.inspect-image",
    title: "用 LingxY 分析图片",
    contexts: ["image"]
  },
  {
    id: "uca.explain-page",
    title: "用 LingxY 解释此页 / 视频",
    contexts: ["page", "video", "frame"]
  }
]);

export const NATIVE_HOST_NAME = "com.uca.host";
export const RUNTIME_OVERLAY_HANDOFF_URL = "http://127.0.0.1:4310/overlay/handoff";
export const RUNTIME_BROWSER_CONTEXT_URL = "http://127.0.0.1:4310/browser/context";
export const RUNTIME_PAGE_EXPLAIN_URL = "http://127.0.0.1:4310/page/explain";
export const RUNTIME_TASK_URL = "http://127.0.0.1:4310/task";
export const RUNTIME_TASK_DETAIL_URL = "http://127.0.0.1:4310/task";

const QUICK_ACTION_COMMANDS = Object.freeze({
  translate: "请翻译这段网页内容",
  summarize: "请总结这段网页内容并列出关键点",
  explain: "请解释这段网页内容并说明它的重要性"
});

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

const CAPTURE_ACTIONS = Object.freeze({
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
  },
  summarize: {
    userCommand: "请总结这段网页内容",
    sourceType: "text_selection"
  },
  translate: {
    userCommand: "请翻译这段网页内容",
    sourceType: "text_selection"
  },
  explain: {
    userCommand: "请解释这段网页内容，并说明它的重要性",
    sourceType: "text_selection"
  }
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

function resolveCaptureAction(actionId) {
  const selected = CAPTURE_ACTIONS[actionId];
  if (!selected) {
    throw new Error(`Unsupported capture action: ${actionId}`);
  }
  return selected;
}

function buildCapturePayload({ actionId, info = {}, tab, selectionState, overrideSourceType = null }) {
  const selected = resolveCaptureAction(actionId);

  return {
    userCommand: selected.userCommand,
    capture: {
      sourceType: overrideSourceType ?? selected.sourceType,
      browser: "chrome.exe",
      url: info.linkUrl ?? info.pageUrl ?? tab?.url ?? selectionState?.url ?? "",
      pageTitle: tab?.title ?? selectionState?.pageTitle ?? "",
      text: selectionState?.text ?? info.selectionText ?? "",
      selectionText: selectionState?.text ?? info.selectionText ?? "",
      contextBefore: selectionState?.contextBefore ?? "",
      contextAfter: selectionState?.contextAfter ?? "",
      anchorText: info.linkText ?? selectionState?.anchorText ?? "",
      imageUrl: info.srcUrl ?? selectionState?.imageUrl ?? "",
      html: selectionState?.html ?? "",
      tabId: tab?.id ?? selectionState?.tabId ?? null
    }
  };
}

export function buildNativeRequest({ menuItemId, info, tab, selectionState }) {
  return {
    protocolVersion: "1.0",
    requestId: crypto.randomUUID(),
    action: "submit_capture",
    payload: buildCapturePayload({
      actionId: menuItemId,
      info,
      tab,
      selectionState
    })
  };
}

export function buildOverlayHandoffRequest({ actionId, info = {}, tab, selectionState, priorResult = null }) {
  const base = buildCapturePayload({
    actionId,
    info,
    tab,
    selectionState,
    overrideSourceType: selectionState?.sourceType ?? null
  });
  return {
    protocolVersion: "1.0",
    requestId: crypto.randomUUID(),
    action: "handoff_capture",
    payload: {
      targetWindow: "overlay",
      ...base,
      priorResult: priorResult ?? null,
      priorUserCommand: priorResult ? base.userCommand : null
    }
  };
}

export async function runQuickAction({ action, selectionState }, fetchImpl = fetch) {
  const text = (selectionState?.text ?? "").trim();
  if (!text) {
    return { ok: false, error: "empty_selection" };
  }
  const userCommand = QUICK_ACTION_COMMANDS[action] ?? QUICK_ACTION_COMMANDS.summarize;

  // Submit the task
  let submitJson;
  try {
    const submitResponse = await fetchImpl(RUNTIME_TASK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand,
        executionMode: "interactive",
        capture: {
          sourceType: "text_selection",
          text,
          url: selectionState?.url ?? "",
          pageTitle: selectionState?.pageTitle ?? "",
          browser: "chrome.exe"
        }
      })
    });
    if (!submitResponse.ok) {
      return { ok: false, error: `submit_failed_${submitResponse.status}` };
    }
    submitJson = await submitResponse.json();
  } catch (error) {
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }

  const taskId = submitJson?.task?.task_id;
  if (!taskId) {
    return { ok: false, error: "no_task_id" };
  }

  // Some tasks return inline result events synchronously inside the submit
  // response (translate executor finishes during /task POST) — try those first.
  const inlineFromSubmit = extractInlineResult(submitJson?.taskEvents ?? []);
  if (inlineFromSubmit && submitJson?.task?.status === "success") {
    return { ok: true, taskId, text: inlineFromSubmit, status: "success" };
  }

  // Otherwise poll /task/:id every 600ms (capped at ~30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const detailResponse = await fetchImpl(`${RUNTIME_TASK_DETAIL_URL}/${taskId}`);
      if (!detailResponse.ok) continue;
      const detail = await detailResponse.json();
      const status = detail?.task?.status;
      if (status === "success" || status === "partial_success") {
        const inline = extractInlineResult(detail?.events ?? []);
        return { ok: true, taskId, text: inline ?? "(无内容)", status };
      }
      if (status === "failed" || status === "cancelled") {
        return { ok: false, taskId, error: detail?.task?.failure_user_message ?? status };
      }
    } catch { /* keep polling */ }
  }
  return { ok: false, taskId, error: "timeout" };
}

function extractInlineResult(events = []) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if ((event.event_type === "inline_result" || event.event_type === "success") && event.payload?.text?.length > 0) {
      return event.payload.text;
    }
  }
  return null;
}

export async function dispatchOverlayHandoff(request, chromeApi = chrome, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(RUNTIME_OVERLAY_HANDOFF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.payload)
    });

    if (!response.ok) {
      throw new Error(`runtime_handoff_failed:${response.status}`);
    }

    return response.json();
  } catch {
    return new Promise((resolve) => {
      chromeApi.runtime.sendNativeMessage(NATIVE_HOST_NAME, request, (response) => resolve(response));
    });
  }
}

// Capture the current tab's page source via the MAIN-world capture function
// installed by content_script/page-source-capture.js, then forward to the
// service's /page/explain endpoint. The endpoint writes an overlay handoff
// file, so the desktop overlay opens with the structured explanation request
// already queued as a task.
export async function dispatchExplainPage({
  tab,
  chromeApi = chrome,
  fetchImpl = fetch,
  pageExplainUrl = RUNTIME_PAGE_EXPLAIN_URL
} = {}) {
  if (!tab?.id) {
    return { ok: false, error: "no_active_tab" };
  }

  let payload = null;
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async () => {
        if (typeof window.__ucaPageSourceCapture !== "function") return null;
        return await window.__ucaPageSourceCapture();
      }
    });
    payload = results?.[0]?.result ?? null;
  } catch (error) {
    return { ok: false, error: `capture_failed:${error?.message ?? "unknown"}` };
  }

  if (!payload) {
    return { ok: false, error: "capture_not_available" };
  }

  // Tag the capture with the originating browser so the service handoff can
  // attribute source_app correctly.
  payload.browser = tab?.url?.includes("edge") ? "msedge.exe" : "chrome.exe";

  try {
    const response = await fetchImpl(pageExplainUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capture: payload })
    });
    if (!response.ok) {
      return { ok: false, error: `runtime_explain_failed_${response.status}` };
    }
    return response.json();
  } catch (error) {
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }
}

export async function dispatchBrowserContextSnapshot(context, fetchImpl = fetch) {
  const url = `${context?.url ?? ""}`.trim();
  const pageTitle = `${context?.pageTitle ?? context?.title ?? ""}`.trim();
  if (!url && !pageTitle) {
    return { ok: false, error: "empty_context" };
  }

  try {
    const response = await fetchImpl(RUNTIME_BROWSER_CONTEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ context })
    });

    if (!response.ok) {
      return { ok: false, error: `runtime_context_failed_${response.status}` };
    }

    return response.json();
  } catch (error) {
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }
}

export function registerExtensionRuntime(chromeApi = chrome) {
  chromeApi.runtime.onInstalled.addListener(async () => {
    for (const item of createContextMenuDefinitions()) {
      chromeApi.contextMenus.create(item);
    }
    await ensureOverlayDefaults(chromeApi);
  });

  chromeApi.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "uca.explain-page") {
      await dispatchExplainPage({ tab, chromeApi, fetchImpl: fetch });
      return;
    }
    const [{ result: selectionState } = {}] = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ucaSelectionState ?? null
    });

    const request = buildOverlayHandoffRequest({
      actionId: info.menuItemId,
      info,
      tab,
      selectionState
    });

    await dispatchOverlayHandoff(request, chromeApi, fetch);
  });

  // Keyboard shortcut — defaults to Ctrl+Shift+E, users can remap it from
  // chrome://extensions/shortcuts.
  if (chromeApi.commands?.onCommand) {
    chromeApi.commands.onCommand.addListener(async (command, tab) => {
      if (command !== "explain-page") return;
      let activeTab = tab;
      if (!activeTab) {
        const [first] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        activeTab = first ?? null;
      }
      if (!activeTab) return;
      await dispatchExplainPage({ tab: activeTab, chromeApi, fetchImpl: fetch });
    });
  }

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "uca.overlay.captureSelection") {
      const request = buildOverlayHandoffRequest({
        actionId: message.action ?? "summarize",
        info: message.info ?? {},
        tab: message.tab ?? null,
        selectionState: message.selectionState ?? null
      });
      dispatchOverlayHandoff(request, chromeApi, fetch).then((response) => sendResponse(response));
      return true;
    }

    if (message?.type === "uca.runtime.runQuickAction") {
      runQuickAction({
        action: message.action,
        selectionState: message.selectionState
      }).then((response) => sendResponse(response));
      return true;
    }

    if (message?.type === "uca.browser.contextSnapshot") {
      dispatchBrowserContextSnapshot(message.context ?? message.payload ?? {}, fetch)
        .then((response) => sendResponse(response));
      return true;
    }

    if (message?.type === "uca.page.explain") {
      (async () => {
        let tab = message.tab ?? null;
        if (!tab) {
          const [first] = await chromeApi.tabs.query({ active: true, currentWindow: true });
          tab = first ?? null;
        }
        const result = await dispatchExplainPage({ tab, chromeApi, fetchImpl: fetch });
        sendResponse(result);
      })();
      return true;
    }

    if (message?.type === "uca.overlay.openWithResult") {
      const request = buildOverlayHandoffRequest({
        actionId: message.action ?? "summarize",
        info: message.info ?? {},
        tab: message.tab ?? null,
        selectionState: message.selectionState ?? null,
        priorResult: message.priorResult ?? null
      });
      dispatchOverlayHandoff(request, chromeApi, fetch).then((response) => sendResponse(response));
      return true;
    }

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

    if (message?.type === "uca.runtime.openTasks") {
      chromeApi.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
        protocolVersion: "1.0",
        requestId: crypto.randomUUID(),
        action: "open_runtime_tasks"
      }, (response) => sendResponse(response));
      return true;
    }

    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  registerExtensionRuntime(chrome);
}
