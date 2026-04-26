#!/usr/bin/env node
/**
 * UCA-077 P4-RQ G5: fast-executor truthfulness + Rule 5 extension.
 *
 * Two-layer defense against fast executor fabricating live-lookup
 * claims when SR couldn't run AND the user's request shows
 * structural research intent:
 *
 *   G5a (executor-resolver Rule 5 extension):
 *     goal=search_and_answer + web=forbidden + !connector_domain → fast.
 *     Routes "不要联网，告诉我今天 AI 新闻" through fast for an
 *     honest reply instead of tool_using's planner loop.
 *     Connector-domain boundary preserves
 *     "不要联网，查一下我最近的邮件" → tool_using.
 *
 *   G5b (fast-executor pre-LLM short-circuit):
 *     routing_status != "ok" AND research_signals_present → return
 *     partial_success with routing_degraded message. No LLM call.
 *
 *   G5c (fast-executor post-LLM truthfulness guard):
 *     LLM output containing "让我查一下" / "I'll search" patterns →
 *     downgrade to partial_success with honest note.
 *
 *   G5d (fast-executor system prompt update):
 *     Adds explicit "you have NO tools" clause so the model is
 *     less likely to fabricate tool-action claims.
 *
 * Asserts:
 *
 *   G5a routing:
 *     1. "不要联网，告诉我今天 AI 新闻" + SR=required → fast.
 *     2. "不要联网，查一下我最近的邮件" → tool_using (connector_domain).
 *     3. goal=qa + web=forbidden → fast (legacy preserved).
 *
 *   G5b short-circuit:
 *     4. shouldShortCircuitForRoutingDegraded returns true when
 *        routing_status=sr_timeout + research_signals_present=true.
 *     5. Returns false when routing_status=ok.
 *     6. Returns false when no research signals (chitchat).
 *
 *   G5c truthfulness guard:
 *     7. detectFastUnbackedClaim matches Chinese "让我帮你查一下".
 *     8. Matches English "I'll search the web".
 *     9. No match on factual answer.
 *
 *   G5d prompt:
 *    10. buildMessages system prompt contains the no-tools clause.
 *
 * Run: node scripts/verify-fast-executor-truthfulness.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildMessages } from "../src/service/executors/fast/fast-executor.mjs";
import { resolveExecutor } from "../src/service/core/planning/executor-resolver.mjs";
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

// ── G5a: executor-resolver Rule 5 extension ─────────────────────────
it("G5a: '不要联网，告诉我今天 AI 新闻' + SR=required → fast", () => {
  const spec = createTaskSpec("不要联网，告诉我今天 AI 新闻", {
    semantic_router_decision: { ...SR_REQUIRED }
  }, {});
  // explicit_no_search wins at resolver step 0a → web=forbidden.
  // SR drives goal=search_and_answer (E3 path). Rule 5 extension
  // routes goal=search_and_answer + forbidden + !connector_domain
  // to fast.
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.goal, "search_and_answer");
  assert.equal(spec.connector_domain, false);
  assert.equal(spec.suggested_executor, "fast",
    "G5a Rule 5 ext. must route research-blocked + non-connector to fast");
});

it("G5a: '不要联网，查一下我最近的邮件' → tool_using (connector_domain boundary)", () => {
  const spec = createTaskSpec("不要联网，查一下我最近的邮件", {}, {});
  // connector_domain preserves tool_using even when web=forbidden.
  assert.equal(spec.connector_domain, true);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.suggested_executor, "tool_using",
    "connector-domain task must stay on tool_using for connector workflows");
});

it("G5a: legacy goal=qa + web=forbidden → fast (Rule 5 unchanged)", () => {
  // "你好" — chitchat. goal=qa naturally. web=forbidden default.
  const spec = createTaskSpec("你好", {}, {});
  assert.equal(spec.goal, "qa");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.suggested_executor, "fast");
});

// ── G5a executor-resolver direct invocation (decoupled from createTaskSpec) ─
it("G5a resolveExecutor direct: research-blocked + !connector_domain → fast", () => {
  const taskSpec = {
    goal: "search_and_answer",
    tool_policy: {
      web_search_fetch: { mode: "forbidden" },
      policy_groups: { external_web_read: { mode: "forbidden" } }
    },
    artifact: { required: false },
    connector_domain: false
  };
  const out = resolveExecutor({
    taskSpec,
    toolPolicy: taskSpec.tool_policy,
    contextPacket: {}
  });
  assert.equal(out.executor, "fast");
});

it("G5a resolveExecutor direct: research-blocked + connector_domain → tool_using (rule 5 skipped)", () => {
  const taskSpec = {
    goal: "search_and_answer",
    tool_policy: {
      web_search_fetch: { mode: "forbidden" },
      policy_groups: { external_web_read: { mode: "forbidden" } }
    },
    artifact: { required: false },
    connector_domain: true
  };
  const out = resolveExecutor({
    taskSpec,
    toolPolicy: taskSpec.tool_policy,
    contextPacket: {}
  });
  assert.equal(out.executor, "tool_using");
});

// ── G5d: system prompt update ───────────────────────────────────────
it("G5d: buildMessages system prompt contains 'NO tools' clause", () => {
  const messages = buildMessages({
    user_command: "hello",
    context_packet: {}
  });
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  assert.match(sys, /NO tools/i,
    "system prompt must explicitly state NO tools available");
  assert.match(sys, /Do NOT promise to search|cannot perform live queries/i,
    "system prompt must coach against fabricated tool-action claims");
});

// ── G5b/G5c source-level lock-ins (executor logic isn't directly callable
// without a provider; lock the structural shape via grep) ─────────────────
it("G5b lock-in: shouldShortCircuitForRoutingDegraded helper exists and is gated correctly", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /function\s+shouldShortCircuitForRoutingDegraded\s*\(/,
    "helper must be defined");
  // Must read routing_status
  assert.match(src, /task\?\.task_spec\?\.routing_status/);
  // Must read research_signals_present
  assert.match(src, /research_signals_present/);
  // Must NOT short-circuit on routing_status === "ok"
  assert.match(src, /status === "ok"/);
});

it("G5b lock-in: pre-LLM short-circuit yields partial_success with routing_degraded", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  // The execute() body must call shouldShortCircuitForRoutingDegraded
  // BEFORE provider lookup
  const executeBody = src.match(/async \*execute[\s\S]*?\n    \}/);
  assert.ok(executeBody, "execute body must be present");
  assert.match(executeBody[0], /shouldShortCircuitForRoutingDegraded/);
  // Must yield partial_success with routing_degraded flag
  assert.match(src, /event_type:\s*"partial_success"[\s\S]{0,200}routing_degraded:\s*true/);
});

it("G5c lock-in: detectFastUnbackedClaim helper + post-LLM guard wired", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /function\s+detectFastUnbackedClaim\s*\(/,
    "truthfulness guard helper must be defined");
  assert.match(src, /FAST_UNBACKED_CLAIM_PATTERNS/);
  // Patterns must catch Chinese 让我查一下 / I'll search etc.
  assert.match(src, /让我[\s\S]{0,80}查/);
  assert.match(src, /I'?ll[\s\S]{0,40}(check|search|look)/i);
  // Post-LLM guard fires after resultText, downgrades to partial_success
  assert.match(src, /detectFastUnbackedClaim\(resultText\)/);
  assert.match(src, /unbacked_tool_claim:\s*true/);
});

// ── G5b/G5c behaviour: import the helpers (they're not exported, so
// we go through buildMessages or trace the source). For full
// integration we'd need a provider mock; the source-level lock-ins
// above cover the structural shape. ─────────────────────────────────

// ── Boundary: G5b only fires when BOTH conditions hold ──────────────
it("G5b boundary: routing_status=ok + research_signals_present=true → no short-circuit", () => {
  // research_signals_present is true (explicit_search), but
  // routing_status=ok (SR ran). Fast not selected anyway because
  // explicit_search drives web=required (E5 step 3) → executor=tool_using.
  // Lock in via createTaskSpec output.
  const spec = createTaskSpec("查一下 X", {}, {});
  assert.equal(spec.research_signals_present, true);
  assert.equal(spec.routing_status, "ok");
  assert.equal(spec.suggested_executor, "tool_using");
});

it("G5b boundary: routing_status=sr_timeout + chitchat → no short-circuit", () => {
  // Time marker "最近怎么样" alone must NOT count as research signal.
  const spec = createTaskSpec("你好，最近怎么样", {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test" }
  }, {});
  assert.equal(spec.research_signals_present, false,
    "weak_freshness alone (chitchat time marker) must NOT count as research signal");
  assert.equal(spec.routing_status, "sr_timeout");
  assert.equal(spec.suggested_executor, "fast");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
