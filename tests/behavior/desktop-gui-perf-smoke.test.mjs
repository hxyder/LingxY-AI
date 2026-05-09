import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET,
  readDesktopGuiSmokePerfBudget,
  summarizeDesktopGuiSmokePerf,
  validateDesktopGuiSmokePerfResult
} from "../../scripts/gui-smoke-perf-contract.mjs";

function passingResult(overrides = {}) {
  const checks = Array.from({ length: 30 }, (_item, index) => ({
    name: `check_${index}`,
    ok: true
  }));
  return {
    ok: true,
    checks,
    perf: {
      startup_ms: 1200,
      first_window_ready_ms: 1100,
      interaction_ms: 3200,
      total_ms: 4400,
      check_count: checks.length,
      ...overrides
    }
  };
}

test("desktop GUI perf contract accepts bounded smoke metrics", () => {
  const result = validateDesktopGuiSmokePerfResult(passingResult(), {
    startupMs: 2000,
    interactionMs: 5000,
    totalMs: 6000,
    minChecks: 25
  });

  assert.equal(result.ok, true);
  assert.equal(result.perf.check_count, 30);
});

test("desktop GUI perf contract rejects missing and over-budget metrics", () => {
  const missing = validateDesktopGuiSmokePerfResult({ ok: true, checks: [] }, DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET);
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.includes("missing_perf_report"));
  assert.ok(missing.failures.includes("missing_startup_ms"));

  const slow = validateDesktopGuiSmokePerfResult(passingResult({
    startup_ms: 6000,
    first_window_ready_ms: 6000,
    interaction_ms: 7000,
    total_ms: 9000
  }), {
    startupMs: 5000,
    interactionMs: 6000,
    totalMs: 8000,
    minChecks: 25
  });
  assert.equal(slow.ok, false);
  assert.ok(slow.failures.includes("startup_ms_over_budget:6000>5000"));
  assert.ok(slow.failures.includes("interaction_ms_over_budget:7000>6000"));
  assert.ok(slow.failures.includes("total_ms_over_budget:9000>8000"));
});

test("desktop GUI perf contract reads env overrides and summarizes results", () => {
  const budget = readDesktopGuiSmokePerfBudget({
    LINGXY_ELECTRON_GUI_SMOKE_STARTUP_BUDGET_MS: "123",
    LINGXY_ELECTRON_GUI_SMOKE_INTERACTION_BUDGET_MS: "456",
    LINGXY_ELECTRON_GUI_SMOKE_TOTAL_BUDGET_MS: "789",
    LINGXY_ELECTRON_GUI_SMOKE_MIN_CHECKS: "5"
  });

  assert.deepEqual(budget, {
    startupMs: 123,
    interactionMs: 456,
    totalMs: 789,
    minChecks: 5
  });
  assert.match(summarizeDesktopGuiSmokePerf(passingResult()), /startup=1200ms/);
  assert.match(summarizeDesktopGuiSmokePerf(passingResult()), /checks=30/);
});
