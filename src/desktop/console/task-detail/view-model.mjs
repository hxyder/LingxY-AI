export function buildTaskDetailViewModel(task, events = [], artifacts = []) {
  return {
    taskId: task.task_id,
    status: task.status,
    progress: task.progress ?? 0,
    currentStep: task.current_step ?? null,
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
