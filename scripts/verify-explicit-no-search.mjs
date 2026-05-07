#!/usr/bin/env node
/**
 * UCA-077 P4-RQ E1: explicit_no_search signal + resolver override
 * + SR hard-fact-conflict guard.
 *
 * Asserts:
 *   1. Signal detector matches Chinese / English no-browse phrasings,
 *      kind: "fact", strength: "strong", hint.value: "no_browse".
 *   2. Detector does NOT match positive search phrasings or
 *      outcome-negation ("搜不到") that don't actually forbid web.
 *   3. SIGNAL_NAMES public surface includes "explicit_no_search".
 *   4. resolveDeterministicPolicy returns web=forbidden when the
 *      signal fires, BEATING:
 *        - pending_offer (would otherwise inherit external intent)
 *        - explicit_external (would otherwise upgrade to required)
 *        - topic_hint (would otherwise upgrade)
 *   5. resolveToolPolicy / mergeSemanticRouterDecision: SR's
 *      web=required suggestion does NOT override forbidden when
 *      explicit_no_search is set.
 *   6. SR's detectHardFactConflict rejects an LLM decision with
 *      web_policy != "forbidden" when explicit_no_search.matched.
 *   7. createTaskSpec end-to-end: "不要联网，今天 AI 新闻" → web=forbidden,
 *      research_quality=null (no enforcement applies).
 *
 * Run: node scripts/verify-explicit-no-search.mjs
 */

import assert from "node:assert/strict";

import {
  detect as detectExplicitNoSearch,
  EXPLICIT_NO_SEARCH_SIGNAL_NAME
} from "../src/service/core/intent/signals/explicit-no-search.mjs";
import { SIGNAL_NAMES } from "../src/service/core/intent/signals/_signal-types.mjs";
import {
  resolveDeterministicPolicy,
  resolveToolPolicy,
  mergeSemanticRouterDecision
} from "../src/service/core/policy/tool-policy-resolver.mjs";
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

// ── Signal detector ─────────────────────────────────────────────────
it("signal: matches Chinese 不要联网 / 不要搜索 / 离线模式", () => {
  for (const text of [
    "不要联网，解释一下 X",
    "不联网，告诉我",
    "别联网",
    "不要搜索网络",
    "请勿联网",
    "无需上网",
    "离线模式回答即可",
    "不要使用网络",
    "不允许访问互联网"
  ]) {
    const s = detectExplicitNoSearch(text, {});
    assert.equal(s.matched, true, `expected match for "${text}"`);
    assert.equal(s.kind, "fact");
    assert.equal(s.strength, "strong");
    assert.equal(s.hint?.value, "no_browse");
  }
});

it("signal: matches English don't browse / no search / offline only / without browsing", () => {
  for (const text of [
    "explain X without browsing",
    "do not search the web",
    "don't browse",
    "do not browse, tell me about X",
    "offline only please",
    "answer with no web search",
    "without internet access, summarise X",
    "do not use the internet"
  ]) {
    const s = detectExplicitNoSearch(text, {});
    assert.equal(s.matched, true, `expected match for "${text}"`);
  }
});

it("signal: NOT matched on positive search phrasing (no negation)", () => {
  for (const text of [
    "search the web for X",
    "查一下网上的 AI 新闻",
    "browse the latest news",
    "today's AI news",
    "今天有什么 AI 新闻"
  ]) {
    const s = detectExplicitNoSearch(text, {});
    assert.equal(s.matched, false, `expected NO match for "${text}"`);
  }
});

it("signal: NOT matched on outcome-negation (search returned nothing)", () => {
  // "搜不到" / "can't find" — negation applies to the OUTCOME, not
  // to the user's instruction to abstain.
  for (const text of [
    "搜不到答案",
    "I can't find the answer",
    "查不到相关信息"
  ]) {
    const s = detectExplicitNoSearch(text, {});
    assert.equal(s.matched, false, `expected NO match for "${text}"`);
  }
});

