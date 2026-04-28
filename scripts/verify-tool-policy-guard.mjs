#!/usr/bin/env node
/**
 * UCA-077 P4-04: Verifier for the registry-level policy guard.
 *
 * Asserts:
 *   1. forbidden tools return success:false with error="blocked_by_policy"
 *      and write a `tool.blocked_by_policy` audit entry
 *   2. rate-limited tools return success:false with error="rate_limited"
 *      after the configured cap and write a `tool.rate_limited` audit entry
 *   3. tools with no policy and no rate cap pass through unchanged
 *   4. policy=optional and policy=required do NOT block (only forbidden does)
 *   5. guard does not crash when ctx is missing (registry called from a
 *      bare unit test) — graceful degradation
 *
 * Run: node scripts/verify-tool-policy-guard.mjs
 */

import assert from "node:assert/strict";

import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { resetRateLimits, getRateLimitUsage, DEFAULT_RATE_LIMITS } from "../src/service/action_tools/policy-guard.mjs";

function makeFakeRuntime() {
  const auditEntries = [];
  return {
    auditEntries,
    perTaskToolCallCounts: new Map(),
    store: {
      appendAuditLog(entry) { auditEntries.push(entry); return entry; }
    }
  };
}

function makeTask({ taskId = "task_test", toolPolicy = {}, rateLimits = null } = {}) {
  return {
    task_id: taskId,
    task_spec: {
      tool_policy: toolPolicy,
      ...(rateLimits ? { execution_constraints: { rate_limit: rateLimits } } : {})
    }
  };
}

