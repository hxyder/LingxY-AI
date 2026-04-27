#!/usr/bin/env node
/**
 * UCA-077 P4-RQ smoke test — end-to-end regression net for the
 * user-facing reproductions that drove the H/I/J/K rounds.
 *
 * Each scenario exercises the framework as close to the real
 * submission path as possible without spinning up the runtime
 * scaffold. The point is NOT to replace the per-module unit
 * verifiers — those still own correctness for individual layers.
 * This file is the second line of defense: when a future commit
 * accidentally cuts a wire between layers, one of these
 * scenarios fails and points at the broken seam.
 *
 * Reproductions (per user direction in the C-track plan):
 *   1. "今天有什么 AI 新闻"
 *      → goal=search_and_answer, web=required, research_quality
 *        =multi_source_research (3/2). Single-source transcript
 *        must FAIL the contract; 3-domain transcript must PASS.
 *
 *   2. "深入调研 ..." with SR research_depth=deep_research
 *      → research_quality.profile=deep_research (5/3). 3-domain
 *        transcript must FAIL with insufficient_sources +
 *        single_domain_only; 5-source / 3-domain transcript must PASS.
 *
 *   3. "不要联网，告诉我今天 AI 新闻"
 *      → web=forbidden, executor=fast (Rule 5 ext.), routing_degraded
 *        stays false even when SR is unavailable (I1 hard-fact skip).
 *        SuccessContract has no required_policy_groups so any
 *        completion satisfies — the model's job is to refuse
 *        honestly, not to research.
 *
 *   4. "今天天气怎么样"
 *      With SR decision (web=required, multi_source) → search_and_answer
 *        + required + tool_using executor.
 *      Without SR (no provider) → conservative forbidden + fast (the
 *        post-E3 conservative fallback).
 *
 *   5. Follow-up "罗利" with the same conversation_id as a prior
 *      weather-offer task → createTaskRecord auto-resolves
 *      parent_task_id, parent_task_summary attached for
 *      pending-offer detection (K4 + K6 wiring).
 *
 *   6. "打开word" → tryFastPath returns null (architectural
 *      decision per I2), extractFirstTier0Action returns null,
 *      classifyGoal still recognises launch_and_act on the
 *      planner side, createTaskSpec produces no docx artifact.
 *
 *   7. Local selection summary ("总结一下" + ctx.text passage)
 *      → web=forbidden via source_scope=fact+local, research_quality
 *        is null. The user's local content is not hijacked into a
 *        multi-source research task even though the topic might
 *        otherwise look researchy.
 *
 *      URL summary ("总结这个 URL: https://...") → explicit_single_url
 *        + inline URL → web=required + research_quality=single_lookup
 *        (1/1/digest_ok). One-source transcript satisfies.
 *
 * Run: node scripts/verify-p4rq-smoke.mjs
 */

import assert from "node:assert/strict";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { classifyGoal } from "../src/service/core/task-spec.mjs";
import { validateSuccessContract } from "../src/service/core/policy/success-contract-validator.mjs";
import {
  tryFastPath,
  extractFirstTier0Action
} from "../src/service/core/router/fast-path-router.mjs";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";

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

/** Build a transcript entry in the validator-shape (type:"tool_result"). */
function tr({ tool = "web_search_fetch", success = true, observation = "Found articles covering the topic in multiple publishers' analyses.", urls = [] } = {}) {
  return {
    type: "tool_result",
    tool,
    success,
    observation,
    metadata: {
      tool_id: tool,
      results: urls.map((u, i) => ({ url: u, title: `Article ${i + 1}` }))
    }
  };
}

/** Stub SR decision payload. Stamped on contextPacket.semantic_router_decision. */
function srDecision({
  source_scope = "external_world",
  web_policy = "required",
  output_kind = "conversation",
  artifact_required = false,
  executor = "tool_using",
  research_depth = "multi_source",
  confidence = 0.85,
  reason = "test fixture"
} = {}) {
  return {
    source_scope, web_policy, output_kind, artifact_required,
    executor, research_depth, confidence, reason
  };
}

