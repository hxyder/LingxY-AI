import {
  loadStandaloneConfig,
  isDesktopAvailable,
  callLLMDirect,
  callLLMDirectStream,
  callLLMDirectVision,
  buildPromptFor,
  invalidateDesktopProbe
} from "./standalone-client.js";
import {
  enrichContextForAction,
  formatEnrichmentAsMarkdown,
  shouldEnrichForAction
} from "./context-enricher.js";
import { runTaskWithStream } from "./sse-client.js";

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
    // Carry the original action id through so downstream handlers (standalone
    // fallback in dispatchOverlayHandoff, desktop /overlay/handoff, etc.)
    // can branch on the real intent. Without this the standalone fallback
    // collapsed every context-menu action to "summarize", which made right-
    // click "translate" trigger the summarize enrichment path (page + 3
    // link fetches) and added 2-3 s of wasted wall time on top of the LLM
    // call — symptom: 10 s translates.
    actionId,
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

export async function runQuickAction({ action, selectionState, tab = null }, fetchImpl = fetch) {
  const text = (selectionState?.text ?? "").trim();
  if (!text) {
    return { ok: false, error: "empty_selection" };
  }
  const userCommand = QUICK_ACTION_COMMANDS[action] ?? QUICK_ACTION_COMMANDS.summarize;

  // Standalone short-circuit: if desktop isn't running AND the user has
  // configured a direct API key, call the LLM directly from the extension.
  //
  // UCA-162 follow-up: translate has no reason to go through the full
  // task-submission pipeline — no decomposition, no tool calls, no
  // artifact, no routing. If standalone is configured, prefer it for
  // translate even when desktop is up. ~800 ms vs 2-3 s for a one-shot
  // translation. summarize / explain still go through desktop when it's up
  // because the task-history trail is useful there.
  const standaloneConfig = await loadStandaloneConfig();
  const runtimeBase = (standaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  const desktopUp = await isDesktopAvailable(runtimeBase);
  const preferStandalone = (!desktopUp || action === "translate" || action === "uca.translate-selection")
    && standaloneConfig?.apiKey;
  if (preferStandalone) {
    // UCA-161: summarize / explain get the full page outline + any in-selection
    // links fetched and inlined so the LLM has real material to ground on.
    let enrichmentMarkdown = "";
    if (shouldEnrichForAction(action)) {
      try {
        const enrichment = await enrichContextForAction({ action, selectionState, tab });
        enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
      } catch { /* enrichment is best-effort */ }
    }
    const { prompt, systemPrompt } = buildPromptFor(action, selectionState, enrichmentMarkdown);
    const result = await callLLMDirect({ config: standaloneConfig, prompt, systemPrompt });
    if (result.ok) return { ok: true, mode: "standalone", text: result.text, status: "success" };
    return { ok: false, mode: "standalone", error: result.error };
  }

  // UCA-161: also enrich the desktop-path payload so the server-side executor
  // sees the same deep context the standalone path uses. Passed as both a
  // structured `capture.enrichment` field (for future server-side use) and
  // inlined into capture.text so today's executors pick it up without any
  // server-side change.
  let enrichedText = text;
  let enrichment = null;
  if (shouldEnrichForAction(action)) {
    try {
      enrichment = await enrichContextForAction({ action, selectionState, tab });
      const enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
      if (enrichmentMarkdown) {
        enrichedText = `${text}\n\n---\n【补充上下文（自动抓取）】\n${enrichmentMarkdown}`;
      }
    } catch { /* best-effort */ }
  }

  // Submit the task
  let submitJson;
  try {
    const submitResponse = await fetchImpl(`${runtimeBase}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand,
        executionMode: "interactive",
        capture: {
          sourceType: "text_selection",
          text: enrichedText,
          url: selectionState?.url ?? "",
          pageTitle: selectionState?.pageTitle ?? "",
          browser: "chrome.exe",
          enrichment: enrichment
            ? { pageOutline: enrichment.pageOutline, linkResults: enrichment.linkResults }
            : null
        }
      })
    });
    if (!submitResponse.ok) {
      return { ok: false, error: `submit_failed_${submitResponse.status}` };
    }
    submitJson = await submitResponse.json();
  } catch (error) {
    // Network failure + no API key = no path forward. With API key we'd have
    // taken the standalone branch above already.
    invalidateDesktopProbe();
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

  // UCA-162: subscribe to the task's SSE stream (/task/:id/events). First
  // token typically arrives in 100-300 ms; the 600 ms polling loop was
  // costing the popup ~1 s before anything appeared. If the stream fails or
  // closes without a terminal event we fall back to the old poll loop so
  // slow proxies / local-host quirks still work.
  const controller = new AbortController();
  const streamDeadline = setTimeout(() => controller.abort(), 30_000);
  try {
    const streamed = await runTaskWithStream(`${runtimeBase}/task/${taskId}`, { signal: controller.signal });
    if (streamed?.ok) {
      clearTimeout(streamDeadline);
      return { ok: true, taskId, text: streamed.text, status: streamed.status };
    }
    if (streamed && !streamed.ok && streamed.error && streamed.error !== "stream_ended_without_terminal") {
      // Surface non-terminal stream errors when we have one — the user is
      // better off seeing "connection dropped" than a silent timeout.
      clearTimeout(streamDeadline);
      return { ok: false, taskId, error: streamed.error };
    }
  } catch { /* fall through to polling */ }
  clearTimeout(streamDeadline);

  // Fallback polling (legacy path)
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
  // Pre-flight: if desktop is unreachable and user has standalone config,
  // run the task directly via LLM API and surface the result as a chrome
  // notification (+ clipboard). The overlay handoff path assumes the desktop
  // owns the UI, so we can't render an inline reply without the desktop —
  // standalone mode is "best effort" for context-menu actions.
  const standaloneConfig = await loadStandaloneConfig();
  const runtimeBase = (standaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  const desktopUp = await isDesktopAvailable(runtimeBase);
  if (!desktopUp && standaloneConfig?.apiKey) {
    // UCA-164: use the action the user actually picked from the context menu,
    // not a hardcoded "summarize". Right-click translate used to fall into
    // the summarize enrichment path (page outline + link fetches), adding
    // 2-3 s of wasted wall time on top of the LLM call.
    const action = request?.payload?.actionId
      ?? (request?.payload?.capture?.sourceType === "image" ? "uca.inspect-image" : "summarize");
    const selectionState = {
      text: request?.payload?.capture?.text ?? request?.payload?.capture?.selectionText ?? "",
      url: request?.payload?.capture?.url ?? "",
      pageTitle: request?.payload?.capture?.pageTitle ?? "",
      imageUrl: request?.payload?.capture?.imageUrl ?? ""
    };
    // UCA-161: enrich summarize / explain with page outline + in-selection links.
    // For images we skip — vision models get the image bytes directly.
    let enrichmentMarkdown = "";
    if (shouldEnrichForAction(action)) {
      try {
        const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        const enrichment = await enrichContextForAction({ action, selectionState, tab: activeTab, chromeApi });
        enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
      } catch { /* best-effort */ }
    }
    const { prompt, systemPrompt } = buildPromptFor(action, selectionState, enrichmentMarkdown);
    const result = action === "uca.inspect-image"
      ? await callLLMDirectVision({ config: standaloneConfig, prompt, imageUrl: selectionState.imageUrl })
      : await callLLMDirect({ config: standaloneConfig, prompt, systemPrompt });
    try {
      if (result.ok && chromeApi.notifications?.create) {
        chromeApi.notifications.create(`uca-standalone-${Date.now()}`, {
          type: "basic",
          iconUrl: "popup/icon.png",
          title: "LingxY · 独立模式",
          message: (result.text ?? "").slice(0, 200)
        });
      }
    } catch { /* notifications optional */ }
    return { ok: Boolean(result.ok), mode: "standalone", text: result.text ?? "", error: result.error };
  }

  // UCA-161: also enrich the desktop path. We infer action from the user
  // command text (the payload doesn't carry it directly) and only enrich for
  // summarize / explain families — right-click "抓取链接" / "解释此页" alike.
  try {
    const uc = `${request?.payload?.userCommand ?? ""}`;
    const isSummarizeOrExplain = /总结|解释|summar|explain|抓取/i.test(uc);
    if (isSummarizeOrExplain && request?.payload?.capture && chromeApi?.tabs?.query && chromeApi?.scripting?.executeScript) {
      const selectionState = {
        text: request.payload.capture.text ?? "",
        url: request.payload.capture.url ?? "",
        pageTitle: request.payload.capture.pageTitle ?? ""
      };
      const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      const enrichment = await enrichContextForAction({
        action: "summarize", selectionState, tab: activeTab, chromeApi
      });
      const enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
      if (enrichmentMarkdown) {
        request.payload.capture.text = `${selectionState.text}\n\n---\n【补充上下文（自动抓取）】\n${enrichmentMarkdown}`;
        request.payload.capture.enrichment = {
          pageOutline: enrichment?.pageOutline ?? null,
          linkResults: enrichment?.linkResults ?? []
        };
      }
    }
  } catch { /* enrichment is best-effort */ }

  try {
    const response = await fetchImpl(`${runtimeBase}/overlay/handoff`, {
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
      try {
        chromeApi.runtime.sendNativeMessage(NATIVE_HOST_NAME, request, (response) => {
          const lastError = chromeApi.runtime?.lastError;
          if (lastError) {
            console.info("[LingxY] native host unavailable:", lastError.message);
            resolve({ ok: false, reason: "native_host_not_installed", message: lastError.message });
            return;
          }
          resolve(response);
        });
      } catch (err) {
        console.info("[LingxY] native messaging threw:", err?.message ?? err);
        resolve({ ok: false, reason: "native_host_error", message: err?.message ?? String(err) });
      }
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

    // UCA-173: for link / image actions, render a visible streaming frame
    // inside the page instead of silently firing a chrome.notifications
    // toast. The frame gives the user direct feedback + lets them copy the
    // result. We tell the active tab's content script to show a frame;
    // it'll open its own streaming port. Falls back to dispatchOverlayHandoff
    // when the content-script message fails (e.g., chrome:// pages).
    const visibleFrameActions = new Set([
      "uca.fetch-link",
      "uca.inspect-image",
      "uca.summarize-selection",
      "uca.translate-selection"
    ]);
    if (visibleFrameActions.has(info.menuItemId) && tab?.id != null) {
      const payload = {
        type: "uca.content.showActionFrame",
        action: info.menuItemId,
        selectionState: {
          text: selectionState?.text ?? info.selectionText ?? "",
          url: info.linkUrl ?? info.pageUrl ?? tab?.url ?? "",
          pageTitle: tab?.title ?? "",
          imageUrl: info.srcUrl ?? "",
          anchorText: info.linkText ?? ""
        },
        tabInfo: { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" }
      };
      try {
        const reply = await new Promise((resolve) => {
          chromeApi.tabs.sendMessage(tab.id, payload, (response) => {
            const lastError = chromeApi.runtime?.lastError;
            if (lastError) resolve({ ok: false, error: lastError.message });
            else resolve(response ?? { ok: false, error: "no_response" });
          });
        });
        if (reply?.ok) return;
        // Content-script couldn't show the frame (chrome:// page, PDF
        // viewer, etc.) — fall through to legacy dispatchOverlayHandoff so
        // the user still gets a chrome.notifications reply in standalone
        // mode / a desktop handoff when the desktop app is running.
      } catch { /* fall through */ }
    }

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

    if (message?.type === "uca.standalone.test") {
      (async () => {
        const config = message.config ?? await loadStandaloneConfig();
        const result = await callLLMDirect({
          config,
          prompt: message.prompt ?? "ping",
          systemPrompt: "Reply with a single short sentence confirming you're online."
        });
        sendResponse(result);
      })();
      return true;
    }

    // UCA-160: multi-turn chat from popup. Keeps a short history in memory
    // inside the service worker (not persisted) and returns the assistant's
    // reply plus the updated history so popup can render without round-tripping
    // storage. If desktop is running we still prefer standalone direct-call
    // for chat — the desktop runtime's /task endpoint is optimised for
    // structured-task execution, not free-form chat.
    if (message?.type === "uca.standalone.chat") {
      (async () => {
        const userText = `${message.text ?? ""}`.trim();
        if (!userText) {
          sendResponse({ ok: false, error: "empty_input" });
          return;
        }
        // Cap history at 6 turns — more than that bloats the prompt without
        // adding much value in a casual popup chat, and it hurts latency.
        const history = Array.isArray(message.history)
          ? message.history.filter((turn) => turn?.role === "user" || turn?.role === "assistant").slice(-6)
          : [];
        const conversation = [...history, { role: "user", content: userText }];
        const config = await loadStandaloneConfig();

        // Path A: standalone direct-call (preferred — no desktop round-trip).
        // Uses proper `messages` array so providers track turn roles natively
        // (saves ~50 tokens/turn versus the prior "用户:/助手:" concat) and
        // a tighter max_tokens cap (512) to keep worst-case wall time down.
        if (config?.apiKey) {
          const systemPrompt = "You are LingxY, a helpful assistant in a Chrome extension popup. Reply concisely in the user's language. Use Markdown for structure when helpful.";
          const messages = [
            { role: "system", content: systemPrompt },
            ...conversation
          ];
          const result = await callLLMDirect({ config, messages, maxTokens: 512 });
          if (result.ok) {
            sendResponse({ ok: true, mode: "standalone", text: result.text, history: [...conversation, { role: "assistant", content: result.text }] });
            return;
          }
          // Fall through to desktop path if standalone call fails (e.g., bad key)
          // so the user still has a way to chat when desktop is up.
        }

        // Path B: desktop runtime via /task + SSE stream.
        const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
        if (await isDesktopAvailable(runtimeBase)) {
          try {
            const submitResponse = await fetch(`${runtimeBase}/task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userCommand: userText,
                executionMode: "interactive",
                capture: {
                  sourceType: "chat",
                  text: userText,
                  history: conversation.slice(0, -1),
                  browser: "chrome.exe"
                }
              })
            });
            if (!submitResponse.ok) {
              sendResponse({ ok: false, error: `desktop_submit_${submitResponse.status}` });
              return;
            }
            const submitJson = await submitResponse.json();
            const taskId = submitJson?.task?.task_id;
            const inlineFromSubmit = extractInlineResult(submitJson?.taskEvents ?? []);
            if (inlineFromSubmit && submitJson?.task?.status === "success") {
              sendResponse({ ok: true, mode: "desktop", text: inlineFromSubmit, history: [...conversation, { role: "assistant", content: inlineFromSubmit }] });
              return;
            }
            if (!taskId) {
              sendResponse({ ok: false, error: "desktop_no_task_id" });
              return;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            const streamed = await runTaskWithStream(`${runtimeBase}/task/${taskId}`, { signal: controller.signal });
            clearTimeout(timer);
            if (streamed?.ok) {
              sendResponse({ ok: true, mode: "desktop", text: streamed.text, history: [...conversation, { role: "assistant", content: streamed.text }] });
              return;
            }
            sendResponse({ ok: false, error: streamed?.error ?? "desktop_stream_failed" });
            return;
          } catch (error) {
            sendResponse({ ok: false, error: `desktop_error:${error?.message ?? error}` });
            return;
          }
        }

        sendResponse({ ok: false, error: config?.apiKey ? "standalone_failed" : "no_provider_configured" });
      })();
      return true;
    }

    if (message?.type === "uca.standalone.status") {
      (async () => {
        const config = await loadStandaloneConfig();
        const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
        invalidateDesktopProbe();
        const desktopUp = await isDesktopAvailable(runtimeBase);
        sendResponse({
          desktopAvailable: desktopUp,
          standaloneReady: Boolean(config?.apiKey),
          provider: config?.provider ?? null,
          runtimeUrl: runtimeBase
        });
      })();
      return true;
    }

    if (message?.type === "uca.runtime.openTasks") {
      try {
        chromeApi.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
          protocolVersion: "1.0",
          requestId: crypto.randomUUID(),
          action: "open_runtime_tasks"
        }, (response) => {
          // Consume chrome.runtime.lastError so Chrome doesn't log an
          // unchecked warning when the native host isn't installed.
          const lastError = chromeApi.runtime?.lastError;
          if (lastError) {
            console.info("[LingxY] native host unavailable:", lastError.message);
            // Fall back to opening the local runtime in a new tab so the
            // user still reaches the Console even without the native host.
            chromeApi.tabs?.create?.({ url: "http://127.0.0.1:4310/" });
            sendResponse({ ok: false, reason: "native_host_not_installed", message: lastError.message });
            return;
          }
          sendResponse(response);
        });
      } catch (err) {
        console.info("[LingxY] native messaging threw:", err?.message ?? err);
        chromeApi.tabs?.create?.({ url: "http://127.0.0.1:4310/" });
        sendResponse({ ok: false, reason: "native_host_error", message: err?.message ?? String(err) });
      }
      return true;
    }

    return false;
  });
}

