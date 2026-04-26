#!/usr/bin/env node
/**
 * UCA-077 P4-EB (main plan §17.4.2 / §18.4): error budget engine.
 *
 * Asserts:
 *   1. createErrorBudget initialises with documented defaults +
 *      per-task overrides; per-counter `consumed` starts at 0.
 *   2. chargeBudget:
 *        - increments the matching counter
 *        - returns `exhausted: true` when consumed >= max
 *        - is pure (input state not mutated; new state returned)
 *        - silently no-ops on unknown event names
 *        - returns reason text when exhausted; null otherwise
 *   3. Repeat charges past exhaustion don't double-count beyond max
 *      semantically — exhausted stays true (budget can't un-exhaust).
 *   4. isAnyBudgetExhausted true when ANY counter hits max.
 *   5. listExhaustedCounters returns event names of exhausted counters.
 *   6. snapshotBudget returns a defensive copy.
 *   7. Defaults match the documented values (1 / 2 / 2 / 1) — locked
 *      in so a future `safe-default tweak` is a deliberate change.
 *   8. Override of 0 is honoured (counter starts already-at-ceiling),
 *      matching "this counter is disabled" semantic.
 *
 * Run: node scripts/verify-error-budget.mjs
 */

import assert from "node:assert/strict";

import {
  DEFAULT_BUDGET,
  createErrorBudget,
  chargeBudget,
  snapshotBudget,
  isAnyBudgetExhausted,
  listExhaustedCounters
} from "../src/service/core/runtime/error-budget.mjs";

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
  // ── 1. defaults + initialisation ──────────────────────────────────────
  it("defaults: documented values are 1 / 2 / 2 / 1", () => {
    assert.equal(DEFAULT_BUDGET.max_empty_search_results, 1);
    assert.equal(DEFAULT_BUDGET.max_tool_failures, 2);
    assert.equal(DEFAULT_BUDGET.max_replan_rounds, 2);
    assert.equal(DEFAULT_BUDGET.max_no_file_change_runs, 1);
  });
  it("defaults: DEFAULT_BUDGET frozen", () => {
    assert.throws(() => { DEFAULT_BUDGET.max_tool_failures = 99; });
  });
  it("init: createErrorBudget() yields defaults + zeroed counters", () => {
    const b = createErrorBudget();
    assert.equal(b.max_empty_search_results, 1);
    assert.equal(b.max_tool_failures, 2);
    assert.equal(b.max_replan_rounds, 2);
    assert.equal(b.max_no_file_change_runs, 1);
    assert.equal(b.consumed_empty_search_results, 0);
    assert.equal(b.consumed_tool_failures, 0);
    assert.equal(b.consumed_replan_rounds, 0);
    assert.equal(b.consumed_no_file_change_runs, 0);
  });
  it("init: createErrorBudget honours overrides", () => {
    const b = createErrorBudget({ max_tool_failures: 5, max_replan_rounds: 0 });
    assert.equal(b.max_tool_failures, 5);
    assert.equal(b.max_replan_rounds, 0);
    // un-overridden fields use defaults
    assert.equal(b.max_empty_search_results, 1);
  });
  it("init: invalid override (negative / non-number) falls back to default", () => {
    const b = createErrorBudget({ max_tool_failures: -1 });
    assert.equal(b.max_tool_failures, 2);
    const b2 = createErrorBudget({ max_tool_failures: "x" });
    assert.equal(b2.max_tool_failures, 2);
  });

  // ── 2. chargeBudget ───────────────────────────────────────────────────
  it("charge: increments the matching counter", () => {
    const b = createErrorBudget();
    const r = chargeBudget(b, "tool_failure");
    assert.equal(r.state.consumed_tool_failures, 1);
    // other counters unchanged
    assert.equal(r.state.consumed_replan_rounds, 0);
    assert.equal(r.exhausted, false);
    assert.equal(r.reason, null);
  });
  it("charge: pure — input state is NOT mutated", () => {
    const b = createErrorBudget();
    const before = JSON.stringify(b);
    chargeBudget(b, "tool_failure");
    chargeBudget(b, "tool_failure");
    assert.equal(JSON.stringify(b), before);
  });
  it("charge: returns exhausted:true + reason when budget hit ceiling", () => {
    let b = createErrorBudget();
    let r = chargeBudget(b, "tool_failure");      // 1/2
    b = r.state;
    assert.equal(r.exhausted, false);
    r = chargeBudget(b, "tool_failure");          // 2/2 → exhausted
    assert.equal(r.exhausted, true);
    assert.match(r.reason, /tool_failure budget exhausted/);
    assert.match(r.reason, /2\/2/);
  });
  it("charge: max=1 budget exhausts after a single event", () => {
    let b = createErrorBudget();   // max_empty_search_results=1
    const r = chargeBudget(b, "empty_search_result");
    assert.equal(r.exhausted, true);
  });
  it("charge: unknown event is silent no-op (no crash)", () => {
    const b = createErrorBudget();
    const r = chargeBudget(b, "not_a_known_event");
    assert.equal(r.state, b);
    assert.equal(r.exhausted, false);
    assert.equal(r.reason, null);
  });

  // ── 3. past exhaustion ────────────────────────────────────────────────
  it("charge: counter past ceiling stays exhausted (no un-exhaustion)", () => {
    let b = createErrorBudget();
    b = chargeBudget(b, "tool_failure").state;   // 1/2
    b = chargeBudget(b, "tool_failure").state;   // 2/2 exhausted
    const r = chargeBudget(b, "tool_failure");   // 3/2
    assert.equal(r.exhausted, true);
    assert.equal(r.state.consumed_tool_failures, 3);
  });

  // ── 4. isAnyBudgetExhausted ───────────────────────────────────────────
  it("anyExhausted: false on a fresh budget", () => {
    assert.equal(isAnyBudgetExhausted(createErrorBudget()), false);
  });
  it("anyExhausted: true once any single counter hits its ceiling", () => {
    let b = createErrorBudget();
    b = chargeBudget(b, "empty_search_result").state;   // max=1, exhausted now
    assert.equal(isAnyBudgetExhausted(b), true);
  });
  it("anyExhausted: tolerates null/undefined", () => {
    assert.equal(isAnyBudgetExhausted(null), false);
    assert.equal(isAnyBudgetExhausted(undefined), false);
    assert.equal(isAnyBudgetExhausted({}), false);
  });

  // ── 5. listExhaustedCounters ──────────────────────────────────────────
  it("list: enumerates event names of exhausted counters", () => {
    let b = createErrorBudget();
    b = chargeBudget(b, "empty_search_result").state;
    b = chargeBudget(b, "no_file_change_run").state;
    const exhausted = listExhaustedCounters(b);
    assert.ok(exhausted.includes("empty_search_result"));
    assert.ok(exhausted.includes("no_file_change_run"));
    assert.ok(!exhausted.includes("tool_failure"));
    assert.ok(!exhausted.includes("replan_round"));
  });
  it("list: empty when nothing is exhausted", () => {
    assert.deepEqual(listExhaustedCounters(createErrorBudget()), []);
  });

  // ── 6. snapshotBudget ─────────────────────────────────────────────────
  it("snapshot: returns a defensive copy", () => {
    let b = createErrorBudget();
    b = chargeBudget(b, "tool_failure").state;
    const snap = snapshotBudget(b);
    assert.deepEqual(snap, b);
    // mutate the snapshot — original must be unaffected
    snap.consumed_tool_failures = 999;
    assert.equal(b.consumed_tool_failures, 1);
  });
  it("snapshot: tolerates null/non-object", () => {
    assert.equal(snapshotBudget(null), null);
    assert.equal(snapshotBudget(undefined), null);
  });

  // ── 7. integration shape: the 4 documented BudgetEvent ids resolve ───
  it("events: all 4 documented ids work end-to-end", () => {
    let b = createErrorBudget();
    for (const ev of ["empty_search_result", "tool_failure", "replan_round", "no_file_change_run"]) {
      const r = chargeBudget(b, ev);
      assert.notEqual(r.state, b, `${ev} must produce a new state object`);
      // either consumed went up by exactly 1, or the field is now ≥ 1
      const consumedKey = `consumed_${ev}${ev.endsWith("s") ? "" : "s"}`;
      // accept either form; the canonical mapping in the module owns it
      const before = b[consumedKey] ?? null;
      const after = r.state[consumedKey] ?? null;
      if (before !== null) assert.equal(after, before + 1);
    }
  });

  // ── 8. zero override semantic ────────────────────────────────────────
  it("override: max=0 → already at ceiling on first event", () => {
    const b = createErrorBudget({ max_tool_failures: 0 });
    const r = chargeBudget(b, "tool_failure");
    // 1 >= 0 → exhausted
    assert.equal(r.exhausted, true);
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
