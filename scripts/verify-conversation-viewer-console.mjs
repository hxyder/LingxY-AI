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

await it("rail item: data-tab=\"conversations\" exists", () => {
  assert.match(html, /data-tab="conversations"/);
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

await it("js: loadConversationsTab GETs /conversations with archived param", () => {
  assert.match(js, /async function loadConversationsTab/);
  assert.match(js, /\/conversations\?[^"]*archived=/);
});

await it("js: loadConversationDetail GETs /conversation/{id}", () => {
  assert.match(js, /\/conversation\/\$\{encodeURIComponent\(conversationId\)\}/);
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
  assert.match(js, /backfilled/);
  assert.match(js, /partial/);
  assert.match(js, /migration_version/);
});

await it("js: renderer shows task-link relation labels", () => {
  assert.match(js, /linksByMessage/);
  assert.match(js, /\.relation/);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
