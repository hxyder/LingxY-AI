import crypto from "node:crypto";
import { classifyFailure } from "../failures/classifier.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createPendingApprovalService } from "../scheduler/pending-approvals.mjs";
import { extractToolSequence, recordToolSequence } from "./skill-pattern-tracker.mjs";
import { createTaskSpec, validateTaskSpec } from "./task-spec.mjs";
import {
  aggregateCompositeStatus,
  listChildTasks
} from "./task-runtime/composite-status.mjs";
import { persistTaskEvent } from "./task-runtime/event-log.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";

export {
  flushTaskLogs,
  readTaskEventLog
} from "./task-runtime/event-log.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildSourceDedupeKey(contextPacket, userCommand, executor) {
  const textKey = contextPacket.text?.trim()?.slice(0, 240);
  const sourceKey = contextPacket.file_paths?.join("|")
    ?? ((contextPacket.source_type === "text_selection" || contextPacket.source_type === "text") && textKey
      ? textKey
      : null)
    ?? contextPacket.url
    ?? textKey
    ?? contextPacket.source_type;
  return `${contextPacket.source_type}:${contextPacket.source_app}:${executor}:${userCommand}:${sourceKey}`;
}

// UCA-182 Phase 18: compact cap on record text so the embedding store
// doesn't bloat with entire clipped web pages. 2KB of Unicode is more
// than enough for TF-IDF term importance and stays well under any
// semantic model's token window. context_packet.text is truncated
// individually because a huge page-dump can single-handedly drown out
// the rest of the signal.
const HISTORY_TEXT_CAP = 2000;
const HISTORY_CTX_TEXT_CAP = 600;
const HISTORY_ANSWER_CAP = 800;

function buildHistoryRecord(task, runtime) {
  const parts = [
    task.user_command,
    task.intent,
    task.context_packet?.title,
    String(task.context_packet?.text ?? "").slice(0, HISTORY_CTX_TEXT_CAP),
    task.context_packet?.url,
    task.context_packet?.file_paths?.join(" "),
    task.failure_user_message
  ];

  // UCA-064: For composite tasks include child task content so history search
  // can find sub-task text and subtasks don't silently disappear from history.
  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0 && runtime) {
    const children = task.child_task_ids
      .map((id) => runtime.store?.getTask(id))
      .filter(Boolean);
    for (const child of children) {
      if (child.user_command) parts.push(child.user_command);
      if (child.failure_user_message) parts.push(child.failure_user_message);
    }
  }

  // Also include result_summary if the executor produced one
  if (task.result_summary) parts.push(task.result_summary);

  // UCA-182 Phase 18: include the assistant's final reply so the
  // embedding store indexes "what was generated", not just "what was
  // asked". Without this, a RAG recall keyed on "ppt" finds the user
  // command (which might just say "ppt") but nothing about the actual
  // subject matter of the earlier report.
  let answerText = "";
  let artifactPaths = [];
  if (runtime?.store?.getTaskEvents) {
    try {
      const events = runtime.store.getTaskEvents(task.task_id) ?? [];
      const finalEvent = [...events].reverse().find((e) =>
        e.event_type === "success" || e.event_type === "inline_result"
      );
      answerText = String(finalEvent?.payload?.text ?? "").slice(0, HISTORY_ANSWER_CAP);
      artifactPaths = events
        .filter((e) => e.event_type === "artifact_created")
        .map((e) => String(e.payload?.path ?? ""))
        .filter((p) => p && !p.endsWith("-preview.html") && !p.endsWith("-preview.txt"))
        .slice(0, 6);
    } catch { /* best-effort; history is not load-bearing */ }
  }
  if (answerText) parts.push(answerText);
  if (artifactPaths.length) parts.push(artifactPaths.join(" "));

  const text = parts.filter(Boolean).join("\n").slice(0, HISTORY_TEXT_CAP);

  if (!text) {
    return null;
  }

  return {
    id: task.task_id,
    text,
    metadata: {
      summary: task.user_command ?? task.intent ?? task.task_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
      status: task.status,
      source_type: task.context_packet?.source_type ?? "unknown",
      intent: task.intent,
      executor: task.executor,
      // Phase 18: carry the distilled answer + artifact list so
      // semantic-recall can cite the assistant's prior reply without
      // re-fetching task events.
      answer_excerpt: answerText || null,
      artifact_paths: artifactPaths
    }
  };
}

