#!/usr/bin/env node
/**
 * UCA-077 P4-RQ §19 #5 / F1-F4: goal classifier migrated off
 * topic_hint, onto explicit_external + semantic_router.
 *
 * Pre-F2 contract: `requiresSignal` for goal=search_and_answer
 * was `explicit_external || topic_hint`. Topical queries (news /
 * weather / stock / etc.) without SR consultation routed to
 * search_and_answer because topic_hint regex matched.
 *
 * Post-F2 contract: `requiresSignal` is
 *   explicit_external (kept-as-regex structural hard signal)
 *   OR semantic_router (synthetic, wraps SR's structured judgement,
 *      hint.web_policy != "forbidden")
 *
 * topic_hint is REMOVED from the goal classifier (still observability
 * in collectGoalEvidence). Result: when SR is unavailable, topical
 * queries route to goal=qa (conservative fallback consistent with
 * E3-C1's "no SR = forbidden web" principle); the executor-resolver
 * Rule 5 then picks `fast` for the cheapest "I can't reach the web"
 * reply.
 *
 * Asserts:
 *   1. semantic_router synthetic signal fires on stamped decisions
 *      with valid web_policy; doesn't fire when absent / malformed.
 *   2. SIGNAL_NAMES public surface includes "semantic_router".
 *   3. With SR (web=required) → goal=search_and_answer.
 *   4. With SR (web=forbidden) → goal=qa (search_and_answer not
 *      escalated by SR's forbidden judgement).
 *   5. Without SR + topical query → goal=qa (the conservative
 *      fallback the migration intentionally produces).
 *   6. Without SR + explicit_external (网上) → goal=search_and_answer
 *      (legacy path preserved — kept-as-regex structural signal).
 *   7. End-to-end shape: news without SR routes to qa+forbidden+fast;
 *      news with SR-required routes to search_and_answer+required+
 *      tool_using.
 *   8. topic_hint signal still fires in the bundle for SR consumption
 *      and observability (NOT removed from the detector — only from
 *      the classifier's decision logic).
 *
 * Run: node scripts/verify-goal-classification-migration.mjs
 */

import assert from "node:assert/strict";

import {
  detect as detectSemanticRouter,
  SEMANTIC_ROUTER_SIGNAL_NAME
} from "../src/service/core/intent/signals/semantic-router.mjs";
import { SIGNAL_NAMES, extractAllSignals } from "../src/service/core/intent/signals/index.mjs";
import { createTaskSpec, classifyGoal } from "../src/service/core/task-spec.mjs";

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

function srStub({ web_policy = "required", confidence = 0.85, research_depth = "multi_source" } = {}) {
  return {
    source_scope: "external_world",
    web_policy,
    output_kind: "conversation",
    artifact_required: false,
    executor: "tool_using",
    research_depth,
    confidence,
    reason: "test stub"
  };
}

// ── 1. semantic_router signal detector ───────────────────────────────
it("signal: SEMANTIC_ROUTER_SIGNAL_NAME exported as 'semantic_router'", () => {
  assert.equal(SEMANTIC_ROUTER_SIGNAL_NAME, "semantic_router");
});
it("signal: SIGNAL_NAMES includes 'semantic_router'", () => {
  assert.ok([...SIGNAL_NAMES].includes("semantic_router"));
});
it("signal: detector matches when valid SR decision is stamped", () => {
  const sig = detectSemanticRouter("anything", {
    semantic_router_decision: srStub({ web_policy: "required", confidence: 0.9 })
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.kind, "hint");
  assert.equal(sig.strength, "strong");
  assert.equal(sig.hint?.web_policy, "required");
  assert.equal(sig.hint?.confidence, 0.9);
});
it("signal: detector returns weak strength on confidence < 0.7", () => {
  const sig = detectSemanticRouter("anything", {
    semantic_router_decision: srStub({ confidence: 0.5 })
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.strength, "weak");
});
it("signal: detector unmatched when no decision stamped", () => {
  assert.equal(detectSemanticRouter("anything", {}).matched, false);
  assert.equal(detectSemanticRouter("anything", { semantic_router_decision: null }).matched, false);
});
it("signal: detector unmatched on malformed decision (web_policy out of enum)", () => {
  const sig = detectSemanticRouter("anything", {
    semantic_router_decision: { ...srStub(), web_policy: "wat" }
  });
  assert.equal(sig.matched, false);
});

// ── 2. Goal classifier ───────────────────────────────────────────────
it("goal: SR web=required + topical patterns → search_and_answer", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srStub({ web_policy: "required" }) };
  const { signals } = extractAllSignals(text, ctx);
  assert.equal(classifyGoal(text, signals), "search_and_answer");
});
it("goal: SR web=forbidden + topical patterns → qa (SR's forbidden does NOT escalate)", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srStub({ web_policy: "forbidden" }) };
  const { signals } = extractAllSignals(text, ctx);
  assert.equal(classifyGoal(text, signals), "qa");
});
it("goal: SR web=optional + topical → search_and_answer (optional is research-class enough)", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srStub({ web_policy: "optional" }) };
  const { signals } = extractAllSignals(text, ctx);
  assert.equal(classifyGoal(text, signals), "search_and_answer");
});
it("goal: WITHOUT SR + topical query → qa (conservative fallback, no topic_hint dependency)", () => {
  // Pre-F2: this returned search_and_answer because topic_hint
  // matched. Post-F2: topic_hint removed from the gate; result is
  // qa unless explicit_external also fires.
  const text = "今天北京的天气";
  const { signals } = extractAllSignals(text, {});
  assert.equal(signals.topic_hint?.matched, true,
    "sanity: topic_hint detector still fires (kept for SR / observability)");
  assert.equal(classifyGoal(text, signals), "qa",
    "topic_hint match alone must NOT drive search_and_answer post-F2");
});
it("goal: WITHOUT SR + explicit_external + search_and_answer pattern match → search_and_answer", () => {
  // The classifyGoal rule first checks `patterns`, then
  // `requiresSignal`. Text must match BOTH for the rule to fire.
  // Using "新闻" so the topical pattern triggers + 网上 for
  // explicit_external. (Without a pattern match the rule never
  // reaches requiresSignal — that's a pre-existing constraint
  // unchanged by F2; documenting it here.)
  const text = "查一下网上最新的 AI 新闻";
  const { signals } = extractAllSignals(text, {});
  assert.equal(signals.explicit_external?.matched, true);
  assert.equal(classifyGoal(text, signals), "search_and_answer",
    "explicit_external (kept-as-regex) drives goal even without SR");
});

