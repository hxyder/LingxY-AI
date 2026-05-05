import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeHostHandler } from "../uca-native-host/index.mjs";
import { encodeNativeMessage, decodeNativeMessage } from "../uca-native-host/protocol.mjs";
import {
  buildOverlayHandoffRequest,
  dispatchBrowserContextSnapshot,
  dispatchOverlayHandoff,
  executeQuickAction,
  RUNTIME_BROWSER_CONTEXT_URL,
  RUNTIME_OVERLAY_HANDOFF_URL,
  runQuickAction
} from "../browser_ext/background/service-worker.js";
import { submitBrowserTask, listRecentTasks } from "../src/service/core/browser-submission.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createMultiModalExecutorScaffold } from "../src/service/executors/multi_modal/multi-modal-executor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(await readFile(path.join(repoRoot, "browser_ext", "manifest.json"), "utf8"));
const locationModule = await readFile(path.join(repoRoot, "browser_ext", "shared", "location.js"), "utf8");

function createFetchResponse(body, contentType) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return contentType;
        if (name.toLowerCase() === "content-length") return String(bytes.length);
        return null;
      }
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function createMockFastExecutor() {
  return {
    id: "fast",
    model: "mock",
    async *execute(task) {
      const text = `Mock browser summary: ${String(task.context_packet?.text ?? task.user_command ?? "").slice(0, 80)}`;
      yield { event_type: "inline_result", payload: { text } };
      yield { event_type: "success", payload: { text, summary: text } };
    }
  };
}

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes("nativeMessaging"));
assert.equal(manifest.background.service_worker, "background/service-worker.js");
assert.equal((manifest.optional_permissions ?? []).includes("geolocation"), false,
  "Chrome MV3 rejects geolocation in optional_permissions; use navigator.geolocation from a user gesture");
assert.equal((manifest.permissions ?? []).includes("geolocation"), true,
  "Chrome extension pages need geolocation in required permissions for navigator.geolocation");
assert.equal(/chrome\.permissions\.(request|contains|remove)[\s\S]*geolocation/.test(locationModule), false,
  "location module must not request geolocation through chrome.permissions");
assert.ok(locationModule.includes("navigator.geolocation"),
  "location module must use the browser geolocation API");

const framed = encodeNativeMessage({ hello: "world" });
assert.deepEqual(decodeNativeMessage(framed), { hello: "world" });

const runtime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-browser-extension") }),
  executors: [createMockFastExecutor(), createMultiModalExecutorScaffold()],
  async fetchImpl(url) {
    if (url.endsWith("/image.png")) {
      return createFetchResponse(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png");
    }
    if (url.endsWith("/linked")) {
      return createFetchResponse("<html><body><main>Fetched browser link content.</main></body></html>", "text/html; charset=utf-8");
    }
    throw new Error(`unexpected browser fetch URL ${url}`);
  }
};

const handler = createNativeHostHandler({
  hostName: "com.uca.host",
  async submitCapture(payload) {
    return submitBrowserTask({
      capture: payload.capture,
      userCommand: payload.userCommand,
      runtime
    });
  },
  async handoffCapture(payload) {
    return {
      accepted: true,
      handoffPath: path.join(repoRoot, ".tmp", "verify-browser-extension", "prompt-handoff.json"),
      sourceType: payload.capture.sourceType
    };
  },
  listRecentTasks() {
    return listRecentTasks(runtime.store, 5);
  }
});

const selectionResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-selection",
  action: "submit_capture",
  payload: {
    userCommand: "请总结这段网页内容",
    capture: {
      sourceType: "text_selection",
      browser: "chrome.exe",
      url: "https://example.com/article",
      pageTitle: "Example Article",
      text: "This is a captured browser selection."
    }
  }
});

assert.equal(selectionResponse.ok, true);
assert.equal(selectionResponse.payload.status, "success");
assert.equal(runtime.store.taskEvents.some((event) => event.event_type === "success"), true);

const secondSelectionResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-selection-2",
  action: "submit_capture",
  payload: {
    userCommand: "请总结这段网页内容",
    capture: {
      sourceType: "text_selection",
      browser: "chrome.exe",
      url: "https://example.com/article",
      pageTitle: "Example Article",
      text: "This is a different captured browser selection from the same URL."
    }
  }
});

assert.equal(secondSelectionResponse.ok, true);
assert.equal(secondSelectionResponse.payload.status, "success");
assert.notEqual(secondSelectionResponse.payload.taskId, selectionResponse.payload.taskId);

const imageResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-image",
  action: "submit_capture",
  payload: {
    userCommand: "请分析这张图片",
    capture: {
      sourceType: "image",
      browser: "chrome.exe",
      url: "https://example.com/page",
      imageUrl: "https://example.com/image.png"
    }
  }
});

