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

function buildHistoryRecord(task, runtime) {
  const parts = [
    task.user_command,
    task.intent,
    task.context_packet?.title,
    task.context_packet?.text,
    task.context_packet?.url,
    task.context_packet?.file_paths?.join(" "),
    task.failure_user_message
  ];

  // UCA-064: For composite tasks include child task content so history search
  // can find sub-task text and subtasks don't silently disappear from history.
  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0 && runtime) {
    const children = task.child_task_ids
      .map((id) => runtime.store?.getTask(id))
      .filter(Boolean);
    for (const child of children) {
      if (child.user_command) parts.push(child.user_command);
      if (child.failure_user_message) parts.push(child.failure_user_message);
    }
  }

  // Also include result_summary if the executor produced one
  if (task.result_summary) parts.push(task.result_summary);

  const text = parts.filter(Boolean).join("\n");

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

// UCA-061: Event types that should be forwarded to the conversation view as
// step labels. Other events (e.g. status_changed on every tick) are too noisy.
const CONVERSATION_VISIBLE_EVENTS = new Set([
  "step_started",
  "tool_call_proposed",
  "tool_call_completed",
  "tool_call_denied",
  "failed",
  "cancelled"
]);

const TOOL_STEP_LABELS = {
  launch_app: "启动应用",
  open_url: "打开链接",
  web_search_fetch: "搜索网络",
  compose_email: "撰写邮件",
  send_email_smtp: "发送邮件",
  open_file: "打开文件",
  write_file: "写入文件",
  verify_file_exists: "验证文件",
  find_recent_files: "查找文件",
  glob_files: "查找文件",
  list_files: "列出文件",
  stat_file: "检查文件",
  register_artifact: "注册结果",
  resolve_output_path: "确定输出路径",
  notify: "发送通知",
  copy_to_clipboard: "复制到剪贴板",
  generate_document: "生成文档",
  take_screenshot: "截图",
  translate_text: "翻译内容",
  run_script: "执行脚本"
};

const STEP_LABELS = {
  tool_planner: "规划操作步骤",
  llm_generate: "生成内容",
  composite_running: "并行执行子任务",
  agentic: "AI 分析规划中"
};

function buildConversationStepLabel(eventType, payload) {
  if (eventType === "tool_call_proposed") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    return label ? `▸ ${label}…` : null;
  }
  if (eventType === "tool_call_completed") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    const ok = payload?.success !== false;
    return label ? `${ok ? "✓" : "✗"} ${label}` : null;
  }
  if (eventType === "tool_call_denied") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    return label ? `⊘ ${label}（已拦截）` : null;
  }
  if (eventType === "step_started") {
    const step = payload?.step ?? "";
    const label = STEP_LABELS[step] ?? step;
    return label ? `▸ ${label}…` : null;
  }
  if (eventType === "failed") {
    const msg = payload?.message ?? payload?.category ?? "未知错误";
    return `✗ 任务失败：${String(msg).slice(0, 60)}`;
  }
  return null;
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

  // UCA-061: Forward qualifying events as conversation_step so the overlay
  // can render real-time step indicators without polling.
  if (CONVERSATION_VISIBLE_EVENTS.has(eventType)) {
    const stepLabel = buildConversationStepLabel(eventType, payload);
    if (stepLabel) {
      runtime.eventBus.publish({
        event_id: createId("step"),
        task_id: taskId,
        ts: nowIso(),
        event_type: "conversation_step",
        payload: {
          step_label: stepLabel,
          source_event: eventType,
          tool_id: payload?.tool_id ?? payload?.tool ?? null
        }
      });
    }
  }

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
  const historyRecord = buildHistoryRecord(task, runtime);
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

  // UCA-064: For composite tasks, build a result_summary listing every
  // subtask outcome so the overlay can show "已完成 3/3 个任务" instead of "Done."
  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0) {
    const children = task.child_task_ids
      .map((id) => runtime.store.getTask(id))
      .filter(Boolean);
    if (children.length > 0) {
      const successCount = children.filter((c) => c.status === "success" || c.status === "partial_success").length;
      const failCount = children.filter((c) => c.status === "failed" || c.status === "cancelled").length;
      const lines = children.map((c, i) => {
        const icon = (c.status === "success" || c.status === "partial_success") ? "✓" : "✗";
        return `${i + 1}. ${icon} ${c.user_command ?? c.intent ?? c.task_id}`;
      });
      task.result_summary = [
        `已完成 ${successCount}/${children.length} 个任务${failCount > 0 ? `（${failCount} 个失败）` : ""}`,
        ...lines
      ].join("\n");
    }
  }

  runtime.store.updateTask(task.task_id, task);
  const historyRecord = buildHistoryRecord(task, runtime);
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
