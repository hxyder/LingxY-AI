import {
  TOOL_DISPLAY_LABELS,
  TOOL_DISPLAY_LABELS_EN,
  formatToolDisplayName
} from "./tool-display.mjs";
import { currentLingxyLocale } from "./i18n-dom.mjs";
import { createRuntimeHttpClient } from "./shared/runtime-http-client.mjs";

const TOOL_INVOCATION_PREFIXES = Object.freeze(buildKnownToolInvocationPrefixes());

function isZhLocale() {
  return currentLingxyLocale() === "zh-CN";
}

function localeText(en, zh) {
  return isZhLocale() ? zh : en;
}

function parseSseFrame(frame) {
  const parsed = {
    id: null,
    event: "message",
    data: null
  };

  for (const line of frame.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("id:")) {
      parsed.id = line.slice(3).trim();
      continue;
    }

    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      const payloadText = line.slice(5).trim();
      parsed.data = payloadText ? JSON.parse(payloadText) : null;
    }
  }

  if (!parsed.id && !parsed.data) {
    return null;
  }

  return parsed;
}

function buildKnownToolInvocationPrefixes() {
  const values = new Set(["tool_call"]);
  for (const labels of [TOOL_DISPLAY_LABELS, TOOL_DISPLAY_LABELS_EN]) {
    for (const [raw, label] of Object.entries(labels)) {
      if (raw) values.add(raw);
      if (label) values.add(label);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function toTaskEventFrame(event) {
  return {
    id: event?.id ?? event?.event_id ?? null,
    event: event?.event ?? event?.event_type ?? "message",
    data: event?.data ?? event?.payload ?? null,
    timestamp: event?.timestamp ?? event?.ts ?? event?.at ?? null,
    taskId: event?.taskId ?? event?.task_id ?? null,
    task_id: event?.task_id ?? event?.taskId ?? null
  };
}

function normalizeMaybeJsonText(text = "") {
  return String(text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function readBalancedJsonObjectPrefix(text = "") {
  const source = String(text ?? "").trim();
  if (!source.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonText = source.slice(0, i + 1);
        const rest = source.slice(i + 1).trim();
        return { jsonText, rest };
      }
    }
  }
  return null;
}

function parseVisibleToolInvocationText(text = "") {
  const normalized = normalizeMaybeJsonText(text);
  for (const prefix of TOOL_INVOCATION_PREFIXES) {
    if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rest = normalized.slice(prefix.length).trimStart();
    if (!rest.startsWith("{")) continue;
    const json = readBalancedJsonObjectPrefix(rest);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json.jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      return { prefix, args: parsed, rest: json.rest };
    } catch {
      return null;
    }
  }
  return null;
}

export function isInternalControlJsonText(text = "") {
  const normalized = normalizeMaybeJsonText(text);
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return Object.prototype.hasOwnProperty.call(parsed, "iteration")
      && Object.prototype.hasOwnProperty.call(parsed, "next_action")
      && Object.prototype.hasOwnProperty.call(parsed, "violation_kinds")
      && Object.prototype.hasOwnProperty.call(parsed, "satisfied");
  } catch {
    return false;
  }
}

export function isInternalToolInvocationText(text = "") {
  const parsed = parseVisibleToolInvocationText(text);
  return Boolean(parsed && !parsed.rest);
}

function stripInternalToolProtocolJson(text = "") {
  const source = String(text ?? "");
  return source.replace(/\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"args"\s*:\s*\{[\s\S]*?\}[\s\S]*?\}/g, (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
          && typeof parsed.tool === "string"
          && parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)) {
        return "";
      }
    } catch {
      return candidate;
    }
    return candidate;
  });
}

export function looksLikeInternalControlJsonText(text = "") {
  const normalized = normalizeMaybeJsonText(text);
  if (!normalized.startsWith("{")) return false;
  const hits = [
    /"iteration"\s*:/.test(normalized),
    /"next_action"\s*:/.test(normalized),
    /"violation_kinds"\s*:/.test(normalized),
    /"satisfied"\s*:/.test(normalized)
  ].filter(Boolean).length;
  return hits >= 3;
}