export function ensureRuntimeServices(runtime) {
  runtime.activeExecutions ??= new Map();
  // UCA-077 P4-04.5: registry must be a singleton on the runtime so that
  // tool_using / agentic / fast all see the same set of tools (including
  // any registered MCP / plugin tools) AND share the per-task rate-limit
  // counters bound to runtime.perTaskToolCallCounts. Service-bootstrap
  // populates this in production; this fallback covers test harnesses
  // and other narrow runtimes that bypass full bootstrap.
  runtime.actionToolRegistry ??= createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  runtime.metrics ??= createMetricsRegistry({
    store: runtime.store,
    queue: runtime.queue
  });
  runtime.securityBroker ??= createSecurityBroker({ runtime });
  // UCA-182 Phase 20: wire executeApprovedAction so approving a
  // source_type="agent_tool_call" record actually runs the tool the
  // agent had proposed. Previously the hook was unset, so users
  // could approve an "account_send_email" card all day and nothing
  // happened. Keeps other source_types (schedule / manual) as they
  // were — only agent_tool_call is newly handled here.
  runtime.pendingApprovals ??= createPendingApprovalService({
    runtime,
    executeApprovedAction: async (approval) => {
      if (approval.source_type !== "agent_tool_call") return null;
      const toolId = approval.proposed_target || approval.metadata?.tool_id;
      if (!toolId) return null;
      const tool = runtime.actionToolRegistry?.get?.(toolId);
      if (!tool || typeof tool.execute !== "function") {
        return { executed: false, reason: "tool_not_found", tool_id: toolId };
      }
      try {
        const result = await tool.execute(approval.proposed_params ?? {}, {
          ...(runtime.toolContext ?? {}),
          runtime,
          task: approval.metadata?.task_id ? runtime.store?.getTask?.(approval.metadata.task_id) : null,
          outputDir: runtime.toolContext?.outputDir ?? null
        });
        return {
          executed: true,
          tool_id: toolId,
          success: Boolean(result?.success),
          observation: result?.observation ?? null
        };
      } catch (error) {
        return { executed: true, tool_id: toolId, success: false, error: error.message };
      }
    }
  });
  return runtime;
}

/**
 * P4-RQ G3b: read the parent task's final assistant text from the
 * runtime store and stamp it on a cloned contextPacket so the
 * pending-offer signal can detect follow-up affirmatives ("对",
 * "yes") even when conversation_turns aren't embedded in the
 * current submission. Pure-function shape — no mutation of the
 * input.
 *
 * Defensively tolerant: if the parent task is missing, has no
 * final reply, or the runtime store is malformed, returns the
 * original contextPacket unchanged.
 */
/**
 * P4-RQ K4: auto-resolve parent_task_id from conversation_id.
 *
 * Walks the store for the most recent task whose `conversation_id`
 * matches `conversationId` and returns its task_id. Returns null
 * when no match (or no runtime / no listTasks).
 *
 * Defensive: any store I/O failure or malformed task is silently
 * skipped — failing to resolve a parent must never block submission.
 *
 * @param {string|null} conversationId
 * @param {object|null} runtime
 * @returns {string|null}
 */
function resolveParentFromConversation(conversationId, runtime) {
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;
  if (typeof runtime?.store?.listTasks !== "function") return null;
  try {
    const candidates = runtime.store.listTasks().filter((t) =>
      t && typeof t === "object" && t.conversation_id === conversationId
    );
    if (candidates.length === 0) return null;
    // Most recent first (created_at is ISO; lexicographic sort works).
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
  // A bare noun/name/location/date answer to a previous clarification usually
  // has no sentence-ending question shape. This covers "罗利", "Raleigh, NC",
  // "数据分析师", "明天下午三点" without reintroducing topic routing.
  return /^[\p{L}\p{N}\s,，.'’_-]+$/u.test(value);
}

export function shouldAutoResolveParentFromConversation(userCommand = "") {
  const text = String(userCommand ?? "").trim();
  if (!text) return false;
  if (SHORT_FOLLOWUP_REPLY.test(text)) return true;
  if (looksLikeShortSlotReply(text)) return true;
  return REFERENTIAL_FOLLOWUP.test(text);
}

function attachParentTaskSummary(contextPacket, parentTaskId, runtime) {
  try {
    const parent = runtime.store.getTask(parentTaskId);
    if (!parent || typeof parent !== "object") return contextPacket;
    // Pull the final assistant text wherever the executor stashed
    // it. Different executors persist this under different keys —
    // result_summary is the canonical, but result.final_text and
    // payload.text show up in some legacy paths.
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
        // Cap to bound prompt growth — only the offer phrasing
        // (typically near the tail of the reply) is what
        // pending-offer cares about.
        assistant_final_text: finalText.slice(0, 1600)
      }
    };
  } catch {
    // Store I/O exception — never let observability fetch break
    // task creation.
    return contextPacket;
  }
}

