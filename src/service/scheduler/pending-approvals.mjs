import { appendAuditLog } from "../security/audit-log.mjs";
import { createPendingApprovalRecord } from "./store.mjs";

function defaultNow() {
  return new Date().toISOString();
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
    async approve(approvalId, { actor = "user", decidedAt = defaultNow() } = {}) {
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
        executionResult = await executeApprovedAction(approval);
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