// UCA-166: Port-based streaming chat channel. The popup opens
// chrome.runtime.connect({ name: "uca.chat.stream" }) and posts
// { text, history }. We stream LLM chunks back via port.postMessage so the
// user sees text as it arrives. The port keeps the MV3 service worker alive
// for the duration of the streaming call (workers die within ~30 s idle
// otherwise).
function registerChatStreamPort(chromeApi = chrome) {
  if (!chromeApi.runtime?.onConnect) return;
  chromeApi.runtime.onConnect.addListener((port) => {
    if (port.name !== "uca.chat.stream") return;
    let aborted = false;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => {
      aborted = true;
      try { controller.abort(); } catch { /* ignore */ }
    });
    port.onMessage.addListener(async (message) => {
      if (message?.type !== "chat") return;
      const userText = `${message.text ?? ""}`.trim();
      if (!userText) {
        port.postMessage({ type: "error", error: "empty_input" });
        return;
      }
      const history = Array.isArray(message.history)
        ? message.history.filter((turn) => turn?.role === "user" || turn?.role === "assistant").slice(-6)
        : [];
      const conversation = [...history, { role: "user", content: userText }];
      const config = await loadStandaloneConfig();
      if (!config?.apiKey) {
        port.postMessage({ type: "error", error: "no_api_key" });
        return;
      }
      // Caller (popup / sidepanel) can override the system prompt — the
      // side panel sends a richer prompt that emphasizes continuity with
      // previously-analyzed pages / videos so follow-ups ("展开第 3 点")
      // get anchored correctly.
      const systemPrompt = typeof message.systemPrompt === "string" && message.systemPrompt.trim()
        ? message.systemPrompt
        : "You are LingxY, a helpful assistant in a Chrome extension popup. Reply concisely in the user's language. Use Markdown for structure when helpful.";
      const messages = [{ role: "system", content: systemPrompt }, ...conversation];
      port.postMessage({ type: "start" });
      const result = await callLLMDirectStream({
        config,
        messages,
        maxTokens: 512,
        signal: controller.signal,
        onChunk: (delta, full) => {
          if (aborted) return;
          try { port.postMessage({ type: "chunk", delta, full }); } catch { /* port closed */ }
        }
      });
      if (aborted) return;
      if (result.ok) {
        port.postMessage({
          type: "done",
          text: result.text,
          history: [...conversation, { role: "assistant", content: result.text }]
        });
      } else {
        port.postMessage({ type: "error", error: result.error });
      }
    });
  });
}

