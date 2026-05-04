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
assert.equal(manifest.commands["explain-page"].suggested_key.default, "Ctrl+Shift+E");
const popupHtml = await readFile(path.join(repoRoot, "browser_ext", "popup", "index.html"), "utf8");
assert.equal(popupHtml.includes("快捷键 Ctrl+Shift+E"), true);
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
