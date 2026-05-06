import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBrowserContextPacket,
  submitBrowserTask
} from "../../src/service/core/browser-submission.mjs";
import { createEventBusScaffold } from "../../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../../src/service/store/artifact-store.mjs";

function createFetchResponse(body, contentType = "text/html; charset=utf-8") {
  const bytes = Buffer.from(body, "utf8");
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        if (String(name).toLowerCase() === "content-length") return String(bytes.length);
        return null;
      }
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

test("URL-only browser capture is metadata until page text is fetched", () => {
  const packet = buildBrowserContextPacket({
    traceId: "trace_url_only",
    contextId: "ctx_url_only",
    capture: {
      sourceType: "webpage",
      browser: "chrome.exe",
      url: "https://example.com/current",
      pageTitle: "Current Page",
      text: "URL：https://example.com/current",
      metadata: { hasPageContent: false }
    }
  });

  assert.equal(packet.selection_metadata.browser_page_content, false);
  assert.ok(packet.selection_metadata.content_evidence.some((entry) =>
    entry.source_kind === "browser_page_metadata"
    && entry.coverage_scope === "url_title_only"
    && entry.content_extracted === false
  ));
});

test("explicit current-page browser capture fetches page text before execution", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-browser-page-"));
  const seen = {};
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    artifactStore: createArtifactStore({ baseDir: tempDir }),
    executors: [{
      id: "fast",
      async *execute(task) {
        seen.text = task.context_packet?.text ?? "";
        yield { event_type: "inline_result", payload: { text: "ok" } };
        yield { event_type: "success", payload: { text: "ok" } };
      }
    }],
    async fetchImpl(url) {
      assert.equal(url, "https://example.com/current");
      return createFetchResponse("<html><body><main>Full current page article body.</main></body></html>");
    }
  };

  try {
    const { task } = await submitBrowserTask({
      runtime,
      userCommand: "请分析当前页面",
      executionMode: "interactive",
      capture: {
        sourceType: "webpage",
        browser: "chrome.exe",
        url: "https://example.com/current",
        pageTitle: "Current Page",
        text: "URL：https://example.com/current",
        metadata: { hasPageContent: false }
      }
    });

    assert.equal(task.status, "success");
    assert.match(seen.text, /Full current page article body/);
    assert.equal(task.context_packet.context_sources.browser_page, true);
    assert.equal(task.context_packet.context_sources.real_selection, false);
    assert.ok(task.context_packet.selection_metadata.content_evidence.some((entry) =>
      entry.source_kind === "browser_prefetch_text"
      && entry.coverage_scope === "fetched_page_text"
      && entry.content_extracted === true
    ));
    assert.ok(runtime.store.getTaskEvents(task.task_id).some((event) =>
      event.event_type === "step_finished"
      && event.payload?.step === "browser_page_context_prefetch"
    ));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser page explanation capture is structured page evidence, not a real text selection", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-browser-page-"));
  const seen = {};
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    artifactStore: createArtifactStore({ baseDir: tempDir }),
    executors: [{
      id: "fast",
      async *execute(task) {
        seen.contextSources = task.context_packet?.context_sources ?? {};
        seen.metadata = task.context_packet?.selection_metadata ?? {};
        yield { event_type: "inline_result", payload: { text: "ok" } };
        yield { event_type: "success", payload: { text: "ok" } };
      }
    }]
  };

  try {
    const { task } = await submitBrowserTask({
      runtime,
      userCommand: "请分析当前页面",
      executionMode: "interactive",
      capture: {
        sourceType: "page_explanation",
        browser: "chrome.exe",
        url: "https://example.com/article",
        pageTitle: "Article",
        text: "文章标题：Article\n\n正文内容：\nStructured article body."
      }
    });

    assert.equal(task.status, "success");
    assert.equal(seen.metadata.browser_page_content, true);
    assert.ok(seen.metadata.content_evidence.some((entry) =>
      entry.source_kind === "browser_page_text"
      && entry.coverage_scope === "captured_page_text"
      && entry.content_extracted === true
    ));
    assert.equal(seen.contextSources.browser_page, true);
    assert.equal(seen.contextSources.real_selection, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("page explanation metadata can prefetch full page text for explicit current-page commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-browser-page-"));
  const seen = {};
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    artifactStore: createArtifactStore({ baseDir: tempDir }),
    executors: [{
      id: "fast",
      async *execute(task) {
        seen.text = task.context_packet?.text ?? "";
        yield { event_type: "inline_result", payload: { text: "ok" } };
        yield { event_type: "success", payload: { text: "ok" } };
      }
    }],
    async fetchImpl(url) {
      assert.equal(url, "https://example.com/page-explain");
      return createFetchResponse("<html><body><article>Fetched explanation page body.</article></body></html>");
    }
  };

  try {
    const { task } = await submitBrowserTask({
      runtime,
      userCommand: "请分析此页面",
      executionMode: "interactive",
      capture: {
        sourceType: "page_explanation",
        browser: "chrome.exe",
        url: "https://example.com/page-explain",
        pageTitle: "Page Explanation",
        text: "",
        metadata: { hasPageContent: false }
      }
    });

    assert.equal(task.status, "success");
    assert.match(seen.text, /Fetched explanation page body/);
    assert.equal(task.context_packet.selection_metadata.browser_page_prefetch, "success");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("explicit current-page capture fails closed when only URL metadata is available and page prefetch fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-browser-page-"));
  let executorCalled = false;
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    artifactStore: createArtifactStore({ baseDir: tempDir }),
    executors: [{
      id: "fast",
      async *execute() {
        executorCalled = true;
        yield { event_type: "inline_result", payload: { text: "should not run" } };
      }
    }],
    async fetchImpl() {
      throw new Error("network unavailable");
    }
  };

  try {
    const { task } = await submitBrowserTask({
      runtime,
      userCommand: "请分析当前页面",
      executionMode: "interactive",
      capture: {
        sourceType: "webpage",
        browser: "chrome.exe",
        url: "https://example.com/current",
        pageTitle: "Current Page",
        text: "URL：https://example.com/current",
        metadata: { hasPageContent: false }
      }
    });

    assert.equal(task.status, "failed");
    assert.equal(executorCalled, false);
    assert.match(task.failure_user_message, /上下文读取失败|could not read/i);
    assert.equal(task.context_packet.selection_metadata.browser_page_prefetch, "failed");
    assert.ok(task.context_packet.selection_metadata.content_evidence.some((entry) =>
      entry.source_kind === "browser_prefetch_failed"
      && entry.status === "failed"
      && entry.content_extracted === false
    ));
    assert.ok(runtime.store.getTaskEvents(task.task_id).some((event) =>
      event.event_type === "step_warning"
      && event.payload?.step === "browser_page_context_prefetch"
    ));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
