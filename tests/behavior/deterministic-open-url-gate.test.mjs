import assert from "node:assert/strict";
import test from "node:test";

import { planDeterministicToolCall } from "../../src/service/executors/tool_using/planners/deterministic.mjs";

// Regression: task_f90251bc (2026-05-06). User asked for a link / page and
// the deterministic planner fired open_url because the trigger regex
// accepted bare nouns (链接 / url / 网页 / 网站). open_url then auto-launched
// the OS default browser and the contract still failed because no real
// web fetch tool ran. Tighten the regex to action verbs only.

test("'打开 https://example.com' fires open_url (action verb)", () => {
  const decision = planDeterministicToolCall("打开 https://example.com");
  assert.deepEqual(decision, { type: "tool_call", tool: "open_url", args: { url: "https://example.com" } });
});

test("'open https://example.com' fires open_url (English action verb)", () => {
  const decision = planDeterministicToolCall("open https://example.com");
  assert.deepEqual(decision, { type: "tool_call", tool: "open_url", args: { url: "https://example.com" } });
});

test("'给我 https://example.com 的链接' does NOT fire open_url (information ask, not action)", () => {
  const decision = planDeterministicToolCall("给我 https://example.com 的链接");
  assert.notDeepEqual(decision?.tool, "open_url",
    `give-me-the-link should not auto-open: ${JSON.stringify(decision)}`);
});

test("'把这个网页发我看看 https://example.com' does NOT fire open_url (passing the URL, not opening)", () => {
  const decision = planDeterministicToolCall("把这个网页发我看看 https://example.com");
  assert.notDeepEqual(decision?.tool, "open_url",
    `passing-the-page should not auto-open: ${JSON.stringify(decision)}`);
});

test("'send me the url for X https://example.com' does NOT fire open_url (passive ask)", () => {
  const decision = planDeterministicToolCall("send me the url for X https://example.com");
  assert.notDeepEqual(decision?.tool, "open_url",
    `passive url ask should not auto-open: ${JSON.stringify(decision)}`);
});

test("'load https://example.com' fires open_url (load = action verb)", () => {
  const decision = planDeterministicToolCall("load https://example.com");
  assert.deepEqual(decision, { type: "tool_call", tool: "open_url", args: { url: "https://example.com" } });
});

test("'navigate to https://example.com' fires open_url", () => {
  const decision = planDeterministicToolCall("navigate to https://example.com");
  assert.deepEqual(decision, { type: "tool_call", tool: "open_url", args: { url: "https://example.com" } });
});

test("'前往 https://example.com' fires open_url (Chinese alt verb)", () => {
  const decision = planDeterministicToolCall("前往 https://example.com");
  assert.deepEqual(decision, { type: "tool_call", tool: "open_url", args: { url: "https://example.com" } });
});