// ── 3. End-to-end task-spec routing shape ────────────────────────────
it("e2e: news WITHOUT SR → goal=qa + web=forbidden + executor=fast (conservative fallback)", () => {
  const spec = createTaskSpec("今天有什么 AI 新闻", {}, {});
  assert.equal(spec.goal, "qa");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.suggested_executor, "fast");
});
it("e2e: news WITH SR (web=required) → goal=search_and_answer + web=required + executor=tool_using", () => {
  const spec = createTaskSpec("今天有什么 AI 新闻", {
    semantic_router_decision: srStub({ web_policy: "required" })
  }, {});
  assert.equal(spec.goal, "search_and_answer");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.equal(spec.suggested_executor, "tool_using");
});
it("e2e: scheduler-fired '每天汇报 AI 新闻' WITHOUT SR → conservative fallback", () => {
  const spec = createTaskSpec("每天早上汇报 AI 新闻", {
    source_app: "uca.scheduler",
    text: "每天早上汇报 AI 新闻"
  }, {});
  assert.equal(spec.goal, "qa", "no scheduler特判: scheduler-fired path same as user-typed");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
});
it("e2e: scheduler-fired '每天汇报 AI 新闻' WITH SR → multi-source research class", () => {
  const spec = createTaskSpec("每天早上汇报 AI 新闻", {
    source_app: "uca.scheduler",
    text: "每天早上汇报 AI 新闻",
    semantic_router_decision: srStub({ web_policy: "required", research_depth: "multi_source" })
  }, {});
  assert.equal(spec.goal, "search_and_answer");
  assert.equal(spec.research_quality?.profile, "multi_source_research");
});

// ── 4. topic_hint detector still functional (no detector removal) ───
it("topic_hint: detector still fires for SR / observability consumption", () => {
  // F2 only removed topic_hint from the goal classifier's
  // requiresSignal. The detector is kept; SR sees it in the signal
  // bundle as input, decision-trace surfaces it as evidence, etc.
  const text = "今天北京的天气";
  const { signals } = extractAllSignals(text, {});
  assert.equal(signals.topic_hint?.matched, true);
  assert.equal(signals.topic_hint?.kind, "hint");
});

// ── 5. Decision trace evidence still includes topic_hint when matched ─
it("evidence: trace's GOAL_CLASSIFICATION evidence carries topic_hint AND semantic_router when both fire", () => {
  const spec = createTaskSpec("今天有什么 AI 新闻", {
    semantic_router_decision: srStub({ web_policy: "required" })
  }, {});
  const goalStage = spec.decision_trace?.find((e) => e.stage === "goal-classification");
  assert.ok(goalStage, "goal-classification stage must exist");
  const sources = (goalStage.evidence ?? []).map((e) => e.source);
  assert.ok(sources.includes("topic_hint"),
    `topic_hint observability evidence missing; got ${sources.join(", ")}`);
  assert.ok(sources.includes("semantic_router"),
    `semantic_router evidence missing; got ${sources.join(", ")}`);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
