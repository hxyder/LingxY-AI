#!/usr/bin/env node
/**
 * UCA-077 P4-RQ D5: end-to-end research-quality enforcement.
 *
 * Drives the user's three explicit reproduction scenarios through
 * the full pipeline (createTaskSpec → validateSuccessContract →
 * suggestRunbookForStepGate) so we have a regression barrier at the
 * level "what the user actually reported", not just at the
 * individual-module level.
 *
 *   1. ScienceNet single-source roundup transcript on a multi_source
 *      task → satisfied=false with single_roundup_only violation,
 *      runbook recommendation = INSUFFICIENT_RESEARCH_SOURCES.
 *   2. 3 cross-domain transcript on the same multi_source task →
 *      satisfied=true.
 *   3. Scheduler-fired "每天早上汇报 AI 新闻" with a single source →
 *      satisfied=false (no scheduler-specific bypass).
 *   4. Single-URL anchor task with 1 source → satisfied (single_lookup
 *      profile gives 1/1/digest_satisfies thresholds).
 *
 * Run: node scripts/verify-research-quality-e2e.mjs
 */

import assert from "node:assert/strict";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { validateSuccessContract, validateStepGate } from "../src/service/core/policy/success-contract-validator.mjs";
import { suggestRunbookForStepGate } from "../src/service/core/runtime/runbook-engine.mjs";
import { RESEARCH_PROFILES } from "../src/service/core/policy/research-quality.mjs";

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

const NEWS_COMMAND = "今天有什么 AI 新闻动态";
const SCHEDULER_NEWS_COMMAND = "每天早上汇报 AI 新闻";

function buildSchedulerPacket() {
  return {
    schema_version: "1.0",
    source_type: "window",
    source_app: "uca.scheduler",
    capture_mode: "event",
    security_level: "internal",
    redaction_applied: false,
    text: SCHEDULER_NEWS_COMMAND,
    file_paths: [],
    image_paths: [],
    selection_metadata: { source_id: "test-source", trigger_reason: "scheduled" }
  };
}

// ── 1. ScienceNet roundup ───────────────────────────────────────────
it("e2e: ScienceNet roundup on multi_source task → single_roundup_only violation + INSUFFICIENT_RESEARCH_SOURCES runbook", () => {
  const spec = createTaskSpec(NEWS_COMMAND, {}, {});
  // Sanity check: the news command must classify as multi_source_research
  // for this fixture to be meaningful.
  assert.equal(spec.research_quality?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
    `expected multi_source_research profile for "${NEWS_COMMAND}"; got ${spec.research_quality?.profile}`);

  const transcript = [{
    type: "tool_result", tool: "web_search_fetch", success: true,
    observation: "x".repeat(500),
    metadata: {
      results: [
        { url: "https://paper.sciencenet.cn/htmlnews/2026/4/563765.shtm", title: "一周热闻回顾（4月3日-4月9日）" },
        { url: "https://news.sciencenet.cn/htmlnews/2026/4/563766.shtm", title: "..." },
        { url: "https://blog.sciencenet.cn/post/123", title: "..." }
      ]
    }
  }];

  const final = validateSuccessContract(spec, transcript);
  assert.equal(final.satisfied, false,
    "ScienceNet single-source roundup must NOT satisfy a multi_source_research contract");
  const kinds = final.violations.map((v) => v.kind);
  assert.ok(kinds.includes("external_web_read_single_roundup_only"),
    `expected external_web_read_single_roundup_only; got ${JSON.stringify(kinds)}`);

  // Phase gate at iteration ceiling → abort, runbook = INSUFFICIENT_RESEARCH_SOURCES
  const gate = validateStepGate(spec, transcript, { iteration: 7, maxIterations: 8 });
  assert.equal(gate.next_action, "abort");
  const runbook = suggestRunbookForStepGate(gate);
  assert.equal(runbook?.id, "INSUFFICIENT_RESEARCH_SOURCES",
    `expected runbook INSUFFICIENT_RESEARCH_SOURCES; got ${runbook?.id}`);
});