/**
 * P6 F3: pre-fetch the recent backend conversation_messages tail for
 * signal detectors that need prior-turn context (today: pending-offer).
 * Stamps `contextPacket.prior_messages` as a sanitised, capped array
 * of {role, content, status, ts}. Excludes UI metadata (no
 * client_message_id, no message_id, no metadata blob — those are
 * ledger fields, not signal inputs).
 *
 * Becomes the SINGLE source of historical context for signal
 * extraction when present. Detectors that previously read
 * `selection_metadata.conversation_turns` or
 * `parent_task_summary.assistant_final_text` must prefer this. Those
 * legacy fields stay only as fallbacks for boots without a backend
 * conversation row.
 */
export function attachPriorBackendMessages(contextPacket, conversationId, runtime, { limit = 12, contentCap = 1600 } = {}) {
  if (!conversationId || typeof runtime?.store?.getConversationMessages !== "function") {
    return contextPacket;
  }
  try {
    const all = runtime.store.getConversationMessages(conversationId);
    if (!Array.isArray(all) || all.length === 0) return contextPacket;
    const tail = all.slice(-Math.max(1, Math.min(limit, 50)));
    const priorMessages = tail.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content.slice(0, contentCap) : "",
      status: m.status ?? null,
      ts: m.ts ?? null
    }));
    return { ...(contextPacket ?? {}), prior_messages: priorMessages };
  } catch {
    return contextPacket;
  }
}

function isSchedulerSourced(contextPacket) {
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

// Derive a short, human-friendly conversation title from the first
// user command. Used to auto-name new conversations so the
// Conversations list reads as "请帮我总结这份合同 …" instead of an
// opaque "conv_abc123…". Returns null if the command is empty.
function deriveConversationTitle(command) {
  if (typeof command !== "string") return null;
  const cleaned = command.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const MAX = 36;
  return cleaned.length > MAX ? `${cleaned.slice(0, MAX)}…` : cleaned;
}

// One-shot migration: walk all conversations and back-fill the
// auto-generated title for any whose title is null/empty/looks like
// the raw conversation_id (legacy data from before the auto-title
// shipped). Idempotent — conversations with a real title are
// untouched. Cheap: one DB read per conversation that needs it,
// stops at the first user message. Run at runtime boot.
//
// Returns { scanned, updated } so the caller can log the impact.
export function backfillConversationTitles(runtime) {
  if (!runtime?.store?.listConversations
      || !runtime.store.getConversationMessages
      || !runtime.store.updateConversation) {
    return { scanned: 0, updated: 0 };
  }
  // Walk every conversation regardless of project / archived state.
  const all = runtime.store.listConversations({ limit: 5000, archived: 0 }) ?? [];
  let updated = 0;
  for (const conv of all) {
    const id = conv.conversation_id ?? conv.id;
    if (!id) continue;
    const existing = String(conv.title ?? "").trim();
    // Treat empty / matches-id as "needs fill". Don't blanket-catch
    // anything starting with "conv_" because a user might legitimately
    // name a conversation that way.
    const needsTitle = !existing || existing === id;
    if (!needsTitle) continue;
    // First user message wins. Some conversations are scheduler-
    // sourced (role=system) — skip those, the conv_auto_* surface
    // already has its own labels.
    const messages = runtime.store.getConversationMessages(id, { limit: 5 }) ?? [];
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg?.content) continue;
    const derived = deriveConversationTitle(firstUserMsg.content);
    if (!derived) continue;
    runtime.store.updateConversation(id, { title: derived });
    updated += 1;
  }
  return { scanned: all.length, updated };
}

export function submitTaskWithConversation(params) {
  const { runtime, parentMessageId = null, projectId = null, clientMessageId = null } = params;
  const task = createTaskRecord(params);
  if (!runtime?.store?.runInTransaction) {
    runtime.store.insertTask(task);
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

    const messageIdToLink = parentMessageId ?? userMessage?.message_id ?? null;
    if (messageIdToLink) {
      runtime.store.linkMessageToTask(messageIdToLink, task.task_id, "triggered");
    }

    return { task, userMessage, conversation };
  });
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
    const msg = runtime.store.appendMessage({
      conversation_id: conversationId,
      role,
      content,
      status: messageStatus,
      metadata: { task_id: task.task_id, executor: task.executor }
    });
    runtime.store.linkMessageToTask(msg.message_id, task.task_id, "answered_by");
    return msg;
  } catch {
    return null;
  }
}

