import crypto from "node:crypto";
import {
  RUNTIME_GRAPH_CHECKPOINT_EVENT,
  RUNTIME_GRAPH_NODES,
  RUNTIME_GRAPH_SCHEMA_VERSION
} from "./runtime-graph-checkpoints.mjs";

const DEFAULT_REPLAY_EVENT_LIMIT = 80;
const MAX_REPLAY_EVENT_LIMIT = 200;

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clampLimit(value, fallback = DEFAULT_REPLAY_EVENT_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), MAX_REPLAY_EVENT_LIMIT));
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max = 320) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function eventSummary(event = {}) {
  const payload = event.payload ?? {};
  return {
    event_id: event.event_id ?? null,
    ts: event.ts ?? null,
    event_type: event.event_type ?? null,
    payload: {
      status: payload.status ?? null,
      tool_id: payload.tool_id ?? payload.tool ?? null,
      artifact_id: payload.artifact_id ?? null,
      approval_id: payload.approval_id ?? null,
      message: payload.message ? cleanText(payload.message) : null
    }
  };
}

function normalizeCheckpointEvent(event = {}) {
  const payload = event.payload ?? {};
  if (event.event_type !== RUNTIME_GRAPH_CHECKPOINT_EVENT || !payload.checkpoint_id) return null;
  return {
    ...cloneJson(payload),
    checkpoint_event_id: event.event_id ?? null,
    checkpoint_event_ts: event.ts ?? payload.created_at ?? null,
    source_event_id: payload.input?.source_event_id ?? null,
    source_event_type: payload.input?.source_event_type ?? null
  };
}

function chooseCheckpoint(checkpoints, { checkpointId = null, node = null, status = null } = {}) {
  const reversed = [...checkpoints].reverse();
  if (checkpointId) {
    return checkpoints.find((checkpoint) => checkpoint.checkpoint_id === checkpointId) ?? null;
  }
  return reversed.find((checkpoint) => (
    (!node || checkpoint.node === node)
    && (!status || checkpoint.status === status)
  )) ?? null;
}

function resumeKindForCheckpoint(checkpoint) {
  if (checkpoint?.resume_token) return "approval_resume";
  if (checkpoint?.status === "failed") return "retry_from_node";
  if (checkpoint?.status === "interrupted") return "fork_from_interruption";
  return "fork_from_prefix";
}

function findTriggeredMessage(store, taskId) {
  if (typeof store?.getTaskMessages !== "function" || typeof store?.getMessage !== "function") return null;
  const links = store.getTaskMessages(taskId) ?? [];
  const triggered = links.find((link) => link.relation === "triggered") ?? links[0] ?? null;
  if (!triggered?.message_id) return null;
  const message = store.getMessage(triggered.message_id);
  if (!message) return null;
  return {
    message_id: message.message_id,
    conversation_id: message.conversation_id,
    seq: Number.isFinite(Number(message.seq)) ? Number(message.seq) : null
  };
}

function latestSessionForTask(store, task) {
  if (typeof store?.getLatestConversationSession !== "function" || !task?.conversation_id) return null;
  return store.getLatestConversationSession(task.conversation_id) ?? null;
}

export function listRuntimeGraphCheckpoints({ store, taskId } = {}) {
  if (!taskId || typeof store?.getTaskEvents !== "function") return [];
  return (store.getTaskEvents(taskId) ?? [])
    .map((event) => normalizeCheckpointEvent(event))
    .filter(Boolean);
}

export function getRuntimeGraphCheckpoint({ store, taskId, checkpointId } = {}) {
  if (!checkpointId) return null;
  return listRuntimeGraphCheckpoints({ store, taskId })
    .find((checkpoint) => checkpoint.checkpoint_id === checkpointId) ?? null;
}

