import {
  loadStandaloneConfig,
  isDesktopAvailable,
  callLLMDirect,
  callLLMDirectStream,
  callLLMDirectVision,
  buildPromptFor,
  invalidateDesktopProbe,
  hasStandaloneProviderConfig
} from "./standalone-client.js";
import {
  enrichContextForAction,
  formatEnrichmentAsMarkdown,
  shouldEnrichForAction
} from "./context-enricher.js";
import {
  createRunModeCapabilities,
  planPageExplainRoute,
  planQuickActionRoute
} from "./run-mode-router.js";
import { runTaskWithStream } from "./sse-client.js";
import { getCachedLocation, getSystemTimezone, STORAGE_KEY as LOCATION_STORAGE_KEY } from "../shared/location.js";

// In-memory mirror of the user's cached geolocation (populated by the
// sidepanel after the user grants the Chrome prompt). We hydrate from
// chrome.storage.local on worker start and refresh on change. This exists
// so buildCapturePayload() can stay synchronous — MV3 service workers may
// be torn down between message handlers, but module-level caches survive
// the current handler lifetime and rehydrate cheaply on wake-up.
let _locationCache = null;
async function hydrateLocationCache() {
  _locationCache = await getCachedLocation();
}
void hydrateLocationCache();
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes?.[LOCATION_STORAGE_KEY]) {
      _locationCache = changes[LOCATION_STORAGE_KEY].newValue ?? null;
    }
  });
} catch {
  /* ignore — test environments may lack chrome.storage */
}

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
export const SIDEPANEL_PENDING_ANALYSIS_KEY = "ucaSidePanelPendingAnalysis";
const MAX_CHAT_HISTORY_TURNS = 20;

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

function createContextMenuSafe(chromeApi, item) {
  return new Promise((resolve) => {
    try {
      chromeApi.contextMenus.create(item, () => {
        const message = chromeApi.runtime?.lastError?.message ?? "";
        if (message && !/duplicate id/i.test(message)) {
          console.warn("[lingxy-ext] context menu create failed:", item?.id, message);
        }
        resolve();
      });
    } catch (error) {
      console.warn("[lingxy-ext] context menu create threw:", item?.id, error?.message ?? error);
      resolve();
    }
  });
}

