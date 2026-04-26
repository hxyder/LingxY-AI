import crypto from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { classifyFailure } from "../failures/classifier.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createPendingApprovalService } from "../scheduler/pending-approvals.mjs";
import { extractToolSequence, recordToolSequence } from "./skill-pattern-tracker.mjs";
import { createTaskSpec, validateTaskSpec } from "./task-spec.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";

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

export function createTaskRecord({
  route,
  contextPacket,
  userCommand,
  executionMode,
  parentTaskId = null,
  childTaskIds = null,
  childIndex = null,
  retryCount = 0,
  bypassDedupe = false,
  executorOverride = null
}) {
  const taskSpec = createTaskSpec(userCommand, contextPacket, route);
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
    parent_task_id: parentTaskId,
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
    task_spec_valid: taskSpecValidation.valid,
    task_spec_errors: taskSpecValidation.errors,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
    context_packet: contextPacket,
    source_dedupe_key: buildSourceDedupeKey(
      contextPacket,
      userCommand,
      executorOverride ?? route.executor
    )
  };
}

function listChildTasks(runtime, parentTask) {
  if (!parentTask) return [];
  const childIds = Array.isArray(parentTask.child_task_ids) ? parentTask.child_task_ids : [];
  if (childIds.length > 0) {
    return childIds.map((id) => runtime.store.getTask(id)).filter(Boolean);
  }
  return runtime.store.listTasks().filter((task) => task.parent_task_id === parentTask.task_id && task.child_index != null);
}

function aggregateCompositeStatus(childTasks) {
  if (childTasks.length === 0) {
    return { status: "running", sub_status: "composite_waiting", progress: 0 };
  }

  const statuses = childTasks.map((task) => task.status);
  // UCA-056: Progress counts only successful/partial outcomes, NOT failures.
  // A failed subtask should show as failure_count in the UI, not inflate progress.
  const succeeded = statuses.filter((s) => s === "success" || s === "partial_success").length;
  const failed = statuses.filter((s) => s === "failed" || s === "cancelled").length;
  const total = childTasks.length;
  const progress = Math.min(1, succeeded / total);

  // UCA-056: Include failure_count in all return values so UI can show "2/5 failed"
  if (statuses.every((status) => status === "success")) {
    return { status: "success", sub_status: "completed", progress: 1, failure_count: 0 };
  }

  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => status === "partial_success")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => ["running", "queued", "cancelling"].includes(status))) {
    return { status: "running", sub_status: "composite_running", progress, failure_count: failed };
  }

  return { status: "running", sub_status: "composite_pending", progress, failure_count: failed };
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
const CONVERSATION_VISIBLE_EVENTS = new Set([
  "step_started",
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
  llm_generate: "生成内容",
  composite_running: "并行执行子任务",
  agentic: "AI 分析规划中"
};

function buildConversationStepLabel(eventType, payload) {
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
const EPHEMERAL_EVENT_TYPES = new Set(["text_delta", "tool_input_delta", "tool_planner_decision"]);

// UCA-182 Phase 11: also skip writing streaming deltas to the per-task
// jsonl log. The log is meant for post-mortem inspection, not as a
// byte-level transcript. Anything the debugger cares about (tool_call,
// artifact_created, status_changed, failure*) is still captured.
const JSONL_SKIP_EVENT_TYPES = new Set([
  "text_delta",
  "tool_input_delta",
  "conversation_step",
  "heartbeat"
]);

const TASK_LOG_MAX_FILES = 500; // evict oldest when this many per-task files accumulate
const TASK_LOG_ROTATE_EVERY = 128; // check every N writes to amortise dir scans

let taskLogWriteCounter = 0;
// Per-task write queues so events in the same task serialise while
// different tasks remain independent. Without this, concurrent
// emitTaskEvent calls race at the fs layer and lines can interleave
// or appear out of order.
const taskLogTails = new Map();

function enqueueTaskLogWrite(taskId, work) {
  const prev = taskLogTails.get(taskId) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => { /* swallow; log is best-effort */ });
  taskLogTails.set(taskId, next);
  // Keep the map from growing unbounded: once the tail settles, drop it
  // unless a newer write has replaced it.
  next.finally(() => {
    if (taskLogTails.get(taskId) === next) taskLogTails.delete(taskId);
  });
  return next;
}

function persistTaskEvent(runtime, record) {
  if (JSONL_SKIP_EVENT_TYPES.has(record.event_type)) return Promise.resolve();
  const logsDir = runtime.paths?.logsDir;
  if (!logsDir || !record.task_id) return Promise.resolve();
  return enqueueTaskLogWrite(record.task_id, async () => {
    const dir = path.join(logsDir, "tasks");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${record.task_id}.jsonl`);
    await appendFile(file, JSON.stringify(record) + "\n", "utf8");

    taskLogWriteCounter += 1;
    if (taskLogWriteCounter % TASK_LOG_ROTATE_EVERY === 0) {
      void rotateTaskLogs(dir).catch(() => { /* best-effort */ });
    }
  });
}

async function rotateTaskLogs(dir) {
  const entries = await readdir(dir).catch(() => []);
  if (entries.length <= TASK_LOG_MAX_FILES) return;
  const stats = await Promise.all(entries.map(async (name) => {
    try {
      const info = await stat(path.join(dir, name));
      return { name, mtime: info.mtimeMs };
    } catch { return null; }
  }));
  const sorted = stats.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
  const toDelete = sorted.slice(0, sorted.length - TASK_LOG_MAX_FILES);
  for (const entry of toDelete) {
    try { await unlink(path.join(dir, entry.name)); } catch { /* ignore */ }
  }
}

/**
 * Wait for all in-flight per-task log writes to settle. Intended for
 * tests and graceful shutdown; normal runtime code doesn't need it
 * because each queue drains on its own.
 */
export async function flushTaskLogs() {
  const pending = [...taskLogTails.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}

/**
 * Read back all persisted events for a task. Returns an empty array if
 * the jsonl file is missing (either never written, rotated, or the
 * task pre-dates Phase 11). Used by GET /task/:id/log.
 */
export async function readTaskEventLog(runtime, taskId) {
  if (!runtime?.paths?.logsDir || !taskId) return [];
  const file = path.join(runtime.paths.logsDir, "tasks", `${taskId}.jsonl`);
  try {
    const text = await readFile(file, "utf8");
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
    updateTask(runtime, task, {
      status: "success",
      sub_status: "completed",
      progress: 1
    }, true);
  }

  if (event.type === "partial_success") {
    if (task.status === "success") {
      return; // don't downgrade a success to partial_success retroactively
    }
    updateTask(runtime, task, {
      status: "partial_success",
      sub_status: "completed_with_warnings",
      progress: event.progress ?? task.progress
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

export async function cancelTask({ runtime, taskId }) {
  ensureRuntimeServices(runtime);
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }

  if (["success", "failed", "cancelled", "unsupported"].includes(task.status)) {
    return task;
  }

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

  const activeExecution = runtime.activeExecutions.get(taskId);
  if (activeExecution?.cancel) {
    await activeExecution.cancel();
  } else {
    updateTask(runtime, task, {
      status: "cancelled",
      sub_status: "user_interrupted",
      failure_category: "user_interrupted",
      failure_user_message: "任务已被手动取消，可在调整后重新执行。",
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
