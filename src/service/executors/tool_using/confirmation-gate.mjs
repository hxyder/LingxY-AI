import { groupsOfTool } from "../../core/policy/policy-groups.mjs";

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

export function resolveScheduledSideEffectAuthorization({ task, tool }) {
  const metadata = task?.context_packet?.selection_metadata ?? {};
  if (metadata.scheduled_task_fire !== true) {
    return { authorized: false };
  }
  const authorization = metadata.side_effect_authorization;
  if (authorization?.kind !== "scheduled_fire" || authorization.decision !== "preauthorized") {
    return { authorized: false };
  }
  const authorizedGroups = new Set(authorization.groups ?? []);
  const contractGroups = new Set(Object.keys(metadata.side_effect_contract?.groups ?? {}));
  const toolGroups = groupsOfTool(tool?.id);
  const group = toolGroups.find((candidate) =>
    authorizedGroups.has(candidate) && contractGroups.has(candidate)
  );
  if (!group) {
    return { authorized: false };
  }
  return {
    authorized: true,
    group,
    source: authorization.source ?? "schedule_definition",
    schedule_id: authorization.schedule_id ?? null
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

export function shouldBlockHighRiskUnattended({ task, risk, tool }) {
  if (resolveScheduledSideEffectAuthorization({ task, tool }).authorized) {
    return false;
  }
  return task.execution_mode === "unattended_safe" && risk.risk_level === "high";
}