assert.equal(imageResponse.ok, true);
assert.equal(imageResponse.payload.status, "success");
assert.equal(runtime.store.taskEvents.some((event) => event.payload?.step === "browser_image_fetch"), true);

const handoffRequest = buildOverlayHandoffRequest({
  actionId: "summarize",
  selectionState: {
    text: "Browser selection for overlay handoff.",
    contextBefore: "Browser selection",
    contextAfter: "overlay handoff.",
    sourceType: "text_selection",
    url: "https://example.com/overlay",
    pageTitle: "Overlay"
  }
});

assert.equal(handoffRequest.action, "handoff_capture");
assert.equal(handoffRequest.payload.targetWindow, "overlay");
assert.equal(handoffRequest.payload.priorResult, null);
assert.equal(handoffRequest.payload.priorUserCommand, null);

// Carrying a prior result back into the desktop overlay (follow-up thread)
const followUpRequest = buildOverlayHandoffRequest({
  actionId: "translate",
  selectionState: {
    text: "Hello world",
    sourceType: "text_selection",
    url: "https://example.com/translate",
    pageTitle: "Translate"
  },
  priorResult: "[zh] 你好世界"
});
assert.equal(followUpRequest.payload.priorResult, "[zh] 你好世界");
assert.equal(typeof followUpRequest.payload.priorUserCommand, "string");
assert.ok(followUpRequest.payload.priorUserCommand.length > 0);

let fetchRequest = null;
const runtimeHandoffResponse = await dispatchOverlayHandoff(
  handoffRequest,
  {
    runtime: {
      sendNativeMessage(_hostName, _request, callback) {
        callback?.({ ok: false });
      }
    }
  },
  async (url, options) => {
    fetchRequest = {
      url,
      options
    };
    return {
      ok: true,
      async json() {
        return {
          accepted: true,
          delivery: "overlay"
        };
      }
    };
  }
);

assert.equal(fetchRequest.url, RUNTIME_OVERLAY_HANDOFF_URL);
assert.equal(JSON.parse(fetchRequest.options.body).targetWindow, "overlay");
assert.equal(runtimeHandoffResponse.accepted, true);

let browserContextFetch = null;
const browserContextResponse = await dispatchBrowserContextSnapshot(
  {
    sourceType: "web_page",
    browser: "chrome.exe",
    url: "https://www.youtube.com/watch?v=abc123",
    pageTitle: "Prompt Engineering Tutorial - YouTube",
    text: "Prompt engineering is an emerging career path."
  },
  async (url, options) => {
    browserContextFetch = { url, options };
    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }
);
assert.equal(browserContextResponse.ok, true);
assert.equal(browserContextFetch.url, RUNTIME_BROWSER_CONTEXT_URL);
assert.equal(JSON.parse(browserContextFetch.options.body).context.pageTitle.includes("Prompt Engineering"), true);

const handoffResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-handoff",
  action: "handoff_capture",
  payload: handoffRequest.payload
});

assert.equal(handoffResponse.ok, true);
assert.equal(handoffResponse.payload.accepted, true);
assert.equal(handoffResponse.payload.delivery, "overlay");

const recentTasksResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-recent",
  action: "get_recent_tasks"
});

assert.equal(recentTasksResponse.ok, true);
assert.equal(recentTasksResponse.payload.tasks.length, 4);

const linkResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-link",
  action: "submit_capture",
  payload: {
    userCommand: "请总结这个链接",
    capture: {
      sourceType: "link",
      browser: "chrome.exe",
      url: "https://example.com/linked",
      anchorText: "linked article"
    }
  }
});

assert.equal(linkResponse.ok, true);
assert.equal(linkResponse.payload.status, "success");
assert.equal(runtime.store.taskEvents.some((event) => event.payload?.step === "web_fetch"), true);
assert.equal(runtime.store.taskEvents.some((event) => event.payload?.step === "web_fetch_placeholder"), false);