export function createTaskRecord({
  route,
  contextPacket,
  userCommand,
  executionMode,
  parentTaskId = null,
  conversationId = null,
  childTaskIds = null,
  childIndex = null,
  retryCount = 0,
  bypassDedupe = false,
  executorOverride = null,
  runtime = null
}) {
  // K4: conversation identity. Frontend mints a UUID per UI session
  // and stamps it on every command (either via this explicit param
  // or via contextPacket.selection_metadata.conversation_id). When
  // the caller didn't provide an explicit parent_task_id, we
  // auto-resolve to the most-recent prior task with the same
  // conversation_id. This is the durable replacement for the G3
  // length/timestamp heuristic — short follow-ups like "罗利" / "对"
  // become children of the prior weather/location task automatically,
  // without the frontend having to explicitly track parent_task_id.
  //
  // Precedence (most specific wins):
  //   1. Explicit parentTaskId param         → use verbatim
  //   2. conversation_id auto-resolution     → newest prior task
  //                                             with same conv_id
  //   3. null (no parent)
  //
  // Reads from selection_metadata.conversation_id when the param
  // is not supplied, so existing call sites that just pass a
  // contextPacket need no signature change.
  // Normalise: nullish OR empty-string → null. Frontends that ship an
  // empty placeholder must not look like "task X has conversation_id ''
  // and therefore matches every other task with empty conversation_id"
  // during auto-resolution.
  const rawConversationId = conversationId
    ?? contextPacket?.selection_metadata?.conversation_id
    ?? null;
  const effectiveConversationId =
    typeof rawConversationId === "string" && rawConversationId.length > 0
      ? rawConversationId
      : null;
  const effectiveParentTaskId = parentTaskId
    ?? (shouldAutoResolveParentFromConversation(userCommand)
      ? resolveParentFromConversation(effectiveConversationId, runtime)
      : null);

  // P4-RQ G3b: when this task has a parentTaskId AND a runtime
  // store is available, fetch the parent's final assistant text and
  // stamp it on contextPacket as parent_task_summary BEFORE
  // createTaskSpec runs. The pending-offer signal reads this to
  // detect "对/yes" affirmatives that follow a parent task's offer
  // even when the current submission didn't carry conversation_turns
  // in selection_metadata. Uses the auto-resolved parent (K4) so
  // conversation-driven follow-ups also see the parent summary.
  const withParentSummary = effectiveParentTaskId && runtime?.store?.getTask
    ? attachParentTaskSummary(contextPacket, effectiveParentTaskId, runtime)
    : contextPacket;
  const enrichedContext = attachPriorBackendMessages(
    withParentSummary,
    effectiveConversationId,
    runtime
  );

  const taskSpec = createTaskSpec(userCommand, enrichedContext, route);
  const taskSpecValidation = validateTaskSpec(taskSpec);

  return {
    task_id: createId("task"),
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "queued",
    sub_status: "queued",
    progress: 0,
    current_step: null,
    completed_steps: [],
    remaining_steps_estimate: [],
    failure_category: null,
    failure_user_message: null,
    failure_internal_log_excerpt: null,
    retryable: true,
    parent_task_id: effectiveParentTaskId,
    // K4: stamp the conversation_id on the task record so future
    // follow-ups in the same UI session can auto-resolve via the
    // store walk in resolveParentFromConversation. Round-trips through
    // SQLite via task_json (no schema migration needed — task is
    // stored as JSON).
    conversation_id: effectiveConversationId,
    child_task_ids: Array.isArray(childTaskIds) ? childTaskIds : null,
    child_index: Number.isInteger(childIndex) ? childIndex : null,
    retry_count: retryCount,
    bypass_dedupe: Boolean(bypassDedupe || retryCount > 0),
    executor_history: [],
    intent: route.intent,
    // UCA-077 P2-05: executor selection precedence is now:
    //   1. explicit submission override (e.g. action-tool-submission forces
    //      tool_using regardless of what intent-router thought)
    //   2. taskSpec.suggested_executor — this is the resolver's decision,
    //      built from goal + tool-policy + signals (see executor-resolver.mjs)
    //   3. route.executor — legacy intent-router fallback, kept for cases
    //      where the resolver couldn't run (e.g. malformed inputs)
    // Phase 1's createTaskSpec already populated suggested_executor via
    // resolveExecutor; Phase 2 finally honours it at the task-record layer.
    executor: executorOverride ?? taskSpec.suggested_executor ?? route.executor,
    user_command: userCommand,
    task_spec: taskSpec,
    // Phase 1.6 — SR parallel safety: snapshot the deterministic spec so
    // validators (success_contract / step_gate / answer_synthesis) can
    // pass/fail against the policy that was active when the executor
    // started. SR's later patches mutate `task_spec` (forward-looking
    // — next planner iteration sees them) but MUST NOT retroactively
    // turn a successful run into a failure because the bar moved after
    // the work was done. Validators read `task_spec_initial` when set.
    task_spec_initial: taskSpec,
    task_spec_source: "deterministic",
    task_spec_valid: taskSpecValidation.valid,
    task_spec_errors: taskSpecValidation.errors,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
    // P4-RQ G3b: persist the ENRICHED context so parent_task_summary
    // (and any future orchestrator-stamped fields) are visible to
    // downstream consumers (executors / observability / replay).
    context_packet: enrichedContext,
    source_dedupe_key: buildSourceDedupeKey(
      enrichedContext,
      userCommand,
      executorOverride ?? route.executor
    )
  };
}

