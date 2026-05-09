export const DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET = Object.freeze({
  startupMs: 30_000,
  interactionMs: 45_000,
  totalMs: 60_000,
  minChecks: 25
});

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function readDesktopGuiSmokePerfBudget(env = process.env) {
  return {
    startupMs: positiveNumber(
      env.LINGXY_ELECTRON_GUI_SMOKE_STARTUP_BUDGET_MS,
      DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET.startupMs
    ),
    interactionMs: positiveNumber(
      env.LINGXY_ELECTRON_GUI_SMOKE_INTERACTION_BUDGET_MS,
      DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET.interactionMs
    ),
    totalMs: positiveNumber(
      env.LINGXY_ELECTRON_GUI_SMOKE_TOTAL_BUDGET_MS,
      DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET.totalMs
    ),
    minChecks: positiveNumber(
      env.LINGXY_ELECTRON_GUI_SMOKE_MIN_CHECKS,
      DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET.minChecks
    )
  };
}

function metricNumber(perf, key) {
  const value = Number(perf?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function validateDesktopGuiSmokePerfResult(result, budget = DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET) {
  const failures = [];
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const perf = result?.perf ?? null;
  const startupMs = metricNumber(perf, "startup_ms");
  const firstWindowReadyMs = metricNumber(perf, "first_window_ready_ms");
  const interactionMs = metricNumber(perf, "interaction_ms");
  const totalMs = metricNumber(perf, "total_ms");
  const checkCount = metricNumber(perf, "check_count") ?? checks.length;

  if (!perf || typeof perf !== "object") {
    failures.push("missing_perf_report");
  }
  if (startupMs == null) failures.push("missing_startup_ms");
  if (firstWindowReadyMs == null) failures.push("missing_first_window_ready_ms");
  if (interactionMs == null) failures.push("missing_interaction_ms");
  if (totalMs == null) failures.push("missing_total_ms");
  if (checkCount < budget.minChecks) {
    failures.push(`check_count_below_budget:${checkCount}<${budget.minChecks}`);
  }
  if (startupMs != null && startupMs > budget.startupMs) {
    failures.push(`startup_ms_over_budget:${startupMs}>${budget.startupMs}`);
  }
  if (firstWindowReadyMs != null && firstWindowReadyMs > budget.startupMs) {
    failures.push(`first_window_ready_ms_over_budget:${firstWindowReadyMs}>${budget.startupMs}`);
  }
  if (interactionMs != null && interactionMs > budget.interactionMs) {
    failures.push(`interaction_ms_over_budget:${interactionMs}>${budget.interactionMs}`);
  }
  if (totalMs != null && totalMs > budget.totalMs) {
    failures.push(`total_ms_over_budget:${totalMs}>${budget.totalMs}`);
  }
  if (startupMs != null && totalMs != null && startupMs > totalMs) {
    failures.push("startup_ms_exceeds_total_ms");
  }
  if (interactionMs != null && totalMs != null && interactionMs > totalMs) {
    failures.push("interaction_ms_exceeds_total_ms");
  }

  return {
    ok: failures.length === 0,
    failures,
    perf: {
      startup_ms: startupMs,
      first_window_ready_ms: firstWindowReadyMs,
      interaction_ms: interactionMs,
      total_ms: totalMs,
      check_count: checkCount
    },
    budget
  };
}

export function summarizeDesktopGuiSmokePerf(result) {
  const perf = result?.perf ?? {};
  return [
    `startup=${Number(perf.startup_ms ?? 0)}ms`,
    `first_window=${Number(perf.first_window_ready_ms ?? 0)}ms`,
    `interaction=${Number(perf.interaction_ms ?? 0)}ms`,
    `total=${Number(perf.total_ms ?? 0)}ms`,
    `checks=${Number(perf.check_count ?? result?.checks?.length ?? 0)}`
  ].join(" ");
}
