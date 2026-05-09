function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function compactReasonKind(reason) {
  const text = String(reason ?? "").trim();
  if (!text) return "unknown";
  return text.split(":")[0].trim() || "unknown";
}

function mean(values) {
  const nums = values.map(positiveNumber).filter((n) => n > 0);
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((sum, n) => sum + n, 0) / nums.length);
}

function percentile(values, p) {
  const nums = values.map(positiveNumber).filter((n) => n > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function deriveOutcome(result = {}) {
  const grade = result.grade ?? {};
  const status = String(grade.status ?? "").toLowerCase();
  const blocked = grade.blocked === true || status === "blocked";
  if (blocked) return { outcome: "blocked", score: 0.2 };
  if (grade.passed === true && Array.isArray(grade.warnings) && grade.warnings.length > 0) {
    return { outcome: "passed_with_warnings", score: 0.9 };
  }
  if (grade.passed === true) return { outcome: "passed", score: 1 };
  if (status === "partial_success") return { outcome: "partial", score: 0.55 };
  if (status === "cancelled") return { outcome: "cancelled", score: 0.1 };
  return { outcome: "failed", score: 0 };
}

function deriveAttentionFlags(result = {}) {
  const metrics = result.metrics ?? {};
  const flags = [];
  const elapsedMs = positiveNumber(metrics.elapsed_ms ?? result.elapsedMs);
  const firstVisibleMs = positiveNumber(metrics.phase_timing?.executor_first_visible_output);
  const totalTokens = positiveNumber(metrics.token_usage?.total_tokens);
  const failedTools = positiveNumber(metrics.failed_tool_count);
  const textDeltas = positiveNumber(metrics.text_delta_count);

  if (elapsedMs >= 180_000) flags.push("very_slow_elapsed");
  else if (elapsedMs >= 60_000) flags.push("slow_elapsed");
  if (firstVisibleMs >= 15_000) flags.push("very_slow_first_visible");
  else if (firstVisibleMs >= 5_000) flags.push("slow_first_visible");
  if (totalTokens >= 150_000) flags.push("very_high_tokens");
  else if (totalTokens >= 50_000) flags.push("high_tokens");
  if (metrics.token_usage_source == null) flags.push("missing_token_usage");
  if (failedTools > 0) flags.push("failed_tools");
  if (textDeltas === 0 && ["success", "partial_success"].includes(String(result.grade?.status ?? ""))) {
    flags.push("no_streaming_text_delta");
  }
  return flags;
}

function deriveEfficiencyScore(result = {}) {
  const metrics = result.metrics ?? {};
  const elapsedMs = positiveNumber(metrics.elapsed_ms ?? result.elapsedMs);
  const firstVisibleMs = positiveNumber(metrics.phase_timing?.executor_first_visible_output);
  const totalTokens = positiveNumber(metrics.token_usage?.total_tokens);
  const failedTools = positiveNumber(metrics.failed_tool_count);
  let score = 100;

  if (elapsedMs >= 180_000) score -= 40;
  else if (elapsedMs >= 60_000) score -= 25;
  else if (elapsedMs >= 30_000) score -= 10;

  if (firstVisibleMs >= 15_000) score -= 30;
  else if (firstVisibleMs >= 5_000) score -= 15;

  if (totalTokens >= 150_000) score -= 30;
  else if (totalTokens >= 50_000) score -= 15;

  if (failedTools > 0) score -= Math.min(30, failedTools * 15);
  if (metrics.token_usage_source == null) score -= 5;

  return Math.max(0, Math.min(100, score));
}

export function computeCaseEvalMetrics(result = {}) {
  const metrics = result.metrics ?? {};
  const { outcome, score } = deriveOutcome(result);
  const reasons = Array.isArray(result.grade?.reasons) ? result.grade.reasons : [];
  const warnings = Array.isArray(result.grade?.warnings) ? result.grade.warnings : [];
  const tokenUsage = metrics.token_usage ?? {};
  return {
    id: result.id ?? null,
    category: result.category ?? null,
    outcome,
    quality_score: score,
    efficiency_score: deriveEfficiencyScore(result),
    status: result.grade?.status ?? null,
    reason_kinds: reasons.map(compactReasonKind),
    warning_count: warnings.length,
    elapsed_ms: positiveNumber(metrics.elapsed_ms ?? result.elapsedMs) || null,
    first_visible_ms: positiveNumber(metrics.phase_timing?.executor_first_visible_output) || null,
    total_tokens: positiveNumber(tokenUsage.total_tokens) || null,
    tool_count: positiveNumber(metrics.tool_count),
    failed_tool_count: positiveNumber(metrics.failed_tool_count),
    artifact_count: positiveNumber(metrics.artifact_count),
    llm_usage_call_count: positiveNumber(metrics.llm_usage_call_count),
    attention_flags: deriveAttentionFlags(result)
  };
}

export function summariseEvalMetrics(results = []) {
  const cases = results.map(computeCaseEvalMetrics);
  const total = cases.length;
  const outcomeCounts = {};
  const flagCounts = {};
  const failureKinds = {};
  for (const item of cases) {
    outcomeCounts[item.outcome] = (outcomeCounts[item.outcome] ?? 0) + 1;
    for (const flag of item.attention_flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
    for (const kind of item.reason_kinds) failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
  }
  const qualityScore = total > 0
    ? Math.round((cases.reduce((sum, item) => sum + item.quality_score, 0) / total) * 1000) / 10
    : null;
  const efficiencyScore = total > 0
    ? Math.round((cases.reduce((sum, item) => sum + item.efficiency_score, 0) / total) * 10) / 10
    : null;

  return {
    total,
    outcome_counts: outcomeCounts,
    pass_rate: ratio((outcomeCounts.passed ?? 0) + (outcomeCounts.passed_with_warnings ?? 0), total),
    partial_rate: ratio(outcomeCounts.partial ?? 0, total),
    blocked_rate: ratio(outcomeCounts.blocked ?? 0, total),
    quality_score_percent: qualityScore,
    efficiency_score_percent: efficiencyScore,
    timing: {
      elapsed_ms_avg: mean(cases.map((item) => item.elapsed_ms)),
      elapsed_ms_p95: percentile(cases.map((item) => item.elapsed_ms), 95),
      first_visible_ms_avg: mean(cases.map((item) => item.first_visible_ms)),
      first_visible_ms_p95: percentile(cases.map((item) => item.first_visible_ms), 95)
    },
    tokens: {
      cases_with_usage: cases.filter((item) => positiveNumber(item.total_tokens) > 0).length,
      total_tokens_avg: mean(cases.map((item) => item.total_tokens)),
      total_tokens_p95: percentile(cases.map((item) => item.total_tokens), 95)
    },
    tools: {
      tool_count_avg: mean(cases.map((item) => item.tool_count)),
      failed_tool_count: cases.reduce((sum, item) => sum + positiveNumber(item.failed_tool_count), 0)
    },
    top_attention_flags: Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
    top_failure_kinds: Object.entries(failureKinds).sort((a, b) => b[1] - a[1]).slice(0, 10),
    cases
  };
}
