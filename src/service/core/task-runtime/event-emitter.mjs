import crypto from "node:crypto";
import { persistTaskEvent } from "./event-log.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
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
export const CONVERSATION_VISIBLE_EVENTS = new Set([
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
  create_scheduled_task: "创建定时任务",
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

export function buildConversationStepLabel(eventType, payload) {
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
  if (eventType === "skill_context_loaded") {
    const count = Number(payload?.active_count ?? payload?.count ?? 0);
    return count > 0 ? `✓ 已加载技能上下文（${count} 个）` : "✓ 已加载技能上下文";
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
export const EPHEMERAL_EVENT_TYPES = new Set([
  "text_delta",
  "tool_input_delta",
  "reasoning_delta",
  "tool_planner_decision"
]);

const firstDeltaTimingEmitted = new Set();
const firstEventTimingEmitted = new Set();
const firstProgressTimingEmitted = new Set();
const firstVisibleTimingEmitted = new Set();

const EXECUTOR_PROGRESS_EVENT_TYPES = new Set([
  "planner_request_started",
  "step_started",
  "step_finished",
  "reasoning_delta",
  "tool_input_delta",
  "tool_call_started",
  "tool_call_proposed",
  "tool_call_completed",
  "tool_call_denied",
  "skill_context_loaded",
  "log",
  "final_composer_started"
]);

function isVisibleOutputEvent(eventType, payload = {}) {
  if (eventType === "text_delta") return true;
  if (eventType === "inline_result") return typeof payload?.text === "string" && payload.text.trim().length > 0;
  if (eventType === "artifact_created") {
    return Boolean(payload?.path || payload?.artifact_path || payload?.artifact_paths?.length);
  }
  if (eventType === "success") {
    return typeof payload?.text === "string" && payload.text.trim().length > 0;
  }
  return false;
}

function isExecutorProgressEvent(eventType) {
  return EXECUTOR_PROGRESS_EVENT_TYPES.has(eventType);
}

function isExecutorEvent(eventType, payload = {}) {
  return isExecutorProgressEvent(eventType) || isVisibleOutputEvent(eventType, payload);
}

function taskCreatedPayloadWithSubmissionOrigin(runtime, taskId, payload = {}) {
  let task;
  try {
    task = runtime?.store?.getTask?.(taskId);
  } catch {
    task = null;
  }
  const metadata = task?.context_packet?.selection_metadata ?? {};
  const permissionMode = metadata.permission_mode_contract ?? null;
  const submissionOrigin = typeof metadata.submission_origin === "string"
    ? metadata.submission_origin.trim().slice(0, 80)
    : "";
  const voiceSessionId = typeof metadata.voice_session_id === "string"
    ? metadata.voice_session_id.trim().slice(0, 120)
    : "";
  if (!submissionOrigin && !voiceSessionId && !permissionMode) return payload ?? {};
  return {
    ...(payload ?? {}),
    ...(submissionOrigin ? { submission_origin: submissionOrigin } : {}),
    ...(voiceSessionId ? { voice_session_id: voiceSessionId } : {}),
    ...(permissionMode ? { permission_mode: permissionMode } : {})
  };
}

export function emitTaskEvent({ runtime, taskId, eventType, payload }) {
  const effectivePayload = eventType === "task_created"
    ? taskCreatedPayloadWithSubmissionOrigin(runtime, taskId, payload)
    : payload;
  const record = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: eventType,
    payload: effectivePayload
  };

  if (!EPHEMERAL_EVENT_TYPES.has(eventType)) {
    runtime.store.appendEvent(record);
  }
  try {
    runtime.conversationSessions?.recordTaskEvent?.({
      taskId,
      eventType,
      payload: effectivePayload,
      event: record
    });
  } catch {
    // Session observability must never break tool execution or streaming.
  }
  runtime.eventBus.publish(record);
  try {
    runtime.runtimeGraph?.recordTaskEvent?.({
      taskId,
      eventType,
      payload: effectivePayload,
      event: record,
      runtime
    });
  } catch {
    // Graph checkpoint observability must never break task execution.
  }
  try {
    runtime.networkOtelExporter?.recordTaskEvent?.({
      taskId,
      eventType,
      payload: effectivePayload,
      event: record
    });
  } catch {
    // Network OTEL export is opt-in observability and must never affect task execution.
  }
  if (taskId && !firstEventTimingEmitted.has(taskId) && isExecutorEvent(eventType, effectivePayload)) {
    firstEventTimingEmitted.add(taskId);
    emitPhaseTiming(runtime, taskId, "executor_first_event");
  }
  if (taskId && !firstProgressTimingEmitted.has(taskId) && isExecutorProgressEvent(eventType)) {
    firstProgressTimingEmitted.add(taskId);
    emitPhaseTiming(runtime, taskId, "executor_first_progress");
  }
  if (eventType === "text_delta" && taskId && !firstDeltaTimingEmitted.has(taskId)) {
    firstDeltaTimingEmitted.add(taskId);
    emitPhaseTiming(runtime, taskId, "executor_first_delta");
  }
  if (taskId && !firstVisibleTimingEmitted.has(taskId) && isVisibleOutputEvent(eventType, effectivePayload)) {
    firstVisibleTimingEmitted.add(taskId);
    emitPhaseTiming(runtime, taskId, "executor_first_visible_output");
  }
  if (eventType === "status_changed" && ["success", "failed", "cancelled", "partial_success"].includes(payload?.status)) {
    firstEventTimingEmitted.delete(taskId);
    firstProgressTimingEmitted.delete(taskId);
    firstDeltaTimingEmitted.delete(taskId);
    firstVisibleTimingEmitted.delete(taskId);
  }
  void persistTaskEvent(runtime, record);

  // UCA-077 P2-03: piggy-back a `decision_trace` event onto every
  // `task_created` so SSE consumers (overlay timeline, task detail page)
  // can render the goal / tool-policy / executor decisions without an
  // extra round trip. Lookup-on-emit avoids touching the submission sites.
  if (eventType === "task_created" && !effectivePayload?.__suppressDecisionTrace) {
    emitDecisionTraceFollowUp(runtime, taskId);
  }

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
          tool_id: effectivePayload?.tool_id ?? effectivePayload?.tool ?? null
        }
      });
    }
  }

  return record;
}

function emitPhaseTiming(runtime, taskId, phase) {
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
      phase,
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
    return;
  }
  const trace = task?.task_spec?.decision_trace;
  if (!Array.isArray(trace) || trace.length === 0) return;

  runtime.eventBus.publish({
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: "decision_trace",
    payload: {
      stages: trace.map((entry) => ({
        stage: entry.stage,
        output: entry.output,
        reason: entry.reason
      })),
      executor: task?.task_spec?.suggested_executor,
      tool_policy: task?.task_spec?.tool_policy
    }
  });
}

export function resetTaskEventEmitterStateForTests() {
  firstEventTimingEmitted.clear();
  firstProgressTimingEmitted.clear();
  firstDeltaTimingEmitted.clear();
  firstVisibleTimingEmitted.clear();
}