async function syncContextMenus(chromeApi = chrome) {
  if (!chromeApi.contextMenus?.removeAll || !chromeApi.contextMenus?.create) return;
  await new Promise((resolve) => {
    try {
      chromeApi.contextMenus.removeAll(() => {
        const message = chromeApi.runtime?.lastError?.message ?? "";
        if (message && !/cannot find|not found/i.test(message)) {
          console.warn("[lingxy-ext] context menu reset failed:", message);
        }
        resolve();
      });
    } catch {
      resolve();
    }
  });
  for (const item of createContextMenuDefinitions()) {
    await createContextMenuSafe(chromeApi, item);
  }
  await createContextMenuSafe(chromeApi, {
    id: "uca.open-sidepanel",
    title: "打开 LingxY 侧边栏",
    contexts: ["action", "page"]
  });
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
    // Timezone is free and non-sensitive. Real location is only attached
    // when the user has clicked the "📍 启用精确定位" chip and Chrome
    // granted the geolocation permission — otherwise userLocation is null
    // and the service treats the request as "location unknown".
    userTimezone: getSystemTimezone(),
    userLocation: _locationCache ?? null,
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
      tabId: tab?.id ?? selectionState?.tabId ?? null,
      // Mirrored inside `capture` because some downstream paths (runDesktopTask,
      // overlay handoff) only forward the capture object, not the wrapping
      // payload. Cheap to duplicate; expensive to lose.
      userTimezone: getSystemTimezone(),
      userLocation: _locationCache ?? null
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

function buildDesktopCaptureForAction(action, selectionState = {}, enrichment = null) {
  const text = `${selectionState?.text ?? selectionState?.selectionText ?? ""}`.trim();
  const url = selectionState?.url ?? "";
  const pageTitle = selectionState?.pageTitle ?? "";
  const base = {
    url,
    pageTitle,
    browser: "chrome.exe"
  };

  if (action === "uca.fetch-link") {
    return {
      ...base,
      sourceType: "link",
      text,
      anchorText: selectionState?.anchorText ?? text,
      selectionText: text,
      enrichment: enrichment
        ? { pageOutline: enrichment.pageOutline, linkResults: enrichment.linkResults }
        : null
    };
  }

  if (action === "uca.inspect-image") {
    return {
      ...base,
      sourceType: "image",
      text,
      imageUrl: selectionState?.imageUrl ?? ""
    };
  }

  const enrichedText = enrichment
    ? `${text}\n\n---\n【补充上下文（自动抓取）】\n${formatEnrichmentAsMarkdown(enrichment)}`
    : text;

  return {
    ...base,
    sourceType: selectionState?.sourceType ?? "text_selection",
    text: enrichedText,
    selectionText: text,
    contextBefore: selectionState?.contextBefore ?? "",
    contextAfter: selectionState?.contextAfter ?? "",
    enrichment: enrichment
      ? { pageOutline: enrichment.pageOutline, linkResults: enrichment.linkResults }
      : null
  };
}

async function runDesktopTask({
  runtimeBase,
  userCommand,
  capture,
  fetchImpl = fetch
}) {
  let submitJson;
  try {
    const submitResponse = await fetchImpl(`${runtimeBase}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand,
        executionMode: "interactive",
        capture
      })
    });
    if (!submitResponse.ok) {
      return { ok: false, error: `submit_failed_${submitResponse.status}` };
    }
    submitJson = await submitResponse.json();
  } catch (error) {
    invalidateDesktopProbe();
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }

  const taskId = submitJson?.task?.task_id;
  if (!taskId) {
    return { ok: false, error: "no_task_id" };
  }

  const inlineFromSubmit = extractInlineResult(submitJson?.taskEvents ?? []);
  if (inlineFromSubmit && submitJson?.task?.status === "success") {
    return { ok: true, taskId, text: inlineFromSubmit, status: "success", mode: "desktop" };
  }

  const controller = new AbortController();
  const streamDeadline = setTimeout(() => controller.abort(), 30_000);
  try {
    const streamed = await runTaskWithStream(`${runtimeBase}/task/${taskId}`, { signal: controller.signal });
    if (streamed?.ok) {
      clearTimeout(streamDeadline);
      return { ok: true, taskId, text: streamed.text, status: streamed.status, mode: "desktop" };
    }
    if (streamed && !streamed.ok && streamed.error && streamed.error !== "stream_ended_without_terminal") {
      clearTimeout(streamDeadline);
      return { ok: false, taskId, error: streamed.error, mode: "desktop" };
    }
  } catch { /* fall through to polling */ }
  clearTimeout(streamDeadline);

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
        return { ok: true, taskId, text: inline ?? "(无内容)", status, mode: "desktop" };
      }
      if (status === "failed" || status === "cancelled") {
        return { ok: false, taskId, error: detail?.task?.failure_user_message ?? status, mode: "desktop" };
      }
    } catch { /* keep polling */ }
  }
  return { ok: false, taskId, error: "timeout", mode: "desktop" };
}

function isValidRoutePlan(routePlan = null) {
  return routePlan && typeof routePlan === "object" && typeof routePlan.transport === "string";
}

async function resolveQuickActionRouteContext({
  action,
  origin = "runtime_message",
  preferInline = true
} = {}) {
  const standaloneConfig = await loadStandaloneConfig();
  const runtimeBase = (standaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  const desktopUp = await isDesktopAvailable(runtimeBase);
  const capabilities = createRunModeCapabilities({
    desktopAvailable: desktopUp,
    standaloneReady: hasStandaloneProviderConfig(standaloneConfig),
    standaloneConfig
  });
  return {
    standaloneConfig,
    runtimeBase,
    capabilities,
    routePlan: planQuickActionRoute({
      action,
      origin,
      capabilities,
      preferInline
    })
  };
}

async function resolvePageExplainRouteContext({
  origin = "page_action",
  preferSidePanel = true
} = {}) {
  const standaloneConfig = await loadStandaloneConfig();
  const runtimeBase = (standaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  const desktopUp = await isDesktopAvailable(runtimeBase);
  const capabilities = createRunModeCapabilities({
    desktopAvailable: desktopUp,
    standaloneReady: hasStandaloneProviderConfig(standaloneConfig),
    standaloneConfig
  });
  return {
    standaloneConfig,
    runtimeBase,
    capabilities,
    routePlan: planPageExplainRoute({
      origin,
      capabilities,
      preferSidePanel
    })
  };
}

export async function executeQuickAction({
  action,
  selectionState,
  tab = null,
  routePlan = null,
  standaloneConfig = null,
  runtimeBase = null,
  stream = false,
  signal = null,
  onStart = null,
  onChunk = null
}, fetchImpl = fetch) {
  const text = (selectionState?.text ?? "").trim();
  const requiresSelectionText = !["uca.fetch-link", "uca.inspect-image"].includes(action);
  if (requiresSelectionText && !text) {
    return { ok: false, error: "empty_selection" };
  }
  const userCommand = CAPTURE_ACTIONS[action]?.userCommand ?? QUICK_ACTION_COMMANDS[action] ?? QUICK_ACTION_COMMANDS.summarize;

  let effectiveRoutePlan = isValidRoutePlan(routePlan) ? routePlan : null;
  let effectiveStandaloneConfig = standaloneConfig;
  let effectiveRuntimeBase = runtimeBase;
  if (!effectiveRoutePlan) {
    const resolved = await resolveQuickActionRouteContext({
      action,
      origin: "runtime_message",
      preferInline: true
    });
    effectiveRoutePlan = resolved.routePlan;
    effectiveStandaloneConfig = resolved.standaloneConfig;
    effectiveRuntimeBase = resolved.runtimeBase;
  } else {
    if (!effectiveStandaloneConfig) effectiveStandaloneConfig = await loadStandaloneConfig();
    effectiveRuntimeBase = (effectiveRuntimeBase ?? effectiveStandaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  }

  if (!effectiveRoutePlan.ok) {
    return { ok: false, mode: effectiveRoutePlan.mode, error: effectiveRoutePlan.reason };
  }

  if (effectiveRoutePlan.transport === "standalone_direct") {
    if (action === "uca.inspect-image") {
      const imageUrl = selectionState?.imageUrl ?? "";
      if (!imageUrl) return { ok: false, mode: "standalone", error: "no_image_url" };
      onStart?.();
      const prompt = buildPromptFor(action, selectionState, "").prompt;
      const result = await callLLMDirectVision({ config: effectiveStandaloneConfig, prompt, imageUrl });
      if (result.ok) return { ok: true, mode: "standalone", text: result.text, status: "success" };
      return { ok: false, mode: "standalone", error: result.error };
    }

    let enrichmentMarkdown = "";
    if (shouldEnrichForAction(action)) {
      try {
        const enrichment = await enrichContextForAction({ action, selectionState, tab });
        enrichmentMarkdown = formatEnrichmentAsMarkdown(enrichment);
      } catch { /* enrichment is best-effort */ }
    }
    const { prompt, systemPrompt } = buildPromptFor(action, selectionState, enrichmentMarkdown);
    onStart?.();
    const translateMaxTokens = action === "uca.translate-selection" || action === "translate"
      ? (stream ? Math.min(256, Math.max(96, Math.round(text.length * 1.4))) : undefined)
      : undefined;
    const result = stream
      ? await callLLMDirectStream({
        config: effectiveStandaloneConfig,
        messages: [
          { role: "system", content: systemPrompt ?? "" },
          { role: "user", content: prompt }
        ],
        maxTokens: translateMaxTokens ?? 1024,
        signal,
        onChunk
      })
      : await callLLMDirect({
        config: effectiveStandaloneConfig,
        prompt,
        systemPrompt,
        ...(translateMaxTokens ? { maxTokens: translateMaxTokens } : {})
      });
    if (result.ok) return { ok: true, mode: "standalone", text: result.text, status: "success" };
    return { ok: false, mode: "standalone", error: result.error };
  }

  let enrichment = null;
  if (shouldEnrichForAction(action)) {
    try {
      enrichment = await enrichContextForAction({ action, selectionState, tab });
    } catch { /* best-effort */ }
  }

  onStart?.();
  return runDesktopTask({
    runtimeBase: effectiveRuntimeBase,
    userCommand,
    capture: buildDesktopCaptureForAction(action, selectionState, enrichment),
    fetchImpl
  });
}

export async function runQuickAction(args = {}, fetchImpl = fetch) {
  return executeQuickAction(args, fetchImpl);
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

async function queueSidePanelAnalysis(request, { chromeApi = chrome, windowId = null, openPanel = true, routePlan = null } = {}) {
  const effectiveRoutePlan = isValidRoutePlan(routePlan)
    ? routePlan
    : (isValidRoutePlan(request?.routePlan) ? request.routePlan : null);
  if (effectiveRoutePlan && !effectiveRoutePlan.ok) {
    return { ok: false, error: effectiveRoutePlan.reason, routePlan: effectiveRoutePlan };
  }
  const payload = {
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    ...request,
    ...(effectiveRoutePlan ? { routePlan: effectiveRoutePlan } : {})
  };
  await chromeApi.storage.local.set({
    [SIDEPANEL_PENDING_ANALYSIS_KEY]: payload
  });
  let resolvedWindowId = windowId;
  if (resolvedWindowId == null && chromeApi.windows?.getCurrent) {
    try {
      const currentWindow = await chromeApi.windows.getCurrent();
      resolvedWindowId = currentWindow?.id ?? null;
    } catch { /* ignore */ }
  }
  if (openPanel && resolvedWindowId != null && chromeApi.sidePanel?.open) {
    try {
      await chromeApi.sidePanel.open({ windowId: resolvedWindowId });
    } catch (error) {
      return {
        ok: false,
        queued: true,
        error: `sidepanel_open_failed:${error?.message ?? error}`
      };
    }
  }
  return { ok: true, requestId: payload.id };
}

async function openExtensionDialog(chromeApi = chrome, pagePath = "sidepanel/index.html") {
  const url = chromeApi.runtime.getURL(pagePath);
  const created = await chromeApi.tabs?.create?.({ url });
  return {
    ok: true,
    url,
    tabId: created?.id ?? null
  };
}

async function openFollowupDialog({
  action,
  selectionState,
  displayLabel = "",
  attached = "",
  priorResult = ""
} = {}, chromeApi = chrome, fetchImpl = fetch) {
  const standaloneConfig = await loadStandaloneConfig();
  const runtimeBase = (standaloneConfig?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
  const desktopUp = await isDesktopAvailable(runtimeBase);

  if (desktopUp) {
    const request = buildOverlayHandoffRequest({
      actionId: action ?? "summarize",
      selectionState,
      priorResult
    });
    return dispatchOverlayHandoff(request, chromeApi, fetchImpl);
  }

  const queued = await queueSidePanelAnalysis({
    kind: "carry_result",
    action,
    selectionState,
    displayLabel,
    attached,
    priorResult
  }, {
    chromeApi,
    openPanel: false
  });
  if (!queued?.ok) return queued;
  return openExtensionDialog(chromeApi, "sidepanel/index.html");
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
  if (!desktopUp && hasStandaloneProviderConfig(standaloneConfig)) {
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

function stripHtmlForPrompt(html = "", maxLength = 18_000) {
  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildStandaloneExplainPagePrompt(capture = {}) {
  const title = `${capture?.title ?? ""}`.trim();
  const url = `${capture?.url ?? ""}`.trim();
  if (capture?.kind === "video" && capture?.youtube) {
    const youtube = capture.youtube;
    const transcript = `${youtube?.transcriptBody ?? ""}`.trim();
    const transcriptBlock = transcript
      ? `\n\n字幕 / 转录：\n${transcript.slice(0, 18_000)}`
      : `\n\n当前未抓到字幕，已知信息：\n作者：${youtube?.author ?? "未知"}\n时长：${youtube?.lengthSeconds ?? 0} 秒`;
    return {
      contentKind: "video",
      systemPrompt: "You explain webpages and videos to a curious reader. Reply in Chinese with structured Markdown.",
      prompt: `请解释这个视频的内容、背景、关键观点和值得关注的地方。输出结构：1）一句话总述 2）5-8 条关键点 3）哪些地方需要保留不确定性。\n\n标题：${youtube?.title ?? title}\n作者：${youtube?.author ?? "未知"}\nURL：${url}${transcriptBlock}`
    };
  }

  const pageText = stripHtmlForPrompt(capture?.html ?? "");
  return {
    contentKind: "article",
    systemPrompt: "You explain webpages to a curious reader. Reply in Chinese with structured Markdown and stay grounded in the provided page text.",
    prompt: `请解释这个网页的内容、背景、关键观点和值得关注的地方。输出结构：1）一句话总述 2）5-8 条关键点 3）哪些地方需要保留不确定性。\n\n标题：${title}\nURL：${url}\n\n页面正文：\n${pageText || "(未抓到正文)"}`
  };
}

async function runStandaloneExplainPage({ capture, standaloneConfig, chromeApi = chrome }) {
  if (!hasStandaloneProviderConfig(standaloneConfig)) {
    return { ok: false, error: "desktop_unavailable" };
  }
  const { prompt, systemPrompt, contentKind } = buildStandaloneExplainPagePrompt(capture);
  const result = await callLLMDirect({
    config: standaloneConfig,
    prompt,
    systemPrompt,
    maxTokens: 1536
  });
  if (result.ok) {
    try {
      chromeApi.notifications?.create?.(`uca-explain-${Date.now()}`, {
        type: "basic",
        iconUrl: "popup/icon.png",
        title: `LingxY · ${contentKind === "video" ? "视频解释" : "网页解释"}`,
        message: (result.text ?? "").slice(0, 200) || "已生成讲解"
      });
    } catch { /* notifications optional */ }
  }
  return {
    ok: Boolean(result.ok),
    mode: "standalone",
    contentKind,
    text: result.text ?? "",
    error: result.error
  };
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
  pageExplainUrl = null
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

  const routeContext = await resolvePageExplainRouteContext({
    origin: "keyboard_or_service_worker",
    preferSidePanel: false
  });
  const { standaloneConfig, runtimeBase, routePlan } = routeContext;
  const resolvedExplainUrl = pageExplainUrl ?? `${runtimeBase}/page/explain`;
  if (!routePlan.ok) {
    return { ok: false, mode: routePlan.mode, error: routePlan.reason, routePlan };
  }
  if (routePlan.transport === "standalone_direct") {
    return runStandaloneExplainPage({ capture: payload, standaloneConfig, chromeApi });
  }

  try {
    const response = await fetchImpl(resolvedExplainUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capture: payload })
    });
    if (!response.ok) {
      return { ok: false, error: `runtime_explain_failed_${response.status}` };
    }
    return response.json();
  } catch (error) {
    invalidateDesktopProbe();
    if (hasStandaloneProviderConfig(standaloneConfig)) {
      return runStandaloneExplainPage({ capture: payload, standaloneConfig, chromeApi });
    }
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
    await syncContextMenus(chromeApi);
    await ensureOverlayDefaults(chromeApi);
  });
  chromeApi.runtime?.onStartup?.addListener?.(() => {
    void syncContextMenus(chromeApi);
  });
  void syncContextMenus(chromeApi);

  chromeApi.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "uca.explain-page") {
      const routeContext = await resolvePageExplainRouteContext({
        origin: "context_menu",
        preferSidePanel: true
      });
      await queueSidePanelAnalysis({
        kind: "page_explain",
        routePlan: routeContext.routePlan
      }, {
        chromeApi,
        windowId: tab?.windowId ?? null,
        routePlan: routeContext.routePlan
      });
      return;
    }
    const [{ result: selectionState } = {}] = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ucaSelectionState ?? null
    });

    const quickActionSelectionState = {
      text: selectionState?.text ?? info.selectionText ?? "",
      url: info.linkUrl ?? info.pageUrl ?? tab?.url ?? "",
      pageTitle: tab?.title ?? "",
      imageUrl: info.srcUrl ?? "",
      anchorText: info.linkText ?? ""
    };
    const inlineRouteContext = await resolveQuickActionRouteContext({
      action: info.menuItemId,
      origin: "context_menu",
      preferInline: true
    });
    if (!inlineRouteContext.routePlan.ok) {
      await queueSidePanelAnalysis({
        kind: "quickaction",
        action: info.menuItemId,
        selectionState: quickActionSelectionState,
        routePlan: inlineRouteContext.routePlan
      }, {
        chromeApi,
        windowId: tab?.windowId ?? null,
        routePlan: inlineRouteContext.routePlan
      });
      return;
    }

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
    if (visibleFrameActions.has(info.menuItemId)
        && inlineRouteContext.routePlan.ui === "inline_frame"
        && tab?.id != null) {
      const payload = {
        type: "uca.content.showActionFrame",
        action: info.menuItemId,
        selectionState: quickActionSelectionState,
        routePlan: inlineRouteContext.routePlan,
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

    if (visibleFrameActions.has(info.menuItemId) && tab?.windowId != null) {
      const sidepanelContext = inlineRouteContext.routePlan.ui === "sidepanel_pending"
        ? inlineRouteContext
        : await resolveQuickActionRouteContext({
          action: info.menuItemId,
          origin: "context_menu",
          preferInline: false
        });
      await queueSidePanelAnalysis({
        kind: "quickaction",
        action: info.menuItemId,
        selectionState: quickActionSelectionState,
        routePlan: sidepanelContext.routePlan
      }, {
        chromeApi,
        windowId: tab.windowId,
        routePlan: sidepanelContext.routePlan
      });
      return;
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
        selectionState: message.selectionState,
        routePlan: message.routePlan ?? null
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
        const explicitWindowId = message.windowId ?? null;
        const senderWindowId = _sender?.tab?.windowId ?? null;
        const routeContext = await resolvePageExplainRouteContext({
          origin: "popup_or_message",
          preferSidePanel: true
        });
        const result = await queueSidePanelAnalysis({
          kind: "page_explain",
          routePlan: routeContext.routePlan
        }, {
          chromeApi,
          windowId: explicitWindowId ?? senderWindowId,
          openPanel: message.openPanel !== false,
          routePlan: routeContext.routePlan
        });
        sendResponse(result);
      })();
      return true;
    }

    if (message?.type === "uca.sidepanel.startAnalysis") {
      (async () => {
        const explicitWindowId = message.windowId ?? null;
        const senderWindowId = _sender?.tab?.windowId ?? null;
        const result = await queueSidePanelAnalysis(message.request ?? {}, {
          chromeApi,
          windowId: explicitWindowId ?? senderWindowId,
          openPanel: message.openPanel !== false
        });
        sendResponse(result);
      })();
      return true;
    }

    if (message?.type === "uca.dialog.open") {
      (async () => {
        try {
          const result = await openExtensionDialog(chromeApi, message.pagePath ?? "sidepanel/index.html");
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error?.message ?? String(error) });
        }
      })();
      return true;
    }

    if (message?.type === "uca.result.openFollowup") {
      openFollowupDialog({
        action: message.action,
        selectionState: message.selectionState ?? null,
        displayLabel: message.displayLabel ?? "",
        attached: message.attached ?? "",
        priorResult: message.priorResult ?? ""
      }, chromeApi, fetch).then((response) => sendResponse(response));
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
        const history = Array.isArray(message.history)
          ? message.history
            .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
            .slice(-MAX_CHAT_HISTORY_TURNS)
          : [];
        const conversation = [...history, { role: "user", content: userText }];
        const config = await loadStandaloneConfig();

        const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
        if (await isDesktopAvailable(runtimeBase)) {
          const desktopResult = await runDesktopTask({
            runtimeBase,
            userCommand: userText,
            capture: {
              sourceType: "chat",
              text: userText,
              history: conversation.slice(0, -1),
              browser: "chrome.exe"
            }
          });
          if (desktopResult.ok) {
            sendResponse({
              ok: true,
              mode: "desktop",
              text: desktopResult.text,
              history: [...conversation, { role: "assistant", content: desktopResult.text }]
            });
            return;
          }
          sendResponse({ ok: false, error: desktopResult.error ?? "desktop_stream_failed" });
          return;
        }

        if (hasStandaloneProviderConfig(config)) {
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
          sendResponse({ ok: false, error: result.error ?? "standalone_failed" });
          return;
        }

        sendResponse({ ok: false, error: "no_provider_configured" });
      })();
      return true;
    }

    if (message?.type === "uca.standalone.status") {
      (async () => {
        const config = await loadStandaloneConfig();
        const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
        invalidateDesktopProbe();
        const desktopUp = await isDesktopAvailable(runtimeBase);
        const standaloneReady = hasStandaloneProviderConfig(config);
        const capabilities = createRunModeCapabilities({
          desktopAvailable: desktopUp,
          standaloneReady,
          standaloneConfig: config
        });
        sendResponse({
          desktopAvailable: desktopUp,
          standaloneReady,
          provider: config?.provider ?? null,
          runtimeUrl: runtimeBase,
          capabilities
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
        ? message.history
          .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
          .slice(-MAX_CHAT_HISTORY_TURNS)
        : [];
      const conversation = [...history, { role: "user", content: userText }];
      const config = await loadStandaloneConfig();
      // Caller (popup / sidepanel) can override the system prompt — the
      // side panel sends a richer prompt that emphasizes continuity with
      // previously-analyzed pages / videos so follow-ups ("展开第 3 点")
      // get anchored correctly.
      const systemPrompt = typeof message.systemPrompt === "string" && message.systemPrompt.trim()
        ? message.systemPrompt
        : "You are LingxY, a helpful assistant in a Chrome extension popup. Reply concisely in the user's language. Use Markdown for structure when helpful.";
      const messages = [{ role: "system", content: systemPrompt }, ...conversation];
      const requestedMaxTokens = Number.isFinite(message?.maxTokens)
        ? Math.min(2048, Math.max(256, Math.round(message.maxTokens)))
        : 512;
      port.postMessage({ type: "start" });
      const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
      let result;
      if (await isDesktopAvailable(runtimeBase)) {
        result = await runDesktopTask({
          runtimeBase,
          userCommand: userText,
          capture: {
            sourceType: "chat",
            text: userText,
            history: conversation.slice(0, -1),
            browser: "chrome.exe"
          }
        });
      } else {
        if (!hasStandaloneProviderConfig(config)) {
          port.postMessage({ type: "error", error: "no_provider_configured" });
          return;
        }
        result = await callLLMDirectStream({
          config,
          messages,
          maxTokens: requestedMaxTokens,
          signal: controller.signal,
          onChunk: (delta, full) => {
            if (aborted) return;
            try { port.postMessage({ type: "chunk", delta, full }); } catch { /* port closed */ }
          },
          // 83.4 — surface reasoning_content (Qwen3 thinking, DeepSeek
          // reasoning) as separate stream events so the sidepanel can
          // render a folded "🧠 思考过程" card next to the assistant
          // bubble. Without this the user just sees a long pause until
          // the model finishes thinking and starts emitting content.
          onReasoningChunk: (delta, full) => {
            if (aborted) return;
            try { port.postMessage({ type: "reasoning_chunk", delta, full }); } catch { /* port closed */ }
          }
        });
      }
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
      const runtimeBase = (config?.runtimeUrl ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
      const routePlan = isValidRoutePlan(message.routePlan)
        ? message.routePlan
        : (await resolveQuickActionRouteContext({
          action,
          origin: "selection_chip",
          preferInline: true
        })).routePlan;

      if (!routePlan.ok) {
        port.postMessage({ type: "error", error: routePlan.reason });
        return;
      }

      const result = await executeQuickAction({
        action,
        selectionState,
        tab: message.tab ?? null,
        routePlan,
        standaloneConfig: config,
        runtimeBase,
        stream: true,
        signal: controller.signal,
        onStart: () => {
          if (!aborted) port.postMessage({ type: "start" });
        },
        onChunk: (delta, full) => {
          if (aborted) return;
          try { port.postMessage({ type: "chunk", delta, full }); } catch { /* closed */ }
        }
      }, fetch);
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
