import { applySideEffectContractToToolArgs } from "../../core/policy/side-effect-contracts.mjs";
import { prepareArtifactToolCall } from "../shared/artifact-tool-preflight.mjs";
import {
  buildDeferredToolContext,
  buildToolApprovalPreview
} from "../shared/tool-approval-context.mjs";
import {
  isScheduleRegistryTool,
  isScheduledFireTask,
  isSideEffectTool,
  transcriptHasSuccessfulToolCall
} from "./tool-surface.mjs";
import {
  shouldBlockToolForExecutionMode,
  shouldPromptForToolApproval
} from "../../../shared/permission-mode-model.mjs";

export async function executeAgenticToolCall({
  registry,
  mcpToolById,
  toolContext,
  call,
  runtime,
  task,
  transcript = [],
  signal = null
}) {
  if (signal?.aborted) {
    throw Object.assign(new Error("Agentic tool call aborted before execution."), { code: "ABORT_ERR" });
  }
  const tool = registry?.get?.(call.name) ?? mcpToolById?.get?.(call.name);
  if (!tool) {
    return {
      success: false,
      observation: `Tool ${call.name} is not registered.`,
      metadata: { tool_id: call.name }
    };
  }
  const artifactPreflight = prepareArtifactToolCall({
    tool,
    call,
    task,
    transcript,
    toolContext
  });
  if (!artifactPreflight.ok) {
    call.arguments = artifactPreflight.args;
    return {
      success: false,
      observation: artifactPreflight.error,
      metadata: {
        tool_id: tool.id,
        validation_error: true,
        artifact_preflight: true,
        reason: artifactPreflight.error
      },
      artifact_paths: [],
      error: artifactPreflight.error
    };
  }

  const callArgs = applySideEffectContractToToolArgs(tool.id, artifactPreflight.args, { task, runtime });
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
    const { evaluateToolRisk } = await import("../../capabilities/registry/risk_matrix.mjs");
    const risk = evaluateToolRisk(tool, callArgs, toolContext ?? {});
    if (shouldBlockToolForExecutionMode({ executionMode: task?.execution_mode, risk })) {
      return {
        success: false,
        observation: `Blocked high-risk tool ${tool.id} in unattended mode.`,
        metadata: {
          tool_id: tool.id,
          reason: "high_risk_blocked_in_unattended_safe",
          risk_level: risk.risk_level ?? tool.risk_level ?? "high"
        },
        artifact_paths: [],
        error: "high_risk_blocked_in_unattended_safe"
      };
    }
    if (shouldPromptForToolApproval({ executionMode: task?.execution_mode, risk }) && runtime?.pendingApprovals?.create) {
      // C18 #2c: pass runtime through so install_skill_from_github
      // approvals can pull the staged SKILL.md preview out of
      // runtime.skillInstallState.inspect(state_token). Other tools
      // ignore the new param; this matches the tool_using path's
      // wiring in confirmation-gate.mjs.
      const deferredToolContext = buildDeferredToolContext({ tool, args: callArgs, task, transcript, runtime });
      const approval = runtime.pendingApprovals.create({
        sourceType: "agent_tool_call",
        sourceId: task?.task_id ?? call.id ?? call.name,
        proposedAction: "action_tool",
        proposedTarget: tool.id,
        proposedParams: callArgs,
        previewText: buildApprovalPreview(tool, callArgs, { deferredContext: deferredToolContext }),
        metadata: {
          tool_id: tool.id,
          risk_level: risk.risk_level ?? tool.risk_level ?? "high",
          reason: risk.reason ?? "requires_confirmation",
          tool_call_id: call.id ?? null,
          task_id: task?.task_id ?? null,
          ...(deferredToolContext ? { deferred_tool_context: deferredToolContext } : {})
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
      transcript: Array.isArray(transcript) ? transcript.slice() : [],
      signal
    });
    return {
      success: Boolean(result?.success),
      observation: result?.observation ?? "",
      metadata: result?.metadata ?? {},
      artifact_paths: result?.artifact_paths ?? [],
      error: result?.error ?? null
    };
  } catch (error) {
    if (error?.code === "ABORT_ERR") throw error;
    return {
      success: false,
      observation: `Tool ${call.name} threw: ${error.message}`,
      metadata: { tool_id: call.name }
    };
  }
}

export function buildApprovalPreview(tool, args = {}, options = {}) {
  return buildToolApprovalPreview(tool, args, options);
}
