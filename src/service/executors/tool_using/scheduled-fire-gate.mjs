import {
  isScheduledFireTask,
  isScheduleRegistryTool
} from "./tool-surface.mjs";

export const SCHEDULED_FIRE_REGISTRY_DENY_REASON = "scheduled_fire_cannot_modify_schedule_registry";
export const SCHEDULED_FIRE_RECURSION_BLOCKED_KIND = "scheduled_fire_recursion_blocked";

export function planScheduledFireRegistryGuard({
  task,
  toolOrId,
  synthesisRetriesUsed,
  maxSynthesisRetries
}) {
  if (!isScheduledFireTask(task) || !isScheduleRegistryTool(toolOrId)) return null;

  const toolId = typeof toolOrId === "string" ? toolOrId : toolOrId?.id;
  const base = {
    deniedEventPayload: {
      tool_id: toolId,
      reason: SCHEDULED_FIRE_REGISTRY_DENY_REASON
    },
    deniedTranscriptEntry: {
      type: "tool_denied",
      tool: toolId,
      reason: SCHEDULED_FIRE_REGISTRY_DENY_REASON
    }
  };

  if (synthesisRetriesUsed < maxSynthesisRetries) {
    return {
      ...base,
      action: "retry",
      retryTranscriptEntry: {
        type: "synthesis_retry",
        violations: [{
          kind: SCHEDULED_FIRE_RECURSION_BLOCKED_KIND,
          message: `${toolId} is unavailable inside a scheduled task fire — execute the action directly (notify / send_email / etc.) instead of creating another schedule.`
        }]
      }
    };
  }

  return {
    ...base,
    action: "partial_success",
    finalText: "无法在已触发的定时任务内部继续创建/修改定时任务。请直接执行原本要做的动作（比如 notify / 发邮件）。"
  };
}