export function refreshCompositeParentStatus(runtime, parentTaskId) {
  // UCA-056: Re-read parent task inside this call to avoid stale state from
  // concurrent child completions. If another child already updated the parent
  // between our read and write, we just emit the latest state (eventual consistency).
  const parentTask = runtime.store.getTask(parentTaskId);
  if (!parentTask) return null;
  const childTasks = listChildTasks(runtime, parentTask);
  const aggregate = aggregateCompositeStatus(childTasks);
  const previousStatus = parentTask.status;
  updateTask(runtime, parentTask, {
    status: aggregate.status,
    sub_status: aggregate.sub_status,
    progress: aggregate.progress,
    failure_count: aggregate.failure_count ?? 0
  }, true);
  return {
    parentTask,
    previousStatus,
    aggregate
  };
}

// UCA-061: Event types that should be forwarded to the conversation view as
// step labels. Other events (e.g. status_changed on every tick) are too noisy.
//
// Default visible set is intentionally small. Pre-execution phases
// (task_created / accepted / started / provider_resolved / semantic_router /
// background_context_added / sr_patch_applied / final_composer_started) are
// implementation detail — they belong in the inspect-routing / debug panel,
// not in the conversation thread, where they create the impression that "lots
// of work happens before any reply" and hurt perceived latency.
//
// Conversation thread shows: a single "思考中" indicator
// (planner_request_started), tool activity, and failures/cancellations.
const CONVERSATION_VISIBLE_EVENTS = new Set([
  "planner_request_started",
  "tool_call_started",
  "tool_call_proposed",
  "tool_call_completed",
  "tool_call_denied",
  "failed",
  "cancelled"
]);

const TOOL_STEP_LABELS = {
  launch_app: "启动应用",
  open_url: "打开链接",
  web_search_fetch: "搜索网络",
  compose_email: "撰写邮件",
  send_email_smtp: "发送邮件",
  open_file: "打开文件",
  write_file: "写入文件",
  verify_file_exists: "验证文件",
  find_recent_files: "查找文件",
  glob_files: "查找文件",
  list_files: "列出文件",
  stat_file: "检查文件",
  register_artifact: "注册结果",
  resolve_output_path: "确定输出路径",
  notify: "发送通知",
  copy_to_clipboard: "复制到剪贴板",
  generate_document: "生成文档",
  take_screenshot: "截图",
  translate_text: "翻译内容",
  run_script: "执行脚本"
};

const STEP_LABELS = {
  tool_planner: "规划操作步骤",
  semantic_router: "理解任务场景",
  semantic_router_patch: "更新任务理解",
  planner_request: "请求模型",
  llm_generate: "生成内容",
  composite_running: "并行执行子任务",
  agentic: "AI 分析规划中"
};

function buildConversationStepLabel(eventType, payload) {
  if (eventType === "task_created") {
    return "▸ 已接收请求，正在准备执行…";
  }
  if (eventType === "accepted") {
    return "▸ 已进入任务队列…";
  }
  if (eventType === "started") {
    return "▸ 开始执行…";
  }
  if (eventType === "provider_resolved") {
    const model = payload?.model ?? payload?.provider_name ?? payload?.provider_id ?? "";
    return model ? `▸ 已选择模型：${String(model).slice(0, 80)}` : "▸ 已选择模型…";
  }
  if (eventType === "tool_call_started" || eventType === "tool_call_proposed") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    return label ? `▸ ${label}…` : null;
  }
  if (eventType === "tool_call_completed") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    const ok = payload?.success !== false;
    return label ? `${ok ? "✓" : "✗"} ${label}` : null;
  }
  if (eventType === "tool_call_denied") {
    const toolId = payload?.tool_id ?? payload?.tool ?? "";
    const label = TOOL_STEP_LABELS[toolId] ?? toolId;
    return label ? `⊘ ${label}（已拦截）` : null;
  }
  if (eventType === "step_started") {
    const step = payload?.step ?? "";
    const label = STEP_LABELS[step] ?? step;
    return label ? `▸ ${label}…` : null;
  }
  if (eventType === "step_finished") {
    const step = payload?.step ?? "";
    const label = STEP_LABELS[step] ?? step;
    return label ? `✓ ${label}` : null;
  }
  if (eventType === "planner_request_started") {
    return "▸ 请求模型…";
  }
  if (eventType === "final_composer_started") {
    return "▸ 整理工具结果并生成回复…";
  }
  if (eventType === "sr_patch_applied") {
    const web = payload?.tool_policy_web ? `联网=${payload.tool_policy_web}` : "";
    const output = payload?.expected_output ? `输出=${payload.expected_output}` : "";
    const bits = [web, output].filter(Boolean).join(" · ");
    return bits ? `✓ 语义分类已更新：${bits}` : "✓ 语义分类已更新";
  }
  if (eventType === "background_context_added") {
    if (payload?.kind === "memory_recall") return `✓ 已补充记忆上下文（${payload.count ?? 0} 条）`;
    if (payload?.kind === "recent_artifact") return "✓ 已补充最近产物上下文";
    return "✓ 已补充背景上下文";
  }
  if (eventType === "failed") {
    const msg = payload?.message ?? payload?.category ?? "未知错误";
    return `✗ 任务失败：${String(msg).slice(0, 60)}`;
  }
  return null;
}

