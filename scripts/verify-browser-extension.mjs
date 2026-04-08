import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeHostHandler } from "../uca-native-host/index.mjs";
import { encodeNativeMessage, decodeNativeMessage } from "../uca-native-host/protocol.mjs";
import { submitBrowserTask, listRecentTasks } from "../src/service/core/browser-submission.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createFastExecutorScaffold } from "../src/service/executors/fast/fast-executor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(await readFile(path.join(repoRoot, "browser_ext", "manifest.json"), "utf8"));

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
  executors: [createFastExecutorScaffold()]
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
assert.equal(imageResponse.payload.status, "unsupported");

const recentTasksResponse = await handler({
  protocolVersion: "1.0",
  requestId: "req-recent",
  action: "get_recent_tasks"
});

assert.equal(recentTasksResponse.ok, true);
assert.equal(recentTasksResponse.payload.tasks.length, 2);

console.log("Browser extension pipeline verification passed.");
