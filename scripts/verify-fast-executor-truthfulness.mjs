#!/usr/bin/env node
/**
 * UCA-077 P4-RQ G5: fast-executor truthfulness + planner-first contract.
 *
 * Fast executor contract after the LLM-first cleanup:
 *
 *   G5a:
 *     goal=search_and_answer + web=forbidden + !connector_domain → tool_using.
 *     The planner treats forbidden web as a contract. It can answer from
 *     local knowledge or ask the user for permission; it must not be
 *     downgraded to a no-tool refusal path.
 *
 *   LLM-first:
 *     routing diagnostics never preempt the fast LLM call; streaming deltas
 *     are emitted for OpenAI-compatible providers.
 *
 *   G5d (fast-executor system prompt update):
 *     Adds explicit "you have NO tools" clause so the model is
 *     less likely to fabricate tool-action claims.
 *
 * Asserts:
 *
 *   G5a routing:
 *     1. "不要联网，告诉我今天 AI 新闻" + SR=required → tool_using.
 *     2. "不要联网，查一下我最近的邮件" → tool_using (connector_domain).
 *     3. very short chitchat + web=forbidden → tool_using.
 *
 *   G5d prompt:
 *     buildMessages system prompt contains the no-tools clause.
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

// ── G5a: executor-resolver planner-first contract ───────────────────
it("G5a: '不要联网，告诉我今天 AI 新闻' + SR=required → tool_using", () => {
  const spec = createTaskSpec("不要联网，告诉我今天 AI 新闻", {
    semantic_router_decision: { ...SR_REQUIRED }
  }, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.goal, "search_and_answer");
  assert.equal(spec.connector_domain, false);
  assert.equal(spec.suggested_executor, "tool_using",
    "forbidden web is a planner contract; the planner must answer locally or ask for permission");
});

it("G5a: '不要联网，查一下我最近的邮件' → tool_using (connector_domain boundary)", () => {
  const spec = createTaskSpec("不要联网，查一下我最近的邮件", {}, {});
  // connector_domain preserves tool_using even when web=forbidden.
  assert.equal(spec.connector_domain, true);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.suggested_executor, "tool_using",
    "connector-domain task must stay on tool_using for connector workflows");
});

it("G5a: very short chitchat + web=forbidden → tool_using", () => {
  // "你好" — chitchat. goal=qa naturally. web=forbidden default.
  const spec = createTaskSpec("你好", {}, {});
  assert.equal(spec.goal, "qa");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.suggested_executor, "tool_using");
});

// ── G5a executor-resolver direct invocation (decoupled from createTaskSpec) ─
it("G5a resolveExecutor direct: research-blocked + !connector_domain → tool_using", () => {
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
  assert.equal(out.executor, "tool_using");
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

// ── LLM-first source-level lock-ins ─────────────────────────────────
it("LLM-first: fast executor does not pre-LLM short-circuit on routing_degraded", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.equal(src.includes(["should", "Short", "Circuit", "For", "Routing", "Degraded"].join("")), false);
  assert.doesNotMatch(src, /routing_degraded:\s*true/);
  assert.doesNotMatch(src, /路由层暂不可用|routing degraded/);
});

it("LLM-first: fast executor emits OpenAI-compatible streaming deltas", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /stream:\s*typeof onTextDelta === "function"/);
  assert.match(src, /emitFastRuntimeEvent\(task,\s*"text_delta"/);
});

it("LLM-first: fast executor emits model-wait heartbeat without fabricating answer text", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /function startFastModelWaitHeartbeat/u);
  assert.match(src, /sub_status:\s*count > 0 \? "waiting_for_model_response" : "waiting_for_model_first_output"/u);
  assert.match(src, /eventType,\s*payload/u);
  assert.doesNotMatch(src, /waiting_for_model_first_output[\s\S]{0,200}inline_result/u,
    "heartbeat must be status/progress only, not a fake answer");
});

it("LLM-first: fast executor has no output-claim regex patch guard", () => {
  const src = readFileSync(
    new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url),
    "utf8"
  );
  assert.equal(src.includes(["FAST", "UNBACKED", "CLAIM", "PATTERNS"].join("_")), false);
  assert.equal(src.includes("detectFastUnbackedClaim"), false);
  assert.equal(src.includes("unbacked_tool_claim"), false);
});

// ── G5b/G5c behaviour: import the helpers (they're not exported, so
// we go through buildMessages or trace the source). For full
// integration we'd need a provider mock; the source-level lock-ins
// above cover the structural shape. ─────────────────────────────────

// ── G6b: routing_degraded gate behaviour ────────────────────────────
it("G6b: routing_status=ok → routing_degraded=false → no short-circuit", () => {
  const spec = createTaskSpec("你好", {}, {});
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
    "structural freshness signal keeps current-info follow-up on a tool-capable planner");
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
    "structural freshness signal, not routing_degraded itself, keeps this on tool_using");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
