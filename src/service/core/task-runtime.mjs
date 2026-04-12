import crypto from "node:crypto";
import { classifyFailure } from "../failures/classifier.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createPendingApprovalService } from "../scheduler/pending-approvals.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildSourceDedupeKey(contextPacket, userCommand, executor) {
  const textKey = contextPacket.text?.trim()?.slice(0, 240);
  const sourceKey = contextPacket.file_paths?.join("|")
    ?? ((contextPacket.source_type === "text_selection" || contextPacket.source_type === "text") && textKey
      ? textKey
      : null)
    ?? contextPacket.url
    ?? textKey
    ?? contextPacket.source_type;
  return `${contextPacket.source_type}:${contextPacket.source_app}:${executor}:${userCommand}:${sourceKey}`;
}

function buildHistoryRecord(task) {
  const text = [
    task.user_command,
    task.intent,
    task.context_packet?.title,
    task.context_packet?.text,
    task.context_packet?.url,
    task.context_packet?.file_paths?.join(" "),
    task.failure_user_message
  ].filter(Boolean).join("\n");

  if (!text) {
    return null;
  }

  return {
    id: task.task_id,
    text,
    metadata: {
      summary: task.user_command ?? task.intent ?? task.task_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
      status: task.status,
      source_type: task.context_packet?.source_type ?? "unknown",
      intent: task.intent,
      executor: task.executor
    }
  };
}

export function ensureRuntimeServices(runtime) {
  runtime.activeExecutions ??= new Map();
  runtime.metrics ??= createMetricsRegistry({
    store: runtime.store,
    queue: runtime.queue
  });
  runtime.securityBroker ??= createSecurityBroker({ runtime });
  runtime.pendingApprovals ??= createPendingApprovalService({ runtime });
  return runtime;
}

export function createTaskRecord({
  route,
  contextPacket,
  userCommand,
  executionMode,
  parentTaskId = null,
  childTaskIds = null,
  childIndex = null,
  retryCount = 0,
  executorOverride = null
}) {
  return {
    task_id: createId("task"),
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "queued",
    sub_status: "queued",
    progress: 0,
    current_step: null,
    completed_steps: [],
    remaining_steps_estimate: [],
    failure_category: null,
    failure_user_message: null,
    failure_internal_log_excerpt: null,
    retryable: true,
    parent_task_id: parentTaskId,
    child_task_ids: Array.isArray(childTaskIds) ? childTaskIds : null,
    child_index: Number.isInteger(childIndex) ? childIndex : null,
    retry_count: retryCount,
    bypass_dedupe: retryCount > 0,
    executor_history: [],
    intent: route.intent,
    executor: executorOverride ?? route.executor,
    user_command: userCommand,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
    context_packet: contextPacket,
    source_dedupe_key: buildSourceDedupeKey(
      contextPacket,
      userCommand,
      executorOverride ?? route.executor
    )
  };
}

function listChildTasks(runtime, parentTask) {
  if (!parentTask) return [];
  const childIds = Array.isArray(parentTask.child_task_ids) ? parentTask.child_task_ids : [];
  if (childIds.length > 0) {
    return childIds.map((id) => runtime.store.getTask(id)).filter(Boolean);
  }
  return runtime.store.listTasks().filter((task) => task.parent_task_id === parentTask.task_id && task.child_index != null);
}

function aggregateCompositeStatus(childTasks) {
  if (childTasks.length === 0) {
    return { status: "running", sub_status: "composite_waiting", progress: 0 };
  }

  const statuses = childTasks.map((task) => task.status);
  // UCA-056: Progress counts only successful/partial outcomes, NOT failures.
  // A failed subtask should show as failure_count in the UI, not inflate progress.
  const succeeded = statuses.filter((s) => s === "success" || s === "partial_success").length;
  const failed = statuses.filter((s) => s === "failed" || s === "cancelled").length;
  const total = childTasks.length;
  const progress = Math.min(1, succeeded / total);

  // UCA-056: Include failure_count in all return values so UI can show "2/5 failed"
  if (statuses.every((status) => status === "success")) {
    return { status: "success", sub_status: "completed", progress: 1, failure_count: 0 };
  }

  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => status === "partial_success")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => ["running", "queued", "cancelling"].includes(status))) {
    return { status: "running", sub_status: "composite_running", progress, failure_count: failed };
  }

  return { status: "running", sub_status: "composite_pending", progress, failure_count: failed };
}

export function refreshCompositeParentStatus(runtime, parentTaskId) {
  // UCA-056: Re-read parent task inside this call to avoid stale state from
  // concurrent child completions. If another child already updated the parent
  // between our read and write, we just emit the latest state (eventual consistency).
  const parentTask = runtime.store.getTask(parentTaskId);
  if (!parentTask) return null;
  const childTasks = listChildTasks(runtime, parentTask);
  const aggregate = aggregateCompositeStatus(childTasks);
  const previousStatus = parentTask.status;
  updateTask(runtime, parentTask, {
    status: aggregate.status,
    sub_status: aggregate.sub_status,
    progress: aggregate.progress,
    failure_count: aggregate.failure_count ?? 0
  }, true);
  return {
    parentTask,
    previousStatus,
    aggregate
  };
}

