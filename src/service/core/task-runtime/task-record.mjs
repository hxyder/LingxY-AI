import crypto from "node:crypto";
import { createTaskSpec, validateTaskSpec } from "../task-spec.mjs";
import { evaluateSubmissionBoundary } from "../policy/submission-boundary.mjs";
import {
  attachParentTaskSummary,
  attachPriorBackendMessages,
  resolveParentFromConversation,
  shouldAutoResolveParentFromConversation
} from "./conversation-lifecycle.mjs";

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
  boundaryContext = null,
  runtime = null
}) {
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
    conversation_id: effectiveConversationId,
    child_task_ids: Array.isArray(childTaskIds) ? childTaskIds : null,
    child_index: Number.isInteger(childIndex) ? childIndex : null,
    retry_count: retryCount,
    bypass_dedupe: Boolean(bypassDedupe || retryCount > 0),
    executor_history: [],
    intent: route.intent,
    executor: selectedExecutor,
    user_command: userCommand,
    task_spec: taskSpec,
    task_spec_initial: taskSpec,
    task_spec_source: "deterministic",
    task_spec_valid: taskSpecValidation.valid,
    task_spec_errors: taskSpecValidation.errors,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
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
    contextPacket: enrichedContext,
    boundaryContext
  });
  return taskRecord;
}
