#!/usr/bin/env node
/**
 * UCA-077 P4-RQ §19 #3 / K3: deep_research research_quality tier.
 *
 * Stricter sibling of multi_source_research. Triggers ONLY when SR
 * classifies the request as `research_depth: "deep_research"`
 * (explicit "深入调研 / 全面对比 / comprehensive review / exhaustive
 * comparison / deep dive" phrasings — taught in the SR prompt). Same
 * shape as multi_source_research; only the threshold numbers differ:
 *   single_lookup            → 1 / 1 / digest_ok=true
 *   multi_source_research    → 3 / 2 / digest_ok=false
 *   deep_research            → 5 / 3 / digest_ok=false
 *
 * The validator (D3) and prompt-side budget block (K2) are
 * data-driven on min_sources / min_distinct_domains, so K3 is a
 * profile-list extension — both reuse the existing numeric path
 * without code changes.
 *
 * Run: node scripts/verify-deep-research-tier.mjs
 */

import assert from "node:assert/strict";
import {
  inferResearchQuality,
  RESEARCH_PROFILES,
  DEFAULT_MULTI_SOURCE_THRESHOLDS,
  DEEP_RESEARCH_THRESHOLDS,
  SINGLE_LOOKUP_THRESHOLDS
} from "../src/service/core/policy/research-quality.mjs";
import { validateSuccessContract } from "../src/service/core/policy/success-contract-validator.mjs";
import { renderResearchBudget } from "../src/service/executors/shared/research-principles.mjs";

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

// ── 1. Constants exposed ─────────────────────────────────────────
it("RESEARCH_PROFILES.DEEP_RESEARCH constant exists", () => {
  assert.equal(RESEARCH_PROFILES.DEEP_RESEARCH, "deep_research");
});

it("DEEP_RESEARCH_THRESHOLDS = 5 / 3 / digest_ok=false", () => {
  assert.equal(DEEP_RESEARCH_THRESHOLDS.min_sources, 5);
  assert.equal(DEEP_RESEARCH_THRESHOLDS.min_distinct_domains, 3);
  assert.equal(DEEP_RESEARCH_THRESHOLDS.single_source_digest_satisfies, false);
});

it("threshold ordering: single_lookup ≤ multi_source ≤ deep_research", () => {
  assert.ok(SINGLE_LOOKUP_THRESHOLDS.min_sources <= DEFAULT_MULTI_SOURCE_THRESHOLDS.min_sources);
  assert.ok(DEFAULT_MULTI_SOURCE_THRESHOLDS.min_sources <= DEEP_RESEARCH_THRESHOLDS.min_sources);
  assert.ok(SINGLE_LOOKUP_THRESHOLDS.min_distinct_domains <= DEFAULT_MULTI_SOURCE_THRESHOLDS.min_distinct_domains);
  assert.ok(DEFAULT_MULTI_SOURCE_THRESHOLDS.min_distinct_domains <= DEEP_RESEARCH_THRESHOLDS.min_distinct_domains);
});

// ── 2. inferResearchQuality picks deep_research when SR says so ──
it("inferResearchQuality: srResearchDepth='deep_research' + web allowed + no anchor → deep_research profile", () => {
  const rq = inferResearchQuality({
    contextSources: { real_selection: false, file_text: false, browser_page: false },
    signals: {},
    toolPolicyMode: "required",
    srResearchDepth: "deep_research"
  });
  assert.equal(rq.profile, "deep_research");
  assert.equal(rq.min_sources, 5);
  assert.equal(rq.min_distinct_domains, 3);
  assert.equal(rq.single_source_digest_satisfies, false);
});

it("inferResearchQuality: srResearchDepth='multi_source' → multi_source_research (no upgrade)", () => {
  const rq = inferResearchQuality({
    contextSources: { real_selection: false, file_text: false },
    signals: {},
    toolPolicyMode: "required",
    srResearchDepth: "multi_source"
  });
  assert.equal(rq.profile, "multi_source_research");
  assert.equal(rq.min_sources, 3);
  assert.equal(rq.min_distinct_domains, 2);
});

