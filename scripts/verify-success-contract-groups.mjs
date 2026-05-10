#!/usr/bin/env node
/**
 * UCA-077 P4-00.7 (plan §18.2.3): SuccessContract group semantics.
 *
 * Asserts:
 *   1. Validator passes when any tool in a required group returns substance.
 *   2. Validator passes when web_search_fetch alone fulfils external_web_read.
 *   3. Validator passes when fetch_url_content alone fulfils
 *      external_web_read (was the regression — pre-P4-00.7 the validator
 *      only knew about web_search_fetch and would FAIL the task).
 *   4. Validator violates when no group member was called.
 *   5. Validator violates when group members were called but all returned
 *      empty results.
 *   6. createTaskSpec stamps `required_policy_groups: ["external_web_read"]`
 *      whenever the canonical group decision is `required`.
 *   7. createTaskSpec does NOT also stamp `required_tool_names:
 *      ["web_search_fetch"]` for the web case (revised §18.6.1.A — the
 *      previous "back-compat" duplicate recreated the contradiction the
 *      group semantics was meant to remove).
 *   8. End-to-end: forbidden / optional tasks do NOT add the group to
 *      required_policy_groups (no spurious requirements).
 *   9. Fail-closed: tool calls with success:false / error / failed result
 *      do NOT count toward satisfying a required_policy_groups entry.
 *      A blocked_by_policy or rate_limited entry with a long observation
 *      must surface as `*_required_all_failed`, not satisfied (§18.6.1.B
 *      real-bug guard).
 *
 * Run: node scripts/verify-success-contract-groups.mjs
 */

import assert from "node:assert/strict";

import { validateSuccessContract, validateStepGate } from "../src/service/core/policy/success-contract-validator.mjs";
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
    if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
    fail += 1;
  }
}

// Helper: build a synthetic taskSpec with a given required_policy_groups list.
function makeSpec({ groups = [], names = [] } = {}) {
  return {
    success_contract: {
      artifact_created: false,
      artifact_registered: false,
      tool_called: true,
      required_tool_names: names,
      required_policy_groups: groups
    }
  };
}

function toolResult({ tool, result, observation }) {
  return { type: "tool_result", tool, result, observation };
}

