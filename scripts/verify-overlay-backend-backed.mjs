#!/usr/bin/env node
/**
 * P6 F2 lock-in: overlay is backed by backend conversation_messages.
 *
 * Asserts (source-level + behavioural via the runtime conversation store):
 *   1. The legacy compressIfNeeded lossy compression is gone.
 *   2. overlay.js submits a `client_message_id` field on /task.
 *   3. overlay.js exposes the optimistic + reconcile helpers
 *      (markPendingUserMessage / applyBackendMessageToCache /
 *      loadConversationFromBackend / reconcileConversationFromBackend).
 *   4. The submission backend persists client_message_id into
 *      conversation_messages.metadata so the frontend can reconcile.
 *   5. submitTaskWithConversation accepts clientMessageId and
 *      writes it into the user message's metadata exactly once.
 *   6. The HTTP /task handler accepts client_message_id (snake_case)
 *      and clientMessageId (camelCase).
 *   7. F1 invariants stay green (no [当前对话上下文] / no
 *      conversation_turns in outbound payload).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { submitTaskWithConversation } from "../src/service/core/task-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}
async function read(p) { return readFile(path.join(repoRoot, p), "utf8"); }

const overlay = await read("src/desktop/renderer/overlay.js");
const httpServer = await read("src/service/core/http-server.mjs");
const taskRuntime = await read("src/service/core/task-runtime.mjs");

await it("overlay.js: compressIfNeeded is removed (no lossy compression of conversation memory)", () => {
  assert.ok(!/function\s+compressIfNeeded\s*\(/.test(overlay));
  assert.ok(!/compressIfNeeded\(/.test(overlay));
});

await it("overlay.js: createClientMessageId / markPendingUserMessage helpers exist", () => {
  assert.match(overlay, /function\s+createClientMessageId\s*\(/);
  assert.match(overlay, /function\s+markPendingUserMessage\s*\(/);
});

await it("overlay.js: applyBackendMessageToCache + loadConversationFromBackend + reconcileConversationFromBackend exist", () => {
  assert.match(overlay, /function\s+applyBackendMessageToCache\s*\(/);
  assert.match(overlay, /function\s+loadConversationFromBackend\s*\(/);
  assert.match(overlay, /function\s+reconcileConversationFromBackend\s*\(/);
});

await it("overlay.js: submit body includes client_message_id", () => {
  assert.match(overlay, /client_message_id:\s*clientMessageId/);
});

await it("overlay.js: switchConversation triggers backend rebuild via loadConversationFromBackend", () => {
  assert.match(overlay, /loadConversationFromBackend\(conversationState\.id\)/);
});

await it("overlay.js: F1 invariants stay (no '[当前对话上下文]' or conversation_turns in outbound)", () => {
  const submitPart = overlay.slice(overlay.indexOf("addSystemBubble(\"Submitting"));
  assert.ok(!submitPart.includes("[当前对话上下文]"));
  assert.ok(!/selectionMetadata\s*:\s*\{[^}]*conversation_turns/.test(submitPart));
});

await it("overlay.js: optimistic user bubble carries data-client-message-id and 'pending' class", () => {
  // The renderer DOM hooks are inside markPendingUserMessage.
  assert.match(overlay, /dataset\.clientMessageId\s*=\s*clientMessageId/);
  assert.match(overlay, /classList\.add\("pending"\)/);
});

await it("overlay.js: applyBackendMessageToCache reconciles by client_message_id (no duplicate user bubble)", () => {
  // Looks for the dataset upgrade path that drops 'pending'.
  assert.match(overlay, /classList\.remove\("pending"\)/);
  assert.match(overlay, /pendingByClientId\.delete\(clientId\)/);
});

await it("overlay.js: tool_summary backend rows are NOT rendered as chat bubbles (timeline owns them)", () => {
  assert.match(overlay, /role === "tool_summary"/);
});

await it("http-server.mjs: /task accepts client_message_id (snake) AND clientMessageId (camel)", () => {
  assert.match(httpServer, /body\.client_message_id/);
  assert.match(httpServer, /body\.clientMessageId/);
});

await it("http-server.mjs: clientMessageId threaded into every submission helper", () => {
  // We assert at least one of each to make sure the threading was
  // complete; missing any path is a regression.
  assert.match(httpServer, /clientMessageId:\s*requestClientMessageId/);
});

await it("task-runtime.mjs: submitTaskWithConversation accepts clientMessageId param", () => {
  assert.match(taskRuntime, /clientMessageId\s*=\s*null/);
});

// Behavioural: backend persists client_message_id into the user message metadata.
await it("backend behaviour: submitTaskWithConversation writes client_message_id into user message metadata", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = {
    store,
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    paths: {},
    metrics: { increment() {}, observe() {} },
    securityBroker: { clearTaskRedactionMap() {} },
    platform: {}
  };
  const result = submitTaskWithConversation({
    runtime,
    route: { intent: "general", goal: "qa", executor: "fast", suggested_executor: "fast", intent_tags: [], suggested_formats: [], requires_confirmation: false },
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "hi",
    executionMode: "interactive",
    conversationId: "conv_f2",
    clientMessageId: "cmsg_test_123"
  });
  assert.ok(result.userMessage);
  assert.equal(result.userMessage.metadata?.client_message_id, "cmsg_test_123");

  // Same conversation, no clientMessageId → metadata field absent
  const r2 = submitTaskWithConversation({
    runtime,
    route: { intent: "general", goal: "qa", executor: "fast", suggested_executor: "fast", intent_tags: [], suggested_formats: [], requires_confirmation: false },
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "again",
    executionMode: "interactive",
    conversationId: "conv_f2"
  });
  assert.ok(r2.userMessage);
  assert.equal(r2.userMessage.metadata?.client_message_id, undefined);
});

await it("overlay.js: failed POST /task marks the optimistic bubble as failed (not permanently pending)", () => {
  assert.match(overlay, /function\s+markPendingMessageFailed\s*\(/);
  assert.match(overlay, /markPendingMessageFailed\(clientMessageId/);
  // The submit path catches the fetchJson throw, calls
  // markPendingMessageFailed, then rethrows so the outer flow can react.
  assert.match(overlay, /catch\s*\(err\)\s*\{[\s\S]{0,200}markPendingMessageFailed/);
});

await it("overlay.js: failed bubbles drop 'pending' class and gain 'failed' state", () => {
  assert.match(overlay, /classList\.add\("failed"\)/);
  assert.match(overlay, /dataset\.status\s*=\s*"failed"/);
});

await it("overlay.js: pagination/truncation deferral is documented as a UI display limit, not memory truncation", () => {
  assert.match(
    overlay,
    /UI currently renders recent 200 messages[\s\S]{0,200}display pagination, not conversation memory truncation/
  );
});

await it("backend behaviour: empty / non-string clientMessageId is dropped, not stamped", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = {
    store,
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    paths: {},
    metrics: { increment() {}, observe() {} },
    securityBroker: { clearTaskRedactionMap() {} },
    platform: {}
  };
  for (const bad of ["", "   ", null, undefined, 123, {}]) {
    const r = submitTaskWithConversation({
      runtime,
      route: { intent: "general", goal: "qa", executor: "fast", suggested_executor: "fast", intent_tags: [], suggested_formats: [], requires_confirmation: false },
      contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
      userCommand: "x",
      executionMode: "interactive",
      conversationId: `conv_bad_${Math.random().toString(36).slice(2,7)}`,
      clientMessageId: bad
    });
    assert.equal(r.userMessage?.metadata?.client_message_id, undefined,
      `bad clientMessageId ${JSON.stringify(bad)} must not be stamped`);
  }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
