import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeLookupTool() {
  return {
    id: "lookup_fixture",
    name: "Lookup Fixture",
    description: "Returns a deterministic observation for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["value"],
      properties: {
        value: { type: "string" }
      }
    },
    async execute(args) {
      return {
        success: true,
        observation: `observed:${args.value}`,
        metadata: { source: "behavior-test" }
      };
    }
  };
}

function makeRuntime(overrides = {}) {
  const events = [];
  const auditLog = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([makeLookupTool()]),
    toolContext: {},
    toolOutputDir: null,
    securityBroker: {
      authorizeToolCall() {
        return { allowed: true, reason: null };
      }
    },
    store: {
      appendAuditLog(entry) {
        auditLog.push(entry);
      }
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    ...overrides
  };
  return { runtime, events, auditLog };
}

function makeTask() {
  return {
    task_id: "task_agent_loop_behavior",
    user_command: "Use the fixture and answer from its result.",
    execution_mode: "interactive",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "answer from fixture" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    }
  };
}

test("agent loop carries tool_result into the next planner turn and final composer", async () => {
  const { runtime, events } = makeRuntime({
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "lookup_fixture"
        && entry.observation === "observed:alpha"
      ));
      return "final: observed:alpha";
    }
  });
  const plannerSnapshots = [];

  const planner = async ({ transcript, iteration }) => {
    plannerSnapshots.push(transcript.map((entry) => ({
      type: entry.type,
      tool: entry.tool,
      observation: entry.observation
    })));
    if (iteration === 0) {
      return { type: "tool_call", tool: "lookup_fixture", args: { value: "alpha" } };
    }
    assert.ok(transcript.some((entry) =>
      entry.type === "tool_result"
      && entry.tool === "lookup_fixture"
      && entry.observation === "observed:alpha"
    ));
    return { type: "final", text: "Planner saw the fixture result." };
  };

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "final: observed:alpha");
  assert.equal(plannerSnapshots.length, 2);
  assert.deepEqual(plannerSnapshots[0], []);
  assert.equal(plannerSnapshots[1][0].type, "tool_result");
  assert.equal(plannerSnapshots[1][0].observation, "observed:alpha");
  assert.ok(events.some((event) => event.eventType === "tool_call_completed" && event.payload?.success === true));
});

test("agent loop falls back to collected tool results when final composition throws", async () => {
  const { runtime } = makeRuntime({
    finalAnswerComposer: async () => {
      throw new Error("fake composer timeout");
    }
  });

  const planner = async ({ transcript, iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "lookup_fixture", args: { value: "beta" } };
    }
    assert.ok(transcript.some((entry) => entry.observation === "observed:beta"));
    return { type: "final", text: "Planner final after tool." };
  };

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.match(result.final_text, /observed:beta/);
  assert.ok(!/fake composer timeout/.test(result.final_text));
});
