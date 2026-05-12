import { defaultTokenEstimator } from "../policy/context-budget.mjs";

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function contentToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => contentToText(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (value.content != null) return contentToText(value.content);
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

export function estimatePromptSegments(segments = [], estimateTokens = defaultTokenEstimator) {
  if (!Array.isArray(segments)) return null;
  const out = [];
  for (const segment of segments) {
    const name = String(segment?.name ?? "").trim();
    if (!name) continue;
    const text = contentToText(segment?.content);
    const tokens = Number(estimateTokens(text));
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    out.push({
      name,
      estimated_tokens: Math.max(0, Math.ceil(tokens))
    });
  }
  if (out.length === 0) return null;
  const total = out.reduce((sum, segment) => sum + segment.estimated_tokens, 0);
  return {
    estimator: "default_chars_div_4",
    total_estimated_tokens: total,
    segments: out
  };
}

export function normalizeLlmUsage(usage = {}) {
  if (!usage || typeof usage !== "object") return null;
  const input = numberOrNull(usage.input_tokens ?? usage.prompt_tokens);
  const output = numberOrNull(usage.output_tokens ?? usage.completion_tokens);
  const total = numberOrNull(usage.total_tokens)
    ?? (input != null || output != null ? (input ?? 0) + (output ?? 0) : null);
  const cacheHit = numberOrNull(usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens);
  const cacheMiss = numberOrNull(usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens);
  const cacheCreation = numberOrNull(usage.cache_creation_input_tokens);
  const cacheRead = numberOrNull(usage.cache_read_input_tokens);
  if (
    input == null
    && output == null
    && total == null
    && cacheHit == null
    && cacheMiss == null
    && cacheCreation == null
    && cacheRead == null
  ) {
    return null;
  }
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    cache_hit_tokens: cacheHit,
    cache_miss_tokens: cacheMiss,
    prompt_cache_hit_tokens: cacheHit,
    prompt_cache_miss_tokens: cacheMiss,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  };
}

export function buildLlmUsagePayload({
  callSite = "unknown",
  iteration = null,
  usage,
  provider = null,
  stream = false,
  aborted = false,
  promptSegments = null,
  extra = {}
} = {}) {
  const normalized = normalizeLlmUsage(usage);
  if (!normalized) return null;
  const descriptor = typeof provider?.describe === "function"
    ? provider.describe()
    : provider;
  const promptEstimate = estimatePromptSegments(promptSegments);
  return {
    call_site: callSite,
    iteration: Number.isFinite(Number(iteration)) ? Number(iteration) : null,
    provider_id: descriptor?.provider_id ?? descriptor?.configId ?? descriptor?.id ?? null,
    provider_kind: descriptor?.provider_kind ?? descriptor?.kind ?? null,
    provider_name: descriptor?.provider_name ?? descriptor?.name ?? null,
    model: descriptor?.model ?? provider?.model ?? null,
    transport: descriptor?.transport ?? provider?.transport ?? null,
    model_role: descriptor?.model_role ?? provider?.modelRole ?? null,
    model_role_routing_enabled: descriptor?.model_role_routing_enabled ?? provider?.modelRoleRoutingEnabled ?? false,
    model_role_task_type: descriptor?.model_role_task_type ?? provider?.modelRoleTaskType ?? null,
    model_role_route_source: descriptor?.model_role_route_source ?? provider?.modelRoleRouteSource ?? null,
    model_role_status: descriptor?.model_role_status ?? provider?.modelRoleStatus ?? null,
    stream: Boolean(stream),
    aborted: Boolean(aborted),
    usage: normalized,
    ...(promptEstimate ? { prompt_segments_estimate: promptEstimate } : {}),
    ...extra
  };
}

export function emitLlmUsage({
  runtime = null,
  onEvent = null,
  task = null,
  taskId = null,
  callSite,
  iteration = null,
  usage,
  provider = null,
  stream = false,
  aborted = false,
  promptSegments = null,
  extra = {}
} = {}) {
  const payload = buildLlmUsagePayload({
    callSite,
    iteration,
    usage,
    provider,
    stream,
    aborted,
    promptSegments,
    extra
  });
  if (!payload) return null;
  const id = taskId ?? task?.task_id ?? null;
  if (typeof onEvent === "function") {
    onEvent({ event_type: "llm_usage", payload });
  } else if (typeof runtime?.emitTaskEvent === "function") {
    runtime.emitTaskEvent("llm_usage", payload);
  }
  if (typeof runtime?.store?.appendAuditLog === "function" && id) {
    try {
      runtime.store.appendAuditLog({
        audit_id: `audit_${cryptoRandomId()}`,
        ts: new Date().toISOString(),
        task_id: id,
        event_subtype: "ai.llm_usage",
        payload
      });
    } catch {
      // Usage telemetry must never break task execution.
    }
  }
  return payload;
}

function cryptoRandomId() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
