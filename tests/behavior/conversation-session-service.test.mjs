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
