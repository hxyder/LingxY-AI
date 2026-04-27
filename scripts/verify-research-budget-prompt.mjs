#!/usr/bin/env node
/**
 * UCA-077 P4-RQ §19 #2 / K2: prompt-side numerical research_quality
 * budget block.
 *
 * Pre-K2 the prompt only carried the abstract principles ("multiple
 * independent sources are better than one") — the model could follow
 * them in spirit and still miss the specific min_sources=3 /
 * min_distinct_domains=2 bar that the validator enforces. K2 renders
 * the numbers verbatim alongside the principles so the model can
 * self-check before claiming completion.
 *
 * Locks in:
 *   - renderResearchBudget gate (research_quality null / web forbidden /
 *     local anchor → null; otherwise render)
 *   - profile-specific text (single_lookup vs multi_source_research)
 *   - numerical thresholds appear verbatim in the rendered text
 *   - both prompt builders (agentic + tool_using) inject the block
 *
 * Run: node scripts/verify-research-budget-prompt.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderResearchBudget } from "../src/service/executors/shared/research-principles.mjs";
import { buildAgenticSystemPrompt } from "../src/service/executors/agentic/prompt-builder.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

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

function loadFile(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

// Helpers to build the inputs renderResearchBudget reads.
const policyRequired = { policy_groups: { external_web_read: { mode: "required" } } };
const policyOptional = { policy_groups: { external_web_read: { mode: "optional" } } };
const policyForbidden = { policy_groups: { external_web_read: { mode: "forbidden" } } };
const noLocalAnchor = { real_selection: false, file_text: false, browser_page: false };
const localAnchor = { real_selection: true };

const multiSource = {
  profile: "multi_source_research",
  min_sources: 3,
  min_distinct_domains: 2,
  single_source_digest_satisfies: false
};
const singleLookup = {
  profile: "single_lookup",
  min_sources: 1,
  min_distinct_domains: 1,
  single_source_digest_satisfies: true
};

// ── 1. Gate: null research_quality → null block ────────────────────
it("gate: research_quality=null → renderResearchBudget returns null", () => {
  assert.equal(renderResearchBudget(policyRequired, noLocalAnchor, null), null);
  assert.equal(renderResearchBudget(policyRequired, noLocalAnchor, undefined), null);
});

// ── 2. Gate: web forbidden → null block ───────────────────────────
it("gate: web=forbidden → renderResearchBudget returns null (block irrelevant)", () => {
  assert.equal(renderResearchBudget(policyForbidden, noLocalAnchor, multiSource), null);
});

// ── 3. Gate: local anchor → null block ────────────────────────────
it("gate: local anchor → renderResearchBudget returns null (single source by user)", () => {
  assert.equal(renderResearchBudget(policyRequired, localAnchor, multiSource), null);
  assert.equal(renderResearchBudget(policyOptional, { file_text: true }, multiSource), null);
});

// ── 4. multi_source_research: numerical thresholds appear verbatim ──
it("multi_source_research: rendered text contains the numerical bar verbatim", () => {
  const text = renderResearchBudget(policyRequired, noLocalAnchor, multiSource);
  assert.ok(typeof text === "string" && text.length > 0);
  assert.match(text, /at least 3 independent sources/,
    "min_sources must appear verbatim");
  assert.match(text, /from 2 distinct publishers/,
    "min_distinct_domains must appear verbatim");
  assert.match(text, /weekly-review.*digest.*roundup/,
    "single_source_digest_satisfies=false must surface the no-roundup line");
  assert.match(text, /partial_success/,
    "must mention partial_success so the model knows the consequence");
});

// ── 5. single_lookup: profile-specific text ───────────────────────
it("single_lookup: profile text says one source is enough", () => {
  const text = renderResearchBudget(policyOptional, noLocalAnchor, singleLookup);
  assert.ok(typeof text === "string" && text.length > 0);
  assert.match(text, /single authoritative source is sufficient/);
  assert.match(text, /single weekly-review.*acceptable/i,
    "single_lookup should accept a roundup page");
  // Negative: single_lookup must NOT mention min_sources=3
  assert.doesNotMatch(text, /at least 3 independent sources/);
});

// ── 6. Optional web policy still triggers the block ───────────────
it("multi_source + web=optional → block still renders", () => {
  const text = renderResearchBudget(policyOptional, noLocalAnchor, multiSource);
  assert.ok(typeof text === "string" && text.length > 0);
  assert.match(text, /at least 3 independent sources/);
});

// ── 7. Singular grammar: min_sources=1 / min_domains=1 ────────────
it("grammar: single-form when thresholds are 1", () => {
  const odd = { profile: "multi_source_research", min_sources: 1, min_distinct_domains: 1, single_source_digest_satisfies: false };
  const text = renderResearchBudget(policyRequired, noLocalAnchor, odd);
  assert.match(text, /at least 1 independent source\b/);
  assert.match(text, /from 1 distinct publisher\b/);
});

// ── 8. Defensive: missing min_sources → falls back to principles ──
it("defensive: missing min_sources → falls back to principles block", () => {
  const broken = { profile: "multi_source_research", min_distinct_domains: 2, single_source_digest_satisfies: false };
  const text = renderResearchBudget(policyRequired, noLocalAnchor, broken);
  assert.ok(typeof text === "string" && text.length > 0);
  // Principles fallback is the original PRINCIPLES_BLOCK
  assert.match(text, /Source quality principles/);
});

// ── 9. Forward compat: deep_research-shape numbers render via numeric path ─
it("forward compat: deep_research-shape thresholds render verbatim (data-driven)", () => {
  const deep = {
    profile: "deep_research",
    min_sources: 5,
    min_distinct_domains: 3,
    single_source_digest_satisfies: false
  };
  const text = renderResearchBudget(policyRequired, noLocalAnchor, deep);
  assert.ok(typeof text === "string");
  assert.match(text, /at least 5 independent sources/);
  assert.match(text, /from 3 distinct publishers/);
});

// ── 10. Agentic prompt builder injects the block ──────────────────
it("agentic prompt-builder: injects the budget block under '## Research budget'", () => {
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const task = {
    user_command: "Summarise today's AI news across multiple publishers",
    context_packet: { context_sources: noLocalAnchor },
    task_spec: {
      tool_policy: policyRequired,
      research_quality: multiSource,
      success_contract: { required_policy_groups: ["external_web_read"], required_tool_names: [] },
      goal: "search_and_answer",
      executor: "agentic"
    }
  };
  const prompt = buildAgenticSystemPrompt({
    tools: registry.list(),
    task,
    requestedFormat: null
  });
  assert.match(prompt, /## Research budget/,
    "prompt must contain the Research budget section header");
  assert.match(prompt, /at least 3 independent sources/,
    "prompt must carry the verbatim min_sources value");
  assert.match(prompt, /from 2 distinct publishers/,
    "prompt must carry the verbatim min_distinct_domains value");
});

it("agentic prompt-builder: skips the block when research_quality is absent", () => {
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const task = {
    user_command: "Just answer this question.",
    context_packet: { context_sources: noLocalAnchor },
    task_spec: {
      tool_policy: policyForbidden,
      research_quality: null,
      success_contract: { required_policy_groups: [], required_tool_names: [] },
      goal: "qa",
      executor: "fast"
    }
  };
  const prompt = buildAgenticSystemPrompt({
    tools: registry.list(),
    task,
    requestedFormat: null
  });
  assert.doesNotMatch(prompt, /## Research budget/,
    "prompt must NOT carry the Research budget section when research_quality is null");
});

// ── 11. Source-level lock-in: tool_using imports + uses the helper ─
it("source-level: tool_using/agent-loop imports renderResearchBudget and threads researchBudgetBlock", () => {
  const src = loadFile("../src/service/executors/tool_using/agent-loop.mjs");
  assert.match(src, /import \{[^}]*\brenderResearchBudget\b[^}]*\} from "\.\.\/shared\/research-principles\.mjs"/,
    "tool_using must import renderResearchBudget from the shared module");
  assert.match(src, /\bresearchBudgetBlock\b/,
    "tool_using must compute a researchBudgetBlock variable");
  assert.match(src, /\$\{researchBudgetBlock\}/,
    "tool_using must inject researchBudgetBlock into the systemPrompt template");
});

it("source-level: agentic/prompt-builder imports + uses renderResearchBudget", () => {
  const src = loadFile("../src/service/executors/agentic/prompt-builder.mjs");
  assert.match(src, /import \{[^}]*\brenderResearchBudget\b[^}]*\} from "\.\.\/shared\/research-principles\.mjs"/);
  assert.match(src, /## Research budget/,
    "agentic prompt template must include the section header literal");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
