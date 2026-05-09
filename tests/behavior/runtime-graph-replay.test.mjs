import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIME_GRAPH_CHECKPOINT_EVENT,
  RUNTIME_GRAPH_SCHEMA_VERSION
} from "../../src/service/core/graph/runtime-graph-checkpoints.mjs";
import {
  buildRuntimeGraphForkSeed,
  buildRuntimeGraphReplayPlan,
  createRuntimeGraphReplayService,
  listRuntimeGraphCheckpoints
} from "../../src/service/core/graph/runtime-graph-replay.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function makeStore({ status = "interrupted", resumeToken = "approval_1" } = {}) {
  const task = {
    task_id: "task_graph_replay",
    conversation_id: "conv_graph_replay",
    parent_task_id: null,
    context_packet: {
      runtime_graph: {
        graph_id: "rgraph_task_graph_replay"
      }
    }
  };
  const checkpoint = {
    schema_version: RUNTIME_GRAPH_SCHEMA_VERSION,
    checkpoint_id: "rgcp_target",
    task_id: task.task_id,
    session_id: "session_graph_replay",
    conversation_id: task.conversation_id,
    graph_id: "rgraph_task_graph_replay",
    node: "act",
    status,
    input: {
      source_event_id: "evt_approval",
      source_event_type: "pending_approval_created"
    },
    output: {},
    error: null,
    resume_token: resumeToken,
    summary: "approval checkpoint",
    created_at: "2026-01-01T00:00:02.000Z"
  };
  const events = [
    {
      event_id: "evt_started",
      task_id: task.task_id,
      ts: "2026-01-01T00:00:00.000Z",
      event_type: "started",
      payload: { status: "running", message: "started" }
    },
    {
      event_id: "evt_approval",
      task_id: task.task_id,
      ts: "2026-01-01T00:00:01.000Z",
      event_type: "pending_approval_created",
      payload: { approval_id: "approval_1", tool_id: "account_send_email" }
    },
    {
      event_id: "evt_checkpoint",
      task_id: task.task_id,
      ts: "2026-01-01T00:00:02.000Z",
      event_type: RUNTIME_GRAPH_CHECKPOINT_EVENT,
      payload: checkpoint
    }
  ];
  return {
    task,
    events,
    getTask(id) {
      return id === task.task_id ? task : null;
    },
    getTaskEvents(id) {
      return id === task.task_id ? [...events] : [];
    },
    getTaskMessages(id) {
      return id === task.task_id
        ? [{ message_id: "msg_trigger", task_id: id, relation: "triggered", created_at: "2026-01-01T00:00:00.000Z" }]
        : [];
    },
    getMessage(id) {
      if (id !== "msg_trigger") return null;
      return {
        message_id: id,
        conversation_id: task.conversation_id,
        seq: 4,
        role: "user",
        content: "continue from here"
      };
    },
    getLatestConversationSession(conversationId) {
      return conversationId === task.conversation_id
        ? { session_id: "session_latest", conversation_id: conversationId }
        : null;
    }
  };
}

test("runtime graph replay lists durable checkpoint events only", () => {
  const store = makeStore();

  const checkpoints = listRuntimeGraphCheckpoints({ store, taskId: store.task.task_id });

  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].checkpoint_id, "rgcp_target");
  assert.equal(checkpoints[0].checkpoint_event_id, "evt_checkpoint");
  assert.equal(checkpoints[0].source_event_id, "evt_approval");
});

test("runtime graph replay plan builds a bounded prefix without replaying checkpoint events", () => {
  const store = makeStore();

  const result = buildRuntimeGraphReplayPlan({
    store,
    taskId: store.task.task_id,
    checkpointId: "rgcp_target"
  });

  assert.equal(result.ok, true);
  assert.equal(result.replay.source_checkpoint_id, "rgcp_target");
  assert.equal(result.replay.resume.kind, "approval_resume");
  assert.equal(result.replay.resume.resume_token, "approval_1");
  assert.deepEqual(
    result.replay.event_prefix.map((event) => event.event_type),
    ["started", "pending_approval_created"]
  );
});

test("runtime graph replay marks failed checkpoints as retryable node resumes", () => {
  const store = makeStore({ status: "failed", resumeToken: null });

  const result = buildRuntimeGraphReplayPlan({
    store,
    taskId: store.task.task_id,
    node: "act",
    status: "failed"
  });

  assert.equal(result.ok, true);
  assert.equal(result.replay.resume.kind, "retry_from_node");
  assert.equal(result.replay.node, "act");
});

test("runtime graph fork seed carries conversation and session prefix metadata", () => {
  const store = makeStore();

  const result = buildRuntimeGraphForkSeed({
    store,
    taskId: store.task.task_id,
    checkpointId: "rgcp_target"
  });

  assert.equal(result.ok, true);
  assert.equal(result.fork_seed.parent_task_id, store.task.task_id);
  assert.equal(result.fork_seed.conversation_prefix.source_conversation_id, store.task.conversation_id);
  assert.equal(result.fork_seed.conversation_prefix.through_message_id, "msg_trigger");
  assert.equal(result.fork_seed.conversation_prefix.through_seq, 4);
  assert.equal(result.fork_seed.session_prefix.source_session_id, "session_graph_replay");
  assert.equal(result.fork_seed.task_context_patch.runtime_graph_fork.source_checkpoint_id, "rgcp_target");
  assert.equal(result.fork_seed.task_context_patch.runtime_graph_replay.resume.kind, "approval_resume");
});

test("runtime services wires runtimeGraphReplay independently of checkpoint writing", () => {
  const store = makeStore();
  const runtime = { store };

  ensureRuntimeServices(runtime);

  assert.ok(runtime.runtimeGraphReplay);
  const service = createRuntimeGraphReplayService({ store });
  assert.equal(runtime.runtimeGraphReplay.listCheckpoints(store.task.task_id).length, 1);
  assert.equal(service.getCheckpoint(store.task.task_id, "rgcp_target").checkpoint_id, "rgcp_target");
});
