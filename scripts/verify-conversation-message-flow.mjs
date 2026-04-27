#!/usr/bin/env node
import assert from "node:assert/strict";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import {
  appendTaskOutcomeMessage,
  ensureConversation,
  submitTaskWithConversation,
  markTaskFailed,
  markTaskSucceeded
} from "../src/service/core/task-runtime.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

function makeRuntime() {
  const store = createInMemoryStoreScaffold();
  const queue = createTaskQueueScaffold();
  const eventBus = createEventBusScaffold();
  return {
    store, queue, eventBus,
    metrics: { increment() {}, observe() {} },
    paths: {},
    securityBroker: { clearTaskRedactionMap() {} },
    platform: {}
  };
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

it("ensureConversation creates row when missing, returns existing on second call", () => {
  const runtime = makeRuntime();
  const a = ensureConversation(runtime, { conversationId: "conv_e1", projectId: "proj_x" });
  assert.equal(a.conversation_id, "conv_e1");
  assert.equal(a.project_id, "proj_x");
  const b = ensureConversation(runtime, { conversationId: "conv_e1" });
  assert.equal(b.conversation_id, a.conversation_id);
  assert.equal(runtime.store.listConversations({ archived: "any" }).length, 1);
});

it("ensureConversation returns null when conversationId missing", () => {
  const runtime = makeRuntime();
  assert.equal(ensureConversation(runtime, {}), null);
  assert.equal(ensureConversation(runtime, { conversationId: "" }), null);
});

it("submitTaskWithConversation creates conversation + user message + task + 'triggered' link in order", () => {
  const runtime = makeRuntime();
  const result = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "what's the weather",
    executionMode: "interactive",
    conversationId: "conv_a",
    runtime
  });
  assert.ok(result.task);
  assert.ok(result.userMessage);
  assert.equal(result.userMessage.role, "user");
  assert.equal(result.userMessage.content, "what's the weather");
  assert.equal(result.userMessage.seq, 0);
  assert.equal(runtime.store.getTask(result.task.task_id).task_id, result.task.task_id);
  const links = runtime.store.getTaskMessages(result.task.task_id);
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "triggered");
});

it("submitTaskWithConversation: scheduler-sourced packet writes role=system, not user", () => {
  const runtime = makeRuntime();
  const result = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "scheduled_context", source_app: "uca.scheduler", capture_mode: "event" },
    userCommand: "morning digest",
    executionMode: "background",
    conversationId: "conv_sched",
    runtime
  });
  assert.equal(result.userMessage.role, "system");
});

it("submitTaskWithConversation: parentMessageId reuses existing message, no new user msg", () => {
  const runtime = makeRuntime();
  const parent = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: {},
    userCommand: "do A and B",
    executionMode: "interactive",
    conversationId: "conv_comp",
    runtime,
    executorOverride: "composite"
  });

  const child = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: {},
    userCommand: "subtask A",
    executionMode: "interactive",
    conversationId: "conv_comp",
    runtime,
    parentMessageId: parent.userMessage.message_id
  });

  assert.equal(child.userMessage, null, "child must NOT append a duplicate user message");
  const links = runtime.store.getTaskMessages(child.task.task_id);
  assert.equal(links.length, 1);
  assert.equal(links[0].message_id, parent.userMessage.message_id);
  assert.equal(links[0].relation, "triggered");
  const conv = runtime.store.getConversation("conv_comp");
  assert.equal(conv.message_count, 1, "still only one message (parent's)");
  assert.equal(conv.task_count, 2, "task_count = parent + child");
});

it("submitTaskWithConversation: missing conversationId still inserts task (no message)", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: {},
    userCommand: "loose task",
    executionMode: "interactive",
    runtime
  });
  assert.equal(r.userMessage, null);
  assert.equal(r.conversation, null);
  assert.ok(runtime.store.getTask(r.task.task_id));
});

it("appendTaskOutcomeMessage on success → assistant message with status=ok and 'answered_by' link", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "q",
    executionMode: "interactive", conversationId: "conv_ok", runtime
  });
  const t = runtime.store.getTask(r.task.task_id);
  t.status = "success";
  t.result_summary = "21 度";
  const msg = appendTaskOutcomeMessage(runtime, t);
  assert.ok(msg);
  assert.equal(msg.role, "assistant");
  assert.equal(msg.content, "21 度");
  assert.equal(msg.status, "ok");
  const links = runtime.store.getTaskMessages(t.task_id);
  const relations = links.map((l) => l.relation).sort();
  assert.deepEqual(relations, ["answered_by", "triggered"]);
});

it("appendTaskOutcomeMessage: success without result_summary → no message written", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "q",
    executionMode: "interactive", conversationId: "conv_silent", runtime
  });
  const t = runtime.store.getTask(r.task.task_id);
  t.status = "success";
  const msg = appendTaskOutcomeMessage(runtime, t);
  assert.equal(msg, null);
});

it("appendTaskOutcomeMessage: failed → system status message with status=failed", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "q",
    executionMode: "interactive", conversationId: "conv_fail", runtime
  });
  const t = runtime.store.getTask(r.task.task_id);
  t.status = "failed";
  t.failure_user_message = "tool not found";
  const msg = appendTaskOutcomeMessage(runtime, t);
  assert.ok(msg);
  assert.equal(msg.role, "system");
  assert.equal(msg.status, "failed");
  assert.match(msg.content, /tool not found/);
});

it("appendTaskOutcomeMessage: cancelled → system status with cancellation copy", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "q",
    executionMode: "interactive", conversationId: "conv_cancel", runtime
  });
  const t = runtime.store.getTask(r.task.task_id);
  t.status = "cancelled";
  const msg = appendTaskOutcomeMessage(runtime, t);
  assert.equal(msg.role, "system");
  assert.equal(msg.status, "cancelled");
  assert.equal(msg.content, "Task was cancelled.");
});

it("appendTaskOutcomeMessage: no conversation_id on task → no-op", () => {
  const runtime = makeRuntime();
  const r = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "q",
    executionMode: "interactive", runtime
  });
  const t = runtime.store.getTask(r.task.task_id);
  t.status = "success";
  t.result_summary = "x";
  assert.equal(appendTaskOutcomeMessage(runtime, t), null);
});

it("submission preserves message order across two consecutive submits in same conversation", () => {
  const runtime = makeRuntime();
  const a = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "first",
    executionMode: "interactive", conversationId: "conv_seq", runtime
  });
  // simulate finalize of A
  const tA = runtime.store.getTask(a.task.task_id);
  tA.status = "success"; tA.result_summary = "A done";
  appendTaskOutcomeMessage(runtime, tA);

  const b = submitTaskWithConversation({
    route: baseRoute, contextPacket: {}, userCommand: "second",
    executionMode: "interactive", conversationId: "conv_seq", runtime
  });

  const msgs = runtime.store.getConversationMessages("conv_seq");
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(msgs.map((m) => m.seq), [0, 1, 2]);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
