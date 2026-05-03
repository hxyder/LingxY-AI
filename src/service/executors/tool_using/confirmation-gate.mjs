export async function resolveInteractiveConfirmation({
  runtime,
  task,
  tool,
  args,
  risk,
  appendAuditLog
}) {
  const decision = await runtime.confirmationHandler({
    task,
    tool,
    args,
    risk
  });

  if (decision?.decision === "edit") {
    return {
      status: "confirm",
      args: decision.args ?? args
    };
  }

  if (decision?.decision === "deny") {
    appendAuditLog?.("tool.denied", {
      tool_id: tool.id
    });
    return {
      status: "deny",
      args
    };
  }

  return {
    status: "confirm",
    args: decision?.args ?? args
  };
}

export function createPendingToolApproval({ runtime, task, tool, args, risk }) {
  const approval = runtime.pendingApprovals.create({
    sourceType: "agent_tool_call",
    sourceId: task.task_id,
    proposedAction: "action_tool",
    proposedTarget: tool.id,
    proposedParams: args,
    previewText: `Pending tool ${tool.id}`,
    // metadata.task_id is what pending-approvals.approve() reads to bridge
    // the resulting tool execution back to THIS task. Without it, the
    // original task is orphaned in waiting_external_decision.
    metadata: {
      task_id: task.task_id,
      tool_id: tool.id,
      risk_level: risk.risk_level ?? "high"
    }
  });
  runtime.emitTaskEvent?.("pending_approval_created", {
    approval_id: approval.approval_id,
    tool_id: tool.id
  });
  return approval;
}

export function shouldBlockHighRiskUnattended({ task, risk }) {
  return task.execution_mode === "unattended_safe" && risk.risk_level === "high";
}
