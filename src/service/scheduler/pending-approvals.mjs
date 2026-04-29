import { appendAuditLog } from "../security/audit-log.mjs";
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
        bridged_from_approval: true
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
      const approval = runtime.store.updatePendingApproval(approvalId, {
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
      return approval;
    },
    async approve(approvalId, { actor = "user", decidedAt = defaultNow(), overrides = null } = {}) {
      const existing = runtime.store.getPendingApproval(approvalId);
      if (!existing || existing.status !== "pending") {
        return null;
      }

      const approval = runtime.store.updatePendingApproval(approvalId, {
        status: "approved",
        decided_at: decidedAt,
        decided_by: actor
      });

      let executionResult = null;
      if (executeApprovedAction) {
        executionResult = await executeApprovedAction(approval, { overrides });
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

      // UCA-181 follow-up: bridge the new task's outcome back to the
      // ORIGINATING task. Without this, a task that suspended on
      // `waiting_external_decision` stays at that sub_status forever
      // and the UI's task panel shows "运行中…" indefinitely. The
      // metadata.task_id field is set by agent-loop's framework gate
      // and the connector workflow dispatcher; if absent we just skip
      // (older approvals or non-task-bound approvals don't need this).
      bridgeApprovalToOriginatingTask({
        runtime,
        approval,
        executionResult,
        decidedAt
      });

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