// Event types that should only be published to the live bus and not persisted
// to the store (avoids flooding the DB with thousands of delta records).
// UCA-077 P3-02: tool_planner_decision is per-iteration observability for
// the agent loop — useful in SSE streams and tests, but it would bloat the
// SQLite event store if we persisted every iteration's payload.
const EPHEMERAL_EVENT_TYPES = new Set([
  "text_delta",
  "tool_input_delta",
  "reasoning_delta",
  "tool_planner_decision"
]);

const firstDeltaTimingEmitted = new Set();

export function emitTaskEvent({ runtime, taskId, eventType, payload }) {
  const record = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: eventType,
    payload
  };

  if (!EPHEMERAL_EVENT_TYPES.has(eventType)) {
    runtime.store.appendEvent(record);
  }
  runtime.eventBus.publish(record);
  if (eventType === "text_delta" && taskId && !firstDeltaTimingEmitted.has(taskId)) {
    firstDeltaTimingEmitted.add(taskId);
    emitFirstDeltaTiming(runtime, taskId);
  }
  if (eventType === "status_changed" && ["success", "failed", "cancelled", "partial_success"].includes(payload?.status)) {
    firstDeltaTimingEmitted.delete(taskId);
  }
  // UCA-182 Phase 11: best-effort durable per-task event log under
  // <logsDir>/tasks/<taskId>.jsonl. Writing is fire-and-forget so
  // nothing on the task hot path waits on disk IO; it is strictly an
  // observability aid (see /task/:id/log endpoint).
  void persistTaskEvent(runtime, record);

  // UCA-077 P2-03: piggy-back a `decision_trace` event onto every
  // `task_created` so SSE consumers (overlay timeline, task detail page)
  // can render the goal / tool-policy / executor decisions without an
  // extra round trip. Lookup-on-emit avoids touching the 12 submission
  // sites that already emit task_created themselves.
  if (eventType === "task_created" && !payload?.__suppressDecisionTrace) {
    emitDecisionTraceFollowUp(runtime, taskId);
  }

  // UCA-061: Forward qualifying events as conversation_step so the overlay
  // can render real-time step indicators without polling.
  if (CONVERSATION_VISIBLE_EVENTS.has(eventType)) {
    const stepLabel = buildConversationStepLabel(eventType, payload);
    if (stepLabel) {
      runtime.eventBus.publish({
        event_id: createId("step"),
        task_id: taskId,
        ts: nowIso(),
        event_type: "conversation_step",
        payload: {
          step_label: stepLabel,
          source_event: eventType,
          tool_id: payload?.tool_id ?? payload?.tool ?? null
        }
      });
    }
  }

  return record;
}

function emitFirstDeltaTiming(runtime, taskId) {
  let durationMs = null;
  try {
    const createdAt = runtime?.store?.getTask?.(taskId)?.created_at;
    const createdMs = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
    if (Number.isFinite(createdMs)) {
      durationMs = Math.max(0, Date.now() - createdMs);
    }
  } catch {
    durationMs = null;
  }
  const timing = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: "phase_timing",
    payload: {
      phase: "executor_first_delta",
      duration_ms: durationMs
    }
  };
  try {
    runtime?.store?.appendEvent?.(timing);
  } catch {
    // Observability must never break token streaming.
  }
  runtime?.eventBus?.publish?.(timing);
  void persistTaskEvent(runtime, timing);
}

function emitDecisionTraceFollowUp(runtime, taskId) {
  let task;
  try {
    task = runtime.store.getTask?.(taskId);
  } catch {
    return; // store may not be ready in some test harnesses
  }
  const trace = task?.task_spec?.decision_trace;
  if (!Array.isArray(trace) || trace.length === 0) return;

  const followUp = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: "decision_trace",
    payload: {
      // Mirror the compact `summary()` shape so SSE consumers do not see
      // the timestamp / decision_id noise unless they ask for the full
      // record (which they can read from task.task_spec.decision_trace).
      stages: trace.map((entry) => ({
        stage: entry.stage,
        output: entry.output,
        reason: entry.reason
      })),
      executor: task?.task_spec?.suggested_executor,
      tool_policy: task?.task_spec?.tool_policy
    }
  };
  // decision_trace is an analytical projection of state already on the task
  // record; we do NOT persist it as its own event row — the task store keeps
  // task_spec.decision_trace, which is enough for replay and the /task/:id
  // detail endpoint.
  runtime.eventBus.publish(followUp);
}

