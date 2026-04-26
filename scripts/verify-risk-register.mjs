#!/usr/bin/env node
/**
 * UCA-077 P4-RR (plan §16.4 + §17.4.3): RAID-log regression.
 *
 * Asserts:
 *   1. RR_REGISTRY shape — every canonical risk has the expected fields.
 *   2. listTaskTriggeredRisks returns the right combination of mitigated +
 *      partial risks for representative task contexts; listGlobalOpenRisks
 *      surfaces open + partial entries for system diagnostic page.
 *   3. listAssumptionsForTask materialises A-01 / A-02 / A-03 only when
 *      their predicate holds (no false positives).
 *   4. listDependenciesForTask flags missing files for code QA, missing
 *      image for multimodal_analyze, and reports D-03 as available when
 *      web is required by policy.
 *   5. compileRaidLog returns all four buckets (issues empty by design).
 *   6. End-to-end via createTaskSpec → `spec.contract.raid_log` is wired
 *      and reflects the request.
 *   7. buildDecisionTrace omits triggered_raid_ids by default and
 *      preserves it when callers populate it.
 *   8. createTaskSpec records triggered_raid_ids on the TOOL_POLICY stage.
 *
 * Run: node scripts/verify-risk-register.mjs
 */

import assert from "node:assert/strict";

import {
  RR_REGISTRY,
  listTaskTriggeredRisks,
  listGlobalOpenRisks,
  listAssumptionsForTask,
  listDependenciesForTask,
  compileRaidLog
} from "../src/service/core/contracts/risk-register.mjs";
import { buildDecisionTrace, STAGES } from "../src/service/core/contracts/decision-trace.mjs";
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

