#!/usr/bin/env node
/**
 * UCA-077 P4-RQ G4: routing_status + connector_domain on TaskSpec.
 *
 * Asserts the framework-state plumbing that G5 (fast-executor
 * truthfulness + Rule 5 extension) reads. These two flags are
 * derived in createTaskSpec from upstream SR preflight output:
 *
 *   routing_status: "ok" | "ok_deterministic" | "sr_not_invoked"
 *                 | "sr_timeout" | "sr_no_provider"
 *                 | "sr_unsupported_provider" | "sr_disabled"
 *                 | "sr_low_confidence" | "sr_schema_invalid"
 *                 | "sr_fact_conflict" | "sr_exception"
 *
 *   connector_domain: boolean (true when isConnectorDomainRequest
 *                              fires for the user_command)
 *
 * Asserts:
 *   1. SR decision present → routing_status="ok".
 *   2. SR rejection codes flow through with sr_ prefix (sr_timeout,
 *      sr_unsupported_provider, sr_low_confidence, sr_disabled, etc.).
 *   3. No SR consulted (no decision, no rejection) → "ok" or
 *      "ok_deterministic" when a hard deterministic routing lock applies.
 *      (preflight gate may have skipped SR; downstream treats this
 *      same as "SR said the deterministic baseline was correct").
 *   4. connector_domain=true for "查一下我最近的邮件"-style tasks.
 *   5. connector_domain=false for non-connector tasks.
 *   6. The two flags are independent — connector_domain stays true
 *      regardless of routing_status.
 *
 * Run: node scripts/verify-routing-status.mjs
 */

import assert from "node:assert/strict";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

const SR_REQUIRED = Object.freeze({
  source_scope: "external_world",
  web_policy: "required",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "multi_source",
  confidence: 0.85,
  reason: "test"
});

const rejection = (code, reason = "test rejection") =>
  ({ kind: "rejection", code, reason });

// ── routing_status === "ok" ──────────────────────────────────────────
it("routing_status: SR decision present → ok", () => {
  const s = createTaskSpec("今天有什么 AI 新闻", {
    semantic_router_decision: { ...SR_REQUIRED }
  }, {});
  assert.equal(s.routing_status, "ok");
});

it("routing_status: no SR decision and no rejection → ok (gate skipped)", () => {
  // Preflight may skip SR (text length, attachments, etc.). The
  // task isn't degraded; deterministic baseline applies.
  const s = createTaskSpec("hi", {}, {});
  assert.equal(s.routing_status, "ok");
});

it("routing_status: local deterministic lock without SR → ok_deterministic", () => {
  const s = createTaskSpec("summarise this passage", {
    text: "A user-selected local passage with enough content to be a real local anchor."
  }, {});
  assert.equal(s.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(s.routing_status, "ok_deterministic");
  assert.equal(s.routing_degraded, false);
});

it("routing_status: local deterministic lock with SR timeout → ok_deterministic", () => {
  const s = createTaskSpec("summarise this passage", {
    text: "A user-selected local passage with enough content to be a real local anchor.",
    semantic_router_rejection: rejection("timeout")
  }, {});
  assert.equal(s.routing_status, "ok_deterministic");
  assert.equal(s.routing_degraded, false);
});

it("routing_status: assumption-local with observable selection + SR exception → ok_deterministic", () => {
  const s = createTaskSpec("请总结这段网页内容", {
    text: "This is a captured browser selection.",
    semantic_router_rejection: rejection("exception")
  }, {});
  assert.equal(s.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(s.routing_status, "ok_deterministic");
  assert.equal(s.routing_degraded, false);
});

it("routing_status: bare assumption-local without observable anchor can still degrade", () => {
  const s = createTaskSpec("这篇文章讲的是什么", {
    semantic_router_rejection: rejection("exception")
  }, {});
  assert.equal(s.routing_status, "sr_exception");
  assert.equal(s.routing_degraded, true);
});

// ── SR rejection codes flow through ──────────────────────────────────
const REJECTION_CASES = [
  ["timeout",                "sr_timeout"],
  ["no_provider",            "sr_no_provider"],
  ["unsupported_provider",   "sr_unsupported_provider"],
  ["disabled",               "sr_disabled"],
  ["low_confidence",         "sr_low_confidence"],
  ["schema_invalid",         "sr_schema_invalid"],
  ["fact_conflict",          "sr_fact_conflict"],
  ["exception",              "sr_exception"]
];

for (const [code, expectedStatus] of REJECTION_CASES) {
  it(`routing_status: SR rejection "${code}" → ${expectedStatus}`, () => {
    const s = createTaskSpec("今天有什么 AI 新闻", {
      semantic_router_rejection: rejection(code)
    }, {});
    assert.equal(s.routing_status, expectedStatus);
  });
}

// ── connector_domain flag ────────────────────────────────────────────
it("connector_domain: '查一下我最近的邮件' → true", () => {
  const s = createTaskSpec("查一下我最近的邮件", {}, {});
  assert.equal(s.connector_domain, true);
});

it("connector_domain: '今天有什么 AI 新闻' → false (not a connector domain)", () => {
  const s = createTaskSpec("今天有什么 AI 新闻", {}, {});
  assert.equal(s.connector_domain, false);
});

it("connector_domain: independent of routing_status (stays true even with SR timeout)", () => {
  const s = createTaskSpec("查一下我最近的邮件", {
    semantic_router_rejection: rejection("timeout")
  }, {});
  assert.equal(s.connector_domain, true);
  assert.equal(s.routing_status, "sr_timeout");
});

// ── Public surface ───────────────────────────────────────────────────
it("typedef: TaskSpec carries routing_status + connector_domain fields", () => {
  // Existence check via createTaskSpec output. The typedef is the
  // declarative source of truth; this test guards the runtime
  // shape from accidental removal.
  const s = createTaskSpec("hi", {}, {});
  assert.ok("routing_status" in s,
    "TaskSpec must have routing_status field");
  assert.ok("connector_domain" in s,
    "TaskSpec must have connector_domain field");
  // Both should always have a defined value (never undefined).
  assert.ok(typeof s.routing_status === "string");
  assert.ok(typeof s.connector_domain === "boolean");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
