#!/usr/bin/env node
/**
 * UCA-077 P4-04.5: Registry snapshot invariant.
 *
 * Asserts that every code path which acquires `runtime.actionToolRegistry`
 * gets the SAME instance. The historical bug was that two `??` fallback
 * sites (action-tool-submission.mjs, agent-loop.mjs) each constructed a
 * fresh registry when runtime.actionToolRegistry was missing, so per-task
 * rate-limit counters and any runtime-level tool registrations were
 * visible to one executor but not the other.
 *
 * Tests:
 *   1. ensureRuntimeServices populates actionToolRegistry when absent
 *   2. ensureRuntimeServices does NOT replace an existing registry
 *      (any tools the bootstrap layer registered must survive)
 *   3. Two consecutive lookups of runtime.actionToolRegistry are === equal
 *      (object identity, not just structural equality)
 *   4. Per-task rate-limit counter survives across registry uses (i.e. it
 *      lives on runtime, not on the registry, so multiple executors share it)
 *   5. agent-loop and action-tool-submission both throw when runtime is
 *      handed to them with no registry AND no ensureRuntimeServices call
 *
 * Run: node scripts/verify-registry-snapshot.mjs
 */

import assert from "node:assert/strict";

import { ensureRuntimeServices } from "../src/service/core/task-runtime.mjs";
import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";

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

function makeMinimalRuntime() {
  // Just enough for ensureRuntimeServices to run without crashing.
  return {
    store: {
      appendAuditLog(entry) { return entry; },
      getTask: () => null
    },
    queue: { markRunning() {}, markDone() {} },
    eventBus: { publish() {} },
    logsDir: null
  };
}

// ── 1. ensureRuntimeServices populates actionToolRegistry when absent ─────
{
  const runtime = makeMinimalRuntime();
  assert.equal(runtime.actionToolRegistry, undefined);
  ensureRuntimeServices(runtime);
  it("ensureRuntimeServices populates registry when absent",
    () => assert.equal(typeof runtime.actionToolRegistry?.call, "function"));
}

// ── 2. ensureRuntimeServices does NOT replace existing registry ───────────
{
  const runtime = makeMinimalRuntime();
  // Pretend service-bootstrap already registered a custom registry with a
  // sentinel tool that ensureRuntimeServices's defaults wouldn't include.
  const sentinelTool = {
    id: "__sentinel__",
    name: "sentinel",
    description: "marker",
    parameters: {},
    risk_level: "low",
    required_capabilities: [],
    execute() { return { success: true, observation: "ok", artifact_paths: [], error: null, metadata: {} }; }
  };
  // Build a tiny registry directly (no defaults), so we know the only
  // way the sentinel survives is if ensureRuntimeServices respects ??=.
  const customRegistry = {
    register() {}, get(id) { return id === "__sentinel__" ? sentinelTool : null; },
    list() { return [{ id: "__sentinel__" }]; }, evaluate() {}, async call() {}
  };
  runtime.actionToolRegistry = customRegistry;
  ensureRuntimeServices(runtime);
  it("ensureRuntimeServices does NOT replace existing registry (??= semantics)",
    () => assert.equal(runtime.actionToolRegistry, customRegistry));
  it("custom registry's sentinel tool is still reachable",
    () => assert.equal(runtime.actionToolRegistry.get("__sentinel__"), sentinelTool));
}

// ── 3. Identity invariant across multiple reads ───────────────────────────
{
  const runtime = makeMinimalRuntime();
  ensureRuntimeServices(runtime);
  const ref1 = runtime.actionToolRegistry;
  const ref2 = runtime.actionToolRegistry;
  it("registry is the same instance across reads (object identity)",
    () => assert.equal(ref1, ref2));
}

// ── 4. Per-task counter shared across uses ────────────────────────────────
{
  const runtime = makeMinimalRuntime();
  ensureRuntimeServices(runtime);
  const registry = runtime.actionToolRegistry;
  const task = {
    task_id: "task_shared",
    task_spec: {
      tool_policy: {},
      execution_constraints: { rate_limit: { web_search_fetch: 2 } }
    }
  };
  const ctx = { runtime, task };

  // First two calls succeed; third is rate-limited.
  // (Default registry has web_search_fetch wired to a real handler — we
  // override that here with a stub to avoid triggering a real fetch.)
  const realTool = registry.get("web_search_fetch");
  assert.ok(realTool, "web_search_fetch must be in default registry");
  let calls = 0;
  registry.register({
    ...realTool,
    execute() { calls += 1; return { success: true, observation: "stub", artifact_paths: [], error: null, metadata: {} }; }
  });

  await registry.call("web_search_fetch", { query: "x" }, ctx);
  await registry.call("web_search_fetch", { query: "x" }, ctx);
  const third = await registry.call("web_search_fetch", { query: "x" }, ctx);

  it("rate-limit counter persists in runtime.perTaskToolCallCounts",
    () => assert.equal(runtime.perTaskToolCallCounts.get("task_shared:web_search_fetch"), 2));
  it("third call beyond limit is rejected",
    () => assert.equal(third.error, "rate_limited"));
  it("execute ran exactly twice",
    () => assert.equal(calls, 2));
}

// ── 5. agent-loop fails loudly when registry is missing ───────────────────
{
  const runtime = makeMinimalRuntime();
  // Intentionally do NOT call ensureRuntimeServices. agent-loop's own
  // invariant should refuse to construct a divergent instance.
  let threw = null;
  try {
    await runToolAgentLoop({
      task: { task_id: "task_err", user_command: "x", task_spec: { goal: "qa" } },
      runtime
    });
  } catch (err) {
    threw = err;
  }
  it("agent-loop throws when registry missing (no silent divergence)",
    () => {
      assert.ok(threw, "expected throw");
      assert.match(threw.message, /actionToolRegistry/);
    });
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
