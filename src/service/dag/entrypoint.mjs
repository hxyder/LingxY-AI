/**
 * DAG entry point — the thing context-submission calls when triage says
 * lane === "dag_planner" and the feature flag is enabled.
 *
 * Pipeline (Phase 2 scope — serial, no streaming):
 *   1. plan the DAG (planDag LLM call)
 *   2. if plan is invalid/unavailable → fallback to single-turn executor
 *   3. create a parent task record for UI tracking
 *   4. runDagPlan with createNodeDispatcher
 *   5. mark success/failure, forward the final text/summary
 *
 * Replan + 3-failures-→-single-turn-retry fallback is built in per
 * decision #4.
 */

import crypto from "node:crypto";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  updateTask
} from "../core/task-runtime.mjs";
import { planDag, replanDag } from "./planner.mjs";
import { runDagPlan } from "./executor.mjs";
import { createNodeDispatcher } from "./dispatch.mjs";
import { planDagStreaming } from "./streaming-planner.mjs";
import { createStreamingDagRun } from "./streaming-executor.mjs";

// Decision #4: cap DAG retries. After this many attempts (initial run + N
// replans = MAX_DAG_ATTEMPTS total), the lane falls back to running the
// original command through the single-turn agent.
const MAX_DAG_ATTEMPTS = 3;

function buildDagContextPacket({ userCommand, originalContextPacket = null }) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: originalContextPacket?.source_type ?? "dag_plan",
    source_app: originalContextPacket?.source_app ?? "lingxy.dag",
    capture_mode: "plan",
    security_level: originalContextPacket?.security_level ?? "internal",
    redaction_applied: false,
    text: userCommand,
    file_paths: originalContextPacket?.file_paths ?? [],
    image_paths: originalContextPacket?.image_paths ?? [],
    captured_at: new Date().toISOString()
  };
}

function summariseSnapshot(snapshot, plan) {
  const summary = plan.summary ?? "计划";
  if (snapshot.status === "success") {
    const successful = Object.keys(snapshot.statuses).filter((k) => snapshot.statuses[k] === "success").length;
    return `${summary}（${successful}/${plan.nodes.length} 步完成）`;
  }
  const failed = snapshot.failedNodeId ?? "?";
  return `${summary}（在节点 ${failed} 失败：${snapshot.failure?.message ?? "unknown"}）`;
}

/**
 * Run the DAG lane end-to-end. Returns the same submission shape as
 * submitContextTask so context-submission can return it directly.
 */
export async function runDagLane({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  parentTaskId = null
}) {
  ensureRuntimeServices(runtime);

  // Streaming planner path (Phase 5) — gated so non-streaming stays the
  // default until we're confident across providers. When the feature flag
  // is on, try streaming first; any failure falls back to the batch planner.
  if (runtime?.featureFlags?.dagStreaming === true) {
    const streamed = await runDagLaneStreaming({
      runtime, userCommand, contextPacket, executionMode, parentTaskId
    });
    if (streamed?.task) return streamed;
    // streaming failed silently → continue with the batch path below.
  }

  // 1. Plan (batch)
  const planResult = await planDag({ userCommand, runtime, contextPacket });

  if (!planResult.plan) {
    // Decision #4: DAG-3-failures fallback — here the planner couldn't
    // even produce a valid plan, so skip DAG entirely and hand back to
    // the normal context-submission flow as a single-turn task. The
    // caller signals this by returning { fallbackSingleTurn: true }.
    return { fallbackSingleTurn: true, planReason: planResult.reason };
  }

  // 2. Create parent task record
  const planContextPacket = buildDagContextPacket({ userCommand, originalContextPacket: contextPacket });
  const parentTask = createTaskRecord({
    route: {
      intent: "dag_plan",
      executor: "dag_engine",
      requires_confirmation: false
    },
    contextPacket: planContextPacket,
    userCommand,
    executionMode,
    executorOverride: "dag_engine",
    parentTaskId
  });
  runtime.store.insertTask(parentTask);
  emitTaskEvent({
    runtime,
    taskId: parentTask.task_id,
    eventType: "task_created",
    payload: { kind: "dag_plan", summary: planResult.plan.summary, node_count: planResult.plan.nodes.length }
  });
  updateTask(runtime, parentTask, { status: "running", sub_status: "dag_running", progress: 0 }, true);

  // 3. Run (with replan loop up to MAX_DAG_ATTEMPTS - 1 replans)
  const dispatcher = createNodeDispatcher({ runtime });
  const emit = (event) => emitTaskEvent({
    runtime,
    taskId: parentTask.task_id,
    eventType: `dag.${event.type}`,
    payload: event
  });
  const dispatchForRun = (node, params, ctx) =>
    dispatcher(node, params, { ...ctx, task: parentTask, parentTaskId: parentTask.task_id });

  let currentPlan = planResult.plan;
  let snapshot = await runDagPlan({ plan: currentPlan, dispatchNode: dispatchForRun, onEvent: emit });
  let attempts = 1;
  const accumulatedResults = { ...snapshot.results };

  while (snapshot.status === "failed"
    && snapshot.failure?.policy === "replan"
    && attempts < MAX_DAG_ATTEMPTS) {
    attempts += 1;
    emit({ type: "replan_attempt", attempt: attempts, failed_node_id: snapshot.failedNodeId });

    const replan = await replanDag({
      originalPlan: currentPlan,
      completedResults: accumulatedResults,
      failedNodeId: snapshot.failedNodeId,
      failureMessage: snapshot.failure?.message,
      userCommand,
      runtime,
      contextPacket
    });
    if (!replan.plan) {
      emit({ type: "replan_failed", reason: replan.reason });
      break;
    }

    // Run the replan plan with the completed results pre-seeded so its
    // placeholders can still address upstream successes.
    snapshot = await runDagPlan({
      plan: replan.plan,
      dispatchNode: dispatchForRun,
      onEvent: emit,
      context: { seededResults: accumulatedResults }
    });
    for (const [id, value] of Object.entries(snapshot.results ?? {})) {
      accumulatedResults[id] = value;
    }
    currentPlan = replan.plan;
  }

  // 4. Mark final status
  const replyText = summariseSnapshot(snapshot, planResult.plan);
  if (snapshot.status === "success") {
    updateTask(runtime, parentTask, {
      status: "success",
      sub_status: "dag_completed",
      progress: 1,
      result_summary: replyText
    }, true);
    emitTaskEvent({
      runtime,
      taskId: parentTask.task_id,
      eventType: "inline_result",
      payload: { text: replyText }
    });
    emitTaskEvent({
      runtime,
      taskId: parentTask.task_id,
      eventType: "success",
      payload: { text: replyText }
    });
    markTaskSucceeded(runtime, parentTask);
  } else {
    markTaskFailed(runtime, parentTask, {
      message: replyText,
      category: "dag_failure"
    });
    emitTaskEvent({
      runtime,
      taskId: parentTask.task_id,
      eventType: "inline_result",
      payload: { text: replyText }
    });
  }

  return {
    task: parentTask,
    taskEvents: runtime.store.getTaskEvents(parentTask.task_id),
    dagSnapshot: snapshot
  };
}