// ── Scenario 1 — research-class news query ─────────────────────────
it("S1 [今日 AI 新闻]: createTaskSpec → search_and_answer + web=required + multi_source", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "multi_source" }) };
  const spec = createTaskSpec(text, ctx);
  assert.equal(spec.goal, "search_and_answer", `goal: ${spec.goal}`);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.equal(spec.research_quality?.profile, "multi_source_research");
  assert.equal(spec.research_quality?.min_sources, 3);
  assert.equal(spec.research_quality?.min_distinct_domains, 2);
  assert.ok(["tool_using", "agentic"].includes(spec.suggested_executor),
    `executor must route to a tool-capable path; got ${spec.suggested_executor}`);
  assert.ok(Array.isArray(spec.success_contract?.required_policy_groups)
    && spec.success_contract.required_policy_groups.includes("external_web_read"),
    "external_web_read must be in required_policy_groups");
});

it("S1 [今日 AI 新闻]: single-source ScienceNet roundup transcript → SuccessContract REJECTS", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "multi_source" }) };
  const spec = createTaskSpec(text, ctx);
  // Reproduce the production failure: a single ScienceNet weekly-review.
  const transcript = [
    tr({
      observation: "ScienceNet's weekly review aggregates eight internal AI articles in depth here.",
      urls: ["https://paper.sciencenet.cn/htmlnews/weekly-review-563765.shtm"]
    })
  ];
  const { satisfied, violations } = validateSuccessContract(spec, transcript);
  assert.equal(satisfied, false,
    "single-source roundup must NOT satisfy multi_source_research");
  const kinds = violations.map((v) => v.kind);
  // EITHER single_roundup_only (D2 detected the roundup markers) OR
  // single_domain_only (just one domain). insufficient_sources is also
  // expected since 1 < 3.
  assert.ok(
    kinds.includes("external_web_read_single_roundup_only")
    || kinds.includes("external_web_read_single_domain_only"),
    `must flag single_roundup_only OR single_domain_only; got ${JSON.stringify(kinds)}`
  );
  assert.ok(kinds.includes("external_web_read_insufficient_sources"),
    `must flag insufficient_sources; got ${JSON.stringify(kinds)}`);
});

it("S1 [今日 AI 新闻]: 3-source / 3-domain transcript → SuccessContract PASSES", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "multi_source" }) };
  const spec = createTaskSpec(text, ctx);
  const transcript = [
    tr({
      observation: "Today's AI news covered across multiple major outlets in detail.",
      urls: [
        "https://nytimes.com/ai-news-a",
        "https://reuters.com/ai-news-b",
        "https://bbc.co.uk/ai-news-c"
      ]
    })
  ];
  const { satisfied, violations } = validateSuccessContract(spec, transcript);
  assert.equal(satisfied, true,
    `3 sources / 3 domains must satisfy multi_source_research; violations=${JSON.stringify(violations)}`);
});

// ── Scenario 2 — deep_research (K3) ────────────────────────────────
it("S2 [深入调研]: SR research_depth=deep_research → research_quality profile=deep_research, 5/3 thresholds", () => {
  const text = "深入调研 AI 安全治理领域的主要研究方向";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "deep_research" }) };
  const spec = createTaskSpec(text, ctx);
  assert.equal(spec.research_quality?.profile, "deep_research",
    `profile: ${spec.research_quality?.profile}`);
  assert.equal(spec.research_quality?.min_sources, 5);
  assert.equal(spec.research_quality?.min_distinct_domains, 3);
  assert.equal(spec.research_quality?.single_source_digest_satisfies, false);
});

it("S2 [深入调研]: 3 sources / 2 domains → REJECTED (would satisfy multi_source but not deep_research)", () => {
  const text = "深入调研一下 AI 治理";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "deep_research" }) };
  const spec = createTaskSpec(text, ctx);
  const transcript = [
    tr({
      observation: "Three articles found across two major publishers in the AI policy space.",
      urls: [
        "https://nytimes.com/a",
        "https://nytimes.com/b",
        "https://reuters.com/c"
      ]
    })
  ];
  const { satisfied, violations } = validateSuccessContract(spec, transcript);
  assert.equal(satisfied, false);
  const kinds = violations.map((v) => v.kind);
  assert.ok(kinds.includes("external_web_read_insufficient_sources"));
  assert.ok(kinds.includes("external_web_read_single_domain_only"));
  // Violation message must reference the active profile (K3 made labels dynamic)
  const msg = violations.find((v) => v.kind === "external_web_read_insufficient_sources").message;
  assert.match(msg, /deep_research/,
    "violation message must reference deep_research, not multi_source_research");
});