async function run() {
  // ── 1. RR_REGISTRY shape ───────────────────────────────────────────────
  it("registry: has RR-01 through RR-06", () => {
    for (const id of ["RR-01", "RR-02", "RR-03", "RR-04", "RR-05", "RR-06"]) {
      assert.ok(RR_REGISTRY[id], `missing ${id}`);
    }
  });
  it("registry: every entry has id/category/risk/severity/mitigation/enforcement/status", () => {
    for (const entry of Object.values(RR_REGISTRY)) {
      for (const field of ["id", "category", "risk", "severity", "mitigation", "enforcement", "status"]) {
        assert.ok(entry[field], `${entry.id ?? "?"} missing ${field}`);
      }
      assert.ok(["low", "medium", "high"].includes(entry.severity));
      assert.ok(["open", "partial", "mitigated", "accepted", "transferred"].includes(entry.status));
    }
  });
  it("registry: P4-00 / P4-00.5 status reflects the just-landed work", () => {
    assert.equal(RR_REGISTRY["RR-03"].status, "mitigated");
    assert.equal(RR_REGISTRY["RR-04"].status, "mitigated");
    // RR-06: partial because long-term prompt-composer (Phase 5) still open.
    assert.equal(RR_REGISTRY["RR-06"].status, "partial");
    assert.ok(RR_REGISTRY["RR-06"].current_mitigation, "partial entries must declare current_mitigation");
    assert.ok(RR_REGISTRY["RR-06"].outstanding_work, "partial entries must declare outstanding_work");
    // RR-05 stays open until P4-02 SemanticRouter lands.
    assert.equal(RR_REGISTRY["RR-05"].status, "open");
  });
  it("registry: entries are frozen (no mutation surface)", () => {
    assert.throws(() => { RR_REGISTRY["RR-01"].status = "open"; });
  });

  // ── 2. listTaskTriggeredRisks (per-task UI) + listGlobalOpenRisks ─────
  it("task: a routed forbidden task surfaces RR-01 + RR-02 + RR-03 + RR-04", () => {
    const spec = createTaskSpec("分析下面代码", { text: "function f(){return 1;}" }, {});
    const ids = listTaskTriggeredRisks(spec).map((r) => r.id);
    // Resolver fired (RR-01), expansion ran (RR-03), at least one forbidden
    // → guard armed (RR-02), resource-context injected (RR-04).
    assert.ok(ids.includes("RR-01"));
    assert.ok(ids.includes("RR-02"));
    assert.ok(ids.includes("RR-03"));
    assert.ok(ids.includes("RR-04"));
    // RR-05 is OPEN — does NOT belong on the per-task list.
    assert.ok(!ids.includes("RR-05"),
      "RR-05 is global-open; per-task list MUST NOT include it");
    // RR-06 is PARTIAL — §18.6.1.C moved partial entries to global only,
    // so the per-task UI doesn't repeat the same project-level concern
    // on every task. Should appear in listGlobalOpenRisks instead.
    assert.ok(!ids.includes("RR-06"),
      "RR-06 is partial; per-task list MUST NOT include it (moved to global)");
  });
  it("task: required-web task surfaces RR-01 + RR-03 (no forbidden → no RR-02)", () => {
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    const ids = listTaskTriggeredRisks(spec).map((r) => r.id);
    assert.ok(ids.includes("RR-01"));
    assert.ok(ids.includes("RR-03"));
    // RR-02 only fires when something is FORBIDDEN. required-mode tasks
    // never trigger the guard, so RR-02 stays off the per-task list.
    assert.ok(!ids.includes("RR-02"),
      "RR-02 must NOT fire on required-only tasks");
  });
  it("task: empty taskSpec triggers only RR-04 (mitigated, always-on)", () => {
    // RR-04 (resource-context) mitigation runs on every executor call,
    // so it is correctly listed as "triggered for this task". RR-06
    // (partial) used to sit here too but §18.6.1.C moved partial entries
    // to global-only so the per-task UI doesn't keep repeating the same
    // project-level concern.
    const ids = listTaskTriggeredRisks({}).map((r) => r.id);
    assert.ok(ids.includes("RR-04"));
    assert.ok(!ids.includes("RR-06"), "partial entries are global-only");
    assert.ok(!ids.includes("RR-05"), "open entries are global-only");
    assert.ok(!ids.includes("RR-01"), "policy-based risks not triggered when no policy");
    assert.ok(!ids.includes("RR-02"));
    assert.ok(!ids.includes("RR-03"));
  });
  it("global: listGlobalOpenRisks returns open + partial entries (RR-05, RR-06)", () => {
    const ids = listGlobalOpenRisks().map((r) => r.id);
    assert.ok(ids.includes("RR-05"), "RR-05 (open) must surface globally");
    assert.ok(ids.includes("RR-06"), "RR-06 (partial) must surface globally");
    // Fully-mitigated risks must NOT appear on the global page.
    assert.ok(!ids.includes("RR-01"));
    assert.ok(!ids.includes("RR-02"));
    assert.ok(!ids.includes("RR-03"));
    assert.ok(!ids.includes("RR-04"));
  });
  it("global: listGlobalOpenRisks does not depend on a task argument", () => {
    // Regression guard: the function intentionally has no task parameter
    // so it can be called from system-level diagnostic code paths.
    assert.equal(listGlobalOpenRisks.length, 0);
  });

  // ── 3. Assumptions ─────────────────────────────────────────────────────
  // Test the module in isolation with crafted inputs — `listAssumptionsForTask`
  // is a pure function over signals + intent_tags, so we don't need the full
  // pipeline. (intent_tags is set by routeIntent upstream of createTaskSpec.)
  it("assumptions: A-01 fires when source_scope=current_context", () => {
    const signals = {
      source_scope: { matched: true, strength: "strong", hint: { value: "current_context" }, evidence: [] }
    };
    const out = listAssumptionsForTask({}, signals);
    const a01 = out.find((a) => a.id === "A-01");
    assert.ok(a01, `expected A-01; got ${out.map((a) => a.id)}`);
    assert.ok(a01.confidence >= 0.85);
  });
  it("assumptions: A-01 confidence drops when source_scope is weak", () => {
    const signals = {
      source_scope: { matched: true, strength: "weak", hint: { value: "current_context" }, evidence: [] }
    };
    const a01 = listAssumptionsForTask({}, signals).find((a) => a.id === "A-01");
    assert.ok(a01.confidence < 0.85);
  });
  it("assumptions: A-02 fires when explicit_entity strong + scope=none", () => {
    const signals = {
      source_scope: { matched: false, hint: { value: "none" } },
      explicit_entity: { matched: true, strength: "strong", evidence: [] }
    };
    const out = listAssumptionsForTask({}, signals);
    assert.ok(out.some((a) => a.id === "A-02"));
  });
  it("assumptions: A-02 does NOT fire when scope is local even with strong entity", () => {
    const signals = {
      source_scope: { matched: true, strength: "strong", hint: { value: "current_context" }, evidence: [] },
      explicit_entity: { matched: true, strength: "strong", evidence: [] }
    };
    const out = listAssumptionsForTask({}, signals);
    assert.ok(!out.some((a) => a.id === "A-02"));
  });
  it("assumptions: A-03 fires for connector-tagged tasks", () => {
    const out = listAssumptionsForTask({ intent_tags: ["connector"] }, {});
    assert.ok(out.some((a) => a.id === "A-03"));
  });
  it("assumptions: empty input produces NO assumptions", () => {
    assert.deepEqual(listAssumptionsForTask({}, {}), []);
  });

  // ── 4. Dependencies ────────────────────────────────────────────────────
  it("dependencies: D-01 fires for code QA without attached files", () => {
    const spec = createTaskSpec("帮我看看这个 Python 脚本里 current 变量是什么意思", {}, {});
    const out = listDependenciesForTask(spec, {});
    const ids = out.map((d) => d.id);
    assert.ok(ids.includes("D-01"), `expected D-01 in ${ids}`);
    const dep = out.find((d) => d.id === "D-01");
    assert.equal(dep.status, "missing");
  });
  it("dependencies: D-01 NOT raised when a file is attached", () => {
    const spec = createTaskSpec("帮我看看这个 Python 脚本", { file_paths: ["x.py"] }, {});
    const out = listDependenciesForTask(spec, { file_paths: ["x.py"] });
    assert.ok(!out.some((d) => d.id === "D-01"));
  });
  it("dependencies: D-02 fires for multimodal_analyze without images", () => {
    const out = listDependenciesForTask({ goal: "multimodal_analyze", user_goal_text: "x" }, {});
    assert.ok(out.some((d) => d.id === "D-02"));
  });
  it("dependencies: D-03 marked available when web is required", () => {
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    const out = listDependenciesForTask(spec, {});
    const dep = out.find((d) => d.id === "D-03");
    assert.ok(dep);
    assert.equal(dep.status, "available");
  });

  // ── 5. compileRaidLog full shape ──────────────────────────────────────
  it("compile: returns all four RAID buckets with issues=[]", () => {
    const spec = createTaskSpec("分析下面代码", { text: "let x = 1" }, {});
    const log = compileRaidLog({ taskSpec: spec, signals: {}, contextPacket: { text: "let x = 1" } });
    assert.ok(Array.isArray(log.task_triggered_risks),
      "raid_log uses `task_triggered_risks` field name (not legacy `risks`)");
    assert.ok(Array.isArray(log.assumptions));
    assert.ok(Array.isArray(log.issues));
    assert.equal(log.issues.length, 0, "issues are projected from audit log later");
    assert.ok(Array.isArray(log.dependencies));
  });
  it("compile: legacy field name `risks` is intentionally absent", () => {
    const spec = createTaskSpec("分析下面代码", { text: "let x = 1" }, {});
    const log = compileRaidLog({ taskSpec: spec, signals: {}, contextPacket: {} });
    assert.equal(log.risks, undefined,
      "legacy `risks` field must NOT come back — consumers must update to task_triggered_risks");
  });

  // ── 6. End-to-end through createTaskSpec → spec.contract.raid_log ─────
  it("e2e: spec.contract.raid_log carries triggered risks only (no RR-05 noise)", () => {
    const spec = createTaskSpec("分析下面代码", { text: "let x = 1" }, {});
    const log = spec.contract?.raid_log;
    assert.ok(log, "spec.contract.raid_log must exist after compileTaskContract");
    const ids = log.task_triggered_risks.map((r) => r.id);
    assert.ok(!ids.includes("RR-05"),
      "per-task raid_log must NOT carry global open risks (RR-05 is open)");
    assert.ok(Array.isArray(log.assumptions));
    assert.equal(log.issues.length, 0);
  });

  // ── 7. DecisionTrace triggered_raid_ids ────────────────────────────────
  it("trace: builds without triggered_raid_ids when caller omits it", () => {
    const entry = buildDecisionTrace("test", { output: { x: 1 } });
    assert.equal(entry.triggered_raid_ids, undefined);
  });
  it("trace: preserves triggered_raid_ids when caller passes them", () => {
    const entry = buildDecisionTrace("test", {
      output: { x: 1 },
      triggered_raid_ids: ["RR-03"]
    });
    assert.deepEqual(entry.triggered_raid_ids, ["RR-03"]);
  });
  it("trace: empty array → field omitted (don't pollute the entry)", () => {
    const entry = buildDecisionTrace("test", { output: { x: 1 }, triggered_raid_ids: [] });
    assert.equal(entry.triggered_raid_ids, undefined);
  });

  // ── 8. createTaskSpec stamps triggered_raid_ids on TOOL_POLICY ────────
  it("createTaskSpec: TOOL_POLICY decision tagged with RR-01 + RR-03", () => {
    const spec = createTaskSpec("分析下面代码", { text: "let x = 1" }, {});
    const trace = spec.decision_trace ?? [];
    const policyEntry = trace.find((e) => e.stage === STAGES.TOOL_POLICY);
    assert.ok(policyEntry, "tool-policy stage must be recorded");
    assert.ok(policyEntry.triggered_raid_ids?.includes("RR-01"));
    assert.ok(policyEntry.triggered_raid_ids?.includes("RR-03"));
    // Forbidden mode → RR-02 also fired.
    assert.ok(policyEntry.triggered_raid_ids?.includes("RR-02"));
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
