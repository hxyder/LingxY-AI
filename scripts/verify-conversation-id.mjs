#!/usr/bin/env node
/**
 * UCA-077 P4-RQ §19 / K4: conversation_id schema + auto-resolution.
 *
 * Lighter G3 (commit 900988d) shipped a length/timestamp heuristic
 * frontend-side to attach parent_task_id for short follow-ups. The
 * user's standing direction was "lighter fix is the bridge; the
 * durable solution is conversation identity." K4 lands the durable
 * piece, backend-only:
 *
 *   1. createTaskRecord accepts a conversationId (or reads it from
 *      contextPacket.selection_metadata.conversation_id).
 *   2. The id is stamped on the task record as `conversation_id`
 *      (round-trips through SQLite via task_json — no schema migration).
 *   3. When the caller didn't provide an explicit parentTaskId AND a
 *      conversationId is present, createTaskRecord walks the store for
 *      the most recent prior task with the same conversation_id and
 *      uses it as the effective parent_task_id. The G3b parent_task_
 *      summary attachment then fires for that auto-resolved parent.
 *
 * Frontend wiring (mint UUID per UI session, stamp on every command)
 * is OUT OF SCOPE for this commit per the user's "(backend only)"
 * direction. Backend will start auto-resolving as soon as the
 * frontend supplies the id.
 *
 * Run: node scripts/verify-conversation-id.mjs
 */

import assert from "node:assert/strict";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

/** Tiny in-memory store stub matching the surface createTaskRecord reads. */
function makeStore(initialTasks = []) {
  const tasks = initialTasks.slice();
  return {
    listTasks: () => tasks.slice(),
    getTask: (id) => tasks.find((t) => t.task_id === id) ?? null,
    add: (t) => tasks.push(t)
  };
}

function makeRuntime(store) {
  return { store };
}

/** Minimal route shape createTaskRecord requires. */
const baseRoute = {
  intent: "qa",
  executor: "fast",
  requires_confirmation: false
};

// ── 1. Stamps conversation_id from explicit param ─────────────────
it("stamps conversation_id from explicit param", () => {
  const store = makeStore();
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "hello",
    conversationId: "conv_123",
    runtime: makeRuntime(store)
  });
  assert.equal(task.conversation_id, "conv_123");
  // No prior task with this conversation_id → parent_task_id stays null.
  assert.equal(task.parent_task_id, null);
});

// ── 2. Reads conversation_id from selection_metadata when param absent ─
it("falls back to contextPacket.selection_metadata.conversation_id", () => {
  const store = makeStore();
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: { selection_metadata: { conversation_id: "conv_meta_456" } },
    userCommand: "hello",
    runtime: makeRuntime(store)
  });
  assert.equal(task.conversation_id, "conv_meta_456");
});

// ── 3. Explicit param wins over selection_metadata ────────────────
it("explicit param wins over selection_metadata.conversation_id", () => {
  const store = makeStore();
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: { selection_metadata: { conversation_id: "conv_meta" } },
    userCommand: "hello",
    conversationId: "conv_explicit",
    runtime: makeRuntime(store)
  });
  assert.equal(task.conversation_id, "conv_explicit");
});

// ── 4. Auto-resolves parent_task_id from prior same-conversation task ─
it("auto-resolves parent_task_id to most recent prior task in same conversation", () => {
  const earlier = {
    task_id: "task_first",
    created_at: "2026-04-26T10:00:00Z",
    conversation_id: "conv_X"
  };
  const store = makeStore([earlier]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "follow-up",
    conversationId: "conv_X",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, "task_first",
    "follow-up must inherit the prior task's id as parent");
  assert.equal(task.conversation_id, "conv_X");
});

// ── 5. Picks the MOST RECENT prior task when multiple share the conv ─
it("picks the most recent prior task when multiple share the conversation_id", () => {
  const t1 = { task_id: "t1", created_at: "2026-04-26T10:00:00Z", conversation_id: "conv_Y" };
  const t2 = { task_id: "t2", created_at: "2026-04-26T11:30:00Z", conversation_id: "conv_Y" };
  const t3 = { task_id: "t3", created_at: "2026-04-26T09:00:00Z", conversation_id: "conv_Y" };
  // Different conversation — must NOT be picked even if newer.
  const tOther = { task_id: "tOther", created_at: "2026-04-26T12:00:00Z", conversation_id: "conv_OTHER" };
  const store = makeStore([t1, t2, t3, tOther]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "another follow-up",
    conversationId: "conv_Y",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, "t2",
    "must pick t2 (most recent in conv_Y), not t1, t3, or tOther");
});

// ── 6. Explicit parentTaskId wins over auto-resolution ────────────
it("explicit parentTaskId wins over conversation auto-resolution", () => {
  const earlier = { task_id: "task_first", created_at: "2026-04-26T10:00:00Z", conversation_id: "conv_Z" };
  const store = makeStore([earlier]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "explicit follow-up",
    conversationId: "conv_Z",
    parentTaskId: "task_explicit_parent",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, "task_explicit_parent",
    "explicit parentTaskId beats conversation auto-resolution");
  assert.equal(task.conversation_id, "conv_Z");
});

// ── 7. No conversation_id → no auto-resolution ────────────────────
it("no conversation_id → no auto-resolution (parent_task_id stays null)", () => {
  const earlier = { task_id: "task_first", created_at: "2026-04-26T10:00:00Z", conversation_id: "conv_other" };
  const store = makeStore([earlier]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "lone follow-up",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, null);
  assert.equal(task.conversation_id, null);
});