function makeFakeTools() {
  // Two tools: one that always succeeds, one that records its call count
  // so we can confirm execute() actually ran (or did NOT run).
  let webSearchCalls = 0;
  let writeFileCalls = 0;
  return {
    web_search_fetch: {
      id: "web_search_fetch",
      name: "Web search",
      description: "fake",
      parameters: {},
      risk_level: "low",
      required_capabilities: [],
      execute() { webSearchCalls += 1; return { success: true, observation: "fake search ok", artifact_paths: [], error: null, metadata: {} }; }
    },
    write_file: {
      id: "write_file",
      name: "Write file",
      description: "fake",
      parameters: {},
      risk_level: "medium",
      required_capabilities: [],
      execute() { writeFileCalls += 1; return { success: true, observation: "fake write ok", artifact_paths: [], error: null, metadata: {} }; }
    },
    counts: () => ({ webSearchCalls, writeFileCalls })
  };
}

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
  // ── 1. forbidden gate ─────────────────────────────────────────────────────
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.web_search_fetch]);
    const runtime = makeFakeRuntime();
    const task = makeTask({
      toolPolicy: { web_search_fetch: { mode: "forbidden", reason: "Local context only" } }
    });

    const result = await registry.call("web_search_fetch", { query: "x" }, { runtime, task });

    it("forbidden: returns success:false", () => assert.equal(result.success, false));
    it("forbidden: error code is blocked_by_policy", () => assert.equal(result.error, "blocked_by_policy"));
    it("forbidden: tool.execute did NOT run", () => assert.equal(tools.counts().webSearchCalls, 0));
    it("forbidden: observation cites the policy reason", () => assert.match(result.observation, /Local context only/));
    it("forbidden: writes audit entry with subtype tool.blocked_by_policy", () => {
      assert.equal(runtime.auditEntries.length, 1);
      assert.equal(runtime.auditEntries[0].event_subtype, "tool.blocked_by_policy");
      assert.equal(runtime.auditEntries[0].task_id, "task_test");
      assert.equal(runtime.auditEntries[0].payload.tool_id, "web_search_fetch");
    });
  })();

  // ── 2. rate limit ─────────────────────────────────────────────────────────
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.write_file]);
    const runtime = makeFakeRuntime();
    const task = makeTask({ taskId: "task_rate" });

    const limit = DEFAULT_RATE_LIMITS.write_file;
    let ranSuccessfully = 0;
    let blockedByRate = 0;
    for (let i = 0; i < limit + 2; i += 1) {
      const r = await registry.call("write_file", { path: `q${i}.txt` }, { runtime, task });
      if (r.success) ranSuccessfully += 1;
      else if (r.error === "rate_limited") blockedByRate += 1;
    }

    it("rate_limit: succeeds exactly `limit` times", () => assert.equal(ranSuccessfully, limit));
    it("rate_limit: blocks subsequent calls", () => assert.equal(blockedByRate, 2));
    it("rate_limit: tool.execute ran exactly `limit` times", () =>
      assert.equal(tools.counts().writeFileCalls, limit));
    it("rate_limit: counter equals limit (does not increment past it)", () =>
      assert.equal(getRateLimitUsage(runtime, "task_rate", "write_file"), limit));
    it("rate_limit: emits one audit per blocked call", () => {
      const blocks = runtime.auditEntries.filter((e) => e.event_subtype === "tool.rate_limited");
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0].payload.limit, limit);
    });
  })();

  // ── 3. uncapped tools: external web is governed by research/loop budgets ──
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.web_search_fetch]);
    const runtime = makeFakeRuntime();
    const task = makeTask({ taskId: "task_web_uncapped" });

    for (let i = 0; i < 20; i += 1) {
      const r = await registry.call("web_search_fetch", { query: `q${i}` }, { runtime, task });
      if (!r.success) throw new Error(`web call ${i} unexpectedly failed`);
    }
    it("uncapped web_search_fetch: no default per-tool quota", () =>
      assert.equal(tools.counts().webSearchCalls, 20));
    it("uncapped web_search_fetch: counter remains zero", () =>
      assert.equal(getRateLimitUsage(runtime, "task_web_uncapped", "web_search_fetch"), 0));
  })();

  // ── 4. uncapped custom tool, no policy: passes through ────────────────────
  await (async () => {
    const fakeTool = {
      id: "harmless_local",
      name: "Harmless",
      description: "no policy, no rate cap",
      parameters: {},
      risk_level: "low",
      required_capabilities: [],
      called: 0,
      execute() { this.called += 1; return { success: true, observation: "ok", artifact_paths: [], error: null, metadata: {} }; }
    };
    const registry = createActionToolRegistry([fakeTool]);
    const runtime = makeFakeRuntime();
    const task = makeTask({ taskId: "task_pass" });

    for (let i = 0; i < 20; i += 1) {
      const r = await registry.call("harmless_local", {}, { runtime, task });
      if (!r.success) throw new Error(`call ${i} unexpectedly failed`);
    }
    it("uncapped: passes through 20+ calls without blocking", () =>
      assert.equal(fakeTool.called, 20));
    it("uncapped: writes no audit entries", () =>
      assert.equal(runtime.auditEntries.length, 0));
  })();

  // ── 5. mode=optional and mode=required do NOT block ───────────────────────
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.web_search_fetch]);
    const runtime = makeFakeRuntime();

    const taskOptional = makeTask({ taskId: "task_opt",
      toolPolicy: { web_search_fetch: { mode: "optional", reason: "weak signal" } } });
    const r1 = await registry.call("web_search_fetch", { query: "x" }, { runtime, task: taskOptional });
    it("optional: does not block", () => assert.equal(r1.success, true));

    const taskRequired = makeTask({ taskId: "task_req",
      toolPolicy: { web_search_fetch: { mode: "required", reason: "explicit_external" } } });
    const r2 = await registry.call("web_search_fetch", { query: "x" }, { runtime, task: taskRequired });
    it("required: does not block", () => assert.equal(r2.success, true));
  })();

  // ── 6. graceful degradation when ctx is bare ──────────────────────────────
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.web_search_fetch]);

    const r = await registry.call("web_search_fetch", { query: "x" }, {});
    it("bare ctx: passes through (no runtime, no task)", () => assert.equal(r.success, true));

    const r2 = await registry.call("web_search_fetch", { query: "x" }, undefined);
    it("undefined ctx: passes through", () => assert.equal(r2.success, true));
  })();

  // ── 7. task-level rate-limit override ─────────────────────────────────────
  await (async () => {
    const tools = makeFakeTools();
    const registry = createActionToolRegistry([tools.write_file]);
    const runtime = makeFakeRuntime();
    const task = makeTask({
      taskId: "task_override",
      rateLimits: { write_file: 1 } // override default of 6
    });

    await registry.call("write_file", { path: "a.txt" }, { runtime, task });
    const second = await registry.call("write_file", { path: "b.txt" }, { runtime, task });
    it("task override: respects custom rate limit (1, not default 6)", () => {
      assert.equal(second.success, false);
      assert.equal(second.error, "rate_limited");
    });
  })();

  // ── 8. unknown tool still throws (we do not gate on policy first) ─────────
  await (async () => {
    const registry = createActionToolRegistry([]);
    const runtime = makeFakeRuntime();
    const task = makeTask({});

    let threw = false;
    try { await registry.call("does_not_exist", {}, { runtime, task }); }
    catch (err) { threw = err.message.includes("Unknown tool"); }
    it("unknown tool: throws as before (guard does not swallow)", () => assert.equal(threw, true));
  })();

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
