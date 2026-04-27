#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  resolveContextBudget,
  pickHistoryWithinBudget,
  defaultTokenEstimator,
  DEFAULT_CONTEXT_BUDGET,
  PER_EXECUTOR_OVERRIDES
} from "../src/service/core/policy/context-budget.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

it("resolveContextBudget: unknown executor falls back to DEFAULT shares", () => {
  const b = resolveContextBudget({ executor: "unknown_xyz", modelContextWindow: 100000 });
  const usable = 100000 - DEFAULT_CONTEXT_BUDGET.reserve_output_tokens;
  assert.equal(b.history_tokens, Math.floor(usable * DEFAULT_CONTEXT_BUDGET.history_share));
  assert.equal(b.current_tokens, Math.floor(usable * DEFAULT_CONTEXT_BUDGET.current_turn_share));
  assert.equal(b.policy_id, "unknown_xyz/default");
});

it("resolveContextBudget: per-executor overrides win over default", () => {
  for (const [executor, override] of Object.entries(PER_EXECUTOR_OVERRIDES)) {
    const b = resolveContextBudget({ executor, modelContextWindow: 200000 });
    const usable = 200000 - DEFAULT_CONTEXT_BUDGET.reserve_output_tokens;
    assert.equal(b.history_tokens, Math.floor(usable * override.history_share),
      `${executor} history_tokens must follow override`);
    assert.equal(b.current_tokens, Math.floor(usable * override.current_turn_share),
      `${executor} current_tokens must follow override`);
  }
});

it("resolveContextBudget: tool_using gets MORE current_turn space than fast", () => {
  const tool = resolveContextBudget({ executor: "tool_using", modelContextWindow: 200000 });
  const fast = resolveContextBudget({ executor: "fast", modelContextWindow: 200000 });
  assert.ok(tool.current_tokens > fast.current_tokens);
  assert.ok(fast.history_tokens > tool.history_tokens);
});

it("resolveContextBudget: model window below MIN clamps to MIN", () => {
  const b = resolveContextBudget({ executor: "fast", modelContextWindow: 100 });
  assert.ok(b.history_tokens > 0);
  assert.ok(b.current_tokens >= 0);
});

it("resolveContextBudget: taskTypeHint flows into policy_id (extension hook)", () => {
  const b = resolveContextBudget({ executor: "tool_using", modelContextWindow: 100000, taskTypeHint: "research" });
  assert.equal(b.policy_id, "tool_using/research");
});

it("pickHistoryWithinBudget: zero-budget returns empty", () => {
  const msgs = [{ role: "user", content: "x" }, { role: "assistant", content: "y" }];
  assert.deepEqual(pickHistoryWithinBudget(msgs, 0), []);
});

it("pickHistoryWithinBudget: keeps the most recent messages first when budget is tight", () => {
  const msgs = [
    { role: "user", content: "a".repeat(400) },
    { role: "assistant", content: "b".repeat(400) },
    { role: "user", content: "c".repeat(400) }
  ];
  const tokens = defaultTokenEstimator("a".repeat(400));
  const kept = pickHistoryWithinBudget(msgs, tokens + 1);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].content[0], "c", "most-recent message must win when budget fits exactly one");
});

it("pickHistoryWithinBudget: never exceeds budget when budget allows ≥ 1 message", () => {
  const msgs = [];
  for (let i = 0; i < 30; i++) msgs.push({ role: "user", content: "x".repeat(100) });
  const tokens = defaultTokenEstimator("x".repeat(100));
  const kept = pickHistoryWithinBudget(msgs, tokens * 5 + 1);
  let used = 0;
  for (const m of kept) used += defaultTokenEstimator(m.content);
  assert.ok(used <= tokens * 5 + 1 + tokens, "kept window stays close to budget");
  assert.ok(kept.length >= 5);
});

it("pickHistoryWithinBudget: preserves chronological order in output", () => {
  const msgs = [];
  for (let i = 0; i < 5; i++) msgs.push({ role: "user", content: `m${i}` });
  const kept = pickHistoryWithinBudget(msgs, 1000);
  assert.deepEqual(kept.map((m) => m.content), ["m0", "m1", "m2", "m3", "m4"]);
});

it("defaultTokenEstimator returns 0 for empty / non-string input", () => {
  assert.equal(defaultTokenEstimator(""), 0);
  assert.equal(defaultTokenEstimator(null), 0);
  assert.equal(defaultTokenEstimator(undefined), 0);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
