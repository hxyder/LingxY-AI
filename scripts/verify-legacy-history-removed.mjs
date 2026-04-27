#!/usr/bin/env node
/**
 * P6-F1 lock-in: frontend must not emit legacy conversation history.
 *
 * Backend conversation_messages is now the single source of truth.
 * The frontend may still render its own UI cache, but nothing it
 * sends to the backend should contain a hand-built history block
 * or a `conversation_turns` field.
 *
 * Asserts:
 *   1. overlay.js does not call buildHistoryBlock / buildStructuredConversationTurns
 *   2. overlay.js submit body does not contain the legacy sentinel "[当前对话上下文]"
 *   3. overlay.js submit body does not assemble selection_metadata.conversation_turns
 *   4. browser-submission.mjs does not emit conversation_turns / conversation_turn_count
 *   5. conversation-memory.mjs is gone (the only consumer was browser-submission)
 */
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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
async function exists(p) { try { await stat(path.join(repoRoot, p)); return true; } catch { return false; } }

const overlay = await read("src/desktop/renderer/overlay.js");
const browser = await read("src/service/core/browser-submission.mjs");

await it("overlay.js: legacy history helpers are deleted (buildHistoryBlock / buildStructuredConversationTurns)", () => {
  assert.ok(!/function\s+buildHistoryBlock\s*\(/.test(overlay),
    "buildHistoryBlock must be removed");
  assert.ok(!/function\s+buildStructuredConversationTurns\s*\(/.test(overlay),
    "buildStructuredConversationTurns must be removed");
});

await it("overlay.js: outbound payload no longer references buildHistoryBlock", () => {
  assert.ok(!/buildHistoryBlock\(/.test(overlay));
});

await it("overlay.js: outbound payload no longer references buildStructuredConversationTurns", () => {
  assert.ok(!/buildStructuredConversationTurns\(/.test(overlay));
});

await it("overlay.js: legacy sentinel '[当前对话上下文]' is NOT injected into submit payloads", () => {
  // The sentinel may still appear in comments or elsewhere; check that no
  // string literal containing it is concatenated into a payload field.
  const submitPart = overlay.slice(overlay.indexOf("addSystemBubble(\"Submitting"));
  assert.ok(!submitPart.includes("[当前对话上下文]"),
    "submit path must not emit [当前对话上下文]");
});

await it("overlay.js: outbound payload has no selection_metadata.conversation_turns assembly", () => {
  const submitPart = overlay.slice(overlay.indexOf("addSystemBubble(\"Submitting"));
  assert.ok(!/selectionMetadata\s*:\s*\{[^}]*conversation_turns/.test(submitPart),
    "submit path must not build selection_metadata.conversation_turns");
});

await it("overlay.js: capture object no longer carries `history: structuredTurns`", () => {
  assert.ok(!/history:\s*structuredTurns/.test(overlay));
});

await it("browser-submission.mjs: createSelectionMetadata does not emit conversation_turns", () => {
  assert.ok(!/conversation_turns:/.test(browser));
  assert.ok(!/conversation_turn_count:/.test(browser));
});

await it("browser-submission.mjs: no import from conversation-memory.mjs", () => {
  assert.ok(!/from\s+"\.\/conversation-memory\.mjs"/.test(browser));
});

await it("conversation-memory.mjs is removed (zero consumers after F1)", async () => {
  const stillThere = await exists("src/service/core/conversation-memory.mjs");
  assert.equal(stillThere, false, "conversation-memory.mjs must be deleted");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