// ── 2. 3 cross-domain → satisfied ────────────────────────────────────
it("e2e: 3 cross-domain transcript on multi_source task → satisfied", () => {
  const spec = createTaskSpec(NEWS_COMMAND, {}, {});
  assert.equal(spec.research_quality?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH);

  const transcript = [{
    type: "tool_result", tool: "web_search_fetch", success: true,
    observation: "x".repeat(500),
    metadata: {
      results: [
        { url: "https://nature.com/articles/a" },
        { url: "https://reuters.com/world/b" },
        { url: "https://wired.com/story/c" }
      ]
    }
  }];

  const final = validateSuccessContract(spec, transcript);
  assert.equal(final.satisfied, true,
    `expected satisfied; violations=${JSON.stringify(final.violations)}`);
});

// ── 3. Scheduler-fired research → still multi_source ─────────────────
it("e2e: scheduler-fired '每天汇报 AI 新闻' is multi_source_research, single source fails", () => {
  const spec = createTaskSpec(SCHEDULER_NEWS_COMMAND, buildSchedulerPacket(), {});
  // Critical: scheduler stamp must NOT downgrade research_quality.
  assert.equal(spec.research_quality?.profile, RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
    "scheduler-fired news task must require multi-source synthesis");

  const transcript = [{
    type: "tool_result", tool: "web_search_fetch", success: true,
    observation: "x".repeat(500),
    metadata: {
      results: [
        { url: "https://news.sciencenet.cn/htmlnews/2026/4/563765.shtm", title: "..." }
      ]
    }
  }];

  const final = validateSuccessContract(spec, transcript);
  assert.equal(final.satisfied, false,
    "single-source completion on scheduled news task must FAIL the contract");
  const kinds = final.violations.map((v) => v.kind);
  assert.ok(
    kinds.includes("external_web_read_insufficient_sources")
    || kinds.includes("external_web_read_single_domain_only"),
    `expected insufficient_sources or single_domain_only; got ${JSON.stringify(kinds)}`
  );
});

// ── 4. Single-URL anchor task → 1 source satisfies ──────────────────
it("e2e: single_lookup task with 1 source → satisfied (1/1/digest-ok thresholds)", () => {
  // Build a single-URL command that fires the explicit_single_url
  // signal. We can't rely on createTaskSpec's full path here because
  // the deterministic resolver may set web=forbidden for "总结这个 URL"
  // (source-scope reads "这个" as current_context), which makes
  // research_quality null and the contract trivially passes. Build
  // the spec by hand to test the single_lookup enforcement path
  // directly.
  const spec = {
    research_quality: {
      profile: "single_lookup",
      min_sources: 1, min_distinct_domains: 1,
      single_source_digest_satisfies: true,
      reason: "explicit_single_url"
    },
    success_contract: {
      artifact_created: false, artifact_registered: false, tool_called: true,
      required_tool_names: [],
      required_policy_groups: ["external_web_read"]
    }
  };
  const transcript = [{
    type: "tool_result", tool: "fetch_url_content", success: true,
    observation: "x".repeat(500),
    metadata: { url: "https://example.com/article" }
  }];

  const final = validateSuccessContract(spec, transcript);
  assert.equal(final.satisfied, true,
    `single_lookup with 1 source should satisfy; violations=${JSON.stringify(final.violations)}`);
});

// ── 5. Mid-loop continue lets the agent fetch more ───────────────────
it("e2e: multi_source + 1 source mid-loop → continue (let agent fetch another) NOT abort", () => {
  const spec = createTaskSpec(NEWS_COMMAND, {}, {});
  const transcript = [{
    type: "tool_result", tool: "web_search_fetch", success: true,
    observation: "x".repeat(500),
    metadata: {
      results: [
        { url: "https://nature.com/articles/a" }
      ]
    }
  }];
  const gate = validateStepGate(spec, transcript, { iteration: 1, maxIterations: 8 });
  // Coverage gap exists, but iteration is far from the ceiling AND
  // the last result was successful. Continue → loop tries another
  // search.
  assert.equal(gate.next_action, "continue",
    `expected continue mid-loop; got ${gate.next_action}`);
  const kinds = gate.violations.map((v) => v.kind);
  assert.ok(kinds.includes("external_web_read_insufficient_sources")
         || kinds.includes("external_web_read_single_domain_only"),
    `expected coverage violations; got ${JSON.stringify(kinds)}`);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
