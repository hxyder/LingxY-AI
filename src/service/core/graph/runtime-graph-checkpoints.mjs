import crypto from "node:crypto";

export const RUNTIME_GRAPH_SCHEMA_VERSION = "1.0";
export const RUNTIME_GRAPH_CHECKPOINT_EVENT = "runtime_graph_checkpoint";

export const RUNTIME_GRAPH_NODES = Object.freeze([
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

export const RUNTIME_GRAPH_EDGES = Object.freeze([
  ["ingest", "resolve_session"],
  ["resolve_session", "resolve_followup"],
  ["resolve_followup", "compile_context"],
  ["compile_context", "plan"],
  ["plan", "act"],
  ["act", "validate"],
  ["validate", "synthesize"],
  ["synthesize", "persist_session"]
]);

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanString(value, max = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function nodeForEvent(eventType, payload = {}) {
  switch (eventType) {
    case "task_created":
      return { node: "ingest", status: "completed" };
    case "accepted":
      return { node: "resolve_session", status: "completed" };
    case "started":
      return { node: "plan", status: "started" };
    case "planner_request_started":
    case "provider_resolved":
      return { node: "plan", status: "started" };
    case "tool_call_started":
    case "tool_call_proposed":
      return { node: "act", status: "started" };
    case "tool_call_completed":
      return { node: "act", status: payload?.success === false ? "failed" : "completed" };
    case "tool_call_denied":
      return { node: "act", status: "interrupted" };
    case "pending_approval_created":
      return { node: "act", status: "interrupted", resumeToken: payload?.approval_id ?? null };
    case "approval_resume_started":
      return { node: "act", status: "started", resumeToken: payload?.approval_id ?? null };
    case "artifact_created":
      return { node: "validate", status: "completed" };
    case "final_composer_started":
      return { node: "synthesize", status: "started" };
    case "success":
    case "partial_success":
      return { node: "synthesize", status: "completed" };
    case "failed":
      return { node: payload?.node ?? "act", status: "failed" };
    case "cancelled":
      return { node: payload?.node ?? "act", status: "interrupted" };
    case "status_changed":
      if (payload?.status === "success" || payload?.status === "partial_success") {
        return { node: "persist_session", status: "completed" };
      }
      if (payload?.status === "failed") return { node: payload?.node ?? "act", status: "failed" };
      if (payload?.status === "cancelled") return { node: payload?.node ?? "act", status: "interrupted" };
      return null;
    default:
      return null;
  }
}

function firstSelectedValue(task, key) {
  const selected = task?.context_packet?.compiled_context?.selected;
  if (!Array.isArray(selected)) return null;
  for (const item of selected) {
    if (item?.value?.[key] != null && item.value[key] !== "") return item.value[key];
  }
  return null;
}

function resolveSessionId(task, runtime) {
  const fromContext = firstSelectedValue(task, "session_id");
  if (fromContext) return fromContext;
  try {
    return runtime?.conversationSessions
      ?.getLatestForConversation?.(task?.conversation_id)
      ?.session_id ?? null;
  } catch {
    return null;
  }
}

export function buildTaskRuntimeGraph({
  taskId = null,
  conversationId = null,
  parentTaskId = null,
  sessionId = null
} = {}) {
  return {
    schema_version: RUNTIME_GRAPH_SCHEMA_VERSION,
    graph_id: taskId ? `rgraph_${taskId}` : newId("rgraph"),
    task_id: taskId,
    conversation_id: conversationId,
    parent_task_id: parentTaskId,
    session_id: sessionId,
    nodes: RUNTIME_GRAPH_NODES.map((node, index) => ({
      id: node,
      order: index
    })),
    edges: RUNTIME_GRAPH_EDGES.map(([from, to]) => ({ from, to }))
  };
}

export function createRuntimeGraphCheckpoint({
  task,
  runtime = null,
  eventType,
  payload = {},
  sourceEvent = null
} = {}) {
  if (!task?.task_id || eventType === RUNTIME_GRAPH_CHECKPOINT_EVENT) return null;
  const mapped = nodeForEvent(eventType, payload);
  if (!mapped) return null;
  const sessionId = resolveSessionId(task, runtime);
  return {
    schema_version: RUNTIME_GRAPH_SCHEMA_VERSION,
    checkpoint_id: newId("rgcp"),
    task_id: task.task_id,
    session_id: sessionId,
    conversation_id: task.conversation_id ?? null,
    parent_task_id: task.parent_task_id ?? null,
    graph_id: task.context_packet?.runtime_graph?.graph_id ?? `rgraph_${task.task_id}`,
    node: mapped.node,
    status: mapped.status,
    input: {
      source_event_type: eventType,
      source_event_id: sourceEvent?.event_id ?? null
    },
    output: {
      tool_id: payload?.tool_id ?? payload?.tool ?? null,
      artifact_id: payload?.artifact_id ?? null,
      artifact_path: payload?.path ?? payload?.artifact_path ?? null,
      status: payload?.status ?? null
    },
    error: payload?.error ?? payload?.message ?? null,
    resume_token: mapped.resumeToken ?? null,
    summary: cleanString(payload?.message ?? payload?.text ?? payload?.tool_id ?? payload?.tool ?? eventType),
    created_at: nowIso()
  };
}

export function createRuntimeGraphCheckpointService({ store, eventBus = null, metrics = null } = {}) {
  if (typeof store?.appendEvent !== "function" || typeof store?.getTask !== "function") {
    throw new Error("RuntimeGraphCheckpointService requires store.appendEvent and store.getTask");
  }

  function recordTaskEvent({ taskId, eventType, payload = {}, event = null, runtime = null } = {}) {
    const task = store.getTask(taskId);
    const checkpoint = createRuntimeGraphCheckpoint({
      task,
      runtime,
      eventType,
      payload,
      sourceEvent: event
    });
    if (!checkpoint) return null;
    const record = {
      event_id: newId("evt"),
      task_id: task.task_id,
      ts: checkpoint.created_at,
      event_type: RUNTIME_GRAPH_CHECKPOINT_EVENT,
      payload: checkpoint
    };
    store.appendEvent(record);
    eventBus?.publish?.(record);
    metrics?.incrementRuntimeCounter?.("runtime_graph.checkpoint", 1, {
      source: "runtime_graph",
      node: checkpoint.node,
      status: checkpoint.status
    });
    return record;
  }

  return {
    buildTaskRuntimeGraph,
    recordTaskEvent
  };
}
