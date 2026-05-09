import assert from "node:assert/strict";
import test from "node:test";

import { createEventBusScaffold } from "../../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import {
  appendTaskOutcomeMessage,
  attachPriorBackendMessages,
  deriveConversationTitle,
  ensureConversation
} from "../../src/service/core/task-runtime/conversation-lifecycle.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";

function makeRuntime() {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    metrics: { increment() {}, observe() {} },
    paths: {},
    securityBroker: { clearTaskRedactionMap() {} },
    platform: {}
  };
  ensureRuntimeServices(runtime);
  return runtime;
}

const baseRoute = {
  intent: "general",
  goal: "qa",
  executor: "fast",
  suggested_executor: "fast",
  intent_tags: [],
  suggested_formats: [],
  requires_confirmation: false
};

test("conversation lifecycle creates and titles the first conversation turn", () => {
  const runtime = makeRuntime();

  const result = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "请帮我总结这份很长很长的材料并给出行动建议",
    executionMode: "interactive",
    conversationId: "conv_lifecycle",
    clientMessageId: "cmsg_lifecycle",
    runtime
  });

  const conversation = runtime.store.getConversation("conv_lifecycle");
  assert.ok(result.task);
  assert.equal(conversation.title, "请帮我总结这份很长很长的材料并给出行动建议");
  assert.equal(result.userMessage.metadata.client_message_id, "cmsg_lifecycle");
  assert.deepEqual(
    runtime.store.getTaskMessages(result.task.task_id).map((link) => link.relation),
    ["triggered"]
  );
});

test("conversation lifecycle auto-resolves short follow-ups to the newest prior task", () => {
  const runtime = makeRuntime();
  const first = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "先查一下今天的天气",
    executionMode: "interactive",
    conversationId: "conv_follow",
    runtime
  }).task;
  first.status = "success";
  first.result_summary = "今天晴，21 度。";
  runtime.store.updateTask(first.task_id, first);
  appendTaskOutcomeMessage(runtime, first);

  const follow = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "继续",
    executionMode: "interactive",
    conversationId: "conv_follow",
    runtime
  }).task;

  assert.equal(follow.parent_task_id, first.task_id);
  assert.equal(first.is_continuation, false);
  assert.equal(follow.is_continuation, true);
  assert.ok(follow.context_packet.prior_messages.some(
    (message) => message.role === "assistant" && message.content.includes("今天晴")
  ));
});

test("conversation lifecycle writes assistant outcome messages and answered_by links", () => {
  const runtime = makeRuntime();
  const task = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "回答我",
    executionMode: "interactive",
    conversationId: "conv_outcome",
    runtime
  }).task;

  task.status = "success";
  task.result_summary = "这是回答。";
  task.evidence_summary = {
    source_count: 1,
    sources: [{ kind: "web", locator: "https://example.test/source" }]
  };
  runtime.store.appendArtifact({
    artifact_id: "artifact_outcome",
    task_id: task.task_id,
    conversation_id: task.conversation_id,
    path: "E:\\linxiDoc\\task\\result.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    status: "ready"
  });
  runtime.store.appendArtifact({
    artifact_id: "artifact_preview_html",
    task_id: task.task_id,
    conversation_id: task.conversation_id,
    path: "E:\\linxiDoc\\task\\result-preview.html",
    mime_type: "text/html",
    kind: "preview",
    status: "ready"
  });
  runtime.store.appendArtifact({
    artifact_id: "artifact_preview_txt",
    task_id: task.task_id,
    conversation_id: task.conversation_id,
    path: "E:\\linxiDoc\\task\\result-preview.txt",
    mime_type: "text/plain",
    kind: "preview",
    status: "ready"
  });
  const message = appendTaskOutcomeMessage(runtime, task);

  assert.equal(message.role, "assistant");
  assert.equal(message.status, "ok");
  assert.equal(message.content, "这是回答。");
  assert.equal(message.metadata.task_id, task.task_id);
  assert.deepEqual(message.metadata.artifact_paths, ["E:\\linxiDoc\\task\\result.docx"]);
  assert.deepEqual(message.metadata.evidence_summary, task.evidence_summary);
  assert.deepEqual(
    runtime.store.getTaskMessages(task.task_id).map((link) => link.relation).sort(),
    ["answered_by", "triggered"]
  );
});

test("conversation lifecycle stores partial-success final text once as assistant outcome", () => {
  const runtime = makeRuntime();
  const task = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "查一下天气",
    executionMode: "interactive",
    conversationId: "conv_partial_outcome",
    runtime
  }).task;

  task.status = "partial_success";
  task.result_summary = "明天有雨。\n\n注意：来源覆盖不足。";

  const first = appendTaskOutcomeMessage(runtime, task);
  const second = appendTaskOutcomeMessage(runtime, task);

  assert.equal(first.role, "assistant");
  assert.equal(first.status, "partial_success");
  assert.equal(first.content, task.result_summary);
  assert.equal(second, null);
  assert.equal(
    runtime.store.getTaskMessages(task.task_id).filter((link) => link.relation === "answered_by").length,
    1
  );
});

test("conversation lifecycle helpers cap prior messages and keep empty ids inert", () => {
  const runtime = makeRuntime();
  assert.equal(ensureConversation(runtime, { conversationId: "" }), null);
  assert.equal(deriveConversationTitle("  ".repeat(10)), null);
  assert.equal(deriveConversationTitle("a".repeat(40)), `${"a".repeat(36)}…`);

  ensureConversation(runtime, { conversationId: "conv_prior" });
  runtime.store.appendMessage({
    conversation_id: "conv_prior",
    role: "user",
    content: "x".repeat(50),
    metadata: { client_message_id: "must_not_leak" }
  });

  const enriched = attachPriorBackendMessages(
    { source_type: "clipboard" },
    "conv_prior",
    runtime,
    { limit: 1, contentCap: 12 }
  );

  assert.deepEqual(enriched.prior_messages, [{
    role: "user",
    content: "x".repeat(12),
    status: null,
    ts: enriched.prior_messages[0].ts
  }]);
  assert.equal(enriched.prior_messages[0].metadata, undefined);
});