/**
 * Streaming variant of runDagLane. The planner LLM emits JSON Lines and the
 * streaming executor dispatches nodes the moment their dependencies are
 * satisfied — no waiting for the whole plan to land. Returns the same
 * submission shape as runDagLane, or null if streaming couldn't produce
 * at least one valid node (caller falls back to batch).
 */
async function runDagLaneStreaming({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  parentTaskId = null
}) {
  // Parent task — created before the stream so timeline events land on it.
  const planContextPacket = buildDagContextPacket({ userCommand, originalContextPacket: contextPacket });
  const parentTask = createTaskRecord({
    route: { intent: "dag_plan_streaming", executor: "dag_engine", requires_confirmation: false },
    contextPacket: planContextPacket,
    userCommand,
    executionMode,
    executorOverride: "dag_engine",
    parentTaskId
  });
  runtime.store.insertTask(parentTask);
  emitTaskEvent({
    runtime,
    taskId: parentTask.task_id,
    eventType: "task_created",
    payload: { kind: "dag_plan_streaming" }
  });
  updateTask(runtime, parentTask, { status: "running", sub_status: "dag_streaming", progress: 0 }, true);

  const dispatcher = createNodeDispatcher({ runtime });
  const run = createStreamingDagRun({
    dispatchNode: (node, params, ctx) =>
      dispatcher(node, params, { ...ctx, task: parentTask, parentTaskId: parentTask.task_id }),
    onEvent(event) {
      emitTaskEvent({
        runtime,
        taskId: parentTask.task_id,
        eventType: `dag.${event.type}`,
        payload: event
      });
    }
  });

  const stream = await planDagStreaming({
    userCommand,
    runtime,
    contextPacket,
    onHeader(header) {
      emitTaskEvent({
        runtime,
        taskId: parentTask.task_id,
        eventType: "dag.plan_header",
        payload: { summary: header.summary, expected_nodes: header.expected_nodes ?? null }
      });
    },
    onNode(node) {
      run.addNode(node);
    }
  });

  if (!stream.ok) {
    // Clean up the parent task record so fallback can proceed cleanly.
    markTaskFailed(runtime, parentTask, {
      message: `streaming planner unavailable: ${stream.reason}`,
      category: "dag_streaming_unavailable"
    });
    return null;
  }

  const snapshot = await run.flush();
  const replyText = summariseSnapshot(snapshot, { summary: stream.header?.summary ?? "计划", nodes: Array(stream.nodeCount) });

  if (snapshot.status === "success") {
    updateTask(runtime, parentTask, {
      status: "success",
      sub_status: "dag_streamed",
      progress: 1,
      result_summary: replyText
    }, true);
    emitTaskEvent({ runtime, taskId: parentTask.task_id, eventType: "inline_result", payload: { text: replyText } });
    emitTaskEvent({ runtime, taskId: parentTask.task_id, eventType: "success", payload: { text: replyText } });
    markTaskSucceeded(runtime, parentTask);
  } else {
    markTaskFailed(runtime, parentTask, { message: replyText, category: "dag_failure" });
    emitTaskEvent({ runtime, taskId: parentTask.task_id, eventType: "inline_result", payload: { text: replyText } });
  }

  return {
    task: parentTask,
    taskEvents: runtime.store.getTaskEvents(parentTask.task_id),
    dagSnapshot: snapshot,
    streamed: true
  };
}