it("S2 [深入调研]: 5 sources / 3 domains → SATISFIED", () => {
  const text = "全面对比一下当前的 AI 治理方案";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "deep_research" }) };
  const spec = createTaskSpec(text, ctx);
  const transcript = [
    tr({
      observation: "Five articles from three publishers covering AI governance comprehensively.",
      urls: [
        "https://nytimes.com/a",
        "https://nytimes.com/b",
        "https://reuters.com/c",
        "https://reuters.com/d",
        "https://bbc.co.uk/e"
      ]
    })
  ];
  const { satisfied, violations } = validateSuccessContract(spec, transcript);
  assert.equal(satisfied, true,
    `5 sources / 3 domains must satisfy deep_research; violations=${JSON.stringify(violations)}`);
});

// ── Scenario 3 — explicit no-search ────────────────────────────────
it("S3 [不要联网]: explicit_no_search beats every signal → web=forbidden + executor=fast", () => {
  const text = "不要联网，告诉我今天 AI 新闻";
  // No SR decision stamped — I1 hard-fact skip means SR isn't consulted
  // for explicit_no_search anyway.
  const spec = createTaskSpec(text, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  // G5a Rule 5 extension: research-class + forbidden + !connector_domain → fast
  assert.equal(spec.suggested_executor, "fast",
    `executor: ${spec.suggested_executor}`);
  // I1 + G6b: SR was correctly skipped on the hard-fact signal, so
  // routing_status stays "ok" and routing_degraded stays false even
  // though no SR decision was stamped.
  assert.equal(spec.routing_status, "ok");
  assert.equal(spec.routing_degraded, false);
  // success_contract must NOT require external_web_read (we forbade it)
  const required = spec.success_contract?.required_policy_groups ?? [];
  assert.ok(!required.includes("external_web_read"),
    `forbidden web must not put external_web_read in required_policy_groups; got ${JSON.stringify(required)}`);
});

it("S3 [不要联网]: research_quality is null when web=forbidden", () => {
  const text = "不要联网，告诉我今天 AI 新闻";
  const spec = createTaskSpec(text, {});
  assert.equal(spec.research_quality, null,
    "research_quality must be null when web is forbidden");
});

// ── Scenario 4 — weather query (with and without SR) ───────────────
it("S4 [今天天气怎么样] + SR: web=required, multi_source, executor=tool_using or agentic", () => {
  const text = "今天天气怎么样";
  const ctx = { semantic_router_decision: srDecision({ web_policy: "required", research_depth: "multi_source" }) };
  const spec = createTaskSpec(text, ctx);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.ok(["tool_using", "agentic"].includes(spec.suggested_executor),
    `executor must route to a tool-capable path; got ${spec.suggested_executor}`);
});

it("S4 [今天天气怎么样] without SR: conservative fallback → web=forbidden + executor=fast", () => {
  // Post-E3-stage-C1: topic_hint no longer drives required deterministically.
  // Without an SR decision, the resolver falls back to forbidden, and Rule 5
  // ext. routes the task to fast for an honest "I cannot do that without
  // a live lookup" reply.
  const text = "今天天气怎么样";
  const spec = createTaskSpec(text, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden",
    "without SR, conservative fallback is forbidden");
  // executor depends on the goal classification; with no goal-pattern
  // match and no SR, classifyGoal returns qa, and Rule 5 → fast.
  assert.equal(spec.suggested_executor, "fast");
});

it("S4b [天气怎么样] + SR timeout: degraded optional fallback → tool_using", () => {
  const text = "天气怎么样";
  const spec = createTaskSpec(text, {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "simulated timeout" }
  });
  assert.equal(spec.routing_status, "sr_timeout");
  assert.equal(spec.routing_degraded, true);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional",
    "SR timeout is operational degradation, not web=forbidden");
  assert.equal(spec.suggested_executor, "tool_using",
    "degraded optional fallback must keep the task on a tool-capable executor");
  assert.ok(!spec.success_contract?.required_policy_groups?.includes("external_web_read"),
    "optional fallback must not force SuccessContract web coverage");
});

