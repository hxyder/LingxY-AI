export const AUTO_SCHEDULE_PROJECT_ID = "proj_auto_schedules";
export const AUTO_EMAIL_PROJECT_ID = "proj_auto_email";

export function taskIdsForConversation(conversation = {}) {
  const ids = new Set();
  const meta = conversation.metadata ?? {};
  for (const value of [meta.latestTaskId, meta.taskId, conversation.taskId, conversation.parentTaskId]) {
    if (typeof value === "string" && value.startsWith("task_")) ids.add(value);
  }
  for (const turn of conversation.turns ?? []) {
    if (typeof turn?.taskId === "string" && turn.taskId.startsWith("task_")) ids.add(turn.taskId);
  }
  return ids;
}

export function isAutomaticResultTask(task) {
  if (!task) return false;
  const metadata = task.context_packet?.selection_metadata
    ?? task.context_packet?.selectionMetadata
    ?? task.selection_metadata
    ?? {};
  const sourceId = String(metadata.source_id ?? task.schedule_source ?? "");
  const sourceApp = task.source_app ?? task.context_packet?.source_app ?? "";
  const captureMode = task.capture_mode ?? task.context_packet?.capture_mode ?? "";
  return sourceApp === "uca.scheduler"
    || captureMode === "scheduler"
    || sourceId.startsWith("sched_")
    || sourceApp === "uca.email"
    || captureMode === "email_digest";
}

export function automaticProjectForTask(task = {}) {
  if (task.source_app === "uca.email" || task.capture_mode === "email_digest") {
    return {
      projectId: AUTO_EMAIL_PROJECT_ID,
      name: "邮件摘要",
      color: "#14b8a6"
    };
  }
  return {
    projectId: AUTO_SCHEDULE_PROJECT_ID,
    name: "定时任务",
    color: "#f59e0b"
  };
}

export function isEmailDigestTask(task = {}) {
  const sourceApp = task.source_app ?? task.context_packet?.source_app ?? "";
  const captureMode = task.capture_mode ?? task.context_packet?.capture_mode ?? "";
  return sourceApp === "uca.email" || captureMode === "email_digest";
}

export function automaticConversationKey(task = {}, detail = {}) {
  const detailTask = detail?.task ?? task;
  const metadata = detailTask?.context_packet?.selection_metadata
    ?? detailTask?.context_packet?.selectionMetadata
    ?? detailTask?.selection_metadata
    ?? {};
  if (isEmailDigestTask(detailTask)) {
    return `email:${new Date(detailTask.updated_at ?? detailTask.created_at ?? Date.now()).toISOString().slice(0, 10)}`;
  }
  return `schedule:${metadata.source_id ?? detailTask.schedule_source ?? detailTask.intent ?? detailTask.user_command ?? detailTask.task_id}`;
}

export function titleForAutomaticConversation(task = {}, detail = {}) {
  const detailTask = detail?.task ?? task;
  if (isEmailDigestTask(detailTask)) {
    return "Morning digest";
  }
  const metadata = detailTask?.context_packet?.selection_metadata
    ?? detailTask?.context_packet?.selectionMetadata
    ?? detailTask?.selection_metadata
    ?? {};
  const raw = metadata.source_id || detailTask.intent || detailTask.user_command || "定时任务";
  return String(raw).slice(0, 48);
}

export function finalTextFromTaskDetail(detail) {
  const events = detail?.events ?? detail?.taskEvents ?? [];
  const finalEvent = [...events].reverse().find((event) =>
    (event.event_type === "inline_result" || event.event_type === "success")
    && typeof event.payload?.text === "string"
    && event.payload.text.trim().length > 0
  );
  return finalEvent?.payload?.text
    ?? detail?.task?.result_summary
    ?? detail?.result_summary
    ?? "";
}
