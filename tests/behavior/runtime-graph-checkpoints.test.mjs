import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_GRAPH_CHECKPOINT_EVENT,
  buildTaskRuntimeGraph,
  createRuntimeGraphCheckpointService
} from "../../src/service/core/graph/runtime-graph-checkpoints.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { emitTaskEvent } from "../../src/service/core/task-runtime/event-emitter.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function makeRuntime() {
  const store = createInMemoryStoreScaffold();
  const published = [];
  const runtime = {
    store,
    eventBus: {
      publish(event) {
        published.push(event);
      }
    },
    metrics: {
      incrementRuntimeCounter() {}
    }
  };
  store.insertTask({
    task_id: "task_graph",
    created_at: "2026-05-09T00:00:00.000Z",
    updated_at: "2026-05-09T00:00:00.000Z",
    status: "queued",
    conversation_id: "conv_graph",
    parent_task_id: "task_parent",
    context_packet: {
      runtime_graph: buildTaskRuntimeGraph({
        taskId: "task_graph",
        conversationId: "conv_graph",
        parentTaskId: "task_parent",
        sessionId: "session_graph"
      }),
      compiled_context: {
        selected: [{
          kind: "session_task_anchor",
          value: { session_id: "session_graph" }
        }]
      }
    }
  });
  runtime.runtimeGraph = createRuntimeGraphCheckpointService({
    store,
    eventBus: runtime.eventBus,
    metrics: runtime.metrics
  });
  return { runtime, published };
}

test("runtime graph template defines the main task execution nodes in order", () => {
  const graph = buildTaskRuntimeGraph({
    taskId: "task_graph",
    conversationId: "conv_graph",
    parentTaskId: "task_parent"
  });

  assert.equal(graph.graph_id, "rgraph_task_graph");
  assert.deepEqual(graph.nodes.map((node) => node.id), [
    "ingest",
    "resolve_session",
    "resolve_followup",
    "compile_context",
    "plan",
    "act",
    "validate",
    "synthesize",
    "persist_session"
  ]);
  assert.deepEqual(graph.edges.at(0), { from: "ingest", to: "resolve_session" });
});

test("runtime graph recorder writes typed checkpoints for approval, success, and cancel events", () => {
  const { runtime, published } = makeRuntime();

  emitTaskEvent({
    runtime,
    taskId: "task_graph",
    eventType: "task_created",
    payload: { route: "general" }
  });
  emitTaskEvent({
    runtime,
    taskId: "task_graph",
    eventType: "pending_approval_created",
    payload: { approval_id: "approval_graph", tool_id: "account_send_email" }
  });
  emitTaskEvent({
    runtime,
    taskId: "task_graph",
    eventType: "status_changed",
    payload: { status: "cancelled" }
  });

  const checkpoints = runtime.store.getTaskEvents("task_graph")
    .filter((event) => event.event_type === RUNTIME_GRAPH_CHECKPOINT_EVENT);
  assert.equal(checkpoints.length, 3);
  assert.equal(checkpoints[0].payload.node, "ingest");
  assert.equal(checkpoints[0].payload.status, "completed");
  assert.equal(checkpoints[0].payload.session_id, "session_graph");
  assert.equal(checkpoints[1].payload.node, "act");
  assert.equal(checkpoints[1].payload.status, "interrupted");
  assert.equal(checkpoints[1].payload.resume_token, "approval_graph");
  assert.equal(checkpoints[2].payload.status, "interrupted");
  assert.ok(published.some((event) => event.event_type === RUNTIME_GRAPH_CHECKPOINT_EVENT));
});

test("runtime services wires runtimeGraph when the store exposes task events", () => {
  const runtime = ensureRuntimeServices({
    store: createInMemoryStoreScaffold(),
    eventBus: { publish() {} }
  });

  assert.equal(typeof runtime.runtimeGraph?.recordTaskEvent, "function");
});
