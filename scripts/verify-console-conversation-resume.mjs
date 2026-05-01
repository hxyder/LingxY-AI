#!/usr/bin/env node
/**
 * P6 G lock-in: console can RESUME a past conversation.
 *
 * Asserts (source-level + behaviour against the shared cache module):
 *   1. Continue button uses the SELECTED conversation_id (no new
 *      conversation creation, no history copy).
 *   2. Console submit threads conversation_id to /task POST when active.
 *   3. Resume does NOT inject [当前对话上下文] into the payload.
 *   4. Resume does NOT inject selection_metadata.conversation_turns.
 *   5. Resume does NOT inject parent_task_summary as pseudo-history.
 *   6. Console fetches GET /conversation/{id} via the shared cache
 *      module (no parallel reconcile logic).
 *   7. Optimistic message uses client_message_id from the shared
 *      cache helper.
 *   8. Reconcile path matches by client_message_id (single helper,
 *      not duplicated).
 *   9. Blank console chat mints a conversation_id before submit.
 *  10. New chat clears consoleActiveConversation.
 *  11. Console + overlay use the EXACT same cache module
 *      (conversation-cache.mjs).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createClientMessageId,
  ensureBackendCacheFields,
  classifyIncomingMessage,
  applyMessageBatch,
  fetchConversations
} from "../src/desktop/renderer/conversation-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}
async function read(p) { return readFile(path.join(repoRoot, p), "utf8"); }

const consoleJs = await read("src/desktop/renderer/console.js");
const consoleHtml = await read("src/desktop/renderer/console.html");
const consoleConversationViewer = await read("src/desktop/renderer/console-conversation-viewer.mjs");
const overlayJs = await read("src/desktop/renderer/overlay.js");
const cacheModule = await read("src/desktop/renderer/conversation-cache.mjs");

await it("console.html: chat panel exposes #consoleChatActiveTitle for the resume label", () => {
  assert.match(consoleHtml, /id="consoleChatActiveTitle"/);
});

await it("console.js: imports from the shared cache module — not a private fork", () => {
  assert.match(consoleJs, /from\s+["']\.\/conversation-cache\.mjs["']/);
  assert.match(consoleJs, /createClientMessageId\s+as\s+cacheCreateClientMessageId/);
  assert.match(consoleJs, /createConversationId\s+as\s+cacheCreateConversationId/);
  assert.match(consoleJs, /fetchConversations\s+as\s+cacheFetchConversations/);
});

await it("console.js: exposes consoleActiveConversation state + clearConsoleActiveConversation", () => {
  assert.match(consoleJs, /let\s+consoleActiveConversation/);
  assert.match(consoleJs, /function\s+clearConsoleActiveConversation\s*\(/);
});

await it("console.js: Continue button binds to data-conversation-id and calls loadConsoleConversationFromBackend", () => {
  assert.match(consoleConversationViewer, /id="conversationsContinueBtn"/);
  assert.match(consoleConversationViewer, /data-conversation-id="\$\{escapeHtml\(conversationId\)\}"/);
  assert.match(consoleJs, /loadConsoleConversationFromBackend\(convId\)/);
  assert.match(consoleJs, /function\s+bindConversationsContinueButton/);
});

await it("console.js: loadConsoleConversationFromBackend uses the shared fetcher (no parallel reconcile)", () => {
  assert.match(consoleJs, /cacheFetchConversationDetail\(/);
  assert.match(consoleJs, /cacheApplyBatch\(consoleActiveConversation/);
  // Negative: no console-local reconcile clone
  assert.ok(!/function\s+reconcileConversationFromBackend/.test(consoleJs),
    "console.js must not declare its own reconcile function — reuse the shared cache");
  assert.ok(!/function\s+applyBackendMessageToCache/.test(consoleJs),
    "console.js must not redeclare applyBackendMessageToCache — adapter only");
});

await it("console.js: Conversations detail viewer also uses the shared detail fetcher", () => {
  const start = consoleJs.indexOf("async function loadConversationDetail");
  assert.ok(start > 0, "loadConversationDetail must exist");
  const end = consoleJs.indexOf("\nasync function loadConversationsTab", start + 1);
  const slice = consoleJs.slice(start, end > start ? end : start + 1200);
  assert.match(slice, /cacheFetchConversationDetail\(/);
  assert.ok(!/fetch\s*\(\s*`\$\{state\.serviceBaseUrl\}\/conversation/.test(slice),
    "conversation viewer must not hand-roll /conversation/{id} fetch");
});

await it("console.js: submit body threads conversation_id when consoleActiveConversation is set", () => {
  // Pattern: { conversation_id: conversationId } spread inside the POST body.
  assert.match(consoleJs,
    /conversationId\s*\?\s*\{\s*conversation_id:\s*conversationId\s*\}/);
});

await it("console.js: blank submit mints conversation_id and force-refreshes conversation lists", () => {
  const start = consoleJs.indexOf("async function submitConsoleChat");
  assert.ok(start > 0, "submitConsoleChat must exist");
  const end = consoleJs.indexOf("\nfunction appendConsoleChatUserMessage", start + 1);
  const slice = consoleJs.slice(start, end > start ? end : start + 5000);
  assert.match(slice, /cacheCreateConversationId\(\)/);
  assert.match(slice, /consoleActiveConversation\s*=\s*cacheEnsureBackendFields/);
  assert.match(slice, /refreshChatSidebar\(\{\s*force:\s*true\s*\}\)/);
  assert.match(consoleJs, /async function ensureConversationsCache\s*\(\s*\{\s*force\s*=\s*false/);
  assert.match(consoleJs, /if\s*\(\s*!force\s*&&\s*Array\.isArray\(conversationsState\?\.items\)/);
});

await it("console.js: submit body includes client_message_id from cacheCreateClientMessageId", () => {
  assert.match(consoleJs, /cacheCreateClientMessageId\(\)/);
  assert.match(consoleJs, /client_message_id:\s*clientMessageId/);
});

await it("console.js: optimistic user bubble carries data-client-message-id and 'pending' class", () => {
  assert.match(consoleJs, /dataset\.clientMessageId\s*=\s*clientMessageId/);
  assert.match(consoleJs, /classList\.contains\("pending"\)|wrapper\.className\s*=\s*"console-chat-message console-chat-message-user pending"/);
});

await it("console.js: New chat handler calls clearConsoleActiveConversation", () => {
  assert.match(consoleJs, /function\s+startNewConsoleChat\s*\(\)\s*\{[\s\S]{0,800}clearConsoleActiveConversation\(\)/);
  assert.match(consoleJs, /consoleChatNewBtn"\)\?\.addEventListener\("click",\s*startNewConsoleChat\)/);
});

await it("console.js: failed POST marks bubble as 'failed', drops 'pending'", () => {
  assert.match(consoleJs, /function\s+markConsoleChatPendingFailed/);
  assert.match(consoleJs, /classList\.add\("failed"\)/);
  assert.match(consoleJs, /node\.dataset\.status\s*=\s*"failed"/);
});

await it("resume payload: NO [当前对话上下文] / conversation_turns / parent_task_summary injection", () => {
  // Locate the submitConsoleChat function body and grep within.
  const start = consoleJs.indexOf("async function submitConsoleChat");
  assert.ok(start > 0, "submitConsoleChat must exist");
  const end = consoleJs.indexOf("\nfunction ", start + 1);
  const slice = consoleJs.slice(start, end > start ? end : start + 4000);
  assert.ok(!slice.includes("[当前对话上下文]"),
    "console submit must NOT inject [当前对话上下文]");
  assert.ok(!/selection_metadata\s*:\s*\{[^}]*conversation_turns/.test(slice),
    "console submit must NOT build selection_metadata.conversation_turns");
  assert.ok(!/parent_task_summary/.test(slice),
    "console submit must NOT echo parent_task_summary as pseudo-history");
});

await it("overlay + console reuse the same cache module symbols (no per-page fork)", () => {
  // Both files must import from the same module path.
  assert.match(overlayJs, /from\s+["']\.\/conversation-cache\.mjs["']/);
  assert.match(consoleJs, /from\s+["']\.\/conversation-cache\.mjs["']/);
  // The cache module is canonical — assertions below pin its surface.
  assert.match(cacheModule, /export\s+function\s+createClientMessageId/);
  assert.match(cacheModule, /export\s+function\s+createConversationId/);
  assert.match(cacheModule, /export\s+async\s+function\s+fetchConversations/);
  assert.match(cacheModule, /export\s+function\s+ensureBackendCacheFields/);
  assert.match(cacheModule, /export\s+function\s+applyMessageBatch/);
});

// Behavioural — exercise the shared module the way both pages do.
await it("classifier: tool_summary classified as skip-tool-summary", () => {
  const conv = ensureBackendCacheFields({});
  const out = classifyIncomingMessage(conv, {
    seq: 0, role: "tool_summary", content: "{}", message_id: "msg_t"
  });
  assert.equal(out.action, "skip-tool-summary");
});

await it("classifier: matching client_message_id classified as reconcile-pending", () => {
  const conv = ensureBackendCacheFields({});
  const cmid = createClientMessageId();
  conv.pendingByClientId.set(cmid, { role: "user", content: "hi", ts: Date.now() });
  const out = classifyIncomingMessage(conv, {
    seq: 1, role: "user", content: "hi",
    message_id: "msg_u", metadata: { client_message_id: cmid }
  });
  assert.equal(out.action, "reconcile-pending");
  assert.equal(out.clientMessageId, cmid);
});

await it("classifier: stale (seq <= lastKnownSeq) returns skip-stale", () => {
  const conv = ensureBackendCacheFields({});
  conv.lastKnownSeq = 5;
  const out = classifyIncomingMessage(conv, { seq: 5, role: "user", content: "x", message_id: "m" });
  assert.equal(out.action, "skip-stale");
});

await it("applyMessageBatch: pending entry is removed and lastKnownSeq advances", () => {
  const conv = ensureBackendCacheFields({});
  const cmid = createClientMessageId();
  conv.pendingByClientId.set(cmid, { role: "user", content: "x", ts: Date.now() });
  let reconciled = 0;
  let appended = 0;
  applyMessageBatch(conv, {
    messages: [
      { seq: 0, role: "user", content: "x", message_id: "m1", metadata: { client_message_id: cmid } },
      { seq: 1, role: "assistant", content: "y", message_id: "m2" }
    ]
  }, {
    onReconcilePending() { reconciled += 1; },
    onAppend() { appended += 1; }
  });
  assert.equal(reconciled, 1);
  assert.equal(appended, 1);
  assert.equal(conv.pendingByClientId.has(cmid), false);
  assert.equal(conv.lastKnownSeq, 1);
});

await it("fetchConversations: builds canonical /conversations query and returns summaries", async () => {
  let requestedUrl = "";
  const rows = await fetchConversations(async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { conversations: [{ conversation_id: "conv_a" }] };
      }
    };
  }, "http://service", { limit: 200, archived: "any", projectId: "proj_default" });
  assert.equal(rows.length, 1);
  assert.ok(requestedUrl.startsWith("http://service/conversations?"));
  assert.ok(requestedUrl.includes("limit=200"));
  assert.ok(requestedUrl.includes("archived=any"));
  assert.ok(requestedUrl.includes("project_id=proj_default"));
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