export function buildRuntimeGraphReplayPlan({
  store,
  taskId,
  checkpointId = null,
  node = null,
  status = null,
  maxEvents = DEFAULT_REPLAY_EVENT_LIMIT
} = {}) {
  if (!taskId || typeof store?.getTask !== "function" || typeof store?.getTaskEvents !== "function") {
    return { ok: false, error: "runtime graph replay store not available" };
  }
  const task = store.getTask(taskId);
  if (!task) return { ok: false, error: "task not found" };
  const checkpoints = listRuntimeGraphCheckpoints({ store, taskId });
  const checkpoint = chooseCheckpoint(checkpoints, { checkpointId, node, status });
  if (!checkpoint) return { ok: false, error: "checkpoint not found" };

  const events = store.getTaskEvents(taskId) ?? [];
  const sourceIndex = checkpoint.source_event_id
    ? events.findIndex((event) => event.event_id === checkpoint.source_event_id)
    : -1;
  const checkpointIndex = checkpoint.checkpoint_event_id
    ? events.findIndex((event) => event.event_id === checkpoint.checkpoint_event_id)
    : -1;
  const prefixEnd = sourceIndex >= 0 ? sourceIndex : checkpointIndex;
  const limit = clampLimit(maxEvents);
  const prefix = prefixEnd >= 0
    ? events
      .slice(0, prefixEnd + 1)
      .filter((event) => event.event_type !== RUNTIME_GRAPH_CHECKPOINT_EVENT)
      .slice(-limit)
      .map((event) => eventSummary(event))
    : [];

  return {
    ok: true,
    replay: {
      schema_version: RUNTIME_GRAPH_SCHEMA_VERSION,
      replay_id: newId("rgreplay"),
      source_task_id: task.task_id,
      source_conversation_id: task.conversation_id ?? null,
      source_checkpoint_id: checkpoint.checkpoint_id,
      checkpoint_event_id: checkpoint.checkpoint_event_id,
      source_event_id: checkpoint.source_event_id,
      graph_id: checkpoint.graph_id ?? task.context_packet?.runtime_graph?.graph_id ?? null,
      node: checkpoint.node,
      node_order: RUNTIME_GRAPH_NODES.indexOf(checkpoint.node),
      status: checkpoint.status,
      resume: {
        kind: resumeKindForCheckpoint(checkpoint),
        resume_token: checkpoint.resume_token ?? null
      },
      cursor: {
        source_event_id: checkpoint.source_event_id,
        checkpoint_event_id: checkpoint.checkpoint_event_id,
        source_event_type: checkpoint.source_event_type,
        event_prefix_count: prefix.length
      },
      event_prefix: prefix
    },
    task,
    checkpoint
  };
}

export function buildRuntimeGraphForkSeed({
  store,
  taskId,
  checkpointId = null,
  node = null,
  status = null,
  maxEvents = DEFAULT_REPLAY_EVENT_LIMIT
} = {}) {
  const plan = buildRuntimeGraphReplayPlan({
    store,
    taskId,
    checkpointId,
    node,
    status,
    maxEvents
  });
  if (!plan.ok) return plan;
  const { task, checkpoint, replay } = plan;
  const triggeredMessage = findTriggeredMessage(store, task.task_id);
  const latestSession = latestSessionForTask(store, task);
  const sourceSessionId = checkpoint.session_id ?? latestSession?.session_id ?? null;
  return {
    ok: true,
    fork_seed: {
      schema_version: RUNTIME_GRAPH_SCHEMA_VERSION,
      fork_id: newId("rgfork"),
      source_task_id: task.task_id,
      source_checkpoint_id: checkpoint.checkpoint_id,
      parent_task_id: task.task_id,
      conversation_prefix: {
        source_conversation_id: task.conversation_id ?? null,
        through_message_id: triggeredMessage?.message_id ?? null,
        through_seq: triggeredMessage?.seq ?? null
      },
      session_prefix: {
        source_session_id: sourceSessionId,
        source_conversation_id: task.conversation_id ?? null,
        parent_task_id: task.task_id
      },
      task_context_patch: {
        parent_task_id: task.task_id,
        runtime_graph_fork: {
          source_task_id: task.task_id,
          source_checkpoint_id: checkpoint.checkpoint_id,
          source_node: checkpoint.node,
          source_status: checkpoint.status
        },
        runtime_graph_replay: replay
      }
    }
  };
}

export function createRuntimeGraphReplayService({ store } = {}) {
  if (typeof store?.getTask !== "function" || typeof store?.getTaskEvents !== "function") {
    throw new Error("RuntimeGraphReplayService requires store.getTask and store.getTaskEvents");
  }
  return {
    listCheckpoints: (taskId) => listRuntimeGraphCheckpoints({ store, taskId }),
    getCheckpoint: (taskId, checkpointId) => getRuntimeGraphCheckpoint({ store, taskId, checkpointId }),
    buildReplayPlan: (input = {}) => buildRuntimeGraphReplayPlan({ store, ...input }),
    buildForkSeed: (input = {}) => buildRuntimeGraphForkSeed({ store, ...input })
  };
}
