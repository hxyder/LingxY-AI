import { emitTaskEvent } from "./task-runtime/event-emitter.mjs";
import { updateTask } from "./task-runtime/task-lifecycle.mjs";
import { ensureRuntimeServices } from "./task-runtime/runtime-services.mjs";

export {
  flushTaskLogs,
  readTaskEventLog
} from "./task-runtime/event-log.mjs";
export {
  appendTaskOutcomeMessage,
  attachPriorBackendMessages,
  backfillConversationTitles,
  deriveConversationTitle,
  ensureConversation,
  shouldAutoResolveParentFromConversation
} from "./task-runtime/conversation-lifecycle.mjs";
export { emitTaskEvent } from "./task-runtime/event-emitter.mjs";
export { createTaskRecord } from "./task-runtime/task-record.mjs";
export { ensureRuntimeServices } from "./task-runtime/runtime-services.mjs";
export { submitTaskWithConversation } from "./task-runtime/task-submission.mjs";
export {
  applyExecutorEvent,
  markTaskFailed,
  markTaskSucceeded,
  refreshCompositeParentStatus,
  registerActiveExecution,
  unregisterActiveExecution,
  updateTask
} from "./task-runtime/task-lifecycle.mjs";

export async function cancelTask({ runtime, taskId, force = false } = {}) {
  ensureRuntimeServices(runtime);
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }

  if (["success", "failed", "cancelled", "unsupported"].includes(task.status)) {
    return task;
  }

  // Force path: skip the polite executor.cancel() round-trip and mark
  // the task cancelled in the store immediately. Used when the user
  // clicks "stop" a second time after the first request hasn't taken
  // effect (executor stuck in an LLM stream that doesn't honour
  // cancel signals quickly). The downstream worker may still run for
  // a few seconds — that's a backend concern — but at least the
  // task's exposed state matches the user's intent.
  const wasCancelling = task.status === "cancelling";
  const shouldForce = force || wasCancelling;

  if (!wasCancelling) {
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
  }

  const activeExecution = runtime.activeExecutions.get(taskId);
  if (activeExecution?.cancel && !shouldForce) {
    await activeExecution.cancel();
  } else {
    updateTask(runtime, task, {
      status: "cancelled",
      sub_status: "user_interrupted",
      failure_category: "user_interrupted",
      failure_user_message: shouldForce
        ? "任务已被手动取消（强制）。底层执行器可能仍在响应，但状态已置为已取消。"
        : "任务已被手动取消，可在调整后重新执行。",
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
