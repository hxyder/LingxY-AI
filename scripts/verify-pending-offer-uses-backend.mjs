#!/usr/bin/env node
/**
 * P6 F3 lock-in: pending-offer prefers backend conversation_messages
 * over the legacy parent_task_summary / conversation_turns sources.
 *
 * Asserts:
 *   1. structured prior_messages present → parent_task_summary is NOT
 *      consulted (no parallel history sources)
 *   2. structured prior_messages absent → falls back to
 *      parent_task_summary
 *   3. structured prior_messages absent + parent_task_summary absent →
 *      legacy in-band conversation_turns is the last fallback
 *   4. tool_summary / status messages may appear in prior_messages but
 *      do NOT override the assistant final answer (last assistant
 *      wins for offer detection)
 *   5. UI metadata (client_message_id / pending / localOnly /
 *      bubble_id / ui_render_state) never reaches signal output —
 *      task-runtime sanitises prior_messages so detectors never see
 *      these fields.
 *   6. attachPriorBackendMessages source-level boundary: pending-offer
 *      does not import runtime / store directly; it reads only the
 *      stamped contextPacket field.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detect as detectPendingOffer } from "../src/service/core/intent/signals/pending-offer.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { submitTaskWithConversation, createTaskRecord } from "../src/service/core/task-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

const route = {
  intent: "general", goal: "qa", executor: "fast", suggested_executor: "fast",
  intent_tags: [], suggested_formats: [], requires_confirmation: false
};

const offerText = "想看天气预报吗？";

await it("backend prior_messages: pending-offer fires when latest assistant matches an offer", () => {
  const sig = detectPendingOffer("需要", {
    prior_messages: [
      { role: "user", content: "今天怎么样" },
      { role: "assistant", content: offerText, status: "ok" }
    ]
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.pending_intent, "weather");
  assert.equal(sig.hint?.history_source, "backend_messages");
});

await it("backend prior_messages present → parent_task_summary is IGNORED (no parallel sources)", () => {
  const sig = detectPendingOffer("需要", {
    prior_messages: [
      { role: "assistant", content: "随便聊聊，没有 offer。", status: "ok" }
    ],
    parent_task_summary: {
      assistant_final_text: offerText
    }
  });
  // Backend says no offer → no match. parent_task_summary having an
  // offer must NOT rescue the detection — that would mean two history
  // sources are running in parallel.
  assert.equal(sig.matched, false,
    "with backend prior_messages present, parent_task_summary must NOT contribute");
});

await it("backend prior_messages present → selection_metadata.conversation_turns is IGNORED", () => {
  const sig = detectPendingOffer("需要", {
    prior_messages: [
      { role: "assistant", content: "随便聊聊，没有 offer。", status: "ok" }
    ],
    selection_metadata: {
      conversation_turns: [{ role: "assistant", content: offerText }]
    }
  });
  assert.equal(sig.matched, false,
    "with backend prior_messages present, conversation_turns must NOT contribute");
});

await it("backend prior_messages absent → falls back to parent_task_summary", () => {
  const sig = detectPendingOffer("需要", {
    parent_task_summary: { assistant_final_text: offerText }
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.history_source, "parent_task_summary");
});

await it("backend AND parent absent → falls back to legacy conversation_turns (last resort)", () => {
  const sig = detectPendingOffer("需要", {
    selection_metadata: {
      conversation_turns: [
        { role: "user", content: "今天怎么样" },
        { role: "assistant", content: offerText }
      ]
    }
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.history_source, "inband_conversation_turns");
});

await it("tool_summary / status entries in prior_messages do NOT override the last assistant", () => {
  const sig = detectPendingOffer("需要", {
    prior_messages: [
      { role: "user",       content: "今天怎么样" },
      { role: "assistant",  content: offerText, status: "ok" },
      { role: "tool_summary", content: JSON.stringify({ tool_id: "x", success: true }) },
      { role: "system",     content: "Task ended.", status: "failed" }
    ]
  });
  // Even with tool_summary + system status appearing AFTER the assistant
  // turn, the offer detection should still match against the assistant
  // turn — the latest non-empty assistant in the tail wins.
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.pending_intent, "weather");
  assert.equal(sig.hint?.history_source, "backend_messages");
});

await it("malformed entries in prior_messages are skipped, not crashed on", () => {
  const sig = detectPendingOffer("需要", {
    prior_messages: [
      null,
      "not an object",
      { role: "assistant" },                       // missing content
      { role: "assistant", content: "" },          // empty content
      { role: "assistant", content: offerText }    // valid
    ]
  });
  assert.equal(sig.matched, true);
});

await it("source-level boundary: pending-offer does NOT import runtime/store directly", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/core/intent/signals/pending-offer.mjs"), "utf8");
  assert.ok(!/from\s+["']\.\.\/\.\.\/store\//.test(src),
    "pending-offer must not reach into the store directly — it reads pre-stamped contextPacket fields");
  assert.ok(!/runtime\?\.store/.test(src) && !/runtime\.store/.test(src),
    "pending-offer must not access runtime.store");
});

await it("end-to-end: createTaskRecord stamps prior_messages from backend conversation_messages", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = {
    store, queue: createTaskQueueScaffold(), eventBus: createEventBusScaffold(),
    paths: {}, metrics: { increment() {}, observe() {} },
    securityBroker: { clearTaskRedactionMap() {} }, platform: {}
  };
  // Seed: an existing conversation with a prior offer from the assistant.
  store.insertConversation({ conversation_id: "conv_e2e_offer" });
  store.appendMessage({ conversation_id: "conv_e2e_offer", role: "user", content: "今天怎么样" });
  store.appendMessage({
    conversation_id: "conv_e2e_offer", role: "assistant",
    content: offerText, status: "ok"
  });

  // Now create a task in the same conversation with a short affirmative.
  const task = createTaskRecord({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "需要",
    executionMode: "interactive",
    conversationId: "conv_e2e_offer",
    runtime
  });
  // task.context_packet should now carry prior_messages from backend.
  assert.ok(Array.isArray(task.context_packet?.prior_messages),
    "createTaskRecord must stamp prior_messages on the enriched contextPacket");
  assert.ok(task.context_packet.prior_messages.some(
    (m) => m.role === "assistant" && m.content === offerText
  ), "prior_messages must contain the seeded assistant offer");
});

await it("end-to-end: prior_messages does NOT carry UI metadata (client_message_id / pending / etc.)", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = {
    store, queue: createTaskQueueScaffold(), eventBus: createEventBusScaffold(),
    paths: {}, metrics: { increment() {}, observe() {} },
    securityBroker: { clearTaskRedactionMap() {} }, platform: {}
  };
  store.insertConversation({ conversation_id: "conv_meta_clean" });
  // Append a message with rich metadata, simulating an F2 user submit.
  store.appendMessage({
    conversation_id: "conv_meta_clean", role: "user",
    content: "今天怎么样",
    metadata: {
      client_message_id: "cmsg_LEAK_X",
      pending: true, localOnly: true, bubble_id: "ui_42"
    }
  });
  store.appendMessage({
    conversation_id: "conv_meta_clean", role: "assistant",
    content: offerText, status: "ok"
  });

  const task = createTaskRecord({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "需要",
    executionMode: "interactive",
    conversationId: "conv_meta_clean",
    runtime
  });
  for (const m of task.context_packet.prior_messages) {
    assert.equal(m.client_message_id, undefined);
    assert.equal(m.pending, undefined);
    assert.equal(m.localOnly, undefined);
    assert.equal(m.metadata, undefined,
      "prior_messages entries must be sanitised — no metadata blob leaks into signal input");
  }
  // And the detector should still match cleanly using only the
  // sanitised assistant content.
  const sig = detectPendingOffer("需要", task.context_packet);
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.history_source, "backend_messages");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
