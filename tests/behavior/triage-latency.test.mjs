import assert from "node:assert/strict";
import test from "node:test";

import { shouldDeferPreExecutionPlanning } from "../../src/service/core/context-submission.mjs";
import { triage } from "../../src/service/core/intent/triage.mjs";

test("triage does not block on SemanticRouter for immediate requests without time phrases", async () => {
  let preflightCalls = 0;
  const result = await triage({
    runtime: { featureFlags: {} },
    userCommand: "分析当前页面并总结要点",
    contextPacket: {},
    executionMode: "interactive",
    background: false,
    preflight: async () => {
      preflightCalls += 1;
      throw new Error("preflight should be deferred");
    }
  });

  assert.equal(result.lane, "single_turn");
  assert.equal(preflightCalls, 0);
});

test("triage still runs SemanticRouter when a time phrase may create a schedule", async () => {
  let preflightCalls = 0;
  const result = await triage({
    runtime: { featureFlags: {} },
    userCommand: "明天下午3点提醒我吃饭",
    contextPacket: {},
    executionMode: "interactive",
    background: false,
    preflight: async ({ contextPacket }) => {
      preflightCalls += 1;
      return contextPacket;
    }
  });

  assert.equal(result.lane, "single_turn");
  assert.equal(preflightCalls, 1);
});

test("context submission defers pre-execution planning for immediate requests", () => {
  assert.equal(shouldDeferPreExecutionPlanning({
    background: false,
    userCommand: "分析当前页面"
  }), true);
  assert.equal(shouldDeferPreExecutionPlanning({
    background: false,
    userCommand: "明天上午8点提醒我"
  }), false);
  assert.equal(shouldDeferPreExecutionPlanning({
    background: true,
    userCommand: "明天上午8点提醒我"
  }), true);
});
