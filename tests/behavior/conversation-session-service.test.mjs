import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";
import {
  SESSION_ITEM_KINDS,
  createConversationSessionService
} from "../../src/service/core/session/conversation-session-service.mjs";
import { emitTaskEvent } from "../../src/service/core/task-runtime/event-emitter.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";

const route = {
  intent: "general",
  goal: "qa",
  executor: "fast",
  suggested_executor: "fast",
  intent_tags: [],
  suggested_formats: [],
  requires_confirmation: false
};

function createSqliteFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingxy-session-test-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "store.sqlite") });
  return {
    store,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("conversation session service appends ordered typed items", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_session" });
  const service = createConversationSessionService({ store });

  const session = service.ensureSession({ conversationId: "conv_session" });
  const first = service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.USER_MESSAGE,
    role: "user",
    content: "继续处理上个文件",
    payload: { source_app: "test" }
  });
  const second = service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: "task_session"
  });

  assert.equal(first.order_index, 0);
  assert.equal(second.order_index, 1);
  assert.deepEqual(
    service.listItems(session.session_id).map((item) => item.kind),
    [SESSION_ITEM_KINDS.USER_MESSAGE, SESSION_ITEM_KINDS.TASK_ANCHOR]
  );
});

test("conversation session storage round-trips through sqlite", () => {
  const fixture = createSqliteFixture();
  try {
    fixture.store.insertConversation({ conversation_id: "conv_sqlite" });
    const service = createConversationSessionService({ store: fixture.store });
    const session = service.ensureSession({
      conversationId: "conv_sqlite",
      metadata: { purpose: "round_trip" }
    });
    service.appendItem({
      sessionId: session.session_id,
      kind: SESSION_ITEM_KINDS.RUNTIME_NOTE,
      content: "typed session item",
      payload: { ok: true }
    });

    const loaded = service.getLatestForConversation("conv_sqlite");
    const items = service.listItems(session.session_id);
    assert.equal(loaded.session_id, session.session_id);
    assert.equal(loaded.metadata.purpose, "round_trip");
    assert.equal(items[0].content_text, "typed session item");
    assert.deepEqual(items[0].payload, { ok: true });
  } finally {
    fixture.cleanup();
  }
});

test("task submission records user message and task anchor session items", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: {
      snapshot() { return { queued: 0, running: 0 }; }
    },
    eventBus: { publish() {} },
    logsDir: null,
    toolContext: {}
  };
  ensureRuntimeServices(runtime);

  const result = submitTaskWithConversation({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "把上个表格整理一下",
    executionMode: "interactive",
    conversationId: "conv_submit_session",
    runtime
  });

  const session = runtime.conversationSessions.getLatestForConversation("conv_submit_session");
  const items = runtime.conversationSessions.listItems(session.session_id);
  assert.equal(session.active_task_id, result.task.task_id);
  assert.deepEqual(
    items.map((item) => item.kind),
    [SESSION_ITEM_KINDS.USER_MESSAGE, SESSION_ITEM_KINDS.TASK_ANCHOR]
  );
  assert.equal(items[0].message_id, result.userMessage.message_id);
  assert.equal(items[1].task_id, result.task.task_id);
});

test("tool task events are persisted as typed session items", () => {
  const published = [];
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: {
      snapshot() { return { queued: 0, running: 0 }; }
    },
    eventBus: { publish(event) { published.push(event); } },
    logsDir: null,
    toolContext: {}
  };
  ensureRuntimeServices(runtime);
  const result = submitTaskWithConversation({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "查一下资料",
    executionMode: "interactive",
    conversationId: "conv_tool_session",
    runtime
  });

  emitTaskEvent({
    runtime,
    taskId: result.task.task_id,
    eventType: "tool_call_started",
    payload: {
      tool_id: "web_search_fetch",
      tool_call_id: "call_1",
      args: { query: "LingxY" }
    }
  });
  emitTaskEvent({
    runtime,
    taskId: result.task.task_id,
    eventType: "tool_call_completed",
    payload: {
      tool_id: "web_search_fetch",
      tool_call_id: "call_1",
      success: true,
      observation: "Found source material."
    }
  });
  emitTaskEvent({
    runtime,
    taskId: result.task.task_id,
    eventType: "text_delta",
    payload: { delta: "not persisted to session items" }
  });

  const session = runtime.conversationSessions.getLatestForConversation("conv_tool_session");
  const items = runtime.conversationSessions.listItems(session.session_id);
  const toolItems = items.filter((item) => [
    SESSION_ITEM_KINDS.TOOL_CALL,
    SESSION_ITEM_KINDS.TOOL_OBSERVATION
  ].includes(item.kind));

  assert.deepEqual(toolItems.map((item) => item.kind), [
    SESSION_ITEM_KINDS.TOOL_CALL,
    SESSION_ITEM_KINDS.TOOL_OBSERVATION
  ]);
  assert.equal(toolItems[0].payload.tool_id, "web_search_fetch");
  assert.deepEqual(toolItems[0].payload.args, { query: "LingxY" });
  assert.equal(toolItems[1].content_text, "Found source material.");
  assert.equal(toolItems[1].payload.success, true);
  assert.equal(items.some((item) => item.content_text === "not persisted to session items"), false);
  assert.ok(published.some((event) => event.event_type === "conversation_step"));
});
