#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  sanitizeToolSummary,
  TOOL_SUMMARY_SANITIZER_FIELDS
} from "../src/service/core/policy/tool-summary-sanitizer.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

it("non-object input returns empty object", () => {
  assert.deepEqual(sanitizeToolSummary(null), {});
  assert.deepEqual(sanitizeToolSummary("hi"), {});
  assert.deepEqual(sanitizeToolSummary(42), {});
  assert.deepEqual(sanitizeToolSummary([]), {});
});

it("only whitelisted fields survive", () => {
  const raw = {
    tool_id: "web_search_fetch",
    success: true,
    source_count: 3,
    raw_html: "<html>secret</html>",
    email_body: "personal data",
    file_content: "lots of bytes",
    arbitrary_key: "drop me"
  };
  const out = sanitizeToolSummary(raw);
  for (const k of Object.keys(out)) {
    assert.ok(TOOL_SUMMARY_SANITIZER_FIELDS.includes(k), `field ${k} must be whitelisted`);
  }
  assert.equal(out.raw_html, undefined);
  assert.equal(out.email_body, undefined);
  assert.equal(out.file_content, undefined);
});

it("type filter: drops non-string tool_id, non-boolean success, non-finite counts", () => {
  const out = sanitizeToolSummary({
    tool_id: 123,
    success: "true",
    source_count: "5",
    distinct_domain_count: NaN,
    duration_ms: Infinity
  });
  assert.equal(out.tool_id, undefined);
  assert.equal(out.success, undefined);
  assert.equal(out.source_count, undefined);
  assert.equal(out.distinct_domain_count, undefined);
  assert.equal(out.duration_ms, undefined);
});

it("counts are floored to non-negative integers", () => {
  const out = sanitizeToolSummary({
    source_count: 3.7,
    distinct_domain_count: -2,
    duration_ms: 1234.9
  });
  assert.equal(out.source_count, 3);
  assert.equal(out.distinct_domain_count, 0);
  assert.equal(out.duration_ms, 1234);
});

it("key_results string longer than 800 chars is truncated", () => {
  const long = "x".repeat(2000);
  const out = sanitizeToolSummary({ key_results: long });
  assert.equal(typeof out.key_results, "string");
  assert.equal(out.key_results.length, 800);
});

it("key_results array: max 8 items × max 200 chars; non-strings dropped", () => {
  const arr = [];
  for (let i = 0; i < 20; i++) arr.push("y".repeat(500));
  arr.push(42);
  arr.push({ junk: true });
  const out = sanitizeToolSummary({ key_results: arr });
  assert.ok(Array.isArray(out.key_results));
  assert.equal(out.key_results.length, 8);
  for (const s of out.key_results) {
    assert.equal(typeof s, "string");
    assert.ok(s.length <= 200);
  }
});

it("artifact_ids: only string ids, max 16 entries, max 256 chars each", () => {
  const ids = [];
  for (let i = 0; i < 30; i++) ids.push(`art_${i}`);
  ids.push(123);
  const out = sanitizeToolSummary({ artifact_ids: ids });
  assert.ok(Array.isArray(out.artifact_ids));
  assert.equal(out.artifact_ids.length, 16);
  for (const id of out.artifact_ids) assert.equal(typeof id, "string");
});

it("warnings: max 4 entries × max 200 chars", () => {
  const w = [];
  for (let i = 0; i < 10; i++) w.push("z".repeat(500));
  const out = sanitizeToolSummary({ warnings: w });
  assert.equal(out.warnings.length, 4);
  for (const s of out.warnings) assert.ok(s.length <= 200);
});

it("empty arrays for whitelisted-array fields are dropped", () => {
  const out = sanitizeToolSummary({
    artifact_ids: [],
    warnings: [],
    key_results: []
  });
  assert.equal(out.artifact_ids, undefined);
  assert.equal(out.warnings, undefined);
  assert.equal(out.key_results, undefined);
});

it("sanitize is idempotent: sanitize(sanitize(x)) == sanitize(x)", () => {
  const raw = {
    tool_id: "web_search_fetch", tool_name: "Web Search", success: true,
    source_count: 5, distinct_domain_count: 3,
    artifact_ids: ["a1", "a2"],
    key_results: ["one", "two"],
    warnings: ["w1"], duration_ms: 999,
    raw_body: "drop"
  };
  const a = sanitizeToolSummary(raw);
  const b = sanitizeToolSummary(a);
  assert.deepEqual(a, b);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
