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

async function read(p) { return readFile(path.join(repoRoot, p), "utf8"); }

const toolUsing = await read("src/service/executors/tool_using/agent-loop.mjs");
const fastExec  = await read("src/service/executors/fast/fast-executor.mjs");
const agentic   = await read("src/service/executors/agentic/planner.mjs");

await it("tool_using imports loadStructuredHistoryFor", () => {
  assert.match(toolUsing, /import\s+\{[^}]*loadStructuredHistoryFor[^}]*\}\s*from\s+"\.\.\/shared\/conversation-history-loader\.mjs"/);
});

await it("tool_using calls loadStructuredHistoryFor with executor: 'tool_using'", () => {
  assert.match(toolUsing, /loadStructuredHistoryFor\([\s\S]{0,200}executor:\s*"tool_using"/);
});

await it("tool_using branches on historyResult.mode === 'structured'", () => {
  assert.match(toolUsing, /historyResult\.mode\s*===\s*"structured"/);
});

await it("tool_using passes prefixMessages (not just userCommand) to buildConversationMessages", () => {
  // After Phase D, buildConversationMessages first arg is a prefix array.
  assert.match(toolUsing, /buildConversationMessages\(\s*prefixMessages/);
});

await it("fast-executor imports loadStructuredHistoryFor", () => {
  assert.match(fastExec, /import\s+\{[^}]*loadStructuredHistoryFor[^}]*\}\s*from\s+"\.\.\/shared\/conversation-history-loader\.mjs"/);
});

await it("fast-executor calls loader with executor: 'fast'", () => {
  assert.match(fastExec, /loadStructuredHistoryFor\([\s\S]{0,160}executor:\s*"fast"/);
});

await it("fast-executor buildMessages branches on historyResult.mode", () => {
  assert.match(fastExec, /historyResult\.mode\s*===\s*"structured"/);
});

await it("agentic imports loadStructuredHistoryFor", () => {
  assert.match(agentic, /import\s+\{[^}]*loadStructuredHistoryFor[^}]*\}\s*from\s+"\.\.\/shared\/conversation-history-loader\.mjs"/);
});

await it("agentic calls loader with executor: 'agentic'", () => {
  assert.match(agentic, /loadStructuredHistoryFor\([\s\S]{0,160}executor:\s*"agentic"/);
});

await it("agentic branches on historyResult.mode === 'structured'", () => {
  assert.match(agentic, /historyResult\.mode\s*===\s*"structured"/);
});

await it("structural rule: tool_using's loader call goes BEFORE await adapter.generate", () => {
  const loaderIdx = toolUsing.search(/loadStructuredHistoryFor\(/);
  const adapterIdx = toolUsing.search(/await adapter\.generate\(/);
  assert.ok(loaderIdx > 0, "loader call must exist");
  assert.ok(adapterIdx > 0, "await adapter.generate must exist");
  assert.ok(loaderIdx < adapterIdx, "loader must be invoked before adapter.generate");
});

await it("structural rule: agentic's loader call goes BEFORE await adapter.generate", () => {
  const loaderIdx = agentic.search(/loadStructuredHistoryFor\(/);
  const adapterIdx = agentic.search(/await adapter\.generate\(/);
  assert.ok(loaderIdx > 0 && adapterIdx > 0);
  assert.ok(loaderIdx < adapterIdx);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
