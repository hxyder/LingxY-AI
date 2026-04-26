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

import { validateSuccessContract } from "../src/service/core/policy/success-contract-validator.mjs";
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
  it("e2e: real spec + transcript with fetch_url_content alone passes", () => {
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    const transcript = [{
      type: "tool_result",
      tool: "fetch_url_content",
      success: true,
      result: { extractedText: "x".repeat(500) }
    }];
    const out = validateSuccessContract(spec, transcript);
    assert.equal(out.satisfied, true,
      `expected satisfied; violations=${JSON.stringify(out.violations)}`);
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
