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

// Best-effort "X/Y" step suffix. Backends may emit either step_index +
// step_total (preferred), step_index alone (numerator only), or neither
// (callers can pass a fallback index/total via the second argument). The
// returned string starts with " · " so it can be appended directly.
function formatStepSuffix(payload, fallback = {}) {
  const idx = Number(payload.step_index ?? fallback.index);
  const tot = Number(payload.step_total ?? fallback.total);
  const idxOk = Number.isFinite(idx) && idx > 0;
  const totOk = Number.isFinite(tot) && tot > 0;
  if (idxOk && totOk) return ` · 第 ${idx}/${tot} 步`;
  if (idxOk) return ` · 第 ${idx} 步`;
  return "";
}

export function formatTaskEventSummary(rawEvent, context = {}) {
  const frame = toTaskEventFrame(rawEvent);
  const payload = frame.data ?? {};
  const step = payload.step ?? payload.sub_status ?? payload.status ?? "任务步骤";
  const pct = typeof payload.progress === "number" ? ` · ${Math.round(payload.progress * 100)}%` : "";
  const stepSuffix = formatStepSuffix(payload, context.step ?? {});

  switch (frame.event) {
    case "task_created":
      return {
        title: "任务已创建",
        body: payload.executor ? `执行器：${payload.executor}` : "任务已经进入队列。"
      };
    case "status_changed":
      return {
        title: "状态更新",
        body: `任务进入 ${payload.status ?? "unknown"}${payload.sub_status ? ` / ${payload.sub_status}` : ""}${pct}${stepSuffix}`.trim()
      };
    case "planner_request_started":
      return {
        title: "请求模型",
        body: payload.iteration != null ? `第 ${payload.iteration} 轮` : "正在请求模型。"
      };
    case "final_composer_started":
      return {
        title: "整理回答",
        body: payload.reason ?? "正在把工具结果合成为最终回复。"
      };
    case "conversation_step":
      return {
        title: "执行进度",
        body: payload.step_label ?? payload.message ?? "正在执行。"
      };
    case "sr_patch_applied":
      return {
        title: "语义路由更新",
        body: [
          payload.expected_output ? `输出：${payload.expected_output}` : null,
          payload.tool_policy_web ? `联网：${payload.tool_policy_web}` : null
        ].filter(Boolean).join(" · ") || "已按语义分类更新任务策略。"
      };
    case "background_context_added":
      return {
        title: "补充上下文",
        body: payload.kind === "memory_recall"
          ? `记忆召回 ${payload.count ?? 0} 条`
          : payload.kind === "recent_artifact"
            ? "已加入最近产物上下文"
            : "已加入背景上下文"
      };
    case "step_started":
      return {
        title: "开始执行",
        body: `${step}${pct}${stepSuffix}`.trim()
      };
    case "accepted":
      return {
        title: "已接收",
        body: "执行器已接收任务。"
      };
    case "started":
      return {
        title: "已启动",
        body: "执行器已开始处理。"
      };
    case "provider_resolved":
      return {
        title: "模型/执行器",
        body: [payload.provider_name ?? payload.provider_id ?? payload.provider_kind, payload.model, payload.transport]
          .filter(Boolean)
          .join(" · ") || "已选择执行器。"
      };
    case "phase_timing":
      return {
        title: "耗时",
        body: `${payload.phase ?? "phase"} · ${payload.duration_ms ?? "?"}ms`
      };
    case "step_finished":
      return {
        title: "步骤完成",
        body: `${step}${pct}${stepSuffix}`.trim()
      };
    case "artifact_created":
      return {
        title: "结果已生成",
        body: payload.path ?? "已生成新的结果文件。"
      };
    case "tool_input_delta":
      return {
        title: "正在写入",
        body: `${payload.tool_id ?? "tool"} · ${(payload.partial_json ?? "").length}B`
      };
    case "tool_call_started":
    case "tool_call_proposed":
      return {
        title: "工具调用",
        body: `正在调用 ${payload.tool_id ?? payload.tool ?? "工具"}`
      };
    case "tool_call_completed":
      return {
        title: "工具完成",
        body: `${payload.tool_id ?? payload.tool ?? "工具"} · ${payload.success === false ? "失败" : "成功"}`
      };
    case "tool_call_denied":
      return {
        title: "工具已拦截",
        body: payload.tool_id ?? payload.tool ?? "工具调用被拦截。"
      };
    case "success":
      return {
        title: "任务完成",
        body: payload.summary ?? "任务已经成功完成。"
      };
    case "partial_success":
      return {
        title: "部分完成",
        body: payload.summary ?? payload.message ?? "任务已完成，但包含部分警告。"
      };
    case "failed":
      return {
        title: "任务失败",
        body: payload.message ?? "任务执行失败。"
      };
    case "cancel_requested":
      return {
        title: "正在取消",
        body: "已收到取消请求。"
      };
    case "cancelled":
      return {
        title: "任务已取消",
        body: payload.message ?? "任务已停止执行。"
      };
    case "inline_result":
      return {
        title: "回复",
        body: payload.text ?? payload.message ?? "已返回结果。"
      };
    case "log":
      return {
        title: "执行日志",
        body: payload.message ?? JSON.stringify(payload)
      };
    default:
      return {
        title: frame.event,
        body: payload.message ?? JSON.stringify(payload)
      };
  }
}

export function applyTaskEventPatch(task, rawEvent) {
  const frame = toTaskEventFrame(rawEvent);
  const payload = frame.data ?? {};
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
      nextTask.status = nextTask.status === "queued" ? "running" : nextTask.status;
      nextTask.current_step = payload.step ?? nextTask.current_step;
      nextTask.sub_status = payload.step ?? nextTask.sub_status;
      if (typeof payload.progress === "number") {
        nextTask.progress = payload.progress;
      }
      break;
    case "step_finished":
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

  const promise = (async () => {
    const search = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}/events${search}`, {
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
