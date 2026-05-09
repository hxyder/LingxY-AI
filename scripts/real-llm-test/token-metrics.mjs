function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function roundRatio(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function promptEstimateTotal(estimate = null) {
  if (!estimate || typeof estimate !== "object") return 0;
  const explicit = positiveNumber(estimate.total_estimated_tokens);
  if (explicit > 0) return explicit;
  if (!Array.isArray(estimate.segments)) return 0;
  return estimate.segments.reduce((sum, segment) =>
    sum + positiveNumber(segment?.estimated_tokens), 0);
}

function calibratePromptEstimate(usage = null, estimate = null) {
  const actual = positiveNumber(usage?.input_tokens);
  const estimated = promptEstimateTotal(estimate);
  if (actual <= 0 || estimated <= 0) return null;
  const delta = estimated - actual;
  return {
    actual_input_tokens: actual,
    estimated_input_tokens: estimated,
    delta_tokens: delta,
    estimate_to_actual_ratio: roundRatio(estimated / actual),
    absolute_error_pct: roundRatio(Math.abs(delta) / actual)
  };
}

function normalizeUsage(usage = {}) {
  if (!usage || typeof usage !== "object") return null;
  const input = positiveNumber(usage.input_tokens ?? usage.prompt_tokens);
  const output = positiveNumber(usage.output_tokens ?? usage.completion_tokens);
  const explicitTotal = positiveNumber(usage.total_tokens);
  const total = explicitTotal > 0 ? explicitTotal : input + output;
  const cacheHit = positiveNumber(usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens);
  const cacheMiss = positiveNumber(usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens);
  const cacheCreation = positiveNumber(usage.cache_creation_input_tokens);
  const cacheRead = positiveNumber(usage.cache_read_input_tokens);
  if (input + output + total + cacheHit + cacheMiss + cacheCreation + cacheRead <= 0) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    cache_hit_tokens: cacheHit,
    cache_miss_tokens: cacheMiss,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  };
}

function compactLlmCall(event) {
  const payload = event?.payload ?? {};
  const usage = normalizeUsage(payload.usage ?? payload.token_usage);
  if (!usage) return null;
  const promptSegments = payload.prompt_segments_estimate ?? null;
  return {
    call_site: payload.call_site ?? event?.event_type ?? "unknown",
    iteration: Number.isFinite(Number(payload.iteration)) ? Number(payload.iteration) : null,
    provider_id: payload.provider_id ?? null,
    provider_kind: payload.provider_kind ?? null,
    provider_name: payload.provider_name ?? null,
    model: payload.model ?? null,
    transport: payload.transport ?? null,
    stream: payload.stream === true,
    aborted: payload.aborted === true,
    prompt_segments_estimate: promptSegments,
    prompt_estimate_calibration: calibratePromptEstimate(usage, promptSegments),
    usage
  };
}

function sumCalls(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    seen: true
  };
  for (const call of calls) {
    const usage = call?.usage ?? {};
    totals.input_tokens += positiveNumber(usage.input_tokens);
    totals.output_tokens += positiveNumber(usage.output_tokens);
    totals.total_tokens += positiveNumber(usage.total_tokens);
    totals.cache_hit_tokens += positiveNumber(usage.cache_hit_tokens);
    totals.cache_miss_tokens += positiveNumber(usage.cache_miss_tokens);
    totals.cache_creation_input_tokens += positiveNumber(usage.cache_creation_input_tokens);
    totals.cache_read_input_tokens += positiveNumber(usage.cache_read_input_tokens);
  }
  if (totals.total_tokens === 0) totals.total_tokens = totals.input_tokens + totals.output_tokens;
  return totals;
}

function aggregatePromptCalibration(calls = []) {
  const items = calls
    .map((call) => call?.prompt_estimate_calibration)
    .filter(Boolean);
  if (items.length === 0) return null;
  const actual = items.reduce((sum, item) => sum + positiveNumber(item.actual_input_tokens), 0);
  const estimated = items.reduce((sum, item) => sum + positiveNumber(item.estimated_input_tokens), 0);
  if (actual <= 0 || estimated <= 0) return null;
  const delta = estimated - actual;
  return {
    call_count: items.length,
    actual_input_tokens: actual,
    estimated_input_tokens: estimated,
    delta_tokens: delta,
    estimate_to_actual_ratio: roundRatio(estimated / actual),
    absolute_error_pct: roundRatio(Math.abs(delta) / actual)
  };
}

export function collectTokenMetrics(events = []) {
  const llmCalls = [];
  const legacyCalls = [];
  for (const event of events) {
    const call = compactLlmCall(event);
    if (!call) continue;
    if (event?.event_type === "llm_usage") {
      llmCalls.push(call);
    } else {
      legacyCalls.push(call);
    }
  }

  const selectedCalls = llmCalls.length > 0 ? llmCalls : legacyCalls;
  return {
    token_usage: sumCalls(selectedCalls),
    token_usage_source: llmCalls.length > 0 ? "llm_usage" : (legacyCalls.length > 0 ? "legacy_event_payload" : null),
    llm_usage_call_count: llmCalls.length,
    llm_usage_calls: llmCalls,
    prompt_estimate_calibration: aggregatePromptCalibration(llmCalls)
  };
}