// ── 8. No matching prior task → parent_task_id stays null ─────────
it("conversation_id with no prior matching task → parent_task_id stays null", () => {
  const unrelated = { task_id: "tx", created_at: "2026-04-26T10:00:00Z", conversation_id: "conv_other" };
  const store = makeStore([unrelated]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "first in conv",
    conversationId: "conv_NEW",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, null);
  assert.equal(task.conversation_id, "conv_NEW");
});

// ── 9. parent_task_summary is attached for auto-resolved parents ──
it("auto-resolved parent triggers parent_task_summary attachment (G3b path still fires)", () => {
  const parent = {
    task_id: "task_parent",
    created_at: "2026-04-26T10:00:00Z",
    conversation_id: "conv_S",
    result_summary: "Today's weather in Tokyo is sunny, 22 degrees Celsius. Want me to check tomorrow?"
  };
  const store = makeStore([parent]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "yes",
    conversationId: "conv_S",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, "task_parent");
  // The parent_task_summary should be threaded into context_packet.
  assert.ok(task.context_packet?.parent_task_summary,
    "parent_task_summary must be attached on the auto-resolved parent");
  assert.equal(task.context_packet.parent_task_summary.parent_task_id, "task_parent");
  assert.match(task.context_packet.parent_task_summary.assistant_final_text,
    /weather in Tokyo/);
});

// ── 10. Defensive: missing runtime → no auto-resolution, no throw ─
it("defensive: missing runtime → no auto-resolution, no throw", () => {
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "hello",
    conversationId: "conv_X"
    // runtime omitted
  });
  assert.equal(task.conversation_id, "conv_X");
  assert.equal(task.parent_task_id, null);
});

// ── 11. Defensive: malformed listTasks (throws) → no auto-resolution ─
it("defensive: store.listTasks throwing → no auto-resolution, no throw", () => {
  const brokenStore = {
    listTasks: () => { throw new Error("simulated DB error"); },
    getTask: () => null
  };
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "hello",
    conversationId: "conv_X",
    runtime: makeRuntime(brokenStore)
  });
  assert.equal(task.parent_task_id, null,
    "store I/O failure must not block task creation");
});

// ── 12. Defensive: tasks without conversation_id are skipped, not matched ─
it("defensive: legacy tasks without conversation_id are skipped during resolution", () => {
  const legacy = { task_id: "legacy", created_at: "2026-04-26T10:00:00Z" };  // no conv_id
  const matching = { task_id: "match", created_at: "2026-04-26T11:00:00Z", conversation_id: "conv_M" };
  const store = makeStore([legacy, matching]);
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "follow-up",
    conversationId: "conv_M",
    runtime: makeRuntime(store)
  });
  assert.equal(task.parent_task_id, "match",
    "legacy task with undefined conversation_id must not be picked");
});

// ── 13. Defensive: empty conversation_id string is treated as null ─
it("defensive: empty-string conversation_id is treated as null", () => {
  const store = makeStore();
  const task = createTaskRecord({
    route: baseRoute,
    contextPacket: {},
    userCommand: "hello",
    conversationId: "",
    runtime: makeRuntime(store)
  });
  assert.equal(task.conversation_id, null,
    "empty string is normalised to null on the task record");
  assert.equal(task.parent_task_id, null);
});

// ── 14. K6: end-to-end submission path threads conversation_id ───
// (Source-level lock-in — full submitContextTask requires the runtime
// scaffold which the unit-shape store stub doesn't provide. Assert
// the wiring by reading the source so we catch any future drop on
// the floor at the submission seam.)
import { readFileSync } from "node:fs";
function loadFile(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

it("K6 source: submitContextTask accepts conversationId and threads to createTaskRecord", () => {
  const src = loadFile("../src/service/core/context-submission.mjs");
  // submitContextTask's destructured parameter list must include
  // conversationId.
  assert.match(src,
    /export async function submitContextTask\(\{[\s\S]*?\bconversationId\b[\s\S]*?\}\)/,
    "submitContextTask must accept a conversationId parameter");
  // The createTaskRecord call inside submitContextTask must pass
  // conversationId through.
  assert.match(src,
    /createTaskRecord\(\{[\s\S]*?\bconversationId\b[\s\S]*?\}\)/,
    "submitContextTask must thread conversationId into createTaskRecord");
});

it("K6 source: HTTP /task handler extracts body.conversation_id and passes it on", () => {
  const src = loadFile("../src/service/core/http-server.mjs");
  // The /task handler body extraction must accept both snake_case
  // (frontend default — overlay.js:3256) and camelCase.
  assert.match(src,
    /const requestConversationId = typeof body\.conversation_id === "string"[\s\S]*?body\.conversationId/,
    "HTTP /task handler must extract body.conversation_id (snake_case primary, camelCase fallback)");
  assert.match(src,
    /submit(File|Browser|Image|Office|ActionTool|Context)Task\(\{[\s\S]*?conversationId: requestConversationId/,
    "HTTP /task handler must pass requestConversationId into submission branches");
});

it("K7 source: non-context submission paths accept and thread conversationId", () => {
  const files = [
    "../src/service/core/file-submission.mjs",
    "../src/service/core/browser-submission.mjs",
    "../src/service/core/image-submission.mjs",
    "../src/service/core/office-submission.mjs",
    "../src/service/core/action-tool-submission.mjs",
    "../src/service/core/composite-submission.mjs"
  ];
  for (const rel of files) {
    const src = loadFile(rel);
    assert.match(src, /\bconversationId\b/, `${rel} must carry conversationId`);
    assert.match(src, /createTaskRecord\(\{[\s\S]*?\bconversationId\b[\s\S]*?\}\)|submitContextTask\(\{[\s\S]*?\bconversationId\b[\s\S]*?\}\)|submitCompositeTask\(\{[\s\S]*?\bconversationId\b[\s\S]*?\}\)/,
      `${rel} must pass conversationId to its downstream task creation path`);
  }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
