import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { createPendingApprovalService } from "../scheduler/pending-approvals.mjs";
import {
  deriveConversationTitle,
  ensureConversation,
  isSchedulerSourced
} from "./task-runtime/conversation-lifecycle.mjs";
import { emitTaskEvent } from "./task-runtime/event-emitter.mjs";
import { updateTask } from "./task-runtime/task-lifecycle.mjs";
import { createTaskRecord } from "./task-runtime/task-record.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";

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
export {
  applyExecutorEvent,
  markTaskFailed,
  markTaskSucceeded,
  refreshCompositeParentStatus,
  registerActiveExecution,
  unregisterActiveExecution,
  updateTask
} from "./task-runtime/task-lifecycle.mjs";

export function ensureRuntimeServices(runtime) {
  runtime.activeExecutions ??= new Map();
  // UCA-077 P4-04.5: registry must be a singleton on the runtime so that
  // tool_using / agentic / fast all see the same set of tools (including
  // any registered MCP / plugin tools) AND share the per-task rate-limit
  // counters bound to runtime.perTaskToolCallCounts. Service-bootstrap
  // populates this in production; this fallback covers test harnesses
  // and other narrow runtimes that bypass full bootstrap.
  runtime.actionToolRegistry ??= createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  runtime.metrics ??= createMetricsRegistry({
    store: runtime.store,
    queue: runtime.queue
  });
  runtime.securityBroker ??= createSecurityBroker({ runtime });
  // UCA-182 Phase 20: wire executeApprovedAction so approving a
  // source_type="agent_tool_call" record actually runs the tool the
  // agent had proposed. Previously the hook was unset, so users
  // could approve an "account_send_email" card all day and nothing
  // happened. Keeps other source_types (schedule / manual) as they
  // were — only agent_tool_call is newly handled here.
  runtime.pendingApprovals ??= createPendingApprovalService({
    runtime,
    executeApprovedAction: async (approval) => {
      if (approval.source_type !== "agent_tool_call") return null;
      const toolId = approval.proposed_target || approval.metadata?.tool_id;
      if (!toolId) return null;
      const tool = runtime.actionToolRegistry?.get?.(toolId);
      if (!tool || typeof tool.execute !== "function") {
        return { executed: false, reason: "tool_not_found", tool_id: toolId };
      }
      try {
        const result = await tool.execute(approval.proposed_params ?? {}, {
          ...(runtime.toolContext ?? {}),
          runtime,
          task: approval.metadata?.task_id ? runtime.store?.getTask?.(approval.metadata.task_id) : null,
          outputDir: runtime.toolContext?.outputDir ?? null
        });
        return {
          executed: true,
          tool_id: toolId,
          success: Boolean(result?.success),
          observation: result?.observation ?? null
        };
      } catch (error) {
        return { executed: true, tool_id: toolId, success: false, error: error.message };
      }
    }
  });
  return runtime;
}

function auditSubmissionBoundary(runtime, task) {
  if (!runtime || !task?.submission_boundary) return null;
  try {
    return appendAuditLog(
      runtime,
      "submission.boundary_evaluated",
      task.submission_boundary.audit_payload ?? task.submission_boundary,
      task.task_id
    );
  } catch {
    return null;
  }
}

export function submitTaskWithConversation(params) {
  const { runtime, parentMessageId = null, projectId = null, clientMessageId = null } = params;
  const task = createTaskRecord(params);
  if (!runtime?.store?.runInTransaction) {
    runtime.store.insertTask(task);
    auditSubmissionBoundary(runtime, task);
    return { task, userMessage: null, conversation: null };
  }
  return runtime.store.runInTransaction(() => {
    const conversation = ensureConversation(runtime, {
      conversationId: task.conversation_id,
      projectId
    });

    // Auto-title freshly created conversations from the first user
    // command so the sidebar / list reads as recognizable text. Skip
    // when the title was already set (user renamed it, or a follow-up
    // task is reusing the conversation).
    if (conversation && !parentMessageId && !conversation.title && runtime.store?.updateConversation) {
      const derivedTitle = deriveConversationTitle(task.user_command);
      if (derivedTitle) {
        const updated = runtime.store.updateConversation(conversation.conversation_id, { title: derivedTitle });
        if (updated) Object.assign(conversation, updated);
      }
    }

    let userMessage = null;
    if (conversation && !parentMessageId) {
      const role = isSchedulerSourced(task.context_packet) ? "system" : "user";
      const metadata = {
        source_app: task.context_packet?.source_app,
        execution_mode: task.execution_mode
      };
      if (typeof clientMessageId === "string" && clientMessageId.trim()) {
        metadata.client_message_id = clientMessageId.trim().slice(0, 128);
      }
      userMessage = runtime.store.appendMessage({
        conversation_id: conversation.conversation_id,
        role,
        content: task.user_command,
        metadata
      });
    }

    runtime.store.insertTask(task);
    auditSubmissionBoundary(runtime, task);

    const messageIdToLink = parentMessageId ?? userMessage?.message_id ?? null;
    if (messageIdToLink) {
      runtime.store.linkMessageToTask(messageIdToLink, task.task_id, "triggered");
    }

    return { task, userMessage, conversation };
  });
}

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
