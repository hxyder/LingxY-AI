#!/usr/bin/env node
/**
 * UCA-077 P4-RQ C1: research/multi-source principles helper +
 * end-to-end render through both prompt builders.
 *
 * Asserts:
 *   1. Helper unit:
 *      - renders when external_web_read is `required` AND no local anchor
 *      - renders when external_web_read is `optional` AND no local anchor
 *      - returns null when external_web_read is `forbidden`
 *      - returns null when contextSources has real_selection (single URL /
 *        single article anchor)
 *      - returns null when contextSources has file_text (uploaded file)
 *      - returns null when toolPolicy / contextSources are missing
 *   2. Tool_using prompt: principles block appears in the rendered system
 *      prompt for "今天 AI 新闻" + web=required + no anchor; absent when
 *      web=forbidden or when the user anchored a selection.
 *   3. Agentic prompt: same — principles block appears in the rendered
 *      system prompt for the same cases.
 *
 * Run: node scripts/verify-research-principles.mjs
 */

import assert from "node:assert/strict";

import {
  renderResearchPrinciples,
  RESEARCH_PRINCIPLES_TEXT
} from "../src/service/executors/shared/research-principles.mjs";
import { buildAgenticSystemPrompt } from "../src/service/executors/agentic/prompt-builder.mjs";

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

// ── Helper unit ─────────────────────────────────────────────────────
const policyForbidden = { policy_groups: { external_web_read: { mode: "forbidden" } } };
const policyOptional  = { policy_groups: { external_web_read: { mode: "optional"  } } };
const policyRequired  = { policy_groups: { external_web_read: { mode: "required"  } } };

const noAnchor      = { real_selection: false, browser_page: false, file_text: false };
const realSelection = { real_selection: true,  browser_page: false, file_text: false };
const fileText      = { real_selection: false, browser_page: false, file_text: true  };

it("helper: renders for required + no anchor", () => {
  const out = renderResearchPrinciples(policyRequired, noAnchor);
  assert.equal(out, RESEARCH_PRINCIPLES_TEXT);
});
it("helper: renders for optional + no anchor", () => {
  const out = renderResearchPrinciples(policyOptional, noAnchor);
  assert.equal(out, RESEARCH_PRINCIPLES_TEXT);
});
it("helper: null for forbidden (web disallowed entirely)", () => {
  assert.equal(renderResearchPrinciples(policyForbidden, noAnchor), null);
});
it("helper: null when real_selection set (single-URL / single-article anchor)", () => {
  assert.equal(renderResearchPrinciples(policyOptional, realSelection), null);
});
it("helper: null when file_text set (uploaded file anchor)", () => {
  assert.equal(renderResearchPrinciples(policyOptional, fileText), null);
});
it("helper: null when toolPolicy is missing", () => {
  assert.equal(renderResearchPrinciples(null, noAnchor), null);
  assert.equal(renderResearchPrinciples(undefined, noAnchor), null);
  assert.equal(renderResearchPrinciples({}, noAnchor), null);
});
it("helper: tolerates missing contextSources (treats as no anchor)", () => {
  // No anchor info → render (most conservative for research surfaces)
  assert.equal(renderResearchPrinciples(policyOptional, null), RESEARCH_PRINCIPLES_TEXT);
  assert.equal(renderResearchPrinciples(policyOptional, undefined), RESEARCH_PRINCIPLES_TEXT);
});

// ── Block contents — sanity check ───────────────────────────────────
it("contents: mentions multi-source / one-publisher / cite", () => {
  assert.match(RESEARCH_PRINCIPLES_TEXT, /Multiple independent sources/);
  assert.match(RESEARCH_PRINCIPLES_TEXT, /One publisher/);
  assert.match(RESEARCH_PRINCIPLES_TEXT, /Cite the sources/);
});
it("contents: explicitly preserves single-URL / single-fact paths", () => {
  assert.match(RESEARCH_PRINCIPLES_TEXT, /SPECIFIC article or URL/);
  assert.match(RESEARCH_PRINCIPLES_TEXT, /single-fact lookups/i);
});

// ── End-to-end: agentic prompt rendering ────────────────────────────
function makeTask({ webMode = "required", contextSources = noAnchor, userCommand = "今天有什么 AI 新闻动态" } = {}) {
  return {
    user_command: userCommand,
    task_spec: {
      goal: "qa",
      tool_policy: webMode ? { policy_groups: { external_web_read: { mode: webMode } } } : null,
      success_contract: { required_policy_groups: ["external_web_read"] }
    },
    context_packet: {
      context_sources: contextSources
    }
  };
}

it("agentic prompt: principles block present for required + no anchor (today's AI news)", () => {
  const prompt = buildAgenticSystemPrompt({
    tools: [],
    task: makeTask({ webMode: "required", contextSources: noAnchor })
  });
  assert.match(prompt, /Source quality principles/);
  assert.match(prompt, /Multiple independent sources/);
});
it("agentic prompt: principles block present for optional + no anchor (research competitor)", () => {
  const prompt = buildAgenticSystemPrompt({
    tools: [],
    task: makeTask({
      webMode: "optional",
      contextSources: noAnchor,
      userCommand: "research X's competitors"
    })
  });
  assert.match(prompt, /Source quality principles/);
});
it("agentic prompt: principles block ABSENT for forbidden", () => {
  const prompt = buildAgenticSystemPrompt({
    tools: [],
    task: makeTask({ webMode: "forbidden", contextSources: noAnchor })
  });
  assert.doesNotMatch(prompt, /Source quality principles/);
});
it("agentic prompt: principles block ABSENT when real_selection anchor set", () => {
  const prompt = buildAgenticSystemPrompt({
    tools: [],
    task: makeTask({ webMode: "optional", contextSources: realSelection, userCommand: "总结这个 URL: https://example.com/a" })
  });
  assert.doesNotMatch(prompt, /Source quality principles/);
});
it("agentic prompt: principles block ABSENT when file_text anchor set (uploaded file)", () => {
  const prompt = buildAgenticSystemPrompt({
    tools: [],
    task: makeTask({ webMode: "optional", contextSources: fileText, userCommand: "summarize this file" })
  });
  assert.doesNotMatch(prompt, /Source quality principles/);
});

// ── End-to-end: tool_using prompt rendering ─────────────────────────
// Cannot easily call buildToolUsingSystemPrompt (it's inlined in
// llmPlanner). Use a source-level lock-in: the tool_using agent-loop
// must import the helper and inject the block into its system prompt
// template. This is a stable test — the regex shape doesn't depend on
// the exact prompt wording.
import { readFileSync } from "node:fs";

it("tool_using lock-in: agent-loop imports and uses renderResearchPrinciples", () => {
  const src = readFileSync(
    new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url),
    "utf8"
  );
  // K2 combined this import with renderResearchBudget into a single
  // destructured statement; accept either single or combined form.
  assert.match(src, /import\s+\{[^}]*\brenderResearchPrinciples\b[^}]*\}\s+from\s+["']\.\.\/shared\/research-principles\.mjs["']/,
    "agent-loop must import renderResearchPrinciples from shared/research-principles.mjs");
  assert.match(src, /renderResearchPrinciples\s*\(/,
    "agent-loop must call renderResearchPrinciples()");
  assert.match(src, /\$\{researchPrinciplesBlock\}/,
    "agent-loop systemPrompt template must interpolate the principles block");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