// runQuickAction (inline result frame backend) — mocked fetch round-trip
let submittedTask = null;
const quickActionResult = await runQuickAction(
  {
    action: "translate",
    routePlan: {
      ok: true,
      origin: "verify",
      actionKind: "text",
      ui: "inline_frame",
      transport: "desktop_task",
      mode: "desktop",
      reason: "verify_desktop_task"
    },
    runtimeBase: "http://127.0.0.1:4310",
    selectionState: {
      text: "Hello world",
      url: "https://example.com",
      pageTitle: "Example"
    }
  },
  async (url, opts) => {
    if (url.endsWith("/task") && opts?.method === "POST") {
      submittedTask = JSON.parse(opts.body);
      return {
        ok: true,
        async json() {
          return {
            task: { task_id: "task_qa", status: "success", executor: "translate" },
            taskEvents: [
              { event_type: "inline_result", payload: { text: "[zh] Hello world" } }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  }
);
assert.equal(quickActionResult.ok, true);
assert.equal(quickActionResult.text, "[zh] Hello world");
assert.equal(quickActionResult.taskId, "task_qa");
assert.equal(submittedTask?.userCommand?.includes("翻译"), true);
assert.equal(submittedTask?.capture?.text, "Hello world");

const emptyQuickAction = await runQuickAction(
  { action: "translate", selectionState: { text: "  " } },
  async () => { throw new Error("should not be called"); }
);
assert.equal(emptyQuickAction.ok, false);
assert.equal(emptyQuickAction.error, "empty_selection");

const originalFetch = globalThis.fetch;
try {
  const standaloneCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    standaloneCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "Standalone summary" } }] };
      }
    };
  };
  const standaloneText = await executeQuickAction({
    action: "uca.summarize-selection",
    routePlan: {
      ok: true,
      origin: "verify",
      actionKind: "text",
      ui: "inline_frame",
      transport: "standalone_direct",
      mode: "standalone",
      reason: "verify_standalone_text"
    },
    standaloneConfig: { provider: "openai", apiKey: "test-key", model: "gpt-5.4-mini" },
    selectionState: {
      text: "Selected text",
      url: "https://example.com",
      pageTitle: "Example"
    }
  });
  assert.equal(standaloneText.ok, true);
  assert.equal(standaloneText.text, "Standalone summary");
  assert.equal(standaloneCalls.length, 1);
  assert.equal(standaloneCalls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(standaloneCalls[0].body.messages[0].role, "system");

  const visionCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    visionCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    if (String(url) === "https://example.com/image.png") {
      return {
        ok: true,
        async blob() {
          return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
        }
      };
    }
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "Vision analysis" } }] };
      }
    };
  };
  const standaloneImage = await executeQuickAction({
    action: "uca.inspect-image",
    routePlan: {
      ok: true,
      origin: "verify",
      actionKind: "image",
      ui: "inline_frame",
      transport: "standalone_direct",
      mode: "standalone",
      reason: "verify_standalone_image"
    },
    standaloneConfig: { provider: "openai", apiKey: "test-key", model: "gpt-5.4-mini" },
    selectionState: {
      imageUrl: "https://example.com/image.png",
      url: "https://example.com/page",
      pageTitle: "Example Image"
    }
  });
  assert.equal(standaloneImage.ok, true);
  assert.equal(standaloneImage.text, "Vision analysis");
  assert.equal(visionCalls.length, 2);
  assert.equal(visionCalls[1].body.messages[0].content[0].type, "image_url");
  assert.ok(visionCalls[1].body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,"));
} finally {
  globalThis.fetch = originalFetch;
}

// Inline result frame helper exists in the content script
const selectionCacheJs = await readFile(path.join(repoRoot, "browser_ext", "content_script", "selection-cache.js"), "utf8");
assert.equal(selectionCacheJs.includes("showInlineResultFrame"), true);
assert.equal(selectionCacheJs.includes("sendRuntimeMessageSafely"), true);
assert.equal(selectionCacheJs.includes("uca.runtime.runQuickAction"), true);
assert.equal(selectionCacheJs.includes("uca.browser.contextSnapshot"), true);
assert.equal(selectionCacheJs.includes("buildBrowserContextSnapshot"), true);
assert.equal(selectionCacheJs.includes("yt-navigate-finish"), true);
assert.equal(selectionCacheJs.includes("ACTION_LABELS"), true);
// "Open in dialog" button must carry the prior result into the follow-up path
assert.equal(selectionCacheJs.includes("uca.result.openFollowup"), true);
assert.equal(selectionCacheJs.includes("priorResult: resultText"), true);

// Service worker must register the openWithResult message handler
const serviceWorkerJs = await readFile(path.join(repoRoot, "browser_ext", "background", "service-worker.js"), "utf8");
assert.equal(serviceWorkerJs.includes("uca.overlay.openWithResult"), true);
assert.equal(serviceWorkerJs.includes("uca.browser.contextSnapshot"), true);
assert.equal(serviceWorkerJs.includes("RUNTIME_BROWSER_CONTEXT_URL"), true);
assert.equal(serviceWorkerJs.includes("hasStandaloneProviderConfig"), true);
assert.equal(serviceWorkerJs.includes("standaloneConfig?.apiKey"), false);
assert.equal(serviceWorkerJs.includes("resolveQuickActionRouteContext"), true);
assert.equal(serviceWorkerJs.includes("resolvePageExplainRouteContext"), true);
assert.equal(serviceWorkerJs.includes("function isValidRoutePlan("), false,
  "service worker must use the shared run-mode routePlan validator");