export function updateTask(runtime, task, patch, emitStatus = false) {
  const previousStatus = task.status;
  Object.assign(task, patch, { updated_at: nowIso() });
  runtime.store.updateTask(task.task_id, task);

  if (emitStatus && previousStatus !== task.status) {
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "status_changed",
      payload: {
        previous_status: previousStatus,
        status: task.status,
        sub_status: task.sub_status,
        progress: task.progress
      }
    });
  }

  if (task.parent_task_id && task.child_index != null && previousStatus !== task.status) {
    refreshCompositeParentStatus(runtime, task.parent_task_id);
  }

  return task;
}

export function registerActiveExecution(runtime, taskId, executionControl) {
  runtime.activeExecutions.set(taskId, executionControl);
}

export function unregisterActiveExecution(runtime, taskId) {
  runtime.activeExecutions.delete(taskId);
}

export function applyExecutorEvent(runtime, task, event) {
  if (event.type === "step_started") {
    updateTask(runtime, task, {
      current_step: event.step ?? null,
      sub_status: event.step ?? "running",
      progress: event.progress ?? task.progress
    });
  }

  if (event.type === "step_finished") {
    const step = event.step ?? null;
    if (step && !task.completed_steps.includes(step)) {
      updateTask(runtime, task, {
        completed_steps: [...task.completed_steps, step]
      });
    }
  }

  if (event.type === "success") {
    // UCA-056: Guard against duplicate success events — executor should only succeed once
    if (task.status === "success") {
      return; // already succeeded, ignore duplicate
    }
    // Persist event.text as result_summary so writeAssistantMessageForTask
    // (called from markTaskSucceeded) can write the assistant message into
    // conversation_messages. Image / multi_modal executors only emit text
    // via the success event payload — without this they finalised with an
    // empty result_summary and the conversation lost the assistant turn
    // entirely (the bubble was visible live, but the row disappeared on
    // reload). tool_using / agentic also yield success with text; this is
    // a no-op for them because context-submission's post-execution path
    // already sets result_summary first (`if (inlineText && !task.result_summary)`).
    const successText = typeof event.text === "string" ? event.text.trim() : "";
    const patch = {
      status: "success",
      sub_status: "completed",
      progress: 1
    };
    if (successText && !task.result_summary) {
      patch.result_summary = successText;
    }
    updateTask(runtime, task, patch, true);
  }

  if (event.type === "partial_success") {
    if (task.status === "success") {
      return; // don't downgrade a success to partial_success retroactively
    }
    const partialText = typeof event.text === "string" ? event.text.trim() : "";
    const patch = {
      status: "partial_success",
      sub_status: event.sub_status ?? "completed_with_warnings",
      progress: event.progress ?? task.progress
    };
    if (partialText && !task.result_summary) {
      patch.result_summary = partialText;
    }
    updateTask(runtime, task, patch, true);
  }

  if (event.type === "failed") {
    if (["success", "partial_success", "failed", "cancelled"].includes(task.status)) {
      return;
    }
    const failure = classifyFailure({
      message: event.message ?? event.text ?? event.error ?? "Executor failed.",
      category: event.category
    });
    updateTask(runtime, task, {
      status: "failed",
      sub_status: failure.category,
      failure_category: failure.category,
      failure_user_message: failure.userMessage,
      failure_internal_log_excerpt: failure.internalExcerpt,
      retryable: failure.retryable
    }, true);
  }
}

export function markTaskFailed(runtime, task, errorLike) {
  const failure = classifyFailure(errorLike);
  updateTask(runtime, task, {
    status: failure.category === "user_interrupted" ? "cancelled" : "failed",
    sub_status: failure.category,
    failure_category: failure.category,
    failure_user_message: failure.userMessage,
    failure_internal_log_excerpt: failure.internalExcerpt,
    retryable: failure.retryable
  }, true);

  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: failure.category === "user_interrupted" ? "cancelled" : "failed",
    payload: {
      category: failure.category,
      message: failure.userMessage,
      user_actions: failure.userActions,
      internal_excerpt: failure.internalExcerpt
    }
  });

  task.executor_history = [
    ...task.executor_history,
    {
      executor: task.executor,
      outcome: task.status,
      ended_at: task.updated_at
    }
  ];
  runtime.store.updateTask(task.task_id, task);
  appendTaskOutcomeMessage(runtime, task);
  const historyRecord = buildHistoryRecord(task, runtime);
  if (historyRecord) {
    runtime.platform?.embeddingStore?.add(historyRecord);
  }
  runtime.securityBroker?.clearTaskRedactionMap(task.task_id);
  runtime.queue.markFinished(task.task_id);
  return failure;
}

