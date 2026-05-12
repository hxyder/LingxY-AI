import { appendAuditLog } from "../security/audit-log.mjs";
import {
  attachApprovalResumeMetadata,
  resolveApprovalResumeMetadata
} from "./approval-resume-state.mjs";
import { createPendingApprovalRecord } from "./store.mjs";

function defaultNow() {
  return new Date().toISOString();
}

/**
 * UCA-181 follow-up: when an approval resolves, mirror the new task's
 * outcome onto the ORIGINATING task that suspended on
 * `waiting_external_decision`. Without this, the UI subscription to the
 * original task never sees a terminal event and stays at "运行中…".
 *
 * Idempotent + best-effort: any missing piece (no metadata.task_id, the
 * new task hasn't been created yet, the original task isn't found) just
 * skips. Never throws — approval bookkeeping is the primary outcome.
 */
function bridgeApprovalToOriginatingTask({ runtime, approval, executionResult, decidedAt }) {
  try {
    const originalTaskId = approval?.metadata?.task_id;
    if (!originalTaskId) return;
    const originalTask = runtime.store?.getTask?.(originalTaskId);
    if (!originalTask) return;
    if (originalTask.sub_status !== "waiting_external_decision") {
      // Already resolved by some other path (cancel, retry, etc.) — don't
      // step on a different terminal state.
      return;
    }

    const newTask = executionResult?.task ?? null;
    const newTaskStatus = newTask?.status ?? null;
    const newTaskFinal = String(
      newTask?.result_summary
        ?? newTask?.failure_user_message
        ?? executionResult?.observation
        ?? executionResult?.executionResult?.observation
        ?? ""
    ).trim();

    const resolvedStatus = newTaskStatus === "success"
      ? "success"
      : newTaskStatus === "partial_success"
        ? "partial_success"
        : newTaskStatus === "failed"
          ? "failed"
          : "success"; // no resulting task → assume the action ran inline successfully.
    const resolvedSubStatus = resolvedStatus === "success" ? "completed" : resolvedStatus;
    const eventType = resolvedStatus === "success"
      ? "success"
      : resolvedStatus === "failed"
        ? "failed"
        : "partial_success";

    const summaryFallback = approval.proposed_target
      ? `${approval.proposed_target} 已通过审批${newTaskStatus ? `，结果：${newTaskStatus}` : "并执行完成"}。`
      : "已通过审批。";
    const finalText = newTaskFinal || summaryFallback;

    // Failure metadata MUST mirror too. Without this, the desktop
    // overlay falls back to "Task failed: Unknown error." because
    // failure_user_message stays null on the bridged task even
    // though the new task's classifier did set it correctly.
    const failurePatch = resolvedStatus === "failed"
      ? {
        failure_category: newTask?.failure_category ?? "internal_error",
        failure_user_message: newTask?.failure_user_message ?? finalText,
        failure_internal_log_excerpt: newTask?.failure_internal_log_excerpt ?? null,
        retryable: newTask?.retryable ?? true
      }
      : {};

    // Mutate-in-place + full-record write — matches task-runtime.mjs's
    // updateTask helper signature (avoid importing it; circular dep risk).
    Object.assign(originalTask, {
      status: resolvedStatus,
      sub_status: resolvedSubStatus,
      progress: resolvedStatus === "success" ? 1 : (originalTask.progress ?? 0.95),
      result_summary: finalText,
      updated_at: decidedAt,
      ...failurePatch
    });
    runtime.store.updateTask?.(originalTaskId, originalTask);

    // The original task fired a `tool_call_proposed` event before the
    // confirmation gate suspended it; the desktop task panel keeps
    // that card in "运行中…" state until a matching
    // `tool_call_completed` arrives. The actual tool execution
    // happened on the resumed task (different task_id), so this
    // event never reaches the original task. Synthesize a matching
    // `tool_call_completed` here so the UI's tool-call card resolves
    // alongside the terminal status event below.
    const toolId = approval.metadata?.tool_id ?? approval.proposed_target ?? null;
    if (toolId) {
      const newTaskTranscript = newTask?.transcript ?? newTask?.task_spec?.transcript ?? null;
      const matchingResult = Array.isArray(newTaskTranscript)
        ? [...newTaskTranscript].reverse().find((entry) =>
          entry?.type === "tool_call_completed" && entry?.tool_id === toolId)
        : null;
      const toolCallCompletedEvent = {
        event_id: `evt_approval_bridge_tool_${approval.approval_id}`,
        task_id: originalTaskId,
        ts: decidedAt,
        event_type: "tool_call_completed",
        payload: {
          tool_id: toolId,
          success: resolvedStatus !== "failed",
          observation: matchingResult?.observation ?? finalText,
          args: approval.proposed_params?.input ?? approval.proposed_params ?? {},
          bridged_from_approval: true,
          approval_id: approval.approval_id,
          resulting_task_id: newTask?.task_id ?? null
        }
      };
      runtime.store?.appendEvent?.(toolCallCompletedEvent);
      runtime.eventBus?.publish?.(toolCallCompletedEvent);
    }

    // Persist + publish the terminal event so SSE subscribers (desktop
    // task panel) see the resolution and stop showing "运行中…".
    const eventRecord = {
      event_id: `evt_approval_bridge_${approval.approval_id}`,
      task_id: originalTaskId,
      ts: decidedAt,
      event_type: eventType,
      payload: {
        text: finalText,
        approval_id: approval.approval_id,
        resulting_task_id: newTask?.task_id ?? null,
        bridged_from_approval: true,
        approval_resume: approval.metadata?.approval_resume ?? null
      }
    };
    runtime.store?.appendEvent?.(eventRecord);
    runtime.eventBus?.publish?.(eventRecord);
  } catch (err) {
    appendAuditLog(runtime, "pending_approval.bridge_failed", {
      approval_id: approval?.approval_id,
      error: err?.message ?? String(err)
    });
  }
}