// UCA-167: Streaming port for the inline-frame quick actions (translate /
// summarize / explain). Uses the same standalone direct-call path as the
// one-shot runQuickAction, but pipes chunks back so the content-script
// frame can render text as it arrives.
function registerQuickActionStreamPort(chromeApi = chrome) {
  if (!chromeApi.runtime?.onConnect) return;
  chromeApi.runtime.onConnect.addListener((port) => {
    if (port.name !== "uca.quickaction.stream") return;
    let aborted = false;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => {
      aborted = true;
      try { controller.abort(); } catch { /* ignore */ }
    });
    port.onMessage.addListener(async (message) => {
      if (message?.type !== "quickaction") return;
      const { action, selectionState } = message;
      const config = await loadStandaloneConfig();
      if (!config?.apiKey) {
        port.postMessage({ type: "error", error: "no_api_key" });
        return;
      }

      // UCA-173: image analysis takes its own path (vision API, base64
      // image). Vision responses aren't streamed by most providers, so we
      // emit a single done frame. The content-script frame handles both
      // shapes identically.
      if (action === "uca.inspect-image") {
        const imageUrl = selectionState?.imageUrl ?? "";
        if (!imageUrl) {
          port.postMessage({ type: "error", error: "no_image_url" });
          return;
        }
        port.postMessage({ type: "start" });
        const prompt = "请分析这张图片：简述里面有什么、关键文字（如有）、是否需要注意的细节。用中文回答。";
        const { callLLMDirectVision } = await import("./standalone-client.js");
        const visionResult = await callLLMDirectVision({ config, prompt, imageUrl });
        if (aborted) return;
        if (visionResult.ok) {
          port.postMessage({ type: "done", text: visionResult.text });
        } else {
          port.postMessage({ type: "error", error: visionResult.error });
        }
        return;
      }

      // Enrichment for summarize / explain / fetch-link. Translate goes
      // direct — that was the whole point of UCA-164a.
      let enrichmentMarkdown = "";
      if (shouldEnrichForAction(action)) {
        try {
          const enrichment = await enrichContextForAction({ action, selectionState, tab: message.tab ?? null });
          enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
        } catch { /* best effort */ }
      }
      const { prompt, systemPrompt } = buildPromptFor(action, selectionState, enrichmentMarkdown);
      port.postMessage({ type: "start" });
      const result = await callLLMDirectStream({
        config,
        messages: [
          { role: "system", content: systemPrompt ?? "" },
          { role: "user", content: prompt }
        ],
        maxTokens: 1024,
        signal: controller.signal,
        onChunk: (delta, full) => {
          if (aborted) return;
          try { port.postMessage({ type: "chunk", delta, full }); } catch { /* closed */ }
        }
      });
      if (aborted) return;
      if (result.ok) {
        port.postMessage({ type: "done", text: result.text });
      } else {
        port.postMessage({ type: "error", error: result.error });
      }
    });
  });
}

