#!/usr/bin/env node
/**
 * mock-shadow-run.mjs — C18 #C' round-9 (codex round-7 #3)
 *
 * Mock corpus shadow run for the route verifier. Wires the actual
 * `createSemanticRouter()` SR shell with stubbed provider adapter +
 * stubbed `invokeJudge`, runs the full TEST_CORPUS through it, and
 * writes verifier_shadow telemetry as JSONL. The output is then
 * fed through `verify-route-verifier-readiness.mjs` to confirm the
 * gate fires and reports correctly on a non-trivial sample.
 *
 * What this validates (codex round-7 design):
 *   - verifier_shadow telemetry actually flows through the live SR
 *     wiring (not just the verifier module in isolation)
 *   - dual-track shadow records when stable-qa-override applies
 *   - readiness gate's MIN_TRACKS_FOR_READY threshold is calibrated
 *     correctly against the real corpus volume
 *   - the full shape (raw / post_override / override_applied /
 *     diagnostics) survives the summariseVerifier passthrough
 *
 * What this does NOT validate (round-10 / labelled corpus territory):
 *   - judge correctness (the mock judge is a fixed strategy; real
 *     precision requires labelled ground-truth which round-10 ships)
 *
 * Cache discipline (codex round-6 #6): we use `_resetDefaultRouter
 * State()` + a fresh `cache: new Map()` per case so cache hits do
 * not silently drop verifier tracks.
 *
 * Usage:
 *   node scripts/real-llm-test/mock-shadow-run.mjs [output.jsonl]
 *
 * Default output: scripts/real-llm-test/mock-shadow.jsonl
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEST_CORPUS } from "./corpus.mjs";
import { createSemanticRouter, _resetDefaultRouterState } from "../../src/service/core/intent/semantic-router.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Mock SR adapter ───────────────────────────────────────────────────
// Returns SR decisions calibrated against the corpus's expected
// behavior. Stable QA categories (A.*, F.par_*) get web_policy=
// required (the bug stable-qa-override patches); anything with a
// web tool expectation gets web_policy=required + external source.
// This deliberately recreates the conditions the verifier exists
// to fix.
function classifyCorpusItem(item) {
  // Stable QA: corpus says no web tools should fire.
  if (item.expected?.toolMustNotInclude?.includes("web_search_fetch")) {
    return { kind: "stable_qa" };
  }
  // Web search: corpus says web tools must fire.
  if (item.expected?.toolMustInclude?.some((t) => /web_search|fetch_url/.test(t))) {
    return { kind: "needs_web" };
  }
  return { kind: "ambiguous" };
}

function mockSrDecisionFor(item) {
  const cls = classifyCorpusItem(item);
  if (cls.kind === "stable_qa") {
    // Recreate the bug: SR (DeepSeek-flash) routes stable QA to
    // web_policy=required when learning verbs trigger "lookup".
    return {
      source_scope: "none",
      web_policy: "required",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      user_goal: "ask",
      research_depth: "single_lookup",
      file_read_depth: "shallow",
      primary_intent: "qa",
      domain: "software",
      expected_output: "summary",
      needs_external_info: true,
      needs_current_information: false,
      needs_user_files: false,
      needs_tool_use: true,
      needed_capabilities: ["external_web_read"],
      required_policy_groups: [],
      source_mode: "single_lookup",
      complexity: "low",
      risk_level: "low",
      confidence: 0.7,
      rationale_summary: "looks like a Q lookup",
      reason: "mock SR error case"
    };
  }
  if (cls.kind === "needs_web") {
    return {
      source_scope: "none",
      web_policy: "required",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      user_goal: "ask",
      research_depth: "multi_source",
      file_read_depth: "shallow",
      primary_intent: "research",
      domain: "software",
      expected_output: "summary",
      needs_external_info: true,
      needs_current_information: true,
      needs_user_files: false,
      needs_tool_use: true,
      needed_capabilities: ["external_web_read"],
      required_policy_groups: ["external_web_read"],
      source_mode: "multi_source_research",
      complexity: "medium",
      risk_level: "low",
      confidence: 0.85,
      rationale_summary: "freshness-bearing query",
      reason: "needs current info"
    };
  }
  // Ambiguous: SR uncertain
  return {
    source_scope: "none",
    web_policy: "optional",
    output_kind: "conversation",
    artifact_required: false,
    executor: "fast",
    user_goal: "chat",
    primary_intent: "qa",
    domain: "general",
    research_depth: "unknown",
    file_read_depth: "shallow",
    expected_output: "direct_answer",
    needs_external_info: false,
    needs_current_information: false,
    needs_user_files: false,
    needs_tool_use: false,
    needed_capabilities: [],
    required_policy_groups: [],
    source_mode: "no_external",
    complexity: "low",
    risk_level: "low",
    confidence: 0.6,
    rationale_summary: "ambiguous",
    reason: "ambiguous"
  };
}

// ─── Mock provider adapter ─────────────────────────────────────────────
function buildMockAdapter() {
  return {
    async generate({ tools }) {
      // The SR adapter contract: return an LLM-style payload that
      // includes a tool_call with the SR's structured decision in
      // its arguments. We re-derive the decision per call inside
      // the closure (each test case sets activeItem first).
      if (!activeItem) throw new Error("mock adapter called without an activeItem");
      const decision = mockSrDecisionFor(activeItem);
      return {
        tool_calls: [{
          name: tools?.[0]?.name ?? "route_task",
          arguments: decision
        }]
      };
    }
  };
}

// ─── Mock judge ────────────────────────────────────────────────────────
// Deterministic strategy: when SR routes a stable_qa item to
// web_policy=required, the judge correctly rejects with the
// stable-QA correction. Otherwise the judge accepts.
function mockInvokeJudge(prompt) {
  // Heuristic: read the SR decision out of the prompt (it's
  // serialized via JSON.stringify inside buildJudgePrompt).
  const srMatch = prompt.match(/"web_policy":"([^"]+)"/);
  const srWebPolicy = srMatch?.[1];
  const userMatch = prompt.match(/user_command:\s*"((?:[^"\\]|\\.)*)"/);
  const userCommand = userMatch ? JSON.parse(`"${userMatch[1]}"`) : "";

  // Stable QA classifier: same rough shape the verifier prompt
  // primes (no freshness signals + a learning-verb-shape command).
  const looksStableQa = /^(what|什么|如何|怎么|解释|介绍|为什么|why)/i.test(userCommand)
    || /^[A-Z][a-z]+ \w+ vs \w+/.test(userCommand);  // "Compare X vs Y"

  if (srWebPolicy === "required" && looksStableQa) {
    return Promise.resolve({
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      corrected_needs_current_information: false,
      confidence: 0.85,
      reason: "stable concept Q&A — no freshness markers",
      evidence_basis: ["learning verb pattern"]
    });
  }
  return Promise.resolve({
    verdict: "accept",
    confidence: 0.9,
    reason: "SR decision aligns with command",
    evidence_basis: []
  });
}

// ─── Run ───────────────────────────────────────────────────────────────
let activeItem = null;

async function runOne(item) {
  activeItem = item;
  // Fresh cache per case (codex round-6 #6 discipline). Without
  // this, the second occurrence of any (text, signals, context)
  // tuple would return cached without re-running the verifier.
  const router = createSemanticRouter({
    adapter: buildMockAdapter(),
    cache: new Map(),
    invokeJudge: mockInvokeJudge,
    isEnabled: () => true
  });
  const result = await router.resolveSemanticDecision({
    text: item.userCommand,
    contextPacket: {},
    signals: {}
  });
  return {
    user_command: item.userCommand,
    corpus_id: item.id,
    sr_kind: result.kind,
    sr_source: result.source ?? null,
    sr_decision: result.kind === "decision" ? {
      web_policy: result.decision.web_policy,
      source_mode: result.decision.source_mode,
      needs_current_information: result.decision.needs_current_information,
      needs_external_info: result.decision.needs_external_info
    } : null,
    sr_rejection: result.kind === "rejection" ? { code: result.code, reason: result.reason } : null,
    verifier_shadow: result.verifier_shadow ?? null
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = argv[0] ?? path.join(__dirname, "mock-shadow.jsonl");
  mkdirSync(path.dirname(outputPath), { recursive: true });

  _resetDefaultRouterState();
  const rows = [];
  let i = 0;
  for (const item of TEST_CORPUS) {
    if (typeof item.userCommand !== "string") continue;
    i += 1;
    try {
      const row = await runOne(item);
      rows.push(row);
    } catch (err) {
      rows.push({
        user_command: item.userCommand,
        corpus_id: item.id,
        error: err?.message ?? String(err)
      });
    }
    if (i % 25 === 0) {
      process.stderr.write(`[${i}] ${item.id} ...\n`);
    }
  }

  writeFileSync(outputPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  process.stderr.write(`\nWrote ${rows.length} rows → ${outputPath}\n`);

  // Quick stats
  const tracksTotal = rows.reduce((acc, r) => {
    if (r.verifier_shadow?.raw) acc += 1;
    if (r.verifier_shadow?.post_override) acc += 1;
    return acc;
  }, 0);
  const overrideApplied = rows.filter((r) => r.verifier_shadow?.override_applied).length;
  process.stderr.write(`tracks_total=${tracksTotal} override_applied_rows=${overrideApplied}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
