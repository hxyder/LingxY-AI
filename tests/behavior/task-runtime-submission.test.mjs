import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime/task-submission.mjs";

const baseRoute = {
  intent: "general",
  executor: "fast",
  requires_confirmation: false
};

test("task submission shell creates conversation, user message, task, link, and audit entry", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };

  const result = submitTaskWithConversation({
    runtime,
    route: baseRoute,
    contextPacket: { source_type: "text", source_app: "uca.test", text: "hello" },
    userCommand: "Summarize this note",
    executionMode: "interactive",
    conversationId: "conv_submit",
    projectId: "project_1",
    clientMessageId: "client_msg_1",
    submissionKind: "context"
  });

  assert.equal(result.conversation.conversation_id, "conv_submit");
  assert.equal(result.conversation.project_id, "project_1");
  assert.equal(result.conversation.title, "Summarize this note");
  assert.equal(result.userMessage.conversation_id, "conv_submit");
  assert.equal(result.userMessage.metadata.client_message_id, "client_msg_1");
  assert.equal(store.getTask(result.task.task_id), result.task);
  assert.equal(store.messageTaskLinks[0].message_id, result.userMessage.message_id);
  assert.equal(store.messageTaskLinks[0].task_id, result.task.task_id);
  assert.equal(store.auditLogs[0].event_subtype, "submission.boundary_evaluated");
  assert.equal(store.auditLogs[0].task_id, result.task.task_id);
});

test("task submission shell does not reassign an existing conversation project", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };
  store.insertConversation({
    conversation_id: "conv_existing_project",
    project_id: "project_old"
  });

  const result = submitTaskWithConversation({
    runtime,
    route: baseRoute,
    contextPacket: { source_type: "text", source_app: "uca.test", text: "hello" },
    userCommand: "Continue in this conversation",
    executionMode: "interactive",
    conversationId: "conv_existing_project",
    projectId: "project_new",
    submissionKind: "context"
  });

  assert.equal(result.conversation.project_id, "project_old");
  assert.equal(store.getConversation("conv_existing_project").project_id, "project_old");
});

test("task submission shell reuses parent message without appending a new user message", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };
  store.insertConversation({ conversation_id: "conv_existing" });
  const parentMessage = store.appendMessage({
    conversation_id: "conv_existing",
    role: "user",
    content: "parent"
  });

  const result = submitTaskWithConversation({
    runtime,
    route: baseRoute,
    contextPacket: { source_type: "text", source_app: "uca.test", text: "child" },
    userCommand: "continue",
    executionMode: "interactive",
    conversationId: "conv_existing",
    parentMessageId: parentMessage.message_id,
    submissionKind: "context"
  });

  assert.equal(result.userMessage, null);
  assert.equal(store.conversationMessages.length, 1);
  assert.equal(store.messageTaskLinks[0].message_id, parentMessage.message_id);
  assert.equal(store.messageTaskLinks[0].task_id, result.task.task_id);
});

test("task submission shell supports stores without transaction support", () => {
  const inserted = [];
  const auditLogs = [];
  const runtime = {
    store: {
      insertTask(task) {
        inserted.push(task);
        return task;
      },
      appendAuditLog(entry) {
        auditLogs.push(entry);
        return entry;
      }
    }
  };

  const result = submitTaskWithConversation({
    runtime,
    route: baseRoute,
    contextPacket: { source_type: "manual", source_app: "uca.test" },
    userCommand: "Run",
    executionMode: "interactive",
    submissionKind: "manual"
  });

  assert.equal(result.userMessage, null);
  assert.equal(result.conversation, null);
  assert.equal(inserted[0], result.task);
  assert.equal(auditLogs[0].event_subtype, "submission.boundary_evaluated");
});
