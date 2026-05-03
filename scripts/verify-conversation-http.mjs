#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServiceHttpServer } from "../src/service/core/http-server.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

function makeRuntime({ allowHardDelete = false } = {}) {
  const store = createInMemoryStoreScaffold();
  return {
    store,
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    paths: {},
    config: { allowHardDelete },
    metrics: { increment() {}, observe() {} },
    securityBroker: {
      clearTaskRedactionMap() {},
      inspectContext() { return { allowed: true, redactions: [], warnings: [] }; },
      registerTaskRedactionMap() {}
    },
    platform: {},
    configStore: { load: () => ({}), save: () => {} }
  };
}

async function startServer(runtime) {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-conv-http-"));
  const { server, baseUrl } = createServiceHttpServer({
    runtime,
    paths: { logsDir: dir, dataDir: dir }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    close: () => new Promise((r) => server.close(() => { rmSync(dir, { recursive: true, force: true }); r(); }))
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const DESKTOP_ACTOR_HEADER = "X-Lingxy-Desktop-Actor";
function desktopJson(method, body) {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      [DESKTOP_ACTOR_HEADER]: "desktop_console"
    },
    body: JSON.stringify(body ?? {})
  };
}

function desktopMutation(method) {
  return {
    method,
    headers: {
      [DESKTOP_ACTOR_HEADER]: "desktop_console"
    }
  };
}

await it("GET /conversations: empty store returns []", async () => {
  const runtime = makeRuntime();
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversations`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.conversations, []);
  } finally { await srv.close(); }
});

await it("GET /conversations: returns active conversations sorted by updated_at desc", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_old", project_id: "p1", title: "old" });
  await new Promise((r) => setTimeout(r, 5));
  runtime.store.insertConversation({ conversation_id: "c_new", project_id: "p1", title: "new" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversations?project_id=p1`);
    assert.equal(r.status, 200);
    assert.equal(r.body.conversations.length, 2);
    assert.equal(r.body.conversations[0].conversation_id, "c_new");
  } finally { await srv.close(); }
});

await it("GET /conversations: archived filter — default hides archived", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_a" });
  runtime.store.insertConversation({ conversation_id: "c_b" });
  runtime.store.softDeleteConversation("c_b");
  const srv = await startServer(runtime);
  try {
    const def = await fetchJson(`${srv.url}/conversations`);
    assert.equal(def.body.conversations.length, 1);
    const all = await fetchJson(`${srv.url}/conversations?archived=any`);
    assert.equal(all.body.conversations.length, 2);
    const archivedOnly = await fetchJson(`${srv.url}/conversations?archived=1`);
    assert.equal(archivedOnly.body.conversations.length, 1);
    assert.equal(archivedOnly.body.conversations[0].conversation_id, "c_b");
  } finally { await srv.close(); }
});

await it("GET /conversation/{id}: returns conversation + messages + task links", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_full" });
  const userMsg = runtime.store.appendMessage({ conversation_id: "c_full", role: "user", content: "hi" });
  const asstMsg = runtime.store.appendMessage({ conversation_id: "c_full", role: "assistant", content: "hello" });
  runtime.store.linkMessageToTask(userMsg.message_id, "task_x", "triggered");
  runtime.store.linkMessageToTask(asstMsg.message_id, "task_x", "answered_by");
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_full`);
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.conversation_id, "c_full");
    assert.equal(r.body.messages.length, 2);
    assert.deepEqual(r.body.messages.map((m) => m.role), ["user", "assistant"]);
    const relations = r.body.message_task_links.map((l) => l.relation).sort();
    assert.deepEqual(relations, ["answered_by", "triggered"]);
  } finally { await srv.close(); }
});

await it("GET /conversation/{id}: 404 when missing", async () => {
  const runtime = makeRuntime();
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_missing`);
    assert.equal(r.status, 404);
  } finally { await srv.close(); }
});

