import { appendAuditLog } from "../../security/audit-log.mjs";
import {
  deriveConversationTitle,
  ensureConversation,
  isSchedulerSourced
} from "./conversation-lifecycle.mjs";
import { createTaskRecord } from "./task-record.mjs";

export function auditSubmissionBoundary(runtime, task) {
  if (!runtime || !task?.submission_boundary) return null;
  try {
    return appendAuditLog(
      runtime,
      "submission.boundary_evaluated",
      task.submission_boundary.audit_payload ?? task.submission_boundary,
      task.task_id
    );
  } catch {
    return null;
  }
}

export function submitTaskWithConversation(params) {
  const { runtime, parentMessageId = null, projectId = null, clientMessageId = null } = params;
  const task = createTaskRecord(params);
  if (!runtime?.store?.runInTransaction) {
    runtime.store.insertTask(task);
    auditSubmissionBoundary(runtime, task);
    return { task, userMessage: null, conversation: null };
  }
  return runtime.store.runInTransaction(() => {
    const conversation = ensureConversation(runtime, {
      conversationId: task.conversation_id,
      projectId
    });

    // Auto-title freshly created conversations from the first user
    // command so the sidebar / list reads as recognizable text. Skip
    // when the title was already set (user renamed it, or a follow-up
    // task is reusing the conversation).
    if (conversation && !parentMessageId && !conversation.title && runtime.store?.updateConversation) {
      const derivedTitle = deriveConversationTitle(task.user_command);
      if (derivedTitle) {
        const updated = runtime.store.updateConversation(conversation.conversation_id, { title: derivedTitle });
        if (updated) Object.assign(conversation, updated);
      }
    }

    let userMessage = null;
    if (conversation && !parentMessageId) {
      const role = isSchedulerSourced(task.context_packet) ? "system" : "user";
      const metadata = {
        source_app: task.context_packet?.source_app,
        execution_mode: task.execution_mode
      };
      if (typeof clientMessageId === "string" && clientMessageId.trim()) {
        metadata.client_message_id = clientMessageId.trim().slice(0, 128);
      }
      userMessage = runtime.store.appendMessage({
        conversation_id: conversation.conversation_id,
        role,
        content: task.user_command,
        metadata
      });
    }

    runtime.store.insertTask(task);
    auditSubmissionBoundary(runtime, task);

    const messageIdToLink = parentMessageId ?? userMessage?.message_id ?? null;
    if (messageIdToLink) {
      runtime.store.linkMessageToTask(messageIdToLink, task.task_id, "triggered");
    }

    return { task, userMessage, conversation };
  });
}