it("inferResearchQuality: srResearchDepth='unknown' → multi_source_research default", () => {
  const rq = inferResearchQuality({
    contextSources: { real_selection: false },
    signals: {},
    toolPolicyMode: "optional",
    srResearchDepth: "unknown"
  });
  assert.equal(rq.profile, "multi_source_research");
});

it("inferResearchQuality: deep_research never overrides local anchor (single_lookup wins)", () => {
  const rq = inferResearchQuality({
    contextSources: { real_selection: true },
    signals: {},
    toolPolicyMode: "required",
    srResearchDepth: "deep_research"
  });
  assert.equal(rq.profile, "single_lookup",
    "even if SR says deep_research, a local anchor means user pointed at THIS thing");
});

it("inferResearchQuality: deep_research never overrides explicit_single_url", () => {
  const rq = inferResearchQuality({
    contextSources: { real_selection: false },
    signals: {
      explicit_single_url: { matched: true, kind: "hint", strength: "strong", hint: { value: "single_url" } }
    },
    toolPolicyMode: "required",
    srResearchDepth: "deep_research"
  });
  assert.equal(rq.profile, "single_lookup",
    "single-URL signal beats SR depth override — user named one URL");
});

it("inferResearchQuality: deep_research + web=forbidden → null (no enforcement)", () => {
  const rq = inferResearchQuality({
    contextSources: {},
    signals: {},
    toolPolicyMode: "forbidden",
    srResearchDepth: "deep_research"
  });
  assert.equal(rq, null,
    "forbidden short-circuits regardless of depth");
});

