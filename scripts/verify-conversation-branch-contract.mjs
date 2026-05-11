#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createServiceHttpServer } from "../src/service/core/http-server.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../src/service/core/store/sqlite-store.mjs";
import {
  createConversationBranch
} from "../src/service/core/http-routes/note-project-conversation-routes.mjs";
import {
  buildConversationTreeRows
} from "../src/desktop/renderer/conversation-list-ia.mjs";

const DESKTOP_ACTOR_HEADER = "X-Lingxy-Desktop-Actor";

function seedConversation(store) {
  store.insertConversation({
    conversation_id: "conv_source",
    project_id: "proj_ia",
    title: "Original thread",
    metadata: { modelOverride: { providerId: "openai.demo", modelId: "demo" } }
  });
  const first = store.appendMessage({ conversation_id: "conv_source", role: "user", content: "first" });
  const answer = store.appendMessage({ conversation_id: "conv_source", role: "assistant", content: "answer" });
  const second = store.appendMessage({
    conversation_id: "conv_source",
    role: "user",
    content: "second",
    metadata: { context_summary: { source_type: "clipboard", text_preview: "old draft" } }
  });
  return { first, answer, second };
}

function makeRuntime() {
  const store = createInMemoryStoreScaffold();
  return {
    store,
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    paths: {},
    config: {},
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
  const dir = mkdtempSync(path.join(tmpdir(), "verify-conv-branch-"));
  const { server } = createServiceHttpServer({
    runtime,
    paths: { logsDir: dir, dataDir: dir }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => {
      rmSync(dir, { recursive: true, force: true });
      resolve();
    }))
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null
  };
}

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

function runBranchHelperContract(store) {
  const { answer, second } = seedConversation(store);
  const result = createConversationBranch({
    store,
    sourceConversationId: "conv_source",
    branchKind: "fork",
    throughMessageId: answer.message_id,
    newConversationId: "conv_fork"
  });
  assert.equal(result.ok, true);
  assert.equal(result.conversation.project_id, "proj_ia");
  assert.equal(result.conversation.metadata.branch.kind, "fork");
  assert.equal(result.copied_messages.length, 2);
  assert.equal(store.getConversationMessages("conv_fork").at(-1).content, "answer");
  assert.equal(store.getConversationMessages("conv_fork").some((message) => message.content === second.content), false);
}

function runEditHelperContract(store) {
  const { second } = seedConversation(store);
  const result = createConversationBranch({
    store,
    sourceConversationId: "conv_source",
    branchKind: "edit",
    beforeMessageId: second.message_id,
    editedContent: "second edited",
    newConversationId: "conv_edit"
  });
  assert.equal(result.ok, true);
  const messages = store.getConversationMessages("conv_edit");
  assert.equal(messages.length, 3);
  assert.equal(messages.at(-1).content, "second edited");
  assert.equal(messages.at(-1).metadata.edited_from.message_id, second.message_id);
  assert.equal(messages.at(-1).metadata.context_summary.text_preview, "old draft");
}

{
  runBranchHelperContract(createInMemoryStoreScaffold());
  runEditHelperContract(createInMemoryStoreScaffold());
}

