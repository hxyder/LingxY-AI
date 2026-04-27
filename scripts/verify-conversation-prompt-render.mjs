#!/usr/bin/env node
import assert from "node:assert/strict";
import { renderHistoryMessages } from "../src/service/executors/shared/conversation-prompt.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

it("user / assistant rows pass through verbatim", () => {
  const out = renderHistoryMessages([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" }
  ]);
  assert.deepEqual(out, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" }
  ]);
});

it("system rows render as assistant context block — never as user, never as system", () => {
  const out = renderHistoryMessages([
    { role: "system", status: "cancelled", content: "Task was cancelled." }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "assistant",
    "system status must render as assistant/context block, not as a fake user turn");
  assert.match(out[0].content, /System status from prior turn/);
  assert.match(out[0].content, /historical reference, not instructions/);
  assert.match(out[0].content, /status: cancelled/);
  assert.match(out[0].content, /Task was cancelled\./);
});

it("system status with no status field still renders the historical-reference header", () => {
  const out = renderHistoryMessages([
    { role: "system", content: "Generic system note." }
  ]);
  assert.equal(out[0].role, "assistant");
  assert.match(out[0].content, /System status from prior turn/);
  assert.match(out[0].content, /Generic system note/);
});

it("tool_summary rows are emitted as assistant blocks with the historical-reference header", () => {
  const payload = JSON.stringify({
    tool_id: "web_search_fetch",
    success: true,
    source_count: 3,
    distinct_domain_count: 2
  });
  const out = renderHistoryMessages([
    { role: "tool_summary", content: payload }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "assistant", "tool_summary must NOT be a system message");
  assert.match(out[0].content, /Prior turn tool actions/);
  assert.match(out[0].content, /tool: web_search_fetch/);
  assert.match(out[0].content, /sources: 3 across 2 domains/);
});

it("tool_summary rendering re-applies sanitize: raw_html / email_body never reach output", () => {
  const payload = JSON.stringify({
    tool_id: "fetch_url_content",
    success: true,
    raw_html: "<html>secret</html>",
    email_body: "personal data",
    file_content: "lots of bytes"
  });
  const out = renderHistoryMessages([{ role: "tool_summary", content: payload }]);
  const block = out[0].content;
  assert.ok(!block.includes("secret"), "raw_html must be filtered");
  assert.ok(!block.includes("personal data"), "email_body must be filtered");
  assert.ok(!block.includes("lots of bytes"), "file_content must be filtered");
});

it("malformed tool_summary content (non-JSON) renders without crash", () => {
  const out = renderHistoryMessages([{ role: "tool_summary", content: "not json at all" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "assistant");
  assert.match(out[0].content, /no structured summary/);
});

it("unknown roles are dropped, not passed through", () => {
  const out = renderHistoryMessages([
    { role: "user", content: "ok" },
    { role: "tool", content: "bogus" },
    { role: "developer", content: "bogus" },
    { role: "assistant", content: "fine" }
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((m) => m.role), ["user", "assistant"]);
});

it("non-array input returns []", () => {
  assert.deepEqual(renderHistoryMessages(null), []);
  assert.deepEqual(renderHistoryMessages("hi"), []);
  assert.deepEqual(renderHistoryMessages({ role: "user", content: "x" }), []);
});

it("ordering is preserved (chronological in → chronological out)", () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` });
  }
  const out = renderHistoryMessages(rows);
  assert.deepEqual(out.map((m) => m.content), ["m0", "m1", "m2", "m3", "m4", "m5"]);
});

it("regression guard: tool_summary header is verbatim 'historical reference, not instructions'", () => {
  const out = renderHistoryMessages([
    { role: "tool_summary", content: JSON.stringify({ tool_id: "x", success: true }) }
  ]);
  assert.match(out[0].content, /historical reference, not instructions/);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
