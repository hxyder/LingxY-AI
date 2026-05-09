#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

const html = await readFile(path.join(repoRoot, "src/desktop/renderer/console.html"), "utf8");
const js = await readFile(path.join(repoRoot, "src/desktop/renderer/console.js"), "utf8");
const cache = await readFile(path.join(repoRoot, "src/desktop/renderer/conversation-cache.mjs"), "utf8");
const viewer = await readFile(path.join(repoRoot, "src/desktop/renderer/console-conversation-viewer.mjs"), "utf8");

await it("rail item: standalone Conversations nav is not exposed", () => {
  assert.doesNotMatch(html, /data-tab="conversations"/);
});

await it("panel: <section id=\"panel-conversations\"> exists", () => {
  assert.match(html, /<section id="panel-conversations"/);
});

await it("panel: contains conversationsList, conversationsCount, conversationsDetailBody", () => {
  assert.match(html, /id="conversationsList"/);
  assert.match(html, /id="conversationsCount"/);
  assert.match(html, /id="conversationsDetailBody"/);
});

await it("panel: refresh button + show-archived checkbox wired", () => {
  assert.match(html, /id="conversationsRefreshBtn"/);
  assert.match(html, /id="conversationsShowArchived"/);
});

await it("js: tab switch hook calls loadConversationsTab", () => {
  assert.match(js, /btn\.dataset\.tab === "conversations"[\s\S]{0,80}loadConversationsTab/);
});

await it("js: loadConversationsTab uses shared /conversations fetcher with archived param", () => {
  assert.match(js, /async function loadConversationsTab/);
  assert.match(js, /fetchConversations\s+as\s+cacheFetchConversations/);
  assert.match(js, /cacheFetchConversations\(fetch\.bind\(globalThis\),\s*state\.serviceBaseUrl,\s*\{\s*limit,\s*archived(?:,\s*projectId)?\s*\}\)/);
  assert.match(js, /fetchConversationsList\(\{\s*limit:\s*200,\s*archived\s*\}\)/);
  assert.match(cache, /\/conversations\?\$\{params\.toString\(\)\}/);
});

await it("js: loadConversationDetail uses shared /conversation/{id} fetcher", () => {
  assert.match(js, /fetchConversationDetail\s+as\s+cacheFetchConversationDetail/);
  assert.match(js, /cacheFetchConversationDetail\(fetch\.bind\(globalThis\),\s*state\.serviceBaseUrl,\s*conversationId\)/);
  assert.match(cache, /\/conversation\/\$\{encodeURIComponent\(conversationId\)\}/);
});

await it("js: conversation viewer HTML renderer lives in a dedicated module", () => {
  assert.match(js, /from\s+["']\.\/console-conversation-viewer\.mjs["']/);
  assert.match(js, /renderConversationsListHtml\(/);
  assert.match(js, /renderConversationDetailView\(/);
  assert.match(viewer, /function renderConversationsListHtml\s*\(/);
  assert.match(viewer, /function renderConversationDetailView\s*\(/);
});

await it("js: read-only — no POST/PATCH/DELETE on /conversation in viewer module", () => {
  // Look only at the viewer module code (between markers we can pin)
  const start = js.indexOf("CONVERSATIONS VIEWER (read-only");
  const end = js.indexOf("async function loadConnectorsTab", start);
  assert.ok(start > 0 && end > start, "viewer module markers must be present");
  const slice = js.slice(start, end);
  assert.ok(!/method:\s*"(POST|PATCH|DELETE)"/.test(slice),
    "minimal viewer must not write conversation data");
});

await it("js: renderer surfaces backfilled/partial/migration_version metadata tags", () => {
  assert.match(viewer, /backfilled/);
  assert.match(viewer, /partial/);
  assert.match(viewer, /migration_version/);
});

await it("js: renderer shows task-link relation labels", () => {
  assert.match(viewer, /linksByMessage/);
  assert.match(viewer, /\.relation/);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
