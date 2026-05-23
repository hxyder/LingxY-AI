import crypto from "node:crypto";
import { createTaskSpec, validateTaskSpec } from "../task-spec.mjs";
import { evaluateSubmissionBoundary } from "../policy/submission-boundary.mjs";
import { compileContextForTask } from "../context/context-compiler.mjs";
import { buildTaskRuntimeGraph } from "../graph/runtime-graph-checkpoints.mjs";
import {
  attachParentTaskSummary,
  attachPriorBackendMessages,
  attachRecentConversationArtifacts
} from "./conversation-lifecycle.mjs";
import {
  compactFollowUpResolution,
  contextPacketHasExplicitInputContext,
  resolveFollowUp
} from "../session/follow-up-resolver.mjs";
import { buildPermissionModeContract } from "../../../shared/permission-mode-model.mjs";

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

function attachCompiledContext(contextPacket, draftTask, runtime) {
  try {
    const compiledContext = compileContextForTask({
      task: {
        ...draftTask,
        context_packet: contextPacket
      },
      runtime
    });
    return {
      ...(contextPacket ?? {}),
      compiled_context: compiledContext
    };
  } catch (error) {
    return {
      ...(contextPacket ?? {}),
      selection_metadata: {
        ...((contextPacket ?? {}).selection_metadata ?? {}),
        context_compile_error: error?.message ?? "context_compile_failed"
      }
    };
  }
}

function attachCurrentContextFocus(contextPacket, { suppressPriorContext = false } = {}) {
  if (!suppressPriorContext) return contextPacket;
  const {
    parent_task_summary: _parentTaskSummary,
    prior_messages: _priorMessages,
    recent_conversation_artifacts: _recentConversationArtifacts,
    latest_conversation_artifact: _latestConversationArtifact,
    background_contexts: _backgroundContexts,
    ...focusedPacket
  } = contextPacket ?? {};
  return {
    ...focusedPacket,
    selection_metadata: {
      ...((contextPacket ?? {}).selection_metadata ?? {}),
      context_focus: {
        mode: "current_input_context",
        prior_context_suppressed: true,
        reason: "explicit current input context supersedes prior conversation/session anchors"
      }
    }
  };
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
  const taskId = createId("task");
  const createdAt = nowIso();
  const rawConversationId = conversationId
    ?? contextPacket?.selection_metadata?.conversation_id
    ?? null;
  const effectiveConversationId =
    typeof rawConversationId === "string" && rawConversationId.length > 0
      ? rawConversationId
      : null;
  const followUpResolution = resolveFollowUp({
    userCommand,
    conversationId: effectiveConversationId,
    parentTaskId,
    contextPacket,
    runtime
  });
  const effectiveParentTaskId = parentTaskId ?? followUpResolution.parent_task_id ?? null;
  const isCompositeChild = Number.isInteger(childIndex);
  const isContinuation = retryCount > 0
    || (Boolean(effectiveParentTaskId) && !isCompositeChild && followUpResolution.should_continue);
  const explicitInputContext = contextPacketHasExplicitInputContext(contextPacket);
  const shouldSuppressPriorContext = explicitInputContext && !effectiveParentTaskId;
  const focusedContextPacket = attachCurrentContextFocus(contextPacket, {
    suppressPriorContext: shouldSuppressPriorContext
  });

  const withParentSummary = effectiveParentTaskId && runtime?.store?.getTask
    ? attachParentTaskSummary(focusedContextPacket, effectiveParentTaskId, runtime)
    : focusedContextPacket;
  const withPriorMessages = shouldSuppressPriorContext
    ? withParentSummary
    : attachPriorBackendMessages(
        withParentSummary,
        effectiveConversationId,
        runtime
      );
  const withRecentArtifacts = shouldSuppressPriorContext
    ? withPriorMessages
    : attachRecentConversationArtifacts(
        withPriorMessages,
        effectiveConversationId,
        runtime
      );
  const compactResolution = compactFollowUpResolution(followUpResolution);
  const effectiveExecutionMode = executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive");
  const privacyConfig = (() => {
    try {
      return runtime?.securityBroker?.getConfig?.() ?? {};
    } catch {
      return {};
    }
  })();
  const permissionModeContract = buildPermissionModeContract({
    executionMode: effectiveExecutionMode,
    privacyConfig,
    task: {
      task_id: taskId,
      conversation_id: effectiveConversationId,
      parent_task_id: effectiveParentTaskId
    }
  });
  const contextWithFollowUpResolution = compactResolution
    ? {
        ...(withRecentArtifacts ?? {}),
        selection_metadata: {
          ...((withRecentArtifacts ?? {}).selection_metadata ?? {}),
          follow_up_resolution: compactResolution,
          permission_mode_contract: permissionModeContract
        }
      }
    : {
        ...(withRecentArtifacts ?? {}),
        selection_metadata: {
          ...((withRecentArtifacts ?? {}).selection_metadata ?? {}),
          permission_mode_contract: permissionModeContract
        }
      };
  const enrichedContext = attachCompiledContext(
    contextWithFollowUpResolution,
    {
      task_id: taskId,
      conversation_id: effectiveConversationId,
      parent_task_id: effectiveParentTaskId,
      user_command: userCommand
    },
    runtime
  );
  const contextWithRuntimeGraph = {
    ...(enrichedContext ?? {}),
    runtime_graph: buildTaskRuntimeGraph({
      taskId,
      conversationId: effectiveConversationId,
      parentTaskId: effectiveParentTaskId,
      sessionId: null
    })
  };

  const taskSpec = createTaskSpec(userCommand, contextWithRuntimeGraph, route);
  const taskSpecValidation = validateTaskSpec(taskSpec);
  const selectedExecutor = executorOverride ?? taskSpec.suggested_executor ?? route.executor;

  const taskRecord = {
    task_id: taskId,
    created_at: createdAt,
    updated_at: createdAt,
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
    child_index: isCompositeChild ? childIndex : null,
    is_continuation: isContinuation,
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
    execution_mode: effectiveExecutionMode,
    context_packet: contextWithRuntimeGraph,
    source_dedupe_key: buildSourceDedupeKey(
      contextWithRuntimeGraph,
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
