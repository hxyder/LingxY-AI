#!/usr/bin/env node
/**
 * UCA-077 P4-RB (main plan §17.4.1 / §18.4): runbook engine.
 *
 * Asserts:
 *   1. RUNBOOKS catalogue exposes the 6 expected failure-mode entries
 *      (EMPTY_WEB_SEARCH_RESULT / FORBIDDEN_TOOL_REQUESTED /
 *      NO_FILE_CHANGE_DETECTED / AGENT_LOOP_NO_PROGRESS /
 *      TOOL_REPEATED_FAILURE / GATE_ABORT_AT_ITERATION_CEILING)
 *   2. Each runbook entry is well-formed: id / description /
 *      non-empty steps / terminal_action ∈ enum
 *   3. RUNBOOKS / RUNBOOK_IDS are frozen — no mutation surface
 *   4. getRunbook returns null for unknown ids
 *   5. suggestRunbookForStepGate decision tree:
 *        continue / retry              → null (no auto-recovery)
 *        abort                         → GATE_ABORT_AT_ITERATION_CEILING
 *        escalate + tool_repeated      → TOOL_REPEATED_FAILURE
 *        escalate + *_required_empty   → EMPTY_WEB_SEARCH_RESULT
 *        escalate + *_required_failed  → AGENT_LOOP_NO_PROGRESS
 *        escalate + other              → AGENT_LOOP_NO_PROGRESS (default)
 *   6. suggestRunbookForToolFailure recognises blocked_by_policy →
 *      FORBIDDEN_TOOL_REQUESTED; everything else null
 *   7. suggestRunbookForFinalize fires NO_FILE_CHANGE_DETECTED only when
 *      artifact_required=true AND artifact_changed=false
 *   8. Integration with validateStepGate: feeding a step-gate escalate
 *      result into suggestRunbookForStepGate returns the right entry
 *
 * Run: node scripts/verify-runbook-engine.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  RUNBOOKS,
  RUNBOOK_IDS,
  getRunbook,
  suggestRunbookForStepGate,
  suggestRunbookForToolFailure,
  suggestRunbookForFinalize
} from "../src/service/core/runtime/runbook-engine.mjs";
import { validateStepGate } from "../src/service/core/policy/success-contract-validator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

const VALID_TERMINAL = new Set(["retry", "escalate", "abort", "partial_success"]);

async function run() {
  // ── 1. catalogue contents ─────────────────────────────────────────────
  it("catalogue: 7 expected runbook ids registered", () => {
    for (const id of [
      "EMPTY_WEB_SEARCH_RESULT", "FORBIDDEN_TOOL_REQUESTED",
      "NO_FILE_CHANGE_DETECTED", "AGENT_LOOP_NO_PROGRESS",
      "TOOL_REPEATED_FAILURE", "GATE_ABORT_AT_ITERATION_CEILING",
      "INSUFFICIENT_RESEARCH_SOURCES"
    ]) {
      assert.ok(RUNBOOKS[id], `missing runbook: ${id}`);
      assert.equal(RUNBOOKS[id].id, id);
    }
    assert.equal(RUNBOOK_IDS.length, 7);
  });
  it("catalogue: INSUFFICIENT_RESEARCH_SOURCES has broaden_query / alternative_terms / independent_domains / disclosure", () => {
    const rb = RUNBOOKS.INSUFFICIENT_RESEARCH_SOURCES;
    assert.equal(rb.terminal_action, "partial_success");
    const stepIds = rb.steps.map((s) => s.id);
    assert.ok(stepIds.includes("broaden_query_once"), `steps=${stepIds.join(", ")}`);
    assert.ok(stepIds.includes("search_with_alternative_terms"));
    assert.ok(stepIds.includes("prefer_independent_domains"));
    assert.ok(stepIds.includes("return_partial_success_with_disclosure"));
  });

  // ── 2. shape ──────────────────────────────────────────────────────────
  it("shape: every runbook has id / description / steps / terminal_action", () => {
    for (const rb of Object.values(RUNBOOKS)) {
      assert.equal(typeof rb.id, "string");
      assert.equal(typeof rb.description, "string");
      assert.ok(rb.description.length > 0);
      assert.ok(Array.isArray(rb.steps) && rb.steps.length > 0,
        `${rb.id} steps must be non-empty array`);
      for (const step of rb.steps) {
        assert.equal(typeof step.id, "string");
        assert.equal(typeof step.description, "string");
        assert.ok(step.id.length > 0);
        assert.ok(step.description.length > 0);
      }
      assert.ok(VALID_TERMINAL.has(rb.terminal_action),
        `${rb.id} terminal_action=${rb.terminal_action} not in enum`);
    }
  });

  // ── 3. immutability ───────────────────────────────────────────────────
  it("frozen: RUNBOOKS / RUNBOOK_IDS / individual entries are frozen", () => {
    assert.throws(() => { RUNBOOKS.NEW_ONE = {}; });
    assert.throws(() => { RUNBOOK_IDS.push("x"); });
    assert.throws(() => { RUNBOOKS.EMPTY_WEB_SEARCH_RESULT.terminal_action = "x"; });
    // step entries also frozen
    const firstStep = RUNBOOKS.EMPTY_WEB_SEARCH_RESULT.steps[0];
    assert.throws(() => { firstStep.id = "tampered"; });
  });

  // ── 4. getRunbook ─────────────────────────────────────────────────────
  it("getRunbook: returns the runbook by id", () => {
    assert.equal(getRunbook("EMPTY_WEB_SEARCH_RESULT")?.id, "EMPTY_WEB_SEARCH_RESULT");
    assert.equal(getRunbook("does_not_exist"), null);
    assert.equal(getRunbook(""), null);
    assert.equal(getRunbook(null), null);
  });

  // ── 5. suggestRunbookForStepGate ──────────────────────────────────────
  it("suggest/stepGate: continue → null (no auto-recovery needed)", () => {
    assert.equal(suggestRunbookForStepGate({ next_action: "continue" }), null);
  });
  it("suggest/stepGate: retry → null (let agent try again on its own)", () => {
    assert.equal(suggestRunbookForStepGate({ next_action: "retry" }), null);
  });
  it("suggest/stepGate: abort → GATE_ABORT_AT_ITERATION_CEILING", () => {
    const rb = suggestRunbookForStepGate({ next_action: "abort", violations: [] });
    assert.equal(rb?.id, "GATE_ABORT_AT_ITERATION_CEILING");
  });
  it("suggest/stepGate: escalate + tool_repeated_failure → TOOL_REPEATED_FAILURE", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [{ kind: "tool_repeated_failure" }]
    });
    assert.equal(rb?.id, "TOOL_REPEATED_FAILURE");
  });
  it("suggest/stepGate: escalate + *_required_returned_empty → EMPTY_WEB_SEARCH_RESULT", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [{ kind: "external_web_read_required_returned_empty" }]
    });
    assert.equal(rb?.id, "EMPTY_WEB_SEARCH_RESULT");
  });
  it("suggest/stepGate: escalate + *_required_all_failed → AGENT_LOOP_NO_PROGRESS", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [{ kind: "external_web_read_required_all_failed" }]
    });
    assert.equal(rb?.id, "AGENT_LOOP_NO_PROGRESS");
  });
  it("suggest/stepGate: escalate + unrecognised violation → AGENT_LOOP_NO_PROGRESS (default)", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [{ kind: "something_unknown" }]
    });
    assert.equal(rb?.id, "AGENT_LOOP_NO_PROGRESS");
  });
  it("suggest/stepGate: tool_repeated_failure wins over other violations (most specific)", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [
        { kind: "external_web_read_required_returned_empty" },
        { kind: "tool_repeated_failure" }
      ]
    });
    assert.equal(rb?.id, "TOOL_REPEATED_FAILURE");
  });
  it("suggest/stepGate: insufficient_sources → INSUFFICIENT_RESEARCH_SOURCES (research-quality recovery)", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "abort",
      violations: [{ kind: "external_web_read_insufficient_sources" }]
    });
    assert.equal(rb?.id, "INSUFFICIENT_RESEARCH_SOURCES");
  });
  it("suggest/stepGate: single_domain_only → INSUFFICIENT_RESEARCH_SOURCES", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "abort",
      violations: [{ kind: "external_web_read_single_domain_only" }]
    });
    assert.equal(rb?.id, "INSUFFICIENT_RESEARCH_SOURCES");
  });
  it("suggest/stepGate: single_roundup_only → INSUFFICIENT_RESEARCH_SOURCES", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "abort",
      violations: [{ kind: "external_web_read_single_roundup_only" }]
    });
    assert.equal(rb?.id, "INSUFFICIENT_RESEARCH_SOURCES");
  });
  it("suggest/stepGate: research-quality wins over GATE_ABORT_AT_ITERATION_CEILING", () => {
    // Research-quality violation present alongside the iteration-ceiling
    // signal — INSUFFICIENT_RESEARCH_SOURCES still wins because the
    // recovery (broaden query) is more actionable than the generic
    // "stop the loop / surface violations" steps.
    const rb = suggestRunbookForStepGate({
      next_action: "abort",
      violations: [
        { kind: "external_web_read_single_domain_only" }
      ]
    });
    assert.equal(rb?.id, "INSUFFICIENT_RESEARCH_SOURCES");
  });
  it("suggest/stepGate: research-quality fires from escalate path too", () => {
    const rb = suggestRunbookForStepGate({
      next_action: "escalate",
      violations: [{ kind: "external_web_read_insufficient_sources" }]
    });
    assert.equal(rb?.id, "INSUFFICIENT_RESEARCH_SOURCES");
  });
  it("suggest/stepGate: malformed input → null (no crash)", () => {
    assert.equal(suggestRunbookForStepGate(null), null);
    assert.equal(suggestRunbookForStepGate(undefined), null);
    assert.equal(suggestRunbookForStepGate({}), null);
    assert.equal(suggestRunbookForStepGate({ next_action: "weird" }), null);
  });

  // ── 6. suggestRunbookForToolFailure ───────────────────────────────────
  it("suggest/toolFailure: blocked_by_policy → FORBIDDEN_TOOL_REQUESTED", () => {
    const rb = suggestRunbookForToolFailure({ success: false, error: "blocked_by_policy" });
    assert.equal(rb?.id, "FORBIDDEN_TOOL_REQUESTED");
  });
  it("suggest/toolFailure: rate_limited → null (let phase gate decide)", () => {
    assert.equal(suggestRunbookForToolFailure({ success: false, error: "rate_limited" }), null);
  });
  it("suggest/toolFailure: success → null", () => {
    assert.equal(suggestRunbookForToolFailure({ success: true }), null);
  });

  // ── 7. suggestRunbookForFinalize ──────────────────────────────────────
  it("suggest/finalize: artifact_required + no change → NO_FILE_CHANGE_DETECTED", () => {
    const rb = suggestRunbookForFinalize({ artifact_required: true, artifact_changed: false });
    assert.equal(rb?.id, "NO_FILE_CHANGE_DETECTED");
  });
  it("suggest/finalize: artifact_required + changed → null (success path)", () => {
    assert.equal(suggestRunbookForFinalize({ artifact_required: true, artifact_changed: true }), null);
  });
  it("suggest/finalize: !artifact_required → null (no contract to violate)", () => {
    assert.equal(suggestRunbookForFinalize({ artifact_required: false, artifact_changed: false }), null);
  });

  // ── 8. integration with validateStepGate ──────────────────────────────
  it("integration: phase-gate `escalate` from same-tool failure streak picks TOOL_REPEATED_FAILURE", () => {
    const taskSpec = {
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    };
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" },
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" }
    ];
    const gate = validateStepGate(taskSpec, transcript, { iteration: 2, maxIterations: 8 });
    assert.equal(gate.next_action, "escalate");
    const rb = suggestRunbookForStepGate(gate);
    assert.equal(rb?.id, "TOOL_REPEATED_FAILURE");
  });
  it("integration: phase-gate `abort` at iteration ceiling picks GATE_ABORT_AT_ITERATION_CEILING", () => {
    const taskSpec = {
      success_contract: {
        artifact_created: false, artifact_registered: false, tool_called: true,
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    };
    const transcript = [
      { type: "tool_result", tool: "web_search_fetch", success: false, error: "timeout" }
    ];
    const gate = validateStepGate(taskSpec, transcript, { iteration: 7, maxIterations: 8 });
    assert.equal(gate.next_action, "abort");
    const rb = suggestRunbookForStepGate(gate);
    assert.equal(rb?.id, "GATE_ABORT_AT_ITERATION_CEILING");
  });

  it("wire-up: tool_using loop injects runbook guidance instead of audit-only suggestions", () => {
    const src = readFileSync(path.join(root, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
    assert.match(src, /type:\s*"runbook_guidance"/,
      "agent loop must add runbook guidance to transcript");
    assert.match(src, /tool_loop\.runbook_executed/,
      "agent loop must audit actual runbook execution, not only suggestion");
    assert.match(src, /runbook_signal/,
      "agent loop must emit an SSE signal when runbook guidance fires");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
