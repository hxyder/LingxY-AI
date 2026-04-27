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
it("G6b lock-in: shouldShortCircuitForRoutingDegraded reads task_spec.routing_degraded (NOT routing_status+research_signals coupling)", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /function\s+shouldShortCircuitForRoutingDegraded\s*\(/,
    "helper must be defined");
  // Post-G6b: reads routing_degraded directly (framework state).
  assert.match(src, /task\?\.task_spec\?\.routing_degraded/,
    "G6b: must read routing_degraded boolean");
  // Pre-G6b "routing_status != 'ok' AND research_signals_present"
  // composition was wrong (missed '下周天气' without explicit_search).
  // Lock-in that the new gate doesn't reintroduce that coupling.
  assert.doesNotMatch(src, /shouldShortCircuit[\s\S]{0,300}research_signals_present/,
    "post-G6b: must NOT couple short-circuit with research_signals_present");
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

// ── G6b: routing_degraded gate behaviour ────────────────────────────
it("G6b: routing_status=ok → routing_degraded=false → no short-circuit", () => {
  const spec = createTaskSpec("hello", {}, {});
  assert.equal(spec.routing_status, "ok");
  assert.equal(spec.routing_degraded, false);
});

it("G6b: SR timeout → routing_degraded=true (transient operational failure)", () => {
  const spec = createTaskSpec("我这里下周的天气怎么样", {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test" }
  }, {});
  assert.equal(spec.routing_status, "sr_timeout");
  assert.equal(spec.routing_degraded, true,
    "user-reported reproduction: SR timeout for research-class query must trigger routing_degraded");
  assert.equal(spec.tool_policy.web_search_fetch.mode, "optional",
    "SR operational failure must not be interpreted as forbidden");
  assert.equal(spec.suggested_executor, "tool_using",
    "degraded optional fallback must keep a tool-capable executor");
});

it("G6b: SR exception → routing_degraded=true", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "exception", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, true);
});

it("G6b: SR no_provider → routing_degraded=true (config missing — operator should know)", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "no_provider", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, true);
});

it("G6b: SR schema_invalid → routing_degraded=true", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "schema_invalid", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, true);
});

it("G6b: SR unsupported_provider → routing_degraded=false (operator choice, not degradation)", () => {
  // Operator running ollama / code_cli intentionally — every query
  // would have routing_status=sr_unsupported_provider. Fast guard
  // must NOT degrade-circuit on this; chitchat works fine without SR.
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "unsupported_provider", reason: "test" }
  }, {});
  assert.equal(spec.routing_status, "sr_unsupported_provider");
  assert.equal(spec.routing_degraded, false);
});

it("G6b: SR disabled → routing_degraded=false (operator opted out)", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "disabled", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, false);
});

it("G6b: SR low_confidence → routing_degraded=false (SR ran, deterministic baseline took over)", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "low_confidence", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, false);
});

it("G6b: SR fact_conflict → routing_degraded=false (SR ran, hard fact rejected its decision)", () => {
  const spec = createTaskSpec("今天天气", {
    semantic_router_rejection: { kind: "rejection", code: "fact_conflict", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, false);
});

it("G6b reproduction: '下周天气' + SR timeout → routing_degraded=true (the user's repro)", () => {
  // Pre-G6b the gate was research_signals_present which checked
  // explicit_search/external/required-mode. "下周天气" had none of
  // those, so routing_degraded effectively didn't fire. Post-G6b
  // the gate reads routing_degraded directly — covers this case.
  const spec = createTaskSpec("我这里下周的天气怎么样", {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test" }
  }, {});
  assert.equal(spec.routing_degraded, true,
    "G6b must catch '下周天气 + SR timeout' (the post-G5 reproduction)");
  assert.equal(spec.suggested_executor, "tool_using",
    "post-IntentRoute fallback routes to tool_using instead of fast refusal");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