it("S4b [国际新闻] + SR timeout: degraded optional fallback → tool_using", () => {
  const text = "国际新闻";
  const spec = createTaskSpec(text, {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "simulated timeout" }
  });
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional");
  assert.equal(spec.suggested_executor, "tool_using");
});

// ── Scenario 5 — follow-up auto-parent via conversation_id ─────────
it("S5 [罗利 follow-up]: createTaskRecord auto-resolves parent + attaches parent_task_summary", () => {
  // Pre-populate a runtime-ish store with a prior weather-offer task.
  const earlier = {
    task_id: "task_weather",
    created_at: "2026-04-26T10:00:00Z",
    conversation_id: "conv_session_1",
    result_summary: "Current location is unclear. Want me to check the weather for Raleigh, NC, or did you mean somewhere else?"
  };
  const tasks = [earlier];
  const store = {
    listTasks: () => tasks.slice(),
    getTask: (id) => tasks.find((t) => t.task_id === id) ?? null
  };

  const followUp = createTaskRecord({
    route: { intent: "qa", executor: "fast", requires_confirmation: false },
    contextPacket: {},
    userCommand: "罗利",
    conversationId: "conv_session_1",
    runtime: { store }
  });

  // K4: parent auto-resolved from conversation_id
  assert.equal(followUp.parent_task_id, "task_weather",
    "follow-up must inherit the prior task's id as parent");
  assert.equal(followUp.conversation_id, "conv_session_1");

  // G3b: parent_task_summary attached so pending-offer can read it
  assert.ok(followUp.context_packet?.parent_task_summary,
    "parent_task_summary must be attached on the auto-resolved parent");
  assert.equal(
    followUp.context_packet.parent_task_summary.parent_task_id,
    "task_weather"
  );
  assert.match(
    followUp.context_packet.parent_task_summary.assistant_final_text,
    /weather for Raleigh/
  );
});

// ── Scenario 6 — app launch is NOT a regex fast path (I2 lock-in) ──
it("S6 [打开word]: tryFastPath / extractFirstTier0Action both return null", () => {
  assert.equal(tryFastPath("打开word", {}), null,
    "app launch must NOT be a Tier-0 fast path (I2 architecture)");
  assert.equal(tryFastPath("打开 word", {}), null);
  assert.equal(tryFastPath("启动Excel", {}), null);
  assert.equal(extractFirstTier0Action("打开word"), null);
  assert.equal(extractFirstTier0Action("启动Excel"), null);
});

it("S6 [打开word]: planner-side classifyGoal still recognises launch_and_act", () => {
  assert.equal(classifyGoal("打开word"), "launch_and_act");
  assert.equal(classifyGoal("open VSCode"), "launch_and_act");
});

it("S6 [打开word]: createTaskSpec produces no docx artifact", () => {
  const spec = createTaskSpec("打开word", {});
  assert.equal(spec.goal, "launch_and_act");
  assert.equal(spec.artifact?.required, false);
  assert.equal(spec.artifact?.kind, null);
  assert.deepEqual(spec.suggested_formats, []);
});

it("S6 negative [生成 word 文档]: still routes to generate_document with docx artifact", () => {
  // Regression guard: I2's "no Tier-0 launch" decision must not break
  // legitimate document generation requests.
  const spec = createTaskSpec("帮我生成一份 word 文档", {});
  assert.equal(spec.goal, "generate_document");
  assert.equal(spec.artifact?.required, true);
  assert.equal(spec.artifact?.kind, "docx");
});