export function markTaskSucceeded(runtime, task) {
  const freshTask = runtime.store.getTask(task.task_id) ?? task;
  Object.assign(task, freshTask);
  task.executor_history = [
    ...(task.executor_history ?? []),
    {
      executor: task.executor,
      outcome: task.status,
      ended_at: nowIso()
    }
  ];

  // UCA-064: For composite tasks, build a result_summary listing every
  // subtask outcome so the overlay can show "已完成 3/3 个任务" instead of "Done."
  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0) {
    const children = task.child_task_ids
      .map((id) => runtime.store.getTask(id))
      .filter(Boolean);
    if (children.length > 0) {
      const successCount = children.filter((c) => c.status === "success" || c.status === "partial_success").length;
      const failCount = children.filter((c) => c.status === "failed" || c.status === "cancelled").length;
      const lines = children.map((c, i) => {
        const icon = (c.status === "success" || c.status === "partial_success") ? "✓" : "✗";
        return `${i + 1}. ${icon} ${c.user_command ?? c.intent ?? c.task_id}`;
      });
      task.result_summary = [
        `已完成 ${successCount}/${children.length} 个任务${failCount > 0 ? `（${failCount} 个失败）` : ""}`,
        ...lines
      ].join("\n");
    }
  }

  runtime.store.updateTask(task.task_id, task);
  appendTaskOutcomeMessage(runtime, task);
  const historyRecord = buildHistoryRecord(task, runtime);
  if (historyRecord) {
    runtime.platform?.embeddingStore?.add(historyRecord);
  }

  // UCA-075: Auto-skill classification — detect repeated tool sequences
  try {
    const skillPatternsPath = runtime.paths?.skillPatternsPath ?? null;
    if (skillPatternsPath) {
      const taskEvents = runtime.store.getTaskEvents?.(task.task_id) ?? [];
      const toolSequence = extractToolSequence(taskEvents);
      const proposal = recordToolSequence(skillPatternsPath, {
        taskId: task.task_id,
        command: task.user_command,
        toolSequence
      });
      if (proposal) {
        // Emit as inline_result so the overlay shows a save-skill bubble
        emitTaskEvent({
          runtime,
          taskId: task.task_id,
          eventType: "skill_proposal",
          payload: {
            text: `💡 此操作流程已重复执行 ${proposal.count} 次：${proposal.tools.join(" → ")}\n是否保存为可复用技能「${proposal.suggestedName}」？`,
            proposal
          }
        });
      }
    }
  } catch { /* non-fatal */ }

  runtime.securityBroker?.clearTaskRedactionMap(task.task_id);
  runtime.queue.markFinished(task.task_id);
}

export async function cancelTask({ runtime, taskId, force = false } = {}) {
  ensureRuntimeServices(runtime);
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }

  if (["success", "failed", "cancelled", "unsupported"].includes(task.status)) {
    return task;
  }

  // Force path: skip the polite executor.cancel() round-trip and mark
  // the task cancelled in the store immediately. Used when the user
  // clicks "stop" a second time after the first request hasn't taken
  // effect (executor stuck in an LLM stream that doesn't honour
  // cancel signals quickly). The downstream worker may still run for
  // a few seconds — that's a backend concern — but at least the
  // task's exposed state matches the user's intent.
  const wasCancelling = task.status === "cancelling";
  const shouldForce = force || wasCancelling;

  if (!wasCancelling) {
    updateTask(runtime, task, {
      status: "cancelling",
      sub_status: "cancelling"
    }, true);

    emitTaskEvent({
      runtime,
      taskId,
      eventType: "cancel_requested",
      payload: { by: "user" }
    });
  }

  const activeExecution = runtime.activeExecutions.get(taskId);
  if (activeExecution?.cancel && !shouldForce) {
    await activeExecution.cancel();
  } else {
    updateTask(runtime, task, {
      status: "cancelled",
      sub_status: "user_interrupted",
      failure_category: "user_interrupted",
      failure_user_message: shouldForce
        ? "任务已被手动取消（强制）。底层执行器可能仍在响应，但状态已置为已取消。"
        : "任务已被手动取消，可在调整后重新执行。",
      retryable: true
    }, true);
    emitTaskEvent({
      runtime,
      taskId,
      eventType: "cancelled",
      payload: {
        category: "user_interrupted"
      }
    });
    runtime.queue.markFinished(taskId);
  }

  return task;
}
