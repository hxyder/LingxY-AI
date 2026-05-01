import { classifyFailure } from "../../failures/classifier.mjs";
import { extractToolSequence, recordToolSequence } from "../skill-pattern-tracker.mjs";
import {
  aggregateCompositeStatus,
  listChildTasks
} from "./composite-status.mjs";
import { appendTaskOutcomeMessage } from "./conversation-lifecycle.mjs";
import { emitTaskEvent } from "./event-emitter.mjs";

function nowIso() {
  return new Date().toISOString();
}

// UCA-182 Phase 18: compact cap on record text so the embedding store
// doesn't bloat with entire clipped web pages.
const HISTORY_TEXT_CAP = 2000;
const HISTORY_CTX_TEXT_CAP = 600;
const HISTORY_ANSWER_CAP = 800;

function buildHistoryRecord(task, runtime) {
  const parts = [
    task.user_command,
    task.intent,
    task.context_packet?.title,
    String(task.context_packet?.text ?? "").slice(0, HISTORY_CTX_TEXT_CAP),
    task.context_packet?.url,
    task.context_packet?.file_paths?.join(" "),
    task.failure_user_message
  ];

  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0 && runtime) {
    const children = task.child_task_ids
      .map((id) => runtime.store?.getTask(id))
      .filter(Boolean);
    for (const child of children) {
      if (child.user_command) parts.push(child.user_command);
      if (child.failure_user_message) parts.push(child.failure_user_message);
    }
  }

  if (task.result_summary) parts.push(task.result_summary);

  let answerText = "";
  let artifactPaths = [];
  if (runtime?.store?.getTaskEvents) {
    try {
      const events = runtime.store.getTaskEvents(task.task_id) ?? [];
      const finalEvent = [...events].reverse().find((event) =>
        event.event_type === "success" || event.event_type === "inline_result"
      );
      answerText = String(finalEvent?.payload?.text ?? "").slice(0, HISTORY_ANSWER_CAP);
      artifactPaths = events
        .filter((event) => event.event_type === "artifact_created")
        .map((event) => String(event.payload?.path ?? ""))
        .filter((artifactPath) => artifactPath && !artifactPath.endsWith("-preview.html") && !artifactPath.endsWith("-preview.txt"))
        .slice(0, 6);
    } catch {
      // History indexing is best-effort and must not affect task completion.
    }
  }
  if (answerText) parts.push(answerText);
  if (artifactPaths.length) parts.push(artifactPaths.join(" "));

  const text = parts.filter(Boolean).join("\n").slice(0, HISTORY_TEXT_CAP);
  if (!text) return null;

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
      executor: task.executor,
      answer_excerpt: answerText || null,
      artifact_paths: artifactPaths
    }
  };
}

export function refreshCompositeParentStatus(runtime, parentTaskId) {
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
    if (task.status === "success") return;
    const successText = typeof event.text === "string" ? event.text.trim() : "";
    const patch = {
      status: "success",
      sub_status: "completed",
      progress: 1
    };
    if (successText && !task.result_summary) {
      patch.result_summary = successText;
    }
    updateTask(runtime, task, patch, true);
  }

  if (event.type === "partial_success") {
    if (task.status === "success") return;
    const partialText = typeof event.text === "string" ? event.text.trim() : "";
    const patch = {
      status: "partial_success",
      sub_status: event.sub_status ?? "completed_with_warnings",
      progress: event.progress ?? task.progress
    };
    if (partialText && !task.result_summary) {
      patch.result_summary = partialText;
    }
    updateTask(runtime, task, patch, true);
  }

  if (event.type === "failed") {
    if (["success", "partial_success", "failed", "cancelled"].includes(task.status)) {
      return;
    }
    const failure = classifyFailure({
      message: event.message ?? event.text ?? event.error ?? "Executor failed.",
      category: event.category
    });
    updateTask(runtime, task, {
      status: "failed",
      sub_status: failure.category,
      failure_category: failure.category,
      failure_user_message: failure.userMessage,
      failure_internal_log_excerpt: failure.internalExcerpt,
      retryable: failure.retryable
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
  appendTaskOutcomeMessage(runtime, task);
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

  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0) {
    const children = task.child_task_ids
      .map((id) => runtime.store.getTask(id))
      .filter(Boolean);
    if (children.length > 0) {
      const successCount = children.filter((child) => child.status === "success" || child.status === "partial_success").length;
      const failCount = children.filter((child) => child.status === "failed" || child.status === "cancelled").length;
      const lines = children.map((child, index) => {
        const icon = (child.status === "success" || child.status === "partial_success") ? "✓" : "✗";
        return `${index + 1}. ${icon} ${child.user_command ?? child.intent ?? child.task_id}`;
      });
      task.result_summary = [
        `已完成 ${successCount}/${children.length} 个任务${failCount > 0 ? `（${failCount} 个失败）` : ""}`,
        ...lines
      ].join("\n");
    }
  }

  runtime.store.updateTask(task.task_id, task);
  appendTaskOutcomeMessage(runtime, task);
  const historyRecord = buildHistoryRecord(task, runtime);
  if (historyRecord) {
    runtime.platform?.embeddingStore?.add(historyRecord);
  }

  try {
    const skillPatternsPath = runtime.paths?.skillPatternsPath ?? null;
    if (skillPatternsPath) {
      const taskEvents = runtime.store.getTaskEvents?.(task.task_id) ?? [];
      const toolSequence = extractToolSequence(taskEvents);
      const proposal = recordToolSequence(skillPatternsPath, {
        taskId: task.task_id,
        command: task.user_command,
        toolSequence
      });
      if (proposal) {
        emitTaskEvent({
          runtime,
          taskId: task.task_id,
          eventType: "skill_proposal",
          payload: {
            text: `💡 此操作流程已重复执行 ${proposal.count} 次：${proposal.tools.join(" → ")}\n是否保存为可复用技能「${proposal.suggestedName}」？`,
            proposal
          }
        });
      }
    }
  } catch {
    // Auto-skill suggestions are advisory; never fail task completion.
  }

  runtime.securityBroker?.clearTaskRedactionMap(task.task_id);
  runtime.queue.markFinished(task.task_id);
}
