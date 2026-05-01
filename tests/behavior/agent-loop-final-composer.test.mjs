import test from "node:test";
import assert from "node:assert/strict";

import { composeFinalAnswer } from "../../src/service/executors/tool_using/final-composer.mjs";

test("agent final composer uses injected composer and emits timing events", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "summarize the tool result",
      task_spec: { goal: "answer" }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "A useful result."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async ({ reason }) => `composed:${reason}`
    },
    reason: "unit_test"
  });

  assert.equal(text, "composed:unit_test");
  assert.equal(events[0]?.event_type, "final_composer_started");
  assert.ok(events.some((entry) =>
    entry.event_type === "phase_timing"
    && entry.payload?.phase === "final_composer"
    && entry.payload?.reason === "unit_test"
  ));
});

test("agent final composer falls back to collected tool observations when composition throws", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "What did the tool find?",
      task_spec: { goal: "answer" }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "The collected answer is 42."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async () => {
        throw new Error("composer unavailable");
      }
    },
    reason: "composer_error"
  });

  assert.match(text, /The collected answer is 42/);
  assert.doesNotMatch(text, /composer unavailable/);
  assert.ok(events.some((entry) => entry.event_type === "phase_timing"));
});