async function run() {
  // ── 1. group satisfied when any member returns substance ───────────────
  it("group: web_search_fetch with results satisfies external_web_read", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [toolResult({
      tool: "web_search_fetch",
      result: { results: [{ title: "x", url: "https://example.com" }] }
    })];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true);
    assert.deepEqual(out.violations, []);
  });

  // ── 2. fetch_url_content alone satisfies (was the bug) ────────────────
  it("group: fetch_url_content alone satisfies external_web_read", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [toolResult({
      tool: "fetch_url_content",
      observation: "x".repeat(200) // > 32 char threshold
    })];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true);
  });

  // ── 3. web_search alone satisfies ─────────────────────────────────────
  it("group: web_search alone satisfies external_web_read", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [toolResult({
      tool: "web_search",
      result: { sources: [{ url: "https://example.com" }] }
    })];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true);
  });

  // ── 4. no group member called → violation ──────────────────────────────
  it("group: nothing in group called → not_called violation", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [toolResult({
      tool: "write_file",
      result: { success: true }
    })];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, false);
    assert.equal(out.violations.length, 1);
    assert.equal(out.violations[0].kind, "external_web_read_required_not_called");
    assert.match(out.violations[0].message, /web_search_fetch.*fetch_url_content|fetch_url_content.*web_search_fetch/);
  });

  // ── 5. called but empty → returned_empty violation ────────────────────
  it("group: every group call returned empty → returned_empty violation", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [
      // entry shape includes success: true so it's a "successful but empty" hit
      { type: "tool_result", tool: "web_search_fetch", success: true, result: { results: [] }, observation: "" },
      { type: "tool_result", tool: "fetch_url_content", success: true, result: {}, observation: "no" }
    ];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, false);
    assert.equal(out.violations.length, 1);
    assert.equal(out.violations[0].kind, "external_web_read_required_returned_empty");
  });
  it("group: one empty + one substantial → satisfied (any-of semantics)", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: true, result: { results: [] } },
      { type: "tool_result", tool: "fetch_url_content", success: true, observation: "y".repeat(500) }
    ];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true);
  });

  // ── 6. fail-closed on failed tool calls (§18.6.1.B real bug) ──────────
  it("fail-closed: blocked_by_policy with long observation → all_failed (NOT satisfied)", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    // This is exactly what the registry policy guard returns when it
    // refuses to invoke the tool: success:false, error:blocked_by_policy,
    // and a long observation explaining the block. Pre-fix the validator
    // accepted this as "substance".
    const transcript = [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: false,
      error: "blocked_by_policy",
      observation: 'Tool "web_search_fetch" is forbidden by task policy: Connector domain request — connector tools read external state directly. (full reason text continues)'
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, false);
    assert.equal(out.violations[0].kind, "external_web_read_required_all_failed");
    assert.match(out.violations[0].message, /every call failed/);
    assert.match(out.violations[0].message, /blocked_by_policy/);
  });
  it("fail-closed: rate_limited entry doesn't count as substance either", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [{
      type: "tool_result",
      tool: "fetch_url_content",
      success: false,
      error: "rate_limited",
      observation: "Rate limit exceeded for \"fetch_url_content\" (8/8 per task). Further calls will keep returning this error until the task ends."
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, false);
    assert.equal(out.violations[0].kind, "external_web_read_required_all_failed");
  });
  it("fail-closed: legacy adapter shape (entry.result.success === false) also disqualified", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [{
      type: "tool_result",
      tool: "web_search",
      result: { success: false, error: "transport_failed", observation: "Network unreachable for the configured proxy" }
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, false);
    assert.equal(out.violations[0].kind, "external_web_read_required_all_failed");
  });
  it("fail-closed: one success after several failures → satisfied (any-of)", () => {
    const spec = makeSpec({ groups: ["external_web_read"] });
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "blocked_by_policy", observation: "Tool forbidden" },
      { type: "tool_result", tool: "fetch_url_content", success: true, result: { extractedText: "z".repeat(500) } }
    ];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true);
  });

  // ── 7. unknown group is no-op (do not crash) ──────────────────────────
  it("group: unknown group id is silently skipped", () => {
    const spec = makeSpec({ groups: ["does_not_exist"] });
    const out = validateSuccessContract(spec, []);
    assert.equal(out.satisfied, true);
  });
  it("tool-name: required edit_file is enforced for transform/update flows", () => {
    const spec = makeSpec({ names: ["edit_file"] });
    const missing = validateSuccessContract(spec, [
      { type: "tool_result", tool: "generate_document", success: true, artifact_paths: ["E:/out.pptx"] }
    ]);
    assert.equal(missing.satisfied, false);
    assert.equal(missing.violations[0].kind, "edit_file_required_not_called");

    const satisfied = validateSuccessContract(spec, [
      { type: "tool_result", tool: "edit_file", success: true, artifact_paths: ["E:/source.pptx"] }
    ]);
    assert.equal(satisfied.satisfied, true);
  });

  // ── 8. createTaskSpec stamps the group when canonical=required ────────
  it("e2e: explicit external request stamps required_policy_groups only", () => {
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    assert.deepEqual(spec.success_contract.required_policy_groups, ["external_web_read"]);
  });
  it("e2e: external-web requirement DOES NOT stamp required_tool_names (revised §18.6.1.A)", () => {
    // Pre-revision the rule pushed both the group AND web_search_fetch into
    // required_tool_names "for prompt back-compat", which made the agentic
    // prompt tell the LLM "you must call web_search_fetch" — directly
    // contradicting the validator accepting any sibling tool. Now the
    // group is the single source of truth; required_tool_names is
    // reserved for genuinely toolId-specific rules (open_file etc.).
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    assert.ok(!spec.success_contract.required_tool_names.includes("web_search_fetch"),
      "required_tool_names must not carry web_search_fetch when the requirement comes from the group");
  });
  it("e2e: forbidden / optional tasks do NOT stamp the group", () => {
    const chitchat = createTaskSpec("你好", {}, {});
    assert.deepEqual(chitchat.success_contract.required_policy_groups, []);

    const localCode = createTaskSpec("分析下面代码", { text: "let x = 1" }, {});
    assert.deepEqual(localCode.success_contract.required_policy_groups, []);
  });

  // ── 9. e2e validator on a real createTaskSpec output ──────────────────
  it("e2e: real spec + transcript with multi-source web evidence passes", () => {
    // P4-RQ D3: the group-satisfaction check still passes when ANY
    // tool in the group succeeds. But this is now a multi_source_research
    // task (research-class command) so the transcript also has to meet
    // coverage thresholds (≥3 sources / ≥2 domains). Old single-call
    // version no longer satisfies — split into the dedicated
    // "single_lookup OR coverage met" tests further down.
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    const transcript = [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "x".repeat(500),
      metadata: {
        results: [
          { url: "https://github.com/awesome-project", title: "..." },
          { url: "https://gitlab.com/another-project", title: "..." },
          { url: "https://sourceforge.net/yet-another", title: "..." }
        ]
      }
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true,
      `expected satisfied; violations=${JSON.stringify(out.violations)}`);
  });

  // ── 10. P4-08 phase gate (validateStepGate) ───────────────────────────
  // The in-loop gate. Distinct from validateSuccessContract — returns a
  // next_action hint that drives the agent loop's flow control.
  const phaseSpec = makeSpec({ groups: ["external_web_read"] });

  it("phaseGate: empty transcript + iteration 0 → continue", () => {
    const out = validateStepGate(phaseSpec, [], { iteration: 0, maxIterations: 8 });
    assert.equal(out.satisfied, false);
    assert.equal(out.next_action, "continue");
  });
  it("phaseGate: contract satisfied → continue + satisfied:true", () => {
    const transcript = [
      { type: "tool_result", tool: "fetch_url_content", success: true, observation: "x".repeat(500) }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 1, maxIterations: 8 });
    assert.equal(out.satisfied, true);
    assert.equal(out.next_action, "continue");
    assert.deepEqual(out.violations, []);
  });
  it("phaseGate: successful tool but contract not yet met → continue (agent making progress)", () => {
    // write_file succeeded, but external_web_read is required and never called.
    // Don't escalate — the agent might call web_search next.
    const transcript = [
      { type: "tool_result", tool: "write_file", success: true, observation: "saved" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 0, maxIterations: 8 });
    assert.equal(out.satisfied, false);
    assert.equal(out.next_action, "continue");
  });
  it("phaseGate: ONE failed tool → retry (give the agent another chance)", () => {
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout", observation: "" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 1, maxIterations: 8 });
    assert.equal(out.next_action, "retry");
  });
  it("phaseGate: TWO consecutive same-tool failures → escalate", () => {
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" },
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "blocked_by_policy" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 2, maxIterations: 8 });
    assert.equal(out.next_action, "escalate");
    assert.ok(out.violations.some((v) => v.kind === "tool_repeated_failure"),
      "escalate must surface the tool_repeated_failure violation for trace clarity");
  });
  it("phaseGate: failures of DIFFERENT tools don't count as a streak → retry", () => {
    // Agent tried web_search_fetch, failed, then tried web_search, also
    // failed. That's exploration, not stuck-in-a-loop. Single failure
    // of the LAST tool → retry.
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" },
      { type: "tool_result", tool: "web_search", success: false, error: "no_results" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 2, maxIterations: 8 });
    assert.equal(out.next_action, "retry");
  });
  it("phaseGate: success then failure → retry (streak counts from tail; success breaks it)", () => {
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: true, observation: "x".repeat(40) },
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 2, maxIterations: 8 });
    // Last call failed but the previous one succeeded; streak = 1.
    // Note: contract was already satisfied by the first hit, so actually
    // the gate returns continue. But that's because validateSuccessContract
    // accepts any successful hit with substance — this test doc-pins
    // that behaviour.
    assert.equal(out.next_action, "continue");
    assert.equal(out.satisfied, true);
  });
  it("phaseGate: at iteration === maxIterations - 1 with violations → abort", () => {
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 7, maxIterations: 8 });
    assert.equal(out.next_action, "abort");
    assert.equal(out.satisfied, false);
  });
  it("phaseGate: iteration ceiling AND contract satisfied → continue (don't abort a winning state)", () => {
    const transcript = [
      { type: "tool_result", tool: "fetch_url_content", success: true, observation: "y".repeat(500) }
    ];
    const out = validateStepGate(phaseSpec, transcript, { iteration: 7, maxIterations: 8 });
    assert.equal(out.satisfied, true);
    assert.equal(out.next_action, "continue");
  });
  it("phaseGate: custom perToolFailureThreshold escalates earlier", () => {
    // Single failure with threshold=1 → escalate immediately.
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" }
    ];
    const out = validateStepGate(phaseSpec, transcript, {
      iteration: 1, maxIterations: 8, perToolFailureThreshold: 1
    });
    assert.equal(out.next_action, "escalate");
  });
  it("phaseGate: backward-compat — validateSuccessContract still works on a satisfied multi-source case", () => {
    // P4-RQ D3 update: the phase gate didn't change validateSuccessContract's
    // surface, but research_quality now enforces coverage on multi_source
    // tasks. Snapshot a known-good case: research-class command +
    // 3-cross-domain web evidence → satisfied.
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    const transcript = [{
      type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "x".repeat(500),
      metadata: {
        results: [
          { url: "https://github.com/a" },
          { url: "https://gitlab.com/b" },
          { url: "https://sourceforge.net/c" }
        ]
      }
    }];
    const final = validateSuccessContract(spec, transcript);
    assert.equal(final.satisfied, true);
  });

  // ── 11. P4-RQ D3: research_quality coverage enforcement ───────────────
  // The load-bearing change. Single-source completions on a
  // multi_source_research task must now FAIL validateSuccessContract.

  // Build a multi_source_research spec by hand (avoid depending on
  // tool-policy-resolver's exact regex behaviour for these tests).
  function multiSourceSpec() {
    return {
      research_quality: {
        profile: "multi_source_research",
        min_sources: 3,
        min_distinct_domains: 2,
        single_source_digest_satisfies: false,
        reason: "test"
      },
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    };
  }
  function singleLookupSpec() {
    return {
      research_quality: {
        profile: "single_lookup",
        min_sources: 1, min_distinct_domains: 1,
        single_source_digest_satisfies: true,
        reason: "test"
      },
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    };
  }

  it("D3: multi_source + 1 source / 1 domain → insufficient_sources + single_domain_only", () => {
    const transcript = [{
      type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "x".repeat(500),
      metadata: { results: [{ url: "https://nature.com/articles/x", title: "..." }] }
    }];
    const out = validateSuccessContract(multiSourceSpec(), transcript);
    assert.equal(out.satisfied, false);
    const kinds = out.violations.map((v) => v.kind);
    assert.ok(kinds.includes("external_web_read_insufficient_sources"), `kinds=${JSON.stringify(kinds)}`);
    assert.ok(kinds.includes("external_web_read_single_domain_only"), `kinds=${JSON.stringify(kinds)}`);
  });

  it("D3: multi_source + 3 sources / 1 domain → single_domain_only fires", () => {
    const transcript = [{
      type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "x".repeat(500),
      metadata: {
        results: [
          { url: "https://nature.com/articles/a" },
          { url: "https://nature.com/articles/b" },
          { url: "https://nature.com/articles/c" }
        ]
      }
    }];
    const out = validateSuccessContract(multiSourceSpec(), transcript);
    assert.equal(out.satisfied, false);
    const kinds = out.violations.map((v) => v.kind);
    assert.ok(kinds.includes("external_web_read_single_domain_only"), `kinds=${JSON.stringify(kinds)}`);
    // source_count = 3 already meets min_sources, so insufficient should NOT fire
    assert.ok(!kinds.includes("external_web_read_insufficient_sources"), `kinds=${JSON.stringify(kinds)}`);
  });

  it("D3: multi_source + ScienceNet roundup → single_roundup_only (preferred over single_domain_only)", () => {
    const transcript = [{
      type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "x".repeat(500),
      metadata: {
        results: [
          { url: "https://paper.sciencenet.cn/htmlnews/2026/4/563765.shtm", title: "一周热闻回顾" },
          { url: "https://news.sciencenet.cn/htmlnews/2026/4/563766.shtm", title: "..." },
          { url: "https://blog.sciencenet.cn/post/123", title: "..." }
        ]
      }
    }];
    const out = validateSuccessContract(multiSourceSpec(), transcript);
    assert.equal(out.satisfied, false);
    const kinds = out.violations.map((v) => v.kind);
    assert.ok(kinds.includes("external_web_read_single_roundup_only"),
      `expected single_roundup_only, got ${JSON.stringify(kinds)}`);
    // The branch in checkResearchCoverage uses else-if — single_roundup_only
    // wins over single_domain_only when both apply. (Both "tell the operator
    // different things" — but single_roundup is the more actionable one,
    // pointing the runbook recovery at "broaden query".)
    assert.ok(!kinds.includes("external_web_read_single_domain_only"), `kinds=${JSON.stringify(kinds)}`);
  });

  it("D3: multi_source + 3 sources / 3 domains → satisfied", () => {
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
    const out = validateSuccessContract(multiSourceSpec(), transcript);
    assert.equal(out.satisfied, true,
      `expected satisfied; violations=${JSON.stringify(out.violations)}`);
  });

  it("D3: single_lookup + 1 source / 1 domain → satisfied (1/1/digest_ok thresholds)", () => {
    const transcript = [{
      type: "tool_result", tool: "fetch_url_content", success: true,
      observation: "x".repeat(500),
      metadata: { url: "https://example.com/article" }
    }];
    const out = validateSuccessContract(singleLookupSpec(), transcript);
    assert.equal(out.satisfied, true,
      `expected satisfied; violations=${JSON.stringify(out.violations)}`);
  });

  it("D3: research_quality=null skips coverage check (legacy behaviour preserved)", () => {
    const spec = {
      research_quality: null,
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    };
    const transcript = [{
      type: "tool_result", tool: "web_search_fetch", success: true,
      observation: "x".repeat(500),
      metadata: { results: [{ url: "https://nature.com/x" }] }
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true,
      `expected satisfied; violations=${JSON.stringify(out.violations)}`);
  });

  it("D3: multi_source + optional mode (group NOT in required_policy_groups) skips coverage", () => {
    // research_quality says multi_source_research but the group is
    // NOT on required_policy_groups (web mode is "optional"). Don't
    // force coverage — the user didn't ask for hard external research.
    const spec = {
      research_quality: {
        profile: "multi_source_research",
        min_sources: 3, min_distinct_domains: 2,
        single_source_digest_satisfies: false, reason: "test"
      },
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: []   // <-- key
      }
    };
    const out = validateSuccessContract(spec, [
      { type: "tool_result", tool: "web_search_fetch", success: true, observation: "x".repeat(500), metadata: { results: [{ url: "https://nature.com/x" }] } }
    ]);
    assert.equal(out.satisfied, true,
      "optional-mode multi_source spec must not force coverage");
  });

  // ── 12. validateStepGate flow with research_quality ───────────────────
  it("D3 stepGate: multi_source + 1 source mid-loop + lastResult success → continue (let agent fetch more)", () => {
    const spec = multiSourceSpec();
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: true,
        metadata: { results: [{ url: "https://nature.com/x" }] } }
    ];
    const out = validateStepGate(spec, transcript, { iteration: 2, maxIterations: 8 });
    assert.equal(out.satisfied, false);
    assert.equal(out.next_action, "continue",
      "lastResult successful but coverage gap → loop should continue, not abort");
    const kinds = out.violations.map((v) => v.kind);
    assert.ok(kinds.includes("external_web_read_insufficient_sources"));
  });

  it("D3 stepGate: multi_source + 1 source at iteration ceiling → abort", () => {
    const spec = multiSourceSpec();
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: true,
        metadata: { results: [{ url: "https://nature.com/x" }] } }
    ];
    const out = validateStepGate(spec, transcript, { iteration: 7, maxIterations: 8 });
    assert.equal(out.next_action, "abort");
    const kinds = out.violations.map((v) => v.kind);
    assert.ok(kinds.includes("external_web_read_insufficient_sources"));
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