assert.equal(serviceWorkerJs.includes("isValidRoutePlan"), true);
assert.equal(serviceWorkerJs.includes("validateRoutePlan"), false,
  "routePlan validation schema should stay in run-mode-router, not be duplicated in the worker");
assert.equal(serviceWorkerJs.includes("executeQuickAction"), true);
assert.equal(serviceWorkerJs.includes("planPageExplainRoute"), true);
assert.equal(serviceWorkerJs.includes("routePlan: sidepanelContext.routePlan"), true);
assert.equal(serviceWorkerJs.includes("routePlan: inlineRouteContext.routePlan"), true);
assert.equal(
  /\(info\.menuItemId === "uca\.fetch-link" \|\| info\.menuItemId === "uca\.inspect-image"\)[\s\S]{0,220}queueSidePanelAnalysis/.test(serviceWorkerJs),
  false,
  "context-menu link/image actions must not bypass the shared quick-action route plan"
);
assert.equal(manifest.commands["explain-page"].suggested_key.default, "Ctrl+Shift+E");
const popupHtml = await readFile(path.join(repoRoot, "browser_ext", "popup", "index.html"), "utf8");
assert.equal(popupHtml.includes("快捷键 Ctrl+Shift+E"), true);
const popupJs = await readFile(path.join(repoRoot, "browser_ext", "popup", "index.js"), "utf8");
const sidepanelJs = await readFile(path.join(repoRoot, "browser_ext", "sidepanel", "index.js"), "utf8");
const runModeViewJs = await readFile(path.join(repoRoot, "browser_ext", "shared", "run-mode-view.js"), "utf8");
assert.equal(popupJs.includes("../shared/run-mode-view.js"), true);
assert.equal(sidepanelJs.includes("../shared/run-mode-view.js"), true);
assert.equal(sidepanelJs.includes("../shared/location.js"), true);
assert.equal(sidepanelJs.includes("await import(\"../shared/location.js\")"), false,
  "sidepanel location click must not insert a dynamic import before navigator.geolocation");
assert.equal(sidepanelJs.includes("formatRouteFailureMessage"), true);
assert.equal(sidepanelJs.includes("request.kind === \"runtime_unavailable\""), true);
assert.equal(sidepanelJs.includes("routePlan: request.routePlan ?? null"), true);
assert.equal(sidepanelJs.includes("routePlan = null"), true);
assert.equal(selectionCacheJs.includes("routePlan"), true);
assert.equal(runModeViewJs.includes("本地工具与文件/RAG"), true);
assert.equal(runModeViewJs.includes("网页内容问答"), true);
assert.equal(runModeViewJs.includes("暂无可运行后端"), true);
const runModeRouterJs = await readFile(path.join(repoRoot, "browser_ext", "background", "run-mode-router.js"), "utf8");
assert.equal(runModeRouterJs.includes("export function validateRoutePlan"), true);
assert.equal(runModeRouterJs.includes("ok_route_has_no_transport"), true);
assert.equal(runModeViewJs.includes("formatRouteFailureMessage"), true);
assert.equal(serviceWorkerJs.includes("kind: \"runtime_unavailable\""), true);
const optionsJs = await readFile(path.join(repoRoot, "browser_ext", "options", "index.js"), "utf8");
assert.equal(optionsJs.includes("isStandaloneProviderConfigured"), true);
assert.equal(optionsJs.includes("providerRequiresApiKey(config.provider)"), true);

// Overlay renderer must handle priorResult by rendering history + conversation state
const overlayJs = await readFile(path.join(repoRoot, "src", "desktop", "renderer", "overlay.js"), "utf8");
assert.equal(overlayJs.includes("conversationState"), true);
assert.equal(overlayJs.includes("ensureConversation"), true);
assert.equal(overlayJs.includes("startNewConversation"), true);
assert.equal(overlayJs.includes("appendTurn"), true);
assert.equal(overlayJs.includes("compressIfNeeded"), true);
assert.equal(overlayJs.includes("persistConversation"), true);
assert.equal(overlayJs.includes("restoreConversation"), true);
assert.equal(overlayJs.includes("payload.priorResult"), true);
assert.equal(overlayJs.includes("newSessionBtn"), true);
assert.equal(overlayJs.includes("pendingActiveWindowContext"), true);
assert.equal(overlayJs.includes("resolveActiveWindowBrowserCapture"), true);
assert.equal(overlayJs.includes("fetchRecentBrowserContextForActiveWindow"), true);
assert.equal(overlayJs.includes("buildBrowserContextCapture"), true);

console.log("Browser extension pipeline verification passed.");
