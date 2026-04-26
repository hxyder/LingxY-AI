#!/usr/bin/env node
/**
 * UCA-077 P4-RQ D1: TaskSpec.research_quality field + inferResearchQuality.
 *
 * Asserts the deterministic inference layer that drives the
 * success-contract / phase-gate enforcement landing in D3:
 *
 *   1. multi_source_research is the default for web-allowed tasks
 *      with no local anchor, with thresholds 3 / 2 /
 *      single_source_digest_satisfies=false.
 *   2. single_lookup fires for local anchors (real_selection /
 *      file_text), with thresholds 1 / 1 / true.
 *   3. single_lookup fires for explicit single-URL phrasing in the
 *      user command (Chinese + English variants).
 *   4. null when web is forbidden (no enforcement applies).
 *   5. createTaskSpec stamps research_quality on the resulting spec
 *      for the realistic scheduler-fired research task.
 *
 * Run: node scripts/verify-research-quality.mjs
 */

import assert from "node:assert/strict";

import {
  inferResearchQuality,
  RESEARCH_PROFILES,
  DEFAULT_MULTI_SOURCE_THRESHOLDS,
  SINGLE_LOOKUP_THRESHOLDS
} from "../src/service/core/policy/research-quality.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { detect as detectExplicitSingleUrl } from "../src/service/core/intent/signals/explicit-single-url.mjs";

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

const noAnchor = { real_selection: false, file_text: false, browser_page: false };
const realSelection = { real_selection: true, file_text: false, browser_page: false };
const fileText = { real_selection: false, file_text: true, browser_page: false };

// ── thresholds constants ─────────────────────────────────────────────
it("thresholds: multi_source defaults are 3 / 2 / digest_satisfies=false (matches user spec)", () => {
  assert.equal(DEFAULT_MULTI_SOURCE_THRESHOLDS.min_sources, 3);
  assert.equal(DEFAULT_MULTI_SOURCE_THRESHOLDS.min_distinct_domains, 2);
  assert.equal(DEFAULT_MULTI_SOURCE_THRESHOLDS.single_source_digest_satisfies, false);
});
it("thresholds: single_lookup is 1 / 1 / digest_satisfies=true", () => {
  assert.equal(SINGLE_LOOKUP_THRESHOLDS.min_sources, 1);
  assert.equal(SINGLE_LOOKUP_THRESHOLDS.min_distinct_domains, 1);
  assert.equal(SINGLE_LOOKUP_THRESHOLDS.single_source_digest_satisfies, true);
});