// ── 3. Validator enforces deep_research thresholds ───────────────
it("validateSuccessContract: deep_research + 3 sources / 2 domains → insufficient violations", () => {
  const taskSpec = {
    success_contract: { required_policy_groups: ["external_web_read"] },
    research_quality: {
      profile: "deep_research",
      min_sources: 5,
      min_distinct_domains: 3,
      single_source_digest_satisfies: false
    }
  };
  // Transcript: 3 hits across 2 distinct domains → satisfies multi_source
  // (3/2) but NOT deep_research (5/3).
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "Found three articles covering today's AI news across multiple publishers in detail.",
      metadata: { results: [
        { url: "https://nytimes.com/a", title: "A" },
        { url: "https://nytimes.com/b", title: "B" },
        { url: "https://reuters.com/c", title: "C" }
      ]} }
  ];
  const { satisfied, violations } = validateSuccessContract(taskSpec, transcript);
  assert.equal(satisfied, false);
  const kinds = violations.map((v) => v.kind);
  assert.ok(kinds.includes("external_web_read_insufficient_sources"),
    `expected insufficient_sources for 3 < 5; got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes("external_web_read_single_domain_only"),
    `expected single_domain_only for 2 < 3 distinct publishers; got ${JSON.stringify(kinds)}`);
  // Violation messages must reference deep_research (not multi_source_research)
  const sourcesMsg = violations.find((v) => v.kind === "external_web_read_insufficient_sources");
  assert.match(sourcesMsg.message, /deep_research/,
    "violation message must reference the active profile (deep_research)");
});

it("validateSuccessContract: deep_research + 5 sources / 3 domains → satisfied", () => {
  const taskSpec = {
    success_contract: { required_policy_groups: ["external_web_read"] },
    research_quality: {
      profile: "deep_research",
      min_sources: 5,
      min_distinct_domains: 3,
      single_source_digest_satisfies: false
    }
  };
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "Found five articles across three publishers covering AI policy in depth.",
      metadata: { results: [
        { url: "https://nytimes.com/a", title: "A" },
        { url: "https://reuters.com/b", title: "B" },
        { url: "https://bbc.co.uk/c", title: "C" },
        { url: "https://nytimes.com/d", title: "D" },
        { url: "https://reuters.com/e", title: "E" }
      ]} }
  ];
  const { satisfied, violations } = validateSuccessContract(taskSpec, transcript);
  assert.equal(satisfied, true,
    `should be satisfied at 5/3; violations=${JSON.stringify(violations)}`);
});

it("validateSuccessContract: deep_research + roundup page on single domain → roundup violation", () => {
  const taskSpec = {
    success_contract: { required_policy_groups: ["external_web_read"] },
    research_quality: {
      profile: "deep_research",
      min_sources: 5,
      min_distinct_domains: 3,
      single_source_digest_satisfies: false
    }
  };
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "Found a weekly digest covering this week's developments comprehensively.",
      metadata: { results: [
        { url: "https://paper.sciencenet.cn/htmlnews/weekly-review-563765.shtm",
          title: "AI weekly digest 周报" }
      ]} }
  ];
  const { satisfied, violations } = validateSuccessContract(taskSpec, transcript);
  assert.equal(satisfied, false);
  assert.ok(violations.some((v) => v.kind === "external_web_read_single_roundup_only"),
    `expected single_roundup_only; got ${JSON.stringify(violations.map((v) => v.kind))}`);
});

it("validateSuccessContract: multi_source profile messages still say multi_source_research", () => {
  // Regression guard: K3 made the message label dynamic. Ensure
  // multi_source_research still surfaces its own label.
  const taskSpec = {
    success_contract: { required_policy_groups: ["external_web_read"] },
    research_quality: DEFAULT_MULTI_SOURCE_THRESHOLDS_WITH_PROFILE()
  };
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "Just one article from one publisher describing the matter at hand briefly.",
      metadata: { results: [{ url: "https://example.com/a" }] } }
  ];
  const { violations } = validateSuccessContract(taskSpec, transcript);
  const insuf = violations.find((v) => v.kind === "external_web_read_insufficient_sources");
  assert.ok(insuf);
  assert.match(insuf.message, /multi_source_research/);
  assert.doesNotMatch(insuf.message, /deep_research/);
});

function DEFAULT_MULTI_SOURCE_THRESHOLDS_WITH_PROFILE() {
  return {
    profile: "multi_source_research",
    ...DEFAULT_MULTI_SOURCE_THRESHOLDS
  };
}

// ── 4. Prompt-side budget block renders deep_research thresholds ─
it("renderResearchBudget: deep_research profile renders 5 / 3 verbatim", () => {
  const text = renderResearchBudget(
    { policy_groups: { external_web_read: { mode: "required" } } },
    { real_selection: false, file_text: false },
    {
      profile: "deep_research",
      min_sources: 5,
      min_distinct_domains: 3,
      single_source_digest_satisfies: false
    }
  );
  assert.ok(typeof text === "string");
  assert.match(text, /at least 5 independent sources/);
  assert.match(text, /from 3 distinct publishers/);
  assert.match(text, /weekly-review.*digest.*roundup/);
});

// ── 5. SR enum lock-in: deep_research is in the schema ───────────
it("SR schema: research_depth enum includes deep_research", async () => {
  const mod = await import("../src/service/core/intent/semantic-router.mjs");
  const enumDef = mod.SEMANTIC_DECISION_TOOL.input_schema.properties.research_depth.enum;
  assert.ok(enumDef.includes("deep_research"),
    `enum must include deep_research; got ${JSON.stringify(enumDef)}`);
});

it("SR system prompt: explicitly mentions deep_research and the comprehensive/in-depth phrasings", async () => {
  // Read the source to confirm the prompt text was updated. The
  // prompt itself isn't directly exported; grep the source.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/service/core/intent/semantic-router.mjs", import.meta.url), "utf8");
  assert.match(src, /deep_research/,
    "SR source must reference deep_research");
  assert.match(src, /深入调研|全面对比|comprehensive|exhaustive|deep dive/i,
    "SR system prompt must teach the deep_research trigger phrasings");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
