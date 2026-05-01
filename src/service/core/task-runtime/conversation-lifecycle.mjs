/**
 * Conversation lifecycle helpers for task-runtime.
 *
 * This module owns conversation row creation, prior-message enrichment,
 * follow-up parent resolution, title backfill, and assistant outcome messages.
 * It intentionally does not create task records; task-runtime.mjs remains the
 * orchestration shell that combines task creation, audit, queueing, and events.
 */

export function resolveParentFromConversation(conversationId, runtime) {
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;
  if (typeof runtime?.store?.listTasks !== "function") return null;
  try {
    const candidates = runtime.store.listTasks().filter((task) =>
      task && typeof task === "object" && task.conversation_id === conversationId
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aTs = typeof a.created_at === "string" ? a.created_at : "";
      const bTs = typeof b.created_at === "string" ? b.created_at : "";
      if (aTs === bTs) return 0;
      return aTs < bTs ? 1 : -1;
    });
    const newest = candidates[0];
    return typeof newest?.task_id === "string" ? newest.task_id : null;
  } catch {
    return null;
  }
}

const SHORT_FOLLOWUP_REPLY = /^(好|好的?|可以|继续|需要|要|对|是|是的|嗯|ok|okay|yes|sure|please)\s*[!.！。]?$/i;
const REFERENTIAL_FOLLOWUP = /(^|\s)(上个|上一|刚才|之前|前面|那个|这个|这些|那些|它|它们|里面的|文件夹里的|图片里的|表格里的|文档里的|这张|那张|第一张|第二张|同样|一样|照这个|继续|再来|改一下|补充|加上|打开它|打开这个|打开那个)(\s|$|[，。！？,.!?])/i;
const SHORT_SLOT_REPLY_BLOCKER = /(打开|启动|运行|删除|移动|复制|保存|导出|发送|发邮件|搜索|查一下|查询|查找|新闻|天气|气温|股价|股票|汇率|价格|多少钱|文件|文件夹|图片|上传|下载|日历|提醒|定时|为什么|怎么办|怎么|如何|\?|？|\bopen\b|\blaunch\b|\brun\b|\bdelete\b|\bmove\b|\bcopy\b|\bsave\b|\bexport\b|\bsend\b|\bemail\b|\bsearch\b|\bnews\b|\bweather\b|\bstock\b|\bprice\b|\bfile\b|\bfolder\b|\bimage\b|\bcalendar\b|\bremind\b|\bschedule\b|\bwhy\b|\bhow\b|\bwhat\b)/i;

function looksLikeShortSlotReply(text = "") {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (value.length > 24) return false;
  if (SHORT_SLOT_REPLY_BLOCKER.test(value)) return false;
  return /^[\p{L}\p{N}\s,，.'’_-]+$/u.test(value);
}

export function shouldAutoResolveParentFromConversation(userCommand = "") {
  const text = String(userCommand ?? "").trim();
  if (!text) return false;
  if (SHORT_FOLLOWUP_REPLY.test(text)) return true;
  if (looksLikeShortSlotReply(text)) return true;
  return REFERENTIAL_FOLLOWUP.test(text);
}

export function attachParentTaskSummary(contextPacket, parentTaskId, runtime) {
  try {
    const parent = runtime.store.getTask(parentTaskId);
    if (!parent || typeof parent !== "object") return contextPacket;
    const finalText =
      parent.result_summary
      ?? parent.result?.final_text
      ?? parent.final_text
      ?? null;
    if (typeof finalText !== "string" || finalText.trim().length === 0) {
      return contextPacket;
    }
    return {
      ...(contextPacket ?? {}),
      parent_task_summary: {
        parent_task_id: parentTaskId,
        assistant_final_text: finalText.slice(0, 1600)
      }
    };
  } catch {
    return contextPacket;
  }
}

export function attachPriorBackendMessages(contextPacket, conversationId, runtime, { limit = 12, contentCap = 1600 } = {}) {
  if (!conversationId || typeof runtime?.store?.getConversationMessages !== "function") {
    return contextPacket;
  }
  try {
    const all = runtime.store.getConversationMessages(conversationId);
    if (!Array.isArray(all) || all.length === 0) return contextPacket;
    const tail = all.slice(-Math.max(1, Math.min(limit, 50)));
    const priorMessages = tail.map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content.slice(0, contentCap) : "",
      status: message.status ?? null,
      ts: message.ts ?? null
    }));
    return { ...(contextPacket ?? {}), prior_messages: priorMessages };
  } catch {
    return contextPacket;
  }
}