function bridgeRejectedApprovalToOriginatingTask({ runtime, approval, actor, reason, decidedAt }) {
  try {
    const originalTaskId = approval?.metadata?.task_id;
    if (!originalTaskId) return;
    const originalTask = runtime.store?.getTask?.(originalTaskId);
    if (!originalTask || originalTask.sub_status !== "waiting_external_decision") return;

    const toolId = approval.metadata?.tool_id ?? approval.proposed_target ?? null;
    const finalText = reason
      ? `已拒绝审批，未执行 ${approval.proposed_target ?? "该操作"}：${reason}`
      : `已拒绝审批，未执行 ${approval.proposed_target ?? "该操作"}。`;

    Object.assign(originalTask, {
      status: "partial_success",
      sub_status: "approval_rejected",
      progress: originalTask.progress ?? 0.95,
      result_summary: finalText,
      updated_at: decidedAt
    });
    runtime.store.updateTask?.(originalTaskId, originalTask);

    if (toolId) {
      const toolCallCompletedEvent = {
        event_id: `evt_approval_reject_tool_${approval.approval_id}`,
        task_id: originalTaskId,
        ts: decidedAt,
        event_type: "tool_call_completed",
        payload: {
          tool_id: toolId,
          success: false,
          observation: finalText,
          args: approval.proposed_params?.input ?? approval.proposed_params ?? {},
          bridged_from_approval: true,
          approval_id: approval.approval_id,
          approval_rejected: true,
          decided_by: actor
        }
      };
      runtime.store?.appendEvent?.(toolCallCompletedEvent);
      runtime.eventBus?.publish?.(toolCallCompletedEvent);
    }

    const eventRecord = {
      event_id: `evt_approval_reject_${approval.approval_id}`,
      task_id: originalTaskId,
      ts: decidedAt,
      event_type: "partial_success",
      payload: {
        text: finalText,
        approval_id: approval.approval_id,
        bridged_from_approval: true,
        approval_rejected: true,
        decided_by: actor,
        approval_resume: approval.metadata?.approval_resume ?? null
      }
    };
    runtime.store?.appendEvent?.(eventRecord);
    runtime.eventBus?.publish?.(eventRecord);
  } catch (err) {
    appendAuditLog(runtime, "pending_approval.reject_bridge_failed", {
      approval_id: approval?.approval_id,
      error: err?.message ?? String(err)
    });
  }
}

