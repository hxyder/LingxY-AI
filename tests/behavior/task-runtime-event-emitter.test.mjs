import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversationStepLabel,
  emitTaskEvent,
  resetTaskEventEmitterStateForTests
} from "../../src/service/core/task-runtime/event-emitter.mjs";

function makeRuntime({ selectionMetadata = null } = {}) {
  const appended = [];
  const published = [];
  const task = {
    task_id: "task_emitter",
    created_at: new Date(Date.now() - 25).toISOString(),
    context_packet: selectionMetadata
      ? { selection_metadata: selectionMetadata }
      : undefined,
    task_spec: {
      suggested_executor: "tool_using",
      tool_policy: { web: "forbidden" },
      decision_trace: [
        { stage: "signals", output: { web: "forbidden" }, reason: "fixture", decision_id: "noise" }
      ]
    }
  };

  return {
    appended,
    published,
    runtime: {
      paths: {},
      store: {
        appendEvent(event) {
          appended.push(event);
          return event;
        },
        getTask(taskId) {
          return taskId === task.task_id ? task : null;
        }
      },
      eventBus: {
        publish(event) {
          published.push(event);
        }
      }
    }
  };
}

test("task event emitter keeps streaming deltas ephemeral and emits first-token and first-visible timing once", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime();

  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "text_delta", payload: { delta: "a" } });
  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "text_delta", payload: { delta: "b" } });

  assert.equal(appended.some((event) => event.event_type === "text_delta"), false);
  assert.equal(appended.filter((event) => event.event_type === "phase_timing").length, 3);
  assert.ok(appended.some((event) => event.payload?.phase === "executor_first_event"));
  assert.ok(appended.some((event) => event.payload?.phase === "executor_first_delta"));
  assert.ok(appended.some((event) => event.payload?.phase === "executor_first_visible_output"));
  assert.equal(published.filter((event) => event.event_type === "text_delta").length, 2);
  assert.equal(published.filter((event) => event.event_type === "phase_timing").length, 3);
});

test("task event emitter records first visible output for non-streaming results", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime();

  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "inline_result", payload: { text: "done" } });
  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "artifact_created", payload: { path: "C:\\tmp\\report.docx" } });

  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_event").length, 1);
  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_delta").length, 0);
  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_visible_output").length, 1);
  assert.equal(published.filter((event) => event.payload?.phase === "executor_first_visible_output").length, 1);
});

test("task event emitter records first executor progress before visible output", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime();

  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "planner_request_started", payload: { iteration: 0 } });
  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "reasoning_delta", payload: { delta: "thinking" } });
  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "inline_result", payload: { text: "done" } });

  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_event").length, 1);
  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_progress").length, 1);
  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_delta").length, 0);
  assert.equal(appended.filter((event) => event.payload?.phase === "executor_first_visible_output").length, 1);
  assert.equal(published.filter((event) => event.event_type === "reasoning_delta").length, 1);
});

test("task event emitter publishes decision trace projection on task_created", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime();

  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "task_created", payload: { route: "general" } });

  const decisionTrace = published.find((event) => event.event_type === "decision_trace");
  assert.ok(decisionTrace);
  assert.deepEqual(decisionTrace.payload.stages, [{
    stage: "signals",
    output: { web: "forbidden" },
    reason: "fixture"
  }]);
  assert.equal(appended.some((event) => event.event_type === "decision_trace"), false);
});

test("task event emitter carries stable submission origin on task_created", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime({
    selectionMetadata: {
      submission_origin: "echo",
      voice_session_id: "echo_test_123"
    }
  });

  emitTaskEvent({ runtime, taskId: "task_emitter", eventType: "task_created", payload: { route: "general" } });

  const created = appended.find((event) => event.event_type === "task_created");
  const live = published.find((event) => event.event_type === "task_created");
  assert.equal(created.payload.submission_origin, "echo");
  assert.equal(created.payload.voice_session_id, "echo_test_123");
  assert.equal(live.payload.submission_origin, "echo");
});

test("task event emitter projects visible tool events into conversation steps", () => {
  resetTaskEventEmitterStateForTests();
  const { runtime, appended, published } = makeRuntime();

  emitTaskEvent({
    runtime,
    taskId: "task_emitter",
    eventType: "tool_call_completed",
    payload: { tool_id: "web_search_fetch", success: true }
  });

  const step = published.find((event) => event.event_type === "conversation_step");
  assert.ok(step);
  assert.equal(step.payload.step_label, "✓ 搜索网络");
  assert.equal(step.payload.source_event, "tool_call_completed");
  assert.equal(step.payload.tool_id, "web_search_fetch");
  assert.equal(appended.some((event) => event.event_type === "conversation_step"), false);
  assert.equal(buildConversationStepLabel("tool_call_denied", { tool_id: "open_file" }), "⊘ 打开文件（已拦截）");
});
