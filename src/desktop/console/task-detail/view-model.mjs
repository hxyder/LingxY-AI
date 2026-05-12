import { collectLlmUsageSummary } from "../../../shared/llm-usage-summary.mjs";
import { describePermissionModeContract } from "../../../shared/permission-mode-model.mjs";
import { buildTaskTraceSummary } from "../../../shared/task-trace-summary.mjs";

export function buildTaskDetailViewModel(task, events = [], artifacts = []) {
  const llmUsage = collectLlmUsageSummary(events);
  const trace = buildTaskTraceSummary(events);
  return {
    taskId: task.task_id,
    status: task.status,
    progress: task.progress ?? 0,
    currentStep: task.current_step ?? null,
    executor: task.executor,
    mode: {
      label: describePermissionModeContract(task),
      contract: task.context_packet?.selection_metadata?.permission_mode_contract ?? null
    },
    provider: task.provider_id ?? null,
    model: task.model_id ?? null,
    retryCount: task.retry_count ?? 0,
    canRetry: Boolean(task.retryable),
    canCancel: ["queued", "running", "cancelling"].includes(task.status),
    source: {
      sourceType: task.context_packet?.source_type ?? null,
      sourceApp: task.context_packet?.source_app ?? null,
      captureMode: task.context_packet?.capture_mode ?? null
    },
    cost: {
      usd: task.cost_usd ?? 0,
      tokensIn: task.usage_summary?.tokens_in ?? 0,
      tokensOut: task.usage_summary?.tokens_out ?? 0
    },
    llmUsage,
    trace,
    failure: task.failure_category
      ? {
          category: task.failure_category,
          userMessage: task.failure_user_message,
          internalExcerpt: task.failure_internal_log_excerpt
        }
      : null,
    timeline: events.map((event) => ({
      id: event.event_id,
      at: event.ts,
      type: event.event_type,
      payload: event.payload
    })),
    artifacts
  };
}