export function createPendingApprovalService({ runtime, executeApprovedAction }) {
  return {
    create({
      sourceType,
      sourceId,
      proposedAction,
      proposedTarget,
      proposedParams = {},
      previewText = "",
      metadata = {},
      createdAt = defaultNow()
    }) {
      const existing = runtime.store.listPendingApprovals().filter((approval) =>
        approval.source_type === sourceType
        && approval.source_id === sourceId
        && approval.status === "pending"
      );

      for (const approval of existing) {
        runtime.store.updatePendingApproval(approval.approval_id, {
          status: "superseded",
          decided_at: createdAt,
          decided_by: "system"
        });
        if (approval.metadata?.run_id) {
          runtime.store.updateScheduleRun(approval.metadata.run_id, {
            status: "superseded",
            approval_id: approval.approval_id
          });
        }
        appendAuditLog(runtime, "pending_approval.superseded", {
          approval_id: approval.approval_id,
          source_type: sourceType,
          source_id: sourceId
        });
      }

      const approval = createPendingApprovalRecord({
        sourceType,
        sourceId,
        proposedAction,
        proposedTarget,
        proposedParams,
        previewText,
        metadata,
        createdAt
      });
      approval.metadata = attachApprovalResumeMetadata(approval.metadata, {
        approvalId: approval.approval_id,
        createdAt
      });

      runtime.store.appendPendingApproval(approval);
      appendAuditLog(runtime, "pending_approval.created", {
        approval_id: approval.approval_id,
        source_type: approval.source_type,
        source_id: approval.source_id,
        proposed_target: approval.proposed_target
      });
      return approval;
    },
    list({ statuses = null } = {}) {
      const approvals = runtime.store.listPendingApprovals();
      if (!statuses?.length) {
        return approvals;
      }
      return approvals.filter((approval) => statuses.includes(approval.status));
    },
    get(approvalId) {
      return runtime.store.getPendingApproval(approvalId);
    },
    reject(approvalId, { actor = "user", reason = null, decidedAt = defaultNow() } = {}) {
      let approval = runtime.store.updatePendingApproval(approvalId, {
        status: "rejected",
        decided_at: decidedAt,
        decided_by: actor
      });

      if (!approval) {
        return null;
      }

      appendAuditLog(runtime, "pending_approval.rejected", {
        approval_id: approvalId,
        actor,
        reason
      });
      if (approval.metadata?.run_id) {
        runtime.store.updateScheduleRun(approval.metadata.run_id, {
          status: "rejected"
        });
      }
      approval = runtime.store.updatePendingApproval(approvalId, {
        metadata: resolveApprovalResumeMetadata(approval.metadata, {
          decision: "rejected",
          decidedAt,
          actor
        })
      }) ?? approval;
      bridgeRejectedApprovalToOriginatingTask({
        runtime,
        approval,
        actor,
        reason,
        decidedAt
      });
      return approval;
    },
    async approve(approvalId, { actor = "user", decidedAt = defaultNow(), overrides = null } = {}) {
      const existing = runtime.store.getPendingApproval(approvalId);
      if (!existing || existing.status !== "pending") {
        return null;
      }

      let approval = runtime.store.updatePendingApproval(approvalId, {
        status: "approved",
        decided_at: decidedAt,
        decided_by: actor
      });

      let executionResult = null;
      if (executeApprovedAction) {
        executionResult = await executeApprovedAction(approval, { overrides, actor, decidedAt });
        if (executionResult?.task?.task_id) {
          runtime.store.updatePendingApproval(approvalId, {
            resulting_task_id: executionResult.task.task_id
          });
        }
      }

      if (approval.metadata?.run_id) {
        runtime.store.updateScheduleRun(approval.metadata.run_id, {
          status: executionResult?.task?.status ?? "approved",
          task_id: executionResult?.task?.task_id ?? null
        });
      }
      approval = runtime.store.updatePendingApproval(approvalId, {
        metadata: resolveApprovalResumeMetadata(approval.metadata, {
          decision: "approved",
          decidedAt,
          actor,
          resultingTaskId: executionResult?.task?.task_id ?? null
        })
      }) ?? approval;

      if (executionResult?.same_task_resume !== true) {
        // UCA-181 follow-up: bridge the new task's outcome back to the
        // ORIGINATING task. Without this, a task that suspended on
        // `waiting_external_decision` stays at that sub_status forever
        // and the UI's task panel shows "运行中…" indefinitely. Same-task
        // graph resumes already updated and terminalized the original task,
        // so they deliberately skip this compatibility bridge.
        bridgeApprovalToOriginatingTask({
          runtime,
          approval,
          executionResult,
          decidedAt
        });
      }

      appendAuditLog(runtime, "pending_approval.approved", {
        approval_id: approvalId,
        actor,
        resulting_task_id: executionResult?.task?.task_id ?? null
      });
      return {
        approval: runtime.store.getPendingApproval(approvalId),
        executionResult
      };
    },
    sweepExpired({ now = defaultNow() } = {}) {
      const expired = [];
      for (const approval of runtime.store.listPendingApprovals()) {
        if (approval.status !== "pending" || approval.expires_at > now) {
          continue;
        }

        const updated = runtime.store.updatePendingApproval(approval.approval_id, {
          status: "expired",
          decided_at: now,
          decided_by: "system"
        });
        expired.push(updated);
        if (approval.metadata?.run_id) {
          runtime.store.updateScheduleRun(approval.metadata.run_id, {
            status: "expired"
          });
        }
        appendAuditLog(runtime, "pending_approval.expired", {
          approval_id: approval.approval_id,
          source_type: approval.source_type,
          source_id: approval.source_id
        });
      }

      return expired;
    }
  };
}
