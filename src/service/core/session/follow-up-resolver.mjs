import { SESSION_ITEM_KINDS } from "./conversation-session-service.mjs";

export const FOLLOW_UP_RESOLVER_SCHEMA_VERSION = "1.0";

export const FOLLOW_UP_RESOLUTION_MODES = Object.freeze({
  CALLER_PARENT: "caller_parent",
  SESSION_ANCHOR: "session_anchor",
  NONE: "none"
});

const SHORT_FOLLOWUP_REPLY = /^(好|好的?|可以|继续|需要|要|对|是|是的|嗯|ok|okay|yes|sure|please)\s*[!.！。]?$/i;
const REFERENTIAL_FOLLOWUP = /(^|\s)(上个|上一|刚才|之前|前面|那个|这个|这些|那些|它|它们|里面的|文件夹里的|图片里的|表格里的|文档里的|这张|那张|第一张|第二张|同样|一样|照这个|继续|再来|改一下|补充|加上|打开它|打开这个|打开那个)(\s|$|[，。！？,.!?])/i;
const SHORT_SLOT_REPLY_BLOCKER = /(打开|启动|运行|删除|移动|复制|保存|导出|发送|发邮件|搜索|查一下|查询|查找|新闻|天气|气温|股价|股票|美股|A股|汇率|价格|多少钱|文件|文件夹|图片|上传|下载|日历|提醒|定时|为什么|怎么办|怎么|如何|生成|创建|制作|做成|做一个|报表|表格|格式|文档|幻灯片|电子表格|走势|\?|？|\bopen\b|\blaunch\b|\brun\b|\bdelete\b|\bmove\b|\bcopy\b|\bsave\b|\bexport\b|\bsend\b|\bemail\b|\bsearch\b|\bnews\b|\bweather\b|\bstock\b|\bprice\b|\bfile\b|\bfolder\b|\bimage\b|\bcalendar\b|\bremind\b|\bschedule\b|\bcreate\b|\bgenerate\b|\bmake\b|\breport\b|\bformat\b|\bexcel\b|\bxlsx\b|\bpptx?\b|\bdocx?\b|\bpdf\b|\bwhy\b|\bhow\b|\bwhat\b)/i;

const ANCHOR_ITEM_KINDS = new Set([
  SESSION_ITEM_KINDS.TASK_ANCHOR,
  SESSION_ITEM_KINDS.TOOL_OBSERVATION,
  SESSION_ITEM_KINDS.TOOL_CALL,
  SESSION_ITEM_KINDS.ARTIFACT_REFERENCE
]);

