import test from "node:test";
import assert from "node:assert/strict";

import {
  isSideEffectTool,
  toolResultHasSubstance,
  transcriptHasSuccessfulToolCall
} from "../../src/service/executors/tool_using/tool-call-guards.mjs";

test("agent tool-call guards classify side-effect tools by policy group and registry risk", () => {
  const registry = {
    get(id) {
      if (id === "custom_delete") return { id, risk_level: "high" };
      if (id === "read_only") return { id, risk_level: "low" };
      return null;
    }
  };

  assert.equal(isSideEffectTool({ id: "send_email_smtp" }, registry), true);
  assert.equal(isSideEffectTool({ id: "custom_delete" }, registry), true);
  assert.equal(isSideEffectTool({ id: "approval_tool", requires_confirmation: true }, registry), true);
  assert.equal(isSideEffectTool({ id: "read_only" }, registry), false);
  assert.equal(isSideEffectTool(null, registry), false);
});

test("agent tool-call guards only count successful prior tool calls", () => {
  const transcript = [
    { type: "tool_result", tool: "send_email_smtp", success: false },
    { type: "tool_result", tool: "send_email_smtp", success: true, error: "" },
    { type: "tool_result", tool: "account_upload_file", success: true, error: "failed later" },
    { type: "tool_denied", tool: "notify" }
  ];

  assert.equal(transcriptHasSuccessfulToolCall(transcript, "send_email_smtp"), true);
  assert.equal(transcriptHasSuccessfulToolCall(transcript, "account_upload_file"), false);
  assert.equal(transcriptHasSuccessfulToolCall(transcript, "notify"), false);
  assert.equal(transcriptHasSuccessfulToolCall(transcript, null), false);
});

test("agent tool-call guards detect substantive external-read results", () => {
  assert.equal(toolResultHasSubstance({ results: [{ title: "A" }] }), true);
  assert.equal(toolResultHasSubstance({ sources: [{ url: "https://example.com" }] }), true);
  assert.equal(toolResultHasSubstance({
    observation: "This observation has enough content to count as meaningful evidence."
  }), true);
  assert.equal(toolResultHasSubstance({
    nested: ["one item"]
  }), true);
  assert.equal(toolResultHasSubstance({ observation: "too short" }), false);
  assert.equal(toolResultHasSubstance(null), false);
});