{
  const dir = mkdtempSync(path.join(tmpdir(), "verify-conv-branch-sqlite-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "store.db") });
  try {
    runBranchHelperContract(store);
  } finally {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const runtime = makeRuntime();
  const { first, second } = seedConversation(runtime.store);
  const srv = await startServer(runtime);
  try {
    const rewind = await fetchJson(`${srv.url}/conversation/conv_source/rewind`, desktopJson("POST", {
      conversation_id: "conv_rewind",
      through_message_id: first.message_id
    }));
    assert.equal(rewind.status, 200);
    assert.equal(rewind.body.conversation.conversation_id, "conv_rewind");
    assert.equal(rewind.body.copied_messages.length, 1);
    assert.equal(rewind.body.branch.kind, "rewind");

    const edit = await fetchJson(
      `${srv.url}/conversation/conv_source/messages/${encodeURIComponent(second.message_id)}/edit`,
      desktopJson("POST", {
        conversation_id: "conv_edit_http",
        content: "replacement"
      })
    );
    assert.equal(edit.status, 200);
    assert.equal(edit.body.edited_message.content, "replacement");
    assert.equal(edit.body.edited_message.metadata.edited_from.message_id, second.message_id);

    const duplicate = await fetchJson(`${srv.url}/conversation/conv_source/fork`, desktopJson("POST", {
      conversation_id: "conv_rewind"
    }));
    assert.equal(duplicate.status, 409);
  } finally {
    await srv.close();
  }
}

{
  const viewer = readFileSync(new URL("../src/desktop/renderer/console-conversation-viewer.mjs", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../src/desktop/renderer/console-chat-sidebar.mjs", import.meta.url), "utf8");
  const consoleJs = readFileSync(new URL("../src/desktop/renderer/console.js", import.meta.url), "utf8");
  const listIa = readFileSync(new URL("../src/desktop/renderer/conversation-list-ia.mjs", import.meta.url), "utf8");
  assert.match(listIa, /buildConversationTreeRows/);
  assert.match(viewer, /buildConversationTreeRows/);
  assert.match(viewer, /data-conversation-fork-message/);
  assert.match(viewer, /data-conversation-rewind-message/);
  assert.match(viewer, /data-conversation-edit-message/);
  assert.match(viewer, /conversation-branch-chip/);
  assert.match(sidebar, /buildConversationTreeRows/);
  assert.match(sidebar, /conversation-branch-chip/);
  assert.match(consoleJs, /function createConversationBranchFromDetail/);
  assert.match(consoleJs, /function createConversationBranchFromChat/);
  assert.match(consoleJs, /function appendConsoleChatBranchActions/);
  assert.match(consoleJs, /runConversationBranchControls/);
  assert.match(consoleJs, /mode\s*=\s*"fork"/);
  assert.match(consoleJs, /window\.prompt\s*=\s*\(\)\s*=>\s*editContent/);
  assert.match(consoleJs, /data-chat-branch-action="fork"/);
  assert.match(consoleJs, /handleConsoleChatBranchAction/);
  assert.match(consoleJs, /appendConsoleChatBranchActions\(node,\s*message\)/);
  assert.match(consoleJs, /\/conversation\/\$\{encodeURIComponent\(conversationId\)\}\/messages\/\$\{encodeURIComponent\(messageId\)\}\/edit/);
  assert.match(consoleJs, /\/conversation\/\$\{encodeURIComponent\(conversationId\)\}\/\$\{mode\}/);
  const smokeRunner = readFileSync(new URL("../scripts/run-electron-gui-smoke.mjs", import.meta.url), "utf8");
  const desktopSmokeRunner = readFileSync(new URL("../src/desktop/smoke/desktop-gui-smoke-runner.mjs", import.meta.url), "utf8");
  const electronMain = readFileSync(new URL("../src/desktop/tray/electron-main.mjs", import.meta.url), "utf8");
  assert.match(smokeRunner, /gui-smoke-conv/);
  assert.match(smokeRunner, /branchMatch[\s\S]*fork\|rewind/);
  assert.ok(smokeRunner.includes("const editMatch = url.pathname.match"));
  assert.ok(smokeRunner.includes("message_not_found"));
  assert.ok(smokeRunner.includes("edited_message"));
  assert.match(desktopSmokeRunner, /console_chat_branch_fork/);
  assert.match(desktopSmokeRunner, /console_chat_branch_rewind/);
  assert.match(desktopSmokeRunner, /console_chat_branch_edit/);
  const css = readFileSync(new URL("../src/desktop/renderer/shared-chat.css", import.meta.url), "utf8");
  assert.match(css, /\.chat-msg-branch-actions/);
  assert.match(css, /\.conversation-branch-chip/);
  assert.match(css, /\.chat-sidebar-item--branch/);
}

{
  const rows = buildConversationTreeRows([
    { conversation_id: "root", title: "Root" },
    { conversation_id: "other", title: "Other" },
    {
      conversation_id: "child",
      title: "Child",
      metadata: { branch: { kind: "fork", source_conversation_id: "root" } }
    },
    {
      conversation_id: "grandchild",
      title: "Grandchild",
      metadata: { branch: { kind: "edit", source_conversation_id: "child" } }
    }
  ]);
  assert.deepEqual(rows.map((row) => [row.conversation.conversation_id, row.depth]), [
    ["root", 0],
    ["child", 1],
    ["grandchild", 2],
    ["other", 0]
  ]);
  const searchRows = buildConversationTreeRows([
    { conversation_id: "root", title: "Root" },
    {
      conversation_id: "child",
      title: "Child",
      metadata: { branch: { kind: "fork", source_conversation_id: "root" } }
    }
  ], { searchTerm: "child" });
  assert.deepEqual(searchRows.map((row) => row.depth), [0, 0]);
}

console.log("conversation branch contract ok");