function looksLikeShortSlotReply(text = "") {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (value.length > 24) return false;
  if (SHORT_SLOT_REPLY_BLOCKER.test(value)) return false;
  return /^[\p{L}\p{N}\s,，.'’_-]+$/u.test(value);
}

export function looksLikeFollowUpSignal(userCommand = "") {
  const text = String(userCommand ?? "").trim();
  if (!text) return false;
  if (SHORT_FOLLOWUP_REPLY.test(text)) return true;
  if (looksLikeShortSlotReply(text)) return true;
  return REFERENTIAL_FOLLOWUP.test(text);
}

function makeResolution({
  mode = FOLLOW_UP_RESOLUTION_MODES.NONE,
  parentTaskId = null,
  confidence = 0,
  reason = "no follow-up anchor selected",
  isFollowUpSignal = false,
  anchors = []
} = {}) {
  return {
    schema_version: FOLLOW_UP_RESOLVER_SCHEMA_VERSION,
    mode,
    parent_task_id: parentTaskId,
    confidence,
    reason,
    is_follow_up_signal: Boolean(isFollowUpSignal),
    should_continue: Boolean(parentTaskId && isFollowUpSignal),
    anchors
  };
}

function compactAnchor(item, source) {
  if (!item || typeof item !== "object") return null;
  return {
    source,
    item_id: item.item_id ?? null,
    kind: item.kind ?? null,
    task_id: item.task_id ?? null,
    artifact_id: item.artifact_id ?? null,
    order_index: Number.isInteger(item.order_index) ? item.order_index : null,
    ts: item.ts ?? null
  };
}

function resolveLatestSession(conversationId, runtime) {
  if (!conversationId) return null;
  try {
    return runtime?.conversationSessions?.getLatestForConversation?.(conversationId)
      ?? runtime?.store?.getLatestConversationSession?.(conversationId)
      ?? null;
  } catch {
    return null;
  }
}

function listSessionItems(sessionId, runtime, options) {
  if (!sessionId) return [];
  try {
    const items = runtime?.conversationSessions?.listItems?.(sessionId, options)
      ?? runtime?.store?.listSessionItems?.(sessionId, options)
      ?? [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function findSessionAnchor({ session, items }) {
  const reversed = [...items].reverse();
  const activeTaskId = typeof session?.active_task_id === "string"
    ? session.active_task_id
    : null;
  if (activeTaskId) {
    const activeItem = reversed.find((item) =>
      item?.task_id === activeTaskId && ANCHOR_ITEM_KINDS.has(item.kind)
    );
    return {
      parentTaskId: activeTaskId,
      anchor: compactAnchor(activeItem ?? {
        kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
        task_id: activeTaskId
      }, activeItem ? "session_item" : "session_active_task")
    };
  }

  const item = reversed.find((candidate) =>
    typeof candidate?.task_id === "string"
    && candidate.task_id.length > 0
    && ANCHOR_ITEM_KINDS.has(candidate.kind)
  );
  if (!item) return null;
  return {
    parentTaskId: item.task_id,
    anchor: compactAnchor(item, "session_item")
  };
}

export function compactFollowUpResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return null;
  return {
    schema_version: resolution.schema_version ?? FOLLOW_UP_RESOLVER_SCHEMA_VERSION,
    mode: resolution.mode ?? FOLLOW_UP_RESOLUTION_MODES.NONE,
    parent_task_id: resolution.parent_task_id ?? null,
    confidence: Number.isFinite(resolution.confidence) ? resolution.confidence : 0,
    reason: resolution.reason ?? null,
    is_follow_up_signal: Boolean(resolution.is_follow_up_signal),
    should_continue: Boolean(resolution.should_continue),
    anchors: Array.isArray(resolution.anchors) ? resolution.anchors.slice(0, 4) : []
  };
}

export function resolveFollowUp({
  userCommand = "",
  conversationId = null,
  parentTaskId = null,
  runtime = null,
  sessionItemLimit = 200
} = {}) {
  const isFollowUpSignal = looksLikeFollowUpSignal(userCommand);
  if (typeof parentTaskId === "string" && parentTaskId.length > 0) {
    return makeResolution({
      mode: FOLLOW_UP_RESOLUTION_MODES.CALLER_PARENT,
      parentTaskId,
      confidence: 1,
      reason: "caller supplied parent_task_id",
      isFollowUpSignal,
      anchors: [{
        source: "caller",
        item_id: null,
        kind: "parent_task_id",
        task_id: parentTaskId,
        artifact_id: null,
        order_index: null,
        ts: null
      }]
    });
  }

  if (!isFollowUpSignal) {
    return makeResolution({
      isFollowUpSignal,
      reason: "current user command does not require follow-up resolution"
    });
  }

  const session = resolveLatestSession(conversationId, runtime);
  const sessionItems = listSessionItems(session?.session_id, runtime, {
    limit: sessionItemLimit
  });
  const selectedSessionAnchor = findSessionAnchor({ session, items: sessionItems });
  if (selectedSessionAnchor?.parentTaskId) {
    return makeResolution({
      mode: FOLLOW_UP_RESOLUTION_MODES.SESSION_ANCHOR,
      parentTaskId: selectedSessionAnchor.parentTaskId,
      confidence: 0.9,
      reason: "selected latest typed session anchor for follow-up",
      isFollowUpSignal,
      anchors: [selectedSessionAnchor.anchor].filter(Boolean)
    });
  }

  return makeResolution({
    isFollowUpSignal,
    reason: "follow-up signal present but no typed session anchor was available"
  });
}