export function isSchedulerSourced(contextPacket) {
  return contextPacket?.selection_metadata?.scheduled_task_fire === true
    || contextPacket?.source_app === "uca.scheduler"
    || contextPacket?.capture_mode === "event";
}

export function ensureConversation(runtime, { conversationId, projectId = null, title = null }) {
  if (!runtime?.store?.getConversation || !runtime.store.insertConversation) return null;
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;
  const existing = runtime.store.getConversation(conversationId);
  if (existing) return existing;
  return runtime.store.insertConversation({
    conversation_id: conversationId,
    project_id: projectId ?? null,
    title: title ?? null,
    metadata: {}
  });
}

export function deriveConversationTitle(command) {
  if (typeof command !== "string") return null;
  const cleaned = command.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const MAX = 36;
  return cleaned.length > MAX ? `${cleaned.slice(0, MAX)}…` : cleaned;
}

export function backfillConversationTitles(runtime) {
  if (!runtime?.store?.listConversations
      || !runtime.store.getConversationMessages
      || !runtime.store.updateConversation) {
    return { scanned: 0, updated: 0 };
  }
  const all = runtime.store.listConversations({ limit: 5000, archived: 0 }) ?? [];
  let updated = 0;
  for (const conversation of all) {
    const id = conversation.conversation_id ?? conversation.id;
    if (!id) continue;
    const existing = String(conversation.title ?? "").trim();
    const needsTitle = !existing || existing === id;
    if (!needsTitle) continue;
    const messages = runtime.store.getConversationMessages(id, { limit: 5 }) ?? [];
    const firstUserMessage = messages.find((message) => message.role === "user");
    if (!firstUserMessage?.content) continue;
    const derived = deriveConversationTitle(firstUserMessage.content);
    if (!derived) continue;
    runtime.store.updateConversation(id, { title: derived });
    updated += 1;
  }
  return { scanned: all.length, updated };
}

export function appendTaskOutcomeMessage(runtime, task) {
  if (!runtime?.store?.appendMessage || !runtime.store.linkMessageToTask) return null;
  const conversationId = task?.conversation_id;
  if (!conversationId) return null;
  if (!runtime.store.getConversation?.(conversationId)) return null;

  const status = task.status;
  let role = "assistant";
  let content;
  let messageStatus = status;
  if (status === "success") {
    const finalText = task.result_summary ?? task.result?.final_text ?? task.final_text ?? "";
    if (typeof finalText !== "string" || finalText.trim().length === 0) return null;
    content = finalText;
    messageStatus = "ok";
  } else if (status === "cancelled") {
    role = "system";
    content = "Task was cancelled.";
  } else if (status === "partial_success") {
    role = "system";
    content = `Task partially succeeded: ${task.failure_user_message ?? "see task for details"}`;
  } else if (status === "failed") {
    role = "system";
    content = `Task failed: ${task.failure_user_message ?? task.failure_category ?? "unknown error"}`;
  } else {
    role = "system";
    content = `Task ended with status=${status ?? "unknown"}.`;
  }

  try {
    const message = runtime.store.appendMessage({
      conversation_id: conversationId,
      role,
      content,
      status: messageStatus,
      metadata: { task_id: task.task_id, executor: task.executor }
    });
    runtime.store.linkMessageToTask(message.message_id, task.task_id, "answered_by");
    return message;
  } catch {
    return null;
  }
}
