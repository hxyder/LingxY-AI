function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function positiveNumber(value) {
  const n = nonNegativeNumber(value);
  return n != null && n > 0 ? n : 0;
}

function normalizeUsage(usage = {}) {
  if (!usage || typeof usage !== "object") return null;
  const input = nonNegativeNumber(usage.input_tokens ?? usage.prompt_tokens);
  const output = nonNegativeNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalRaw = nonNegativeNumber(usage.total_tokens);
  const total = totalRaw ?? (
    input != null || output != null ? (input ?? 0) + (output ?? 0) : null
  );
  const cacheHit = nonNegativeNumber(usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens);
  const cacheMiss = nonNegativeNumber(usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens);
  const cacheCreation = nonNegativeNumber(usage.cache_creation_input_tokens);
  const cacheRead = nonNegativeNumber(usage.cache_read_input_tokens);
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
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: total ?? 0,
    cache_hit_tokens: cacheHit ?? 0,
    cache_miss_tokens: cacheMiss ?? 0,
    cache_creation_input_tokens: cacheCreation ?? 0,
    cache_read_input_tokens: cacheRead ?? 0
  };
}

function normalizePromptSegments(value = null) {
  const estimate = value && typeof value === "object" ? value : null;
  const segments = Array.isArray(estimate?.segments)
    ? estimate.segments
      .map((segment) => ({
        name: String(segment?.name ?? "").trim(),
        estimated_tokens: positiveNumber(segment?.estimated_tokens)
      }))
      .filter((segment) => segment.name && segment.estimated_tokens > 0)
    : [];
  if (segments.length === 0) return null;
  const total = positiveNumber(estimate?.total_estimated_tokens)
    || segments.reduce((sum, segment) => sum + segment.estimated_tokens, 0);
  return {
    estimator: estimate?.estimator ?? "unknown",
    total_estimated_tokens: total,
    segments
  };
}

function normalizeCall(event = {}) {
  const payload = event?.payload ?? {};
  const usage = normalizeUsage(payload.usage ?? payload.token_usage);
  if (!usage) return null;
  return {
    event_id: event.event_id ?? null,
    at: event.ts ?? null,
    call_site: payload.call_site ?? "unknown",
    iteration: Number.isFinite(Number(payload.iteration)) ? Number(payload.iteration) : null,
    provider_id: payload.provider_id ?? null,
    provider_kind: payload.provider_kind ?? null,
    provider_name: payload.provider_name ?? null,
    model: payload.model ?? null,
    transport: payload.transport ?? null,
    stream: payload.stream === true,
    aborted: payload.aborted === true,
    usage,
    prompt_segments_estimate: normalizePromptSegments(payload.prompt_segments_estimate)
  };
}

function emptyTotals() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };
}

export function collectLlmUsageSummary(events = []) {
  const calls = [];
  for (const event of events) {
    if (event?.event_type !== "llm_usage") continue;
    const call = normalizeCall(event);
    if (call) calls.push(call);
  }
  if (calls.length === 0) return null;

  const totals = emptyTotals();
  const segmentTotals = new Map();
  for (const call of calls) {
    for (const key of Object.keys(totals)) {
      totals[key] += positiveNumber(call.usage?.[key]);
    }
    for (const segment of call.prompt_segments_estimate?.segments ?? []) {
      segmentTotals.set(
        segment.name,
        (segmentTotals.get(segment.name) ?? 0) + positiveNumber(segment.estimated_tokens)
      );
    }
  }
  if (totals.total_tokens === 0) totals.total_tokens = totals.input_tokens + totals.output_tokens;
  const promptSegments = [...segmentTotals.entries()]
    .map(([name, estimatedTokens]) => ({ name, estimated_tokens: estimatedTokens }))
    .filter((segment) => segment.estimated_tokens > 0)
    .sort((a, b) => b.estimated_tokens - a.estimated_tokens);

  return {
    call_count: calls.length,
    totals,
    cache: {
      hit_tokens: totals.cache_hit_tokens,
      miss_tokens: totals.cache_miss_tokens,
      creation_input_tokens: totals.cache_creation_input_tokens,
      read_input_tokens: totals.cache_read_input_tokens
    },
    prompt_segments_estimate: promptSegments.length > 0
      ? {
          estimator: "default_chars_div_4",
          total_estimated_tokens: promptSegments.reduce((sum, segment) => sum + segment.estimated_tokens, 0),
          segments: promptSegments
        }
      : null,
    calls
  };
}