it("signal: empty / non-string text → unmatched", () => {
  assert.equal(detectExplicitNoSearch("", {}).matched, false);
  assert.equal(detectExplicitNoSearch(null, {}).matched, false);
  assert.equal(detectExplicitNoSearch(undefined, {}).matched, false);
});

it("public surface: SIGNAL_NAMES contains 'explicit_no_search'", () => {
  assert.ok([...SIGNAL_NAMES].includes("explicit_no_search"));
  assert.equal(EXPLICIT_NO_SEARCH_SIGNAL_NAME, "explicit_no_search");
});

// ── Resolver override ───────────────────────────────────────────────
function noSearchSignal() {
  return {
    name: "explicit_no_search",
    matched: true,
    strength: "strong",
    kind: "fact",
    evidence: [{ type: "regex", source: "explicit_no_search", reason: "test" }],
    hint: { value: "no_browse" }
  };
}

function intentRouteFields(overrides = {}) {
  return {
    primary_intent: "research",
    domain: "general",
    user_goal: "Answer the user's current-information question.",
    expected_output: "direct_answer",
    needs_external_info: true,
    needs_current_information: true,
    needs_user_files: false,
    needs_tool_use: true,
    needed_capabilities: ["external_web_read"],
    required_policy_groups: ["external_web_read"],
    source_mode: "multi_source_research",
    // file_read_depth was added to the SR schema after this helper
    // was written; without it the validation step rejected with
    // schema_invalid before detectHardFactConflict could fire,
    // masking the real assertion this test was checking. Default
    // to "shallow" (the smallest valid enum value, appropriate for
    // a non-file research task).
    file_read_depth: "shallow",
    complexity: "medium",
    risk_level: "low",
    rationale_summary: "The request would normally need external information, but hard facts may constrain it.",
    ...overrides
  };
}
function strongExternal() {
  return {
    name: "explicit_external",
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{ type: "regex", source: "explicit_external", reason: "test" }],
    hint: {}
  };
}
function pendingOfferExternal(intent = "weather") {
  return {
    name: "pending_offer",
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{ type: "regex", source: "pending_offer", reason: "test" }],
    hint: { pending_intent: intent }
  };
}
function strongEntityNews() {
  return {
    name: "topic_hint",
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{ type: "regex", source: "topic_hint", reason: "test" }],
    hint: { entity: "news" }
  };
}

it("resolver: explicit_no_search forces web=forbidden over explicit_external", () => {
  const policy = resolveDeterministicPolicy({
    signals: {
      explicit_no_search: noSearchSignal(),
      explicit_external: strongExternal()
    },
    text: "不要联网，告诉我网上的 AI 新闻"
  });
  assert.equal(policy.web_search_fetch.mode, "forbidden");
  assert.match(policy.web_search_fetch.reason, /explicit/i);
});

it("resolver: explicit_no_search forces web=forbidden over pending_offer external intent", () => {
  const policy = resolveDeterministicPolicy({
    signals: {
      explicit_no_search: noSearchSignal(),
      pending_offer: pendingOfferExternal("weather")
    },
    text: "需要，但不要联网"
  });
  assert.equal(policy.web_search_fetch.mode, "forbidden");
});

it("resolver: explicit_no_search forces web=forbidden over topic_hint", () => {
  const policy = resolveDeterministicPolicy({
    signals: {
      explicit_no_search: noSearchSignal(),
      topic_hint: strongEntityNews()
    },
    text: "不要联网，告诉我今天 AI 新闻"
  });
  assert.equal(policy.web_search_fetch.mode, "forbidden");
});

