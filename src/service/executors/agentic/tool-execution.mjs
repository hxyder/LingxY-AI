import { applySideEffectContractToToolArgs } from "../../core/policy/side-effect-contracts.mjs";
import {
  isScheduleRegistryTool,
  isScheduledFireTask,
  isSideEffectTool,
  transcriptHasSuccessfulToolCall
} from "./tool-surface.mjs";

export async function executeAgenticToolCall({
  registry,
  mcpToolById,
  toolContext,
  call,
  runtime,
  task,
  transcript = []
}) {
  const tool = registry?.get?.(call.name) ?? mcpToolById?.get?.(call.name);
  if (!tool) {
    return {
      success: false,
      observation: `Tool ${call.name} is not registered.`,
      metadata: { tool_id: call.name }
    };
  }
  const callArgs = applySideEffectContractToToolArgs(tool.id, call.arguments ?? {}, { task, runtime });
  call.arguments = callArgs;

  if (isScheduleRegistryTool(tool) && isScheduledFireTask(task)) {
    return {
      success: false,
      observation: `${tool.id} is unavailable inside a scheduled task fire — execute the action directly (notify / send_email / etc.) instead of creating another schedule.`,
      metadata: {
        tool_id: tool.id,
        reason: "scheduled_fire_cannot_modify_schedule_registry"
      }
    };
  }

  if (isSideEffectTool(tool) && transcriptHasSuccessfulToolCall(transcript, tool.id)) {
    return {
      success: false,
      observation: `${tool.id} already succeeded earlier in this run; do not re-fire side-effect tools — finalize from the existing result.`,
      metadata: {
        tool_id: tool.id,
        reason: "redundant_side_effect_call"
      }
    };
  }

  try {
    const { evaluateToolRisk } = await import("../../action_tools/risk_matrix.mjs");
    const risk = evaluateToolRisk(tool, callArgs, toolContext ?? {});
    if (risk.requires_confirmation && runtime?.pendingApprovals?.create) {
      const approval = runtime.pendingApprovals.create({
        sourceType: "agent_tool_call",
        sourceId: task?.task_id ?? call.id ?? call.name,
        proposedAction: "action_tool",
        proposedTarget: tool.id,
        proposedParams: callArgs,
        previewText: buildApprovalPreview(tool, callArgs),
        metadata: {
          tool_id: tool.id,
          risk_level: risk.risk_level ?? tool.risk_level ?? "high",
          reason: risk.reason ?? "requires_confirmation",
          tool_call_id: call.id ?? null,
          task_id: task?.task_id ?? null
        }
      });
      return {
        success: false,
        observation: `🔒 Tool ${tool.id} requires user approval before running. An approval card has been surfaced to the user (approval_id=${approval.approval_id}). Stop chaining further tools — the system will re-run ${tool.id} automatically once the user approves.`,
        metadata: {
          tool_id: tool.id,
          waiting_approval: true,
          approval_id: approval.approval_id,
          risk_level: risk.risk_level ?? tool.risk_level ?? "high"
        },
        artifact_paths: [],
        error: null
      };
    }
  } catch (gateError) {
    return {
      success: false,
      observation: `Risk gate failed for ${tool.id}: ${gateError.message}`,
      metadata: { tool_id: tool.id, gate_error: true }
    };
  }

  try {
    const result = await tool.execute(callArgs, {
      ...(toolContext ?? {}),
      runtime,
      task,
      transcript: Array.isArray(transcript) ? transcript.slice() : []
    });
    return {
      success: Boolean(result?.success),
      observation: result?.observation ?? "",
      metadata: result?.metadata ?? {},
      artifact_paths: result?.artifact_paths ?? [],
      error: result?.error ?? null
    };
  } catch (error) {
    return {
      success: false,
      observation: `Tool ${call.name} threw: ${error.message}`,
      metadata: { tool_id: call.name }
    };
  }
}

export function buildApprovalPreview(tool, args = {}) {
  if (tool.id === "account_send_email" || tool.id === "send_email_smtp") {
    const to = Array.isArray(args.to) ? args.to.join(", ") : String(args.to ?? "");
    const subject = String(args.subject ?? "").slice(0, 80);
    const bodyPreview = String(args.body ?? "").replace(/\s+/g, " ").slice(0, 160);
    return `发送邮件 → ${to || "(未指定收件人)"}\n主题: ${subject || "(无主题)"}\n${bodyPreview}`;
  }
  if (tool.id === "file_op" && args.operation === "delete") {
    return `删除文件: ${args.path ?? "(未指定)"}`;
  }
  if (tool.id === "launch_app") {
    return `启动应用: ${args.app ?? "(未指定)"}`;
  }
  const argsPreview = JSON.stringify(args).slice(0, 180);
  return `${tool.name ?? tool.id}\n${argsPreview}`;
}