export function emitTaskEvent({ runtime, taskId, eventType, payload }) {
  const record = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: eventType,
    payload
  };

  runtime.store.appendEvent(record);
  runtime.eventBus.publish(record);
  return record;
}

export function updateTask(runtime, task, patch, emitStatus = false) {
  const previousStatus = task.status;
  Object.assign(task, patch, { updated_at: nowIso() });
  runtime.store.updateTask(task.task_id, task);

  if (emitStatus && previousStatus !== task.status) {
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "status_changed",
      payload: {
        previous_status: previousStatus,
        status: task.status,
        sub_status: task.sub_status,
        progress: task.progress
      }
    });
  }

  if (task.parent_task_id && task.child_index != null && previousStatus !== task.status) {
    refreshCompositeParentStatus(runtime, task.parent_task_id);
  }

  return task;
}

export function registerActiveExecution(runtime, taskId, executionControl) {
  runtime.activeExecutions.set(taskId, executionControl);
}

export function unregisterActiveExecution(runtime, taskId) {
  runtime.activeExecutions.delete(taskId);
}

export function applyExecutorEvent(runtime, task, event) {
  if (event.type === "step_started") {
    updateTask(runtime, task, {
      current_step: event.step ?? null,
      sub_status: event.step ?? "running",
      progress: event.progress ?? task.progress
    });
  }

  if (event.type === "step_finished") {
    const step = event.step ?? null;
    if (step && !task.completed_steps.includes(step)) {
      updateTask(runtime, task, {
        completed_steps: [...task.completed_steps, step]
      });
    }
  }

  if (event.type === "success") {
    // UCA-056: Guard against duplicate success events — executor should only succeed once
    if (task.status === "success") {
      return; // already succeeded, ignore duplicate
    }
    updateTask(runtime, task, {
      status: "success",
      sub_status: "completed",
      progress: 1
    }, true);
  }

  if (event.type === "partial_success") {
    if (task.status === "success") {
      return; // don't downgrade a success to partial_success retroactively
    }
    updateTask(runtime, task, {
      status: "partial_success",
      sub_status: "completed_with_warnings",
      progress: event.progress ?? task.progress
    }, true);
  }
}

export function markTaskFailed(runtime, task, errorLike) {
  const failure = classifyFailure(errorLike);
  updateTask(runtime, task, {
    status: failure.category === "user_interrupted" ? "cancelled" : "failed",
    sub_status: failure.category,
    failure_category: failure.category,
    failure_user_message: failure.userMessage,
    failure_internal_log_excerpt: failure.internalExcerpt,
    retryable: failure.retryable
  }, true);

  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: failure.category === "user_interrupted" ? "cancelled" : "failed",
    payload: {
      category: failure.category,
      message: failure.userMessage,
      user_actions: failure.userActions,
      internal_excerpt: failure.internalExcerpt
    }
  });

  task.executor_history = [
    ...task.executor_history,
    {
      executor: task.executor,
      outcome: task.status,
      ended_at: task.updated_at
    }
  ];
  runtime.store.updateTask(task.task_id, task);
  const historyRecord = buildHistoryRecord(task);
  if (historyRecord) {
    runtime.platform?.embeddingStore?.add(historyRecord);
  }
  runtime.securityBroker?.clearTaskRedactionMap(task.task_id);
  runtime.queue.markFinished(task.task_id);
  return failure;
}

export function markTaskSucceeded(runtime, task) {
  const freshTask = runtime.store.getTask(task.task_id) ?? task;
  Object.assign(task, freshTask);
  task.executor_history = [
    ...(task.executor_history ?? []),
    {
      executor: task.executor,
      outcome: task.status,
      ended_at: nowIso()
    }
  ];
  runtime.store.updateTask(task.task_id, task);
  const historyRecord = buildHistoryRecord(task);
  if (historyRecord) {
    runtime.platform?.embeddingStore?.add(historyRecord);
  }
  runtime.securityBroker?.clearTaskRedactionMap(task.task_id);
  runtime.queue.markFinished(task.task_id);
}

export async function cancelTask({ runtime, taskId }) {
  ensureRuntimeServices(runtime);
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }

  if (["success", "failed", "cancelled", "unsupported"].includes(task.status)) {
    return task;
  }

  updateTask(runtime, task, {
    status: "cancelling",
    sub_status: "cancelling"
  }, true);

  emitTaskEvent({
    runtime,
    taskId,
    eventType: "cancel_requested",
    payload: { by: "user" }
  });

  const activeExecution = runtime.activeExecutions.get(taskId);
  if (activeExecution?.cancel) {
    await activeExecution.cancel();
  } else {
    updateTask(runtime, task, {
      status: "cancelled",
      sub_status: "user_interrupted",
      failure_category: "user_interrupted",
      failure_user_message: "任务已被手动取消，可在调整后重新执行。",
      retryable: true
    }, true);
    emitTaskEvent({
      runtime,
      taskId,
      eventType: "cancelled",
      payload: {
        category: "user_interrupted"
      }
    });
    runtime.queue.markFinished(taskId);
  }

  return task;
}