it("resolver merge: SR's web=required suggestion is ignored when explicit_no_search fires", () => {
  const det = resolveDeterministicPolicy({
    signals: { explicit_no_search: noSearchSignal() },
    text: "不要联网，告诉我 X"
  });
  assert.equal(det.web_search_fetch.mode, "forbidden");

  const merged = mergeSemanticRouterDecision({
    deterministicPolicy: det,
    signals: { explicit_no_search: noSearchSignal() },
    contextPacket: {
      semantic_router_decision: {
        source_scope: "external_world",
        web_policy: "required",
        output_kind: "conversation",
        artifact_required: false,
        executor: "tool_using",
        research_depth: "multi_source",
        confidence: 0.95,
        reason: "topic looks current"
      }
    },
    text: "不要联网，告诉我 X"
  });
  // Det was forbidden + explicit_no_search set → SR cannot upgrade.
  assert.equal(merged.web_search_fetch?.mode ?? merged.policy_groups?.external_web_read?.mode, "forbidden");
});

// ── SR hard-fact-conflict guard ─────────────────────────────────────
it("SR detectHardFactConflict: rejects web=required when explicit_no_search fact is set", async () => {
  // Drive through the full router path with a stub adapter that
  // returns web=required despite the no-search signal — SR must
  // emit a fact_conflict rejection.
  const { createSemanticRouter, SEMANTIC_DECISION_TOOL } =
    await import("../src/service/core/intent/semantic-router.mjs");
  const adapter = {
    async generate() {
      return {
        tool_calls: [{
          name: SEMANTIC_DECISION_TOOL.name,
          arguments: {
            source_scope: "external_world",
            web_policy: "required",     // ← conflicts with no-search fact
            output_kind: "conversation",
            artifact_required: false,
            executor: "tool_using",
            research_depth: "multi_source",
            ...intentRouteFields(),
            confidence: 0.95,
            reason: "topic looks current"
          }
        }]
      };
    }
  };
  const router = createSemanticRouter({ adapter });
  const out = await router.resolveSemanticDecision({
    text: "不要联网，告诉我今天 AI 新闻",
    contextPacket: {},
    signals: { explicit_no_search: noSearchSignal() }
  });
  assert.equal(out.kind, "rejection");
  assert.equal(out.code, "fact_conflict");
  assert.match(out.reason, /explicit_no_search/);
});

it("SR detectHardFactConflict: web=forbidden when no-search fact is set is OK (no conflict)", async () => {
  const { createSemanticRouter, SEMANTIC_DECISION_TOOL } =
    await import("../src/service/core/intent/semantic-router.mjs");
  const adapter = {
    async generate() {
      return {
        tool_calls: [{
          name: SEMANTIC_DECISION_TOOL.name,
          arguments: {
            source_scope: "external_world",
            web_policy: "forbidden",     // ← agrees with no-search fact
            output_kind: "conversation",
            artifact_required: false,
            executor: "fast",
            research_depth: "unknown",
            ...intentRouteFields({
              primary_intent: "qa",
              needs_external_info: false,
              needs_current_information: false,
              needs_tool_use: false,
              needed_capabilities: ["none"],
              required_policy_groups: [],
              source_mode: "no_external",
              rationale_summary: "The user explicitly forbade browsing."
            }),
            confidence: 0.7,
            reason: "user told us not to browse"
          }
        }]
      };
    }
  };
  const router = createSemanticRouter({ adapter });
  const out = await router.resolveSemanticDecision({
    text: "不要联网，告诉我今天 AI 新闻",
    contextPacket: {},
    signals: { explicit_no_search: noSearchSignal() }
  });
  assert.equal(out.kind, "decision");
  assert.equal(out.decision.web_policy, "forbidden");
});

// ── End-to-end ──────────────────────────────────────────────────────
it("e2e: '不要联网，今天 AI 新闻' → web=forbidden, research_quality=null", () => {
  const spec = createTaskSpec("不要联网，告诉我今天 AI 新闻", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden",
    "explicit_no_search must drive the resolver to forbidden");
  assert.equal(spec.research_quality, null,
    "research_quality must be null when web is forbidden");
});

it("e2e: 'do not browse, summarize today's AI news' → web=forbidden", () => {
  const spec = createTaskSpec("do not browse, summarize today's AI news", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
