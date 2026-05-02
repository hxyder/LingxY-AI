import test from "node:test";
import assert from "node:assert/strict";

import {
  inferSearchRecencyFromText,
  resolveTaskMaxIterations,
  shouldCheckSaturation
} from "../../src/service/executors/tool_using/loop-policy.mjs";

test("agent loop policy infers conservative search recency buckets", () => {
  assert.equal(inferSearchRecencyFromText("今天的 AI 新闻"), "day");
  assert.equal(inferSearchRecencyFromText("recent model releases"), "month");
  assert.equal(inferSearchRecencyFromText("近 7 天安全事件"), "week");
  assert.equal(inferSearchRecencyFromText("今年融资趋势"), "year");
  assert.equal(inferSearchRecencyFromText("解释一下 transformer"), null);
});

test("agent loop policy gates saturation nudges to multi-source research", () => {
  assert.equal(shouldCheckSaturation({ task_spec: { research_quality: { profile: "multi_source_research" } } }), true);
  assert.equal(shouldCheckSaturation({ task_spec: { research_quality: { profile: "deep_research" } } }), true);
  assert.equal(shouldCheckSaturation({ task_spec: { research_quality: { profile: "single_lookup" } } }), false);
  assert.equal(shouldCheckSaturation({ task_spec: {} }), false);
});

test("agent loop policy resolves exact task iteration budgets with a hard cap", () => {
  assert.equal(resolveTaskMaxIterations({ task_spec: { execution_constraints: { max_iterations: 12 } } }, 8), 12);
  assert.equal(resolveTaskMaxIterations({ task_spec: { execution_constraints: { max_iterations: 99 } } }, 8), 24);
  assert.equal(resolveTaskMaxIterations({ task_spec: { execution_constraints: { max_iterations: 0 } } }, 8), 8);
  assert.equal(resolveTaskMaxIterations({}, 6), 6);
});