// ── inferResearchQuality ─────────────────────────────────────────────
it("infer: forbidden mode → null (no enforcement applies)", () => {
  assert.equal(inferResearchQuality({ text: "x", contextSources: noAnchor, toolPolicyMode: "forbidden" }), null);
});
it("infer: optional mode + no anchor → multi_source_research", () => {
  const rq = inferResearchQuality({ text: "今天有什么 AI 新闻", contextSources: noAnchor, toolPolicyMode: "optional" });
  assert.equal(rq?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
  assert.equal(rq.min_sources, 3);
  assert.equal(rq.min_distinct_domains, 2);
  assert.equal(rq.single_source_digest_satisfies, false);
});
it("infer: required mode + no anchor → multi_source_research", () => {
  const rq = inferResearchQuality({ text: "research today's tech news", contextSources: noAnchor, toolPolicyMode: "required" });
  assert.equal(rq?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
});
it("infer: real_selection anchor → single_lookup (1/1/true)", () => {
  const rq = inferResearchQuality({ contextSources: realSelection, toolPolicyMode: "optional" });
  assert.equal(rq?.profile, RESEARCH_PROFILES.SINGLE_LOOKUP);
  assert.equal(rq.min_sources, 1);
  assert.equal(rq.min_distinct_domains, 1);
  assert.equal(rq.single_source_digest_satisfies, true);
});
it("infer: file_text anchor → single_lookup", () => {
  const rq = inferResearchQuality({ contextSources: fileText, toolPolicyMode: "optional" });
  assert.equal(rq?.profile, RESEARCH_PROFILES.SINGLE_LOOKUP);
});
it("infer: explicit_single_url signal matched → single_lookup", () => {
  const rq = inferResearchQuality({
    contextSources: noAnchor,
    signals: { explicit_single_url: { matched: true, kind: "hint", strength: "strong" } },
    toolPolicyMode: "optional"
  });
  assert.equal(rq?.profile, RESEARCH_PROFILES.SINGLE_LOOKUP);
});
it("infer: explicit_single_url unmatched → multi_source_research (default)", () => {
  const rq = inferResearchQuality({
    contextSources: noAnchor,
    signals: { explicit_single_url: { matched: false } },
    toolPolicyMode: "optional"
  });
  assert.equal(rq?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
});
it("infer: missing signals/contextSources falls back to multi_source", () => {
  const rq = inferResearchQuality({ toolPolicyMode: "optional" });
  assert.equal(rq?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
});
it("infer: null toolPolicyMode → defaults to multi_source for safety", () => {
  // Defensive: when caller omits toolPolicyMode (only happens during
  // unit tests / partial wiring), don't return null — assume web is
  // possible. Only the explicit "forbidden" string suppresses.
  const rq = inferResearchQuality({});
  assert.equal(rq?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
});

// ── Signal-level: explicit_single_url detector ───────────────────────
it("signal: detector fires for Chinese single-URL phrasings", () => {
  for (const text of [
    "总结这个 URL: https://example.com/a",
    "总结这篇文章",
    "只基于这篇文章总结",
    "分析这个网页",
    "看看这一篇 https://nature.com/x"
  ]) {
    const sig = detectExplicitSingleUrl(text, {});
    assert.equal(sig.matched, true, `expected match for "${text}"`);
    assert.equal(sig.kind, "hint");
    assert.equal(sig.hint?.value, "single_url");
  }
});
it("signal: detector fires for English single-URL phrasings", () => {
  for (const text of [
    "summarize this URL https://example.com/a",
    "summarise this article",
    "read this page",
    "based only on this article please",
    "tell me about this post"
  ]) {
    const sig = detectExplicitSingleUrl(text, {});
    assert.equal(sig.matched, true, `expected match for "${text}"`);
  }
});
it("signal: detector does NOT fire for research/news phrasings without single-URL hint", () => {
  for (const text of [
    "今天有什么 AI 新闻动态",
    "最近 AI 动态汇报",
    "查一下有没有类似的开源项目",
    "帮我研究 X 的竞品",
    "compare these alternatives"
  ]) {
    const sig = detectExplicitSingleUrl(text, {});
    assert.equal(sig.matched, false, `expected NO match for "${text}"`);
  }
});
it("signal: bare URL with no summarise verb does NOT collapse to single_lookup", () => {
  const sig = detectExplicitSingleUrl("https://example.com/a", {});
  assert.equal(sig.matched, false);
});
it("signal: empty / non-string text → unmatched", () => {
  assert.equal(detectExplicitSingleUrl("", {}).matched, false);
  assert.equal(detectExplicitSingleUrl(null, {}).matched, false);
  assert.equal(detectExplicitSingleUrl(undefined, {}).matched, false);
  assert.equal(detectExplicitSingleUrl(42, {}).matched, false);
});

// ── createTaskSpec end-to-end ────────────────────────────────────────
// P4-RQ E3 stage C1 update: topic regex (topic_hint) no longer
// drives web=required deterministically. SR + EvidencePolicy merge
// owns that decision now. Tests stub a `semantic_router_decision` on
// the contextPacket so the merge upgrades web to required and
// research_quality is computed.
const SR_NEWS_REQUIRED = {
  source_scope: "external_world",
  web_policy: "required",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "multi_source",
  confidence: 0.85,
  reason: "news topic"
};

it("createTaskSpec: stamps research_quality on the spec (with SR stub)", () => {
  const spec = createTaskSpec("今天 AI 新闻汇报", {
    semantic_router_decision: { ...SR_NEWS_REQUIRED }
  }, {});
  assert.ok(spec.research_quality, "spec must carry research_quality");
  assert.equal(spec.research_quality.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);
  assert.equal(spec.research_quality.min_sources, 3);
});
it("createTaskSpec: scheduler-fired research task (with SR) → multi_source_research", () => {
  const spec = createTaskSpec("每天早上汇报 AI 新闻", {
    source_app: "uca.scheduler",
    text: "每天早上汇报 AI 新闻",
    file_paths: [],
    image_paths: [],
    semantic_router_decision: { ...SR_NEWS_REQUIRED }
  }, {});
  // No "scheduler特判": the same userCommand routed through SR-merge
  // remains multi_source_research regardless of source_app.
  assert.equal(spec.research_quality?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
    "scheduler-fired news task must require multi-source synthesis");
});
it("createTaskSpec: scheduler-fired news WITHOUT SR → null research_quality (conservative fallback)", () => {
  // P4-RQ E3 stage C1 conservative-fallback lock-in: when SR is
  // unavailable, entity-only queries default forbidden → null
  // research_quality. This is the explicit user-accepted fallback.
  const spec = createTaskSpec("每天早上汇报 AI 新闻", {
    source_app: "uca.scheduler",
    text: "每天早上汇报 AI 新闻",
    file_paths: [],
    image_paths: []
  }, {});
  assert.equal(spec.research_quality, null,
    "without SR, the conservative fallback yields web=forbidden → research_quality=null");
});
it("createTaskSpec: action-only (forbidden web) task → null research_quality", () => {
  const spec = createTaskSpec("帮我打开微信", {}, {});
  assert.equal(spec.research_quality, null,
    "action-only task with web forbidden must have null research_quality");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