export function looksLikeInternalToolInvocationText(text = "") {
  const normalized = normalizeMaybeJsonText(text);
  if (!normalized) return false;
  return TOOL_INVOCATION_PREFIXES.some((prefix) => {
    const lower = normalized.toLowerCase();
    const prefixLower = prefix.toLowerCase();
    if (lower === prefixLower) return true;
    if (!lower.startsWith(prefixLower)) return false;
    const rest = normalized.slice(prefix.length);
    return /^\s*\{/.test(rest);
  });
}

export function isInternalAssistantText(text = "") {
  return isInternalControlJsonText(text) || isInternalToolInvocationText(text);
}

export function looksLikeInternalAssistantText(text = "") {
  return looksLikeInternalControlJsonText(text) || looksLikeInternalToolInvocationText(text);
}

export function sanitizeAssistantVisibleText(text = "") {
  const source = String(text ?? "");
  if (isInternalControlJsonText(source)) return "";
  const parsedToolInvocation = parseVisibleToolInvocationText(source);
  if (parsedToolInvocation) return parsedToolInvocation.rest;
  return stripInternalToolProtocolJson(source);
}

function formatPayloadFallbackMessage(payload = {}, fallback = localeText("Execution event received.", "已收到执行事件。")) {
  if (payload?.message) return payload.message;
  if (payload?.summary) return payload.summary;
  if (payload?.error) return payload.error;
  if (payload?.detail) return payload.detail;
  if (payload?.code) return `${localeText("Code", "代码")}: ${payload.code}`;
  if (payload?.status) return `${localeText("Status", "状态")}: ${payload.status}`;
  if (payload?.tool_id || payload?.tool) return `${localeText("Tool", "工具")}: ${formatToolDisplayName(payload.tool_id ?? payload.tool)}`;
  return fallback;
}

// Best-effort "X/Y" step suffix. Backends may emit either step_index +
// step_total (preferred), step_index alone (numerator only), or neither
// (callers can pass a fallback index/total via the second argument). The
// returned string starts with " · " so it can be appended directly.
function formatStepSuffix(payload, fallback = {}) {
  const idx = Number(payload.step_index ?? fallback.index);
  const tot = Number(payload.step_total ?? fallback.total);
  const idxOk = Number.isFinite(idx) && idx > 0;
  const totOk = Number.isFinite(tot) && tot > 0;
  if (idxOk && totOk) return localeText(` · step ${idx}/${tot}`, ` · 第 ${idx}/${tot} 步`);
  if (idxOk) return localeText(` · step ${idx}`, ` · 第 ${idx} 步`);
  return "";
}

export function formatTaskEventSummary(rawEvent, context = {}) {
  const frame = toTaskEventFrame(rawEvent);
  const payload = frame.data ?? {};
  const step = payload.step ?? payload.sub_status ?? payload.status ?? localeText("Task step", "任务步骤");
  const pct = typeof payload.progress === "number" ? ` · ${Math.round(payload.progress * 100)}%` : "";
  const stepSuffix = formatStepSuffix(payload, context.step ?? {});

  switch (frame.event) {
    case "task_created":
      return {
        title: localeText("Task created", "任务已创建"),
        body: payload.executor ? `${localeText("Executor", "执行器")}: ${payload.executor}` : localeText("Task is queued.", "任务已经进入队列。")
      };
    case "status_changed":
      return {
        title: localeText("Status update", "状态更新"),
        body: `${localeText("Task entered", "任务进入")} ${payload.status ?? "unknown"}${payload.sub_status ? ` / ${payload.sub_status}` : ""}${pct}${stepSuffix}`.trim()
      };
    case "planner_request_started":
      return {
        title: localeText("Requesting model", "请求模型"),
        body: payload.iteration != null ? localeText(`Round ${payload.iteration}`, `第 ${payload.iteration} 轮`) : localeText("Requesting model.", "正在请求模型。")
      };
    case "final_composer_started":
      return {
        title: localeText("Composing answer", "整理回答"),
        body: payload.reason ?? localeText("Composing tool results into the final answer.", "正在把工具结果合成为最终回复。")
      };
    case "conversation_step":
      return {
        title: localeText("Progress", "执行进度"),
        body: payload.step_label ?? payload.message ?? localeText("Running.", "正在执行。")
      };
    case "sr_patch_applied":
      return {
        title: localeText("Semantic routing update", "语义路由更新"),
        body: [
          payload.expected_output ? `${localeText("Output", "输出")}: ${payload.expected_output}` : null,
          payload.tool_policy_web ? `${localeText("Web", "联网")}: ${payload.tool_policy_web}` : null
        ].filter(Boolean).join(" · ") || localeText("Task policy updated by semantic classification.", "已按语义分类更新任务策略。")
      };
    case "background_context_added":
      return {
        title: localeText("Added context", "补充上下文"),
        body: payload.kind === "memory_recall"
          ? localeText(`${payload.count ?? 0} memory items recalled`, `记忆召回 ${payload.count ?? 0} 条`)
          : payload.kind === "recent_artifact"
            ? localeText("Added recent artifact context", "已加入最近产物上下文")
            : localeText("Added background context", "已加入背景上下文")
      };
    case "file_ingest_started":
      return {
        title: localeText("Reading files", "读取文件"),
        body: localeText(`Preparing to read ${payload.total ?? payload.input_count ?? 0} files`, `准备读取 ${payload.total ?? payload.input_count ?? 0} 个文件`)
      };
    case "file_expand_started":
      return {
        title: localeText("Preparing files", "整理文件"),
        body: localeText(`Checking ${payload.input_count ?? 0} inputs`, `正在检查 ${payload.input_count ?? 0} 个输入`)
      };
    case "file_expand_finished":
      return {
        title: localeText("Preparing files", "整理文件"),
        body: localeText(`Found ${payload.expanded_count ?? 0} readable files`, `找到 ${payload.expanded_count ?? 0} 个可读取文件`)
      };
    case "file_ingest_progress":
      return {
        title: localeText("Reading files", "读取文件"),
        body: [
          `${payload.completed ?? "?"}/${payload.total ?? "?"}`,
          payload.path ? String(payload.path).split(/[\\/]/).pop() : null
        ].filter(Boolean).join(" · ")
      };
    case "file_ingest_finished":
      return {
        title: localeText("File read complete", "文件读取完成"),
        body: `${payload.completed ?? payload.total ?? 0}/${payload.total ?? payload.completed ?? 0}`
      };
    case "file_read_started":
      return {
        title: payload.recursive ? localeText("Deep folder read", "深入读取文件夹") : localeText("Read file text", "读取文件原文"),
        body: payload.path ? String(payload.path).split(/[\\/]/).pop() : localeText("Preparing to read content", "准备读取内容")
      };
    case "file_read_progress":
      return {
        title: localeText("Read file text", "读取文件原文"),
        body: [
          `${payload.completed ?? "?"}/${payload.total ?? "?"}`,
          payload.file_path ? String(payload.file_path).split(/[\\/]/).pop() : null
        ].filter(Boolean).join(" · ")
      };
    case "file_read_finished":
      return {
        title: payload.success === false ? localeText("File read failed", "文件读取失败") : localeText("File read complete", "文件读取完成"),
        body: payload.success === false
          ? (payload.error ?? localeText("Read failed", "读取失败"))
          : payload.recursive
            ? localeText(`${payload.files_read ?? 0}/${payload.files_seen ?? payload.files_read ?? 0} files`, `${payload.files_read ?? 0}/${payload.files_seen ?? payload.files_read ?? 0} 个文件`)
            : localeText(`${payload.chars_extracted ?? 0} chars`, `${payload.chars_extracted ?? 0} 字符`)
      };
    case "step_started":
      return {
        title: localeText("Started step", "开始执行"),
        body: `${step}${pct}${stepSuffix}`.trim()
      };
    case "accepted":
      return {
        title: localeText("Accepted", "已接收"),
        body: localeText("Executor accepted the task.", "执行器已接收任务。")
      };
    case "started":
      return {
        title: localeText("Started", "已启动"),
        body: localeText("Executor has started processing.", "执行器已开始处理。")
      };
    case "provider_resolved":
      return {
        title: localeText("Model / executor", "模型/执行器"),
        body: [payload.provider_name ?? payload.provider_id ?? payload.provider_kind, payload.model, payload.transport]
          .filter(Boolean)
          .join(" · ") || localeText("Executor selected.", "已选择执行器。")
      };
    case "phase_timing":
      return {
        title: localeText("Timing", "耗时"),
        body: `${payload.phase ?? "phase"} · ${payload.duration_ms ?? "?"}ms`
      };
    case "step_finished":
      return {
        title: localeText("Step complete", "步骤完成"),
        body: `${step}${pct}${stepSuffix}`.trim()
      };
    case "artifact_created":
      return {
        title: localeText("Result generated", "结果已生成"),
        body: payload.path ?? localeText("Generated a new result file.", "已生成新的结果文件。")
      };
    case "tool_input_delta":
      return {
        title: localeText("Writing", "正在写入"),
        body: `${formatToolDisplayName(payload.tool_id ?? payload.tool ?? "tool")} · ${(payload.partial_json ?? "").length}B`
      };
    case "tool_call_started":
    case "tool_call_proposed":
      return {
        title: localeText("Tool call", "工具调用"),
        body: `${localeText("Calling", "正在调用")} ${formatToolDisplayName(payload.tool_id ?? payload.tool ?? localeText("Tool", "工具"))}`
      };
    case "tool_call_completed":
      return {
        title: localeText("Tool complete", "工具完成"),
        body: `${formatToolDisplayName(payload.tool_id ?? payload.tool ?? localeText("Tool", "工具"))} · ${payload.success === false ? localeText("failed", "失败") : localeText("success", "成功")}`
      };
    case "tool_call_denied":
      return {
        title: localeText("Tool blocked", "工具已拦截"),
        body: formatToolDisplayName(payload.tool_id ?? payload.tool ?? localeText("Tool call", "工具调用"))
      };
    case "local_file_read_guidance":
      return {
        title: localeText("Source text required", "需要读取原文"),
        body: [
          payload.deep ? localeText("Deep folder read required", "需要深度文件夹读取") : localeText("Local file text required", "需要读取本地文件正文"),
          Number(payload.candidate_count ?? 0) > 0 ? localeText(`${payload.candidate_count} candidates`, `候选 ${payload.candidate_count} 个`) : localeText("No reliable index candidates", "暂无可靠索引候选"),
          Number(payload.guidance_count ?? 0) > 0 ? localeText(`${payload.guidance_count} hints`, `提示 ${payload.guidance_count}`) : null
        ].filter(Boolean).join(" · ")
      };
    case "success":
      return {
        title: localeText("Task complete", "任务完成"),
        body: payload.summary ?? localeText("Task completed successfully.", "任务已经成功完成。")
      };
    case "partial_success":
      return {
        title: localeText("Partial success", "部分完成"),
        body: payload.summary ?? payload.message ?? localeText("Task completed with some warnings.", "任务已完成，但包含部分警告。")
      };
    case "failed":
      return {
        title: localeText("Task failed", "任务失败"),
        body: payload.message ?? localeText("Task execution failed.", "任务执行失败。")
      };
    case "cancel_requested":
      return {
        title: localeText("Cancelling", "正在取消"),
        body: localeText("Cancellation request received.", "已收到取消请求。")
      };
    case "cancelled":
      return {
        title: localeText("Task cancelled", "任务已取消"),
        body: payload.message ?? localeText("Task stopped.", "任务已停止执行。")
      };
    case "inline_result":
      return {
        title: localeText("Reply", "回复"),
        body: payload.text ?? payload.message ?? localeText("Result returned.", "已返回结果。")
      };
    case "log":
      return {
        title: localeText("Execution log", "执行日志"),
        body: formatPayloadFallbackMessage(payload, localeText("Execution log received.", "已收到执行日志。"))
      };
    default:
      return {
        title: frame.event,
        body: formatPayloadFallbackMessage(payload)
      };
  }
}

export function applyTaskEventPatch(task, rawEvent) {
  const frame = toTaskEventFrame(rawEvent);
  const payload = frame.data ?? {};
  const diagnosticEvent = payload?.background === true || payload?.visibility === "diagnostic";
  const nextTask = {
    ...(task ?? {})
  };

  if (!nextTask.task_id) {
    return nextTask;
  }

  switch (frame.event) {
    case "status_changed":
      nextTask.status = payload.status ?? nextTask.status;
      nextTask.sub_status = payload.sub_status ?? nextTask.sub_status;
      if (typeof payload.progress === "number") {
        nextTask.progress = payload.progress;
      }
      break;
    case "step_started":
      if (diagnosticEvent) break;
      nextTask.status = nextTask.status === "queued" ? "running" : nextTask.status;
      nextTask.current_step = payload.step ?? nextTask.current_step;
      nextTask.sub_status = payload.step ?? nextTask.sub_status;
      if (typeof payload.progress === "number") {
        nextTask.progress = payload.progress;
      }
      break;
    case "step_finished":
      if (diagnosticEvent) break;
      if (payload.step) {
        const completed = new Set(nextTask.completed_steps ?? []);
        completed.add(payload.step);
        nextTask.completed_steps = [...completed];
      }
      if (typeof payload.progress === "number") {
        nextTask.progress = payload.progress;
      }
      break;
    case "success":
      nextTask.status = "success";
      nextTask.sub_status = "completed";
      nextTask.progress = 1;
      break;
    case "partial_success":
      nextTask.status = "partial_success";
      nextTask.sub_status = "completed_with_warnings";
      if (typeof payload.progress === "number") {
        nextTask.progress = payload.progress;
      }
      break;
    case "failed":
      nextTask.status = "failed";
      nextTask.sub_status = payload.category ?? nextTask.sub_status;
      nextTask.failure_user_message = payload.message ?? nextTask.failure_user_message;
      break;
    case "cancel_requested":
      nextTask.status = "cancelling";
      nextTask.sub_status = "cancelling";
      break;
    case "cancelled":
      nextTask.status = "cancelled";
      nextTask.sub_status = payload.category ?? "user_interrupted";
      nextTask.failure_user_message = payload.message ?? nextTask.failure_user_message;
      break;
    default:
      break;
  }

  return nextTask;
}

export function applyTaskEventToDetail(detail, rawEvent) {
  const frame = toTaskEventFrame(rawEvent);
  const currentEvents = detail?.events ?? [];
  if (frame.id && currentEvents.some((event) => (event.event_id ?? event.id) === frame.id)) {
    return detail;
  }

  const task = applyTaskEventPatch(detail?.task ?? {}, frame);
  return {
    ...(detail ?? {}),
    task,
    events: [
      ...currentEvents,
      {
        event_id: frame.id,
        event_type: frame.event,
        payload: frame.data,
        ts: frame.timestamp ?? new Date().toISOString()
      }
    ]
  };
}

export function subscribeTaskEvents(serviceBaseUrl, taskId, {
  since = null,
  onEvent = () => {},
  onError = () => {}
} = {}) {
  const controller = new AbortController();
  const baseUrl = serviceBaseUrl.replace(/\/+$/, "");
  const httpClient = createRuntimeHttpClient({ getBaseUrl: () => baseUrl });

  const promise = (async () => {
    const search = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await httpClient.fetchResponse(`/task/${encodeURIComponent(taskId)}/events${search}`, {
      headers: {
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to subscribe task events: ${taskId}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) {
          onEvent(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  })().catch((error) => {
    if (error.name === "AbortError") {
      return null;
    }
    onError(error);
    return null;
  });

  return {
    close() {
      controller.abort();
    },
    promise
  };
}