// ── Scenario 7 — local selection / single-URL not hijacked ────────
it("S7a [local selection summary]: real_selection anchor → web=forbidden, no research_quality", () => {
  const text = "总结一下";
  const ctx = {
    text: "Long passage of selected content the user wants summarised. Multiple paragraphs of detail describing some framework's architecture and principles in depth, far more than the userCommand itself."
  };
  const spec = createTaskSpec(text, ctx);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden",
    "local-anchor must forbid web (resolver step 2a)");
  assert.equal(spec.research_quality, null,
    "research_quality must be null when web is forbidden — local content is not research");
});

it("S7a [local selection summary]: I1 hard-fact skip → routing_degraded stays false even with no SR", () => {
  // The verify-scheduler regression I1 fixed.
  const text = "summarise this passage";
  const ctx = {
    text: "Long passage describing a framework architecture in considerable detail across multiple paragraphs."
  };
  const spec = createTaskSpec(text, ctx);
  assert.equal(spec.routing_status, "ok",
    "SR was correctly skipped on the hard-fact source_scope; no rejection stamped");
  assert.equal(spec.routing_degraded, false);
});

it("S7b [URL summary]: explicit_single_url + inline URL → web=required + research_quality=single_lookup", () => {
  const text = "总结这个 URL: https://example.com/article-on-ai-trends";
  const spec = createTaskSpec(text, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required",
    "explicit_single_url + inline URL must require web (resolver step 2b)");
  assert.equal(spec.research_quality?.profile, "single_lookup",
    `single-URL anchor must produce single_lookup profile; got ${spec.research_quality?.profile}`);
  assert.equal(spec.research_quality?.min_sources, 1);
  assert.equal(spec.research_quality?.min_distinct_domains, 1);
  assert.equal(spec.research_quality?.single_source_digest_satisfies, true);
});

it("S7b [URL summary]: 1-source transcript SATISFIES single_lookup", () => {
  const text = "总结这个 URL: https://example.com/article-on-ai-trends";
  const spec = createTaskSpec(text, {});
  // single_lookup profile means a single source is enough.
  const transcript = [
    tr({
      tool: "fetch_url_content",
      observation: "The article discusses AI trends in detail across multiple sections.",
      urls: ["https://example.com/article-on-ai-trends"]
    })
  ];
  // Note: extractEvidence reads metadata.url for fetch_url_content,
  // but our test helper puts urls in metadata.results. Switch the
  // shape for fetch_url_content.
  transcript[0].metadata = {
    tool_id: "fetch_url_content",
    url: "https://example.com/article-on-ai-trends"
  };
  const { satisfied, violations } = validateSuccessContract(spec, transcript);
  assert.equal(satisfied, true,
    `single-URL fetch must satisfy single_lookup; violations=${JSON.stringify(violations)}`);
});

// ── Cross-cutting: the framework is internally consistent ─────────
it("CROSS [research_quality matches required_policy_groups]: when web=required AND research-class, both fire", () => {
  const text = "今天有什么 AI 新闻";
  const ctx = { semantic_router_decision: srDecision({ research_depth: "multi_source" }) };
  const spec = createTaskSpec(text, ctx);
  // Invariant: if research_quality.profile is multi_source/deep, then
  // external_web_read MUST be in required_policy_groups (the validator
  // gates research_quality enforcement on this).
  if (spec.research_quality?.profile === "multi_source_research"
      || spec.research_quality?.profile === "deep_research") {
    const required = spec.success_contract?.required_policy_groups ?? [];
    assert.ok(required.includes("external_web_read"),
      `research-class profile must imply external_web_read in required_policy_groups; got ${JSON.stringify(required)}`);
  }
});

it("CROSS [hard-fact skip preserves outcome]: explicit_no_search resolves forbidden whether SR ran or not", () => {
  // Without SR
  const a = createTaskSpec("不要联网，告诉我 X", {});
  // With an SR decision present (which would be IGNORED by I1 hard-fact skip)
  const b = createTaskSpec("不要联网，告诉我 X", {
    semantic_router_decision: srDecision({ web_policy: "required" })
  });
  assert.equal(a.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(b.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden",
    "explicit_no_search must beat any SR suggestion");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
