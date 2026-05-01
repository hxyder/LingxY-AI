import crypto from "node:crypto";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { createPendingApprovalService } from "../scheduler/pending-approvals.mjs";
import { createTaskSpec, validateTaskSpec } from "./task-spec.mjs";
import { evaluateSubmissionBoundary } from "./policy/submission-boundary.mjs";
import {
  attachParentTaskSummary,
  attachPriorBackendMessages,
  deriveConversationTitle,
  ensureConversation,
  isSchedulerSourced,
  resolveParentFromConversation,
  shouldAutoResolveParentFromConversation
} from "./task-runtime/conversation-lifecycle.mjs";
import { emitTaskEvent } from "./task-runtime/event-emitter.mjs";
import { updateTask } from "./task-runtime/task-lifecycle.mjs";
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
export {
  applyExecutorEvent,
  markTaskFailed,
  markTaskSucceeded,
  refreshCompositeParentStatus,
  registerActiveExecution,
  unregisterActiveExecution,
  updateTask
} from "./task-runtime/task-lifecycle.mjs";

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

export function createTaskRecord({
  route,
  contextPacket,
  userCommand,
  executionMode,
  parentTaskId = null,
  conversationId = null,
  childTaskIds = null,
  childIndex = null,
  retryCount = 0,
  bypassDedupe = false,
  executorOverride = null,
  submissionKind = "unknown",
  runtime = null
}) {
  // K4: conversation identity. Frontend mints a UUID per UI session
  // and stamps it on every command (either via this explicit param
  // or via contextPacket.selection_metadata.conversation_id). When
  // the caller didn't provide an explicit parent_task_id, we
  // auto-resolve to the most-recent prior task with the same
  // conversation_id. This is the durable replacement for the G3
  // length/timestamp heuristic — short follow-ups like "罗利" / "对"
  // become children of the prior weather/location task automatically,
  // without the frontend having to explicitly track parent_task_id.
  //
  // Precedence (most specific wins):
  //   1. Explicit parentTaskId param         → use verbatim
  //   2. conversation_id auto-resolution     → newest prior task
  //                                             with same conv_id
  //   3. null (no parent)
  //
  // Reads from selection_metadata.conversation_id when the param
  // is not supplied, so existing call sites that just pass a
  // contextPacket need no signature change.
  // Normalise: nullish OR empty-string → null. Frontends that ship an
  // empty placeholder must not look like "task X has conversation_id ''
  // and therefore matches every other task with empty conversation_id"
  // during auto-resolution.
  const rawConversationId = conversationId
    ?? contextPacket?.selection_metadata?.conversation_id
    ?? null;
  const effectiveConversationId =
    typeof rawConversationId === "string" && rawConversationId.length > 0
      ? rawConversationId
      : null;
  const effectiveParentTaskId = parentTaskId
    ?? (shouldAutoResolveParentFromConversation(userCommand)
      ? resolveParentFromConversation(effectiveConversationId, runtime)
      : null);

  // P4-RQ G3b: when this task has a parentTaskId AND a runtime
  // store is available, fetch the parent's final assistant text and
  // stamp it on contextPacket as parent_task_summary BEFORE
  // createTaskSpec runs. The pending-offer signal reads this to
  // detect "对/yes" affirmatives that follow a parent task's offer
  // even when the current submission didn't carry conversation_turns
  // in selection_metadata. Uses the auto-resolved parent (K4) so
  // conversation-driven follow-ups also see the parent summary.
  const withParentSummary = effectiveParentTaskId && runtime?.store?.getTask
    ? attachParentTaskSummary(contextPacket, effectiveParentTaskId, runtime)
    : contextPacket;
  const enrichedContext = attachPriorBackendMessages(
    withParentSummary,
    effectiveConversationId,
    runtime
  );

  const taskSpec = createTaskSpec(userCommand, enrichedContext, route);
  const taskSpecValidation = validateTaskSpec(taskSpec);
  const selectedExecutor = executorOverride ?? taskSpec.suggested_executor ?? route.executor;

  const taskRecord = {
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
    parent_task_id: effectiveParentTaskId,
    // K4: stamp the conversation_id on the task record so future
    // follow-ups in the same UI session can auto-resolve via the
    // store walk in resolveParentFromConversation. Round-trips through
    // SQLite via task_json (no schema migration needed — task is
    // stored as JSON).
    conversation_id: effectiveConversationId,
    child_task_ids: Array.isArray(childTaskIds) ? childTaskIds : null,
    child_index: Number.isInteger(childIndex) ? childIndex : null,
    retry_count: retryCount,
    bypass_dedupe: Boolean(bypassDedupe || retryCount > 0),
    executor_history: [],
    intent: route.intent,
    // UCA-077 P2-05: executor selection precedence is now:
    //   1. explicit submission override (e.g. action-tool-submission forces
    //      tool_using regardless of what intent-router thought)
    //   2. taskSpec.suggested_executor — this is the resolver's decision,
    //      built from goal + tool-policy + signals (see executor-resolver.mjs)
    //   3. route.executor — legacy intent-router fallback, kept for cases
    //      where the resolver couldn't run (e.g. malformed inputs)
    // Phase 1's createTaskSpec already populated suggested_executor via
    // resolveExecutor; Phase 2 finally honours it at the task-record layer.
    executor: selectedExecutor,
    user_command: userCommand,
    task_spec: taskSpec,
    // Phase 1.6 — SR parallel safety: snapshot the deterministic spec so
    // validators (success_contract / step_gate / answer_synthesis) can
    // pass/fail against the policy that was active when the executor
    // started. SR's later patches mutate `task_spec` (forward-looking
    // — next planner iteration sees them) but MUST NOT retroactively
    // turn a successful run into a failure because the bar moved after
    // the work was done. Validators read `task_spec_initial` when set.
    task_spec_initial: taskSpec,
    task_spec_source: "deterministic",
    task_spec_valid: taskSpecValidation.valid,
    task_spec_errors: taskSpecValidation.errors,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
    // P4-RQ G3b: persist the ENRICHED context so parent_task_summary
    // (and any future orchestrator-stamped fields) are visible to
    // downstream consumers (executors / observability / replay).
    context_packet: enrichedContext,
    source_dedupe_key: buildSourceDedupeKey(
      enrichedContext,
      userCommand,
      selectedExecutor
    )
  };
  taskRecord.submission_boundary = evaluateSubmissionBoundary({
    task: taskRecord,
    submissionKind,
    executorOverride,
    contextPacket: enrichedContext
  });
  return taskRecord;
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
