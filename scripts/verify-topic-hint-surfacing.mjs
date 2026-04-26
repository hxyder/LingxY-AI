#!/usr/bin/env node
/**
 * UCA-077 P4-RQ E3 stage C3: lock-in that topic_hint surfaces
 * correctly into SR prompt + cache key + decision trace evidence,
 * even though it no longer drives deterministic routing.
 *
 * Why: C1 demoted topic_hint to observability-only at the
 * deterministic layer. The signal must STILL flow through to the
 * LLM router (so SR can use it as input) and to the audit /
 * inspect-routing surfaces (so operators can see "system noticed
 * a topical query, here's what SR did with it").
 *
 * Asserts:
 *   1. summariseSignals (used in SR user-message) includes
 *      topic_hint when matched, with strength + kind + hint.
 *   2. summariseSignalsForCache (used in cache key) includes
 *      topic_hint shape.
 *   3. createTaskSpec → DecisionTrace GOAL_CLASSIFICATION evidence
 *      lists topic_hint when matched.
 *   4. SR system prompt is NOT topic-specific — it teaches by
 *      enum semantics, not by listing topic_hint by name.
 *      (Lock-in for the user's "stop adding topic regex"
 *      directive: instruction text must stay generic.)
 *   5. SIGNAL_NAMES public surface still contains topic_hint.
 *
 * Run: node scripts/verify-topic-hint-surfacing.mjs
 */

import assert from "node:assert/strict";

import { extractAllSignals, SIGNAL_NAMES } from "../src/service/core/intent/signals/index.mjs";
import { detect as detectTopicHint } from "../src/service/core/intent/signals/topic-hint.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import {
  createSemanticRouter,
  SEMANTIC_DECISION_TOOL
} from "../src/service/core/intent/semantic-router.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { process.stdout.write(`PASS  ${label}\n`); pass += 1; })
    .catch((err) => {
      process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
      fail += 1;
    });
}

async function run() {
  // ── 1. SIGNAL_NAMES surface ─────────────────────────────────────────
  await it("public surface: SIGNAL_NAMES contains 'topic_hint'", () => {
    assert.ok([...SIGNAL_NAMES].includes("topic_hint"));
  });

  // ── 2. detector still fires ─────────────────────────────────────────
  await it("detector: topic_hint fires on weather / news / stock topical queries", () => {
    for (const text of ["今天北京的天气", "今天 AI 新闻", "查一下 AVIS 暴涨", "current weather"]) {
      const s = detectTopicHint(text, {});
      assert.equal(s.matched, true, `expected match for "${text}"`);
      assert.equal(s.kind, "hint");
      assert.equal(s.strength, "strong");
    }
  });

  // ── 3. SR user-message embeds topic_hint via summariseSignals ───────
  await it("SR prompt: topic_hint appears in the user-message signal bundle", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return {
          tool_calls: [{
            name: SEMANTIC_DECISION_TOOL.name,
            arguments: {
              source_scope: "external_world", web_policy: "required",
              output_kind: "conversation", artifact_required: false,
              executor: "tool_using", research_depth: "multi_source",
              confidence: 0.85, reason: "test"
            }
          }]
        };
      }
    };
    const router = createSemanticRouter({ adapter: probeAdapter });
    const text = "今天北京的天气怎么样";
    const { signals } = extractAllSignals(text, {});
    await router.resolveSemanticDecision({ text, contextPacket: {}, signals });
    const userMsg = captured.messages.find((m) => m.role === "user").content;
    assert.match(userMsg, /topic_hint/,
      `SR user message must surface topic_hint; got: ${userMsg.slice(0, 200)}`);
    assert.match(userMsg, /"strength":\s*"strong"/);
    assert.match(userMsg, /"kind":\s*"hint"/);
  });

  // ── 4. SR system prompt stays generic (no topic listing) ────────────
  await it("SR prompt: system message does NOT enumerate topic_hint names by topic", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return {
          tool_calls: [{
            name: SEMANTIC_DECISION_TOOL.name,
            arguments: {
              source_scope: "external_world", web_policy: "required",
              output_kind: "conversation", artifact_required: false,
              executor: "tool_using", research_depth: "multi_source",
              confidence: 0.85, reason: "test"
            }
          }]
        };
      }
    };
    const router = createSemanticRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({ text: "今天北京的天气怎么样", contextPacket: {} });
    const sysMsg = captured.messages.find((m) => m.role === "system").content;
    // The system prompt is allowed to MENTION topic_hint as a signal
    // name in the abstract, but it must NOT teach the LLM to escalate
    // based on specific topic words. The user's directive: instruction
    // text stays generic; topic-specific judgement happens in the LLM.
    assert.doesNotMatch(sysMsg, /weather.*stock.*flight.*news/i,
      "system prompt must not enumerate topical entities — that re-introduces the topic-regex anti-pattern at the prompt layer");
  });

  // ── 5. Decision trace surfaces topic_hint evidence ──────────────────
  await it("DecisionTrace GOAL_CLASSIFICATION: topic_hint evidence appears when signal fires", () => {
    // Stub SR so the goal-classification stage can record evidence
    // alongside a non-trivial routing path. The GOAL_CLASSIFICATION
    // stage is recorded BEFORE policy resolution, so the evidence
    // collection happens regardless of whether C1 took the
    // deterministic-required path.
    const spec = createTaskSpec("今天北京的天气怎么样", {
      semantic_router_decision: {
        source_scope: "external_world", web_policy: "required",
        output_kind: "conversation", artifact_required: false,
        executor: "tool_using", research_depth: "single_lookup",
        confidence: 0.9, reason: "weather lookup"
      }
    }, {});
    const goalStage = spec.decision_trace.find((e) => e.stage === "goal-classification");
    assert.ok(goalStage, "goal-classification stage must exist on the trace");
    const evidenceSources = (goalStage.evidence ?? []).map((e) => e.source);
    assert.ok(evidenceSources.includes("topic_hint"),
      `goal-classification evidence must include topic_hint; got sources=${evidenceSources.join(", ")}`);
  });

  // ── 6. Cache shape includes topic_hint ──────────────────────────────
  await it("SR cache: topic_hint shape differentiates cached entries", async () => {
    // Two queries, identical text+ctx, different signal payload — one
    // with topic_hint matched, one without. They must hash to
    // different cache keys (verified by adapter being called twice).
    let calls = 0;
    const adapter = {
      async generate() {
        calls += 1;
        return {
          tool_calls: [{
            name: SEMANTIC_DECISION_TOOL.name,
            arguments: {
              source_scope: "external_world", web_policy: "required",
              output_kind: "conversation", artifact_required: false,
              executor: "tool_using", research_depth: "multi_source",
              confidence: 0.85, reason: "test"
            }
          }]
        };
      }
    };
    const router = createSemanticRouter({ adapter });
    await router.resolveSemanticDecision({
      text: "today's outlook", contextPacket: {}, signals: {}
    });
    await router.resolveSemanticDecision({
      text: "today's outlook", contextPacket: {},
      signals: { topic_hint: { matched: true, strength: "strong", kind: "hint", evidence: [], hint: { favors_external: true } } }
    });
    assert.equal(calls, 2,
      "topic_hint shape must differentiate cache entries");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
