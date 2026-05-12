import { appendFileSync, readFileSync, statSync } from "node:fs";

export const EVAL_TREND_SCHEMA_VERSION = 1;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  const n = numberOrNull(value);
  if (n == null) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function countMap(source = {}) {
  const out = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

function topPairs(source = [], limit = 10) {
  return Array.isArray(source)
    ? source
        .map(([name, count]) => [String(name), Number(count) || 0])
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
    : [];
}

function delta(current, previous) {
  const a = numberOrNull(current);
  const b = numberOrNull(previous);
  return a == null || b == null ? null : round(a - b);
}

export function buildEvalTrendRun({
  summary = {},
  runStartedAt = new Date().toISOString(),
  commit = null,
  corpus = null,
  label = null
} = {}) {
  const quality = summary.qualityMetrics ?? {};
  const tokens = quality.tokens ?? {};
  const timing = quality.timing ?? {};
  const tokenUsage = summary.tokenUsage ?? {};

  return {
    schema_version: EVAL_TREND_SCHEMA_VERSION,
    run_started_at: new Date(runStartedAt).toISOString(),
    commit: commit ? String(commit) : null,
    corpus: corpus ? String(corpus) : null,
    label: label ? String(label) : null,
    total: Number(summary.total ?? quality.total ?? 0) || 0,
    pass_rate: round(summary.passRate ?? quality.pass_rate),
    blocked_rate: round(quality.blocked_rate),
    partial_rate: round(quality.partial_rate),
    quality_score_percent: round(quality.quality_score_percent, 1),
    efficiency_score_percent: round(quality.efficiency_score_percent, 1),
    latency: {
      elapsed_ms_avg: numberOrNull(timing.elapsed_ms_avg),
      elapsed_ms_p95: numberOrNull(timing.elapsed_ms_p95),
      first_visible_ms_avg: numberOrNull(timing.first_visible_ms_avg),
      first_visible_ms_p95: numberOrNull(timing.first_visible_ms_p95)
    },
    tokens: {
      total_tokens: numberOrNull(tokenUsage.total_tokens),
      total_tokens_avg: numberOrNull(tokens.total_tokens_avg),
      total_tokens_p95: numberOrNull(tokens.total_tokens_p95),
      cases_with_usage: numberOrNull(tokens.cases_with_usage ?? tokenUsage.cases_with_usage)
    },
    outcomes: countMap(quality.outcome_counts),
    top_failure_classes: topPairs(quality.top_failure_kinds),
    top_attention_flags: topPairs(quality.top_attention_flags)
  };
}

export function readEvalTrendRuns(path) {
  if (!path || !statSync(path, { throwIfNoEntry: false })?.isFile()) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry?.schema_version === EVAL_TREND_SCHEMA_VERSION);
}

export function compareEvalTrendRuns(current, previous = null) {
  if (!current || !previous) return null;
  return {
    previous_run_started_at: previous.run_started_at ?? null,
    previous_commit: previous.commit ?? null,
    pass_rate_delta: delta(current.pass_rate, previous.pass_rate),
    blocked_rate_delta: delta(current.blocked_rate, previous.blocked_rate),
    total_tokens_delta: delta(current.tokens?.total_tokens, previous.tokens?.total_tokens),
    elapsed_ms_p95_delta: delta(current.latency?.elapsed_ms_p95, previous.latency?.elapsed_ms_p95),
    top_failure_classes_added: (current.top_failure_classes ?? [])
      .filter(([name]) => !(previous.top_failure_classes ?? []).some(([prev]) => prev === name))
      .map(([name]) => name)
  };
}

export function appendEvalTrendRun(path, run) {
  if (!path) throw new Error("trend path is required");
  appendFileSync(path, `${JSON.stringify(run)}\n`, "utf8");
  return run;
}