// UCA-171: clicking the extension toolbar icon opens the side panel in
// addition to the popup. (Strictly "instead of" when sidePanel is enabled
// — per Chrome's behavior, the popup in manifest.action takes precedence,
// so we set the panel to open *beside* the popup via setPanelBehavior,
// and also expose a context menu + popup button so the user can
// deliberately open it.)
function registerSidePanel(chromeApi = chrome) {
  if (!chromeApi.sidePanel?.setPanelBehavior) return;
  try {
    chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch { /* ignore */ }
  // Context menu entry — works regardless of popup focus.
  if (chromeApi.contextMenus?.create) {
    try {
      chromeApi.contextMenus.create({
        id: "uca.open-sidepanel",
        title: "打开 LingxY 侧边栏",
        contexts: ["action", "page"]
      });
    } catch { /* already created across SW restarts */ }
  }
  chromeApi.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId !== "uca.open-sidepanel") return;
    if (tab?.windowId && chromeApi.sidePanel?.open) {
      chromeApi.sidePanel.open({ windowId: tab.windowId }).catch(() => { /* older Chrome */ });
    }
  });
  // Expose a message handler so popup can ask us to open it programmatically.
  chromeApi.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message?.type !== "uca.sidepanel.open") return false;
    const windowId = sender?.tab?.windowId ?? message.windowId ?? null;
    const doOpen = (wid) => {
      if (!chromeApi.sidePanel?.open) {
        sendResponse({ ok: false, error: "side_panel_api_unavailable" });
        return;
      }
      chromeApi.sidePanel.open({ windowId: wid })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err?.message ?? String(err) }));
    };
    if (windowId != null) {
      doOpen(windowId);
    } else {
      chromeApi.windows?.getCurrent?.()
        ?.then((w) => doOpen(w?.id))
        ?.catch((err) => sendResponse({ ok: false, error: err?.message ?? String(err) }));
    }
    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  registerExtensionRuntime(chrome);
  registerChatStreamPort(chrome);
  registerQuickActionStreamPort(chrome);
  registerSidePanel(chrome);
}