await it("GET /conversation/{id}/messages?since=N: returns only seq >= N", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_inc" });
  for (let i = 0; i < 5; i++) {
    runtime.store.appendMessage({ conversation_id: "c_inc", role: "user", content: `m${i}` });
  }
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_inc/messages?since=3`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.messages.map((m) => m.seq), [3, 4]);
    assert.equal(r.body.since_seq, 3);
  } finally { await srv.close(); }
});

await it("POST /task does not run pre-task regex clarification", async () => {
  const runtime = makeRuntime();
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand: "打开文件",
        conversation_id: "c_clarify",
        client_message_id: "cmsg_clarify_1",
        background: true,
        sourceApp: "uca.overlay",
        executionMode: "interactive"
      })
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.task?.task_id, "ambiguous-looking text should still create a task");
    assert.notEqual(r.body.type, "clarification_needed");
    const messages = runtime.store.getConversationMessages("c_clarify");
    assert.equal(messages.length, 1);
    assert.deepEqual(messages.map((m) => m.role), ["user"]);
    assert.equal(messages[0].content, "打开文件");
    assert.equal(messages[0].metadata.client_message_id, "cmsg_clarify_1");
  } finally { await srv.close(); }
});

await it("POST /task ignores stale client parent_task_id for clear new topics", async () => {
  const runtime = makeRuntime();
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand: "汽车修空调要多少钱",
        conversation_id: "c_parent_guard",
        parent_task_id: "task_previous",
        client_message_id: "cmsg_parent_guard",
        background: true,
        sourceApp: "uca.overlay",
        executionMode: "interactive"
      })
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.parent_task_id, null);
  } finally { await srv.close(); }
});

await it("POST /task keeps client parent_task_id for explicit short follow-ups", async () => {
  const runtime = makeRuntime();
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCommand: "继续",
        conversation_id: "c_parent_keep",
        parent_task_id: "task_previous",
        client_message_id: "cmsg_parent_keep",
        background: true,
        sourceApp: "uca.overlay",
        executionMode: "interactive"
      })
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.parent_task_id, "task_previous");
  } finally { await srv.close(); }
});

await it("PATCH /conversation/{id}: title and archived can be updated", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_patch" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_patch`, desktopJson("PATCH", {
      title: "renamed",
      archived: true
    }));
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.title, "renamed");
    assert.equal(r.body.conversation.archived, true);
  } finally { await srv.close(); }
});

await it("PATCH: rejects body without patchable fields", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_p2" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_p2`, desktopJson("PATCH", { unsupported: 1 }));
    assert.equal(r.status, 400);
  } finally { await srv.close(); }
});

await it("DELETE: default is soft delete (archived=true), no cascade", async () => {
  const runtime = makeRuntime();
  runtime.store.insertConversation({ conversation_id: "c_del" });
  runtime.store.appendMessage({ conversation_id: "c_del", role: "user", content: "x" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_del`, desktopMutation("DELETE"));
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.archived, true);
    const conv = runtime.store.getConversation("c_del");
    assert.ok(conv, "row must still exist after soft delete");
    assert.equal(runtime.store.countConversationMessages("c_del"), 1, "messages must NOT cascade on soft delete");
  } finally { await srv.close(); }
});

await it("DELETE ?hard=true: rejected with 403 when allowHardDelete is false", async () => {
  const runtime = makeRuntime({ allowHardDelete: false });
  runtime.store.insertConversation({ conversation_id: "c_hd" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_hd?hard=true`, desktopMutation("DELETE"));
    assert.equal(r.status, 403);
    assert.ok(runtime.store.getConversation("c_hd"), "row must NOT be deleted");
  } finally { await srv.close(); }
});

await it("DELETE ?hard=true with allowHardDelete=true cascades messages", async () => {
  const runtime = makeRuntime({ allowHardDelete: true });
  runtime.store.insertConversation({ conversation_id: "c_hard" });
  runtime.store.appendMessage({ conversation_id: "c_hard", role: "user", content: "x" });
  const srv = await startServer(runtime);
  try {
    const r = await fetchJson(`${srv.url}/conversation/c_hard?hard=true`, desktopMutation("DELETE"));
    assert.equal(r.status, 200);
    assert.equal(r.body.hard, true);
    assert.equal(runtime.store.getConversation("c_hard"), null);
  } finally { await srv.close(); }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
