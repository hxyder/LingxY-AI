export function inferSearchRecencyFromText(value = "") {
  const text = String(value ?? "").toLowerCase();
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "day";
  if (/(本周|一周|近\s*7\s*天|week)/i.test(text)) return "week";
  if (/(本月|一个月|近\s*30\s*天|month)/i.test(text)) return "month";
  if (/(今年|一年|近\s*12\s*个月|year)/i.test(text)) return "year";
  if (/(今天|今日|时政|要闻|最新|最近|新闻|消息|近况|latest|recent|current|news)/i.test(text)) return "month";
  return null;
}

// Saturation hint is only worth firing when the task expects multiple
// independent sources. single_lookup wants exactly one publisher, so a
// "no new domain" pattern is the success state, not a stuck signal.
export function shouldCheckSaturation(task) {
  const profile = task?.task_spec?.research_quality?.profile;
  return profile === "multi_source_research" || profile === "deep_research";
}

export function resolveTaskMaxIterations(task, fallback = 8) {
  const configured = task?.task_spec?.execution_constraints?.max_iterations;
  if (Number.isFinite(configured) && configured > 0) {
    // execution_constraints is an exact per-task budget, not merely an
    // upward override. This lets single_lookup cap a generic executor at 8
    // while multi/deep research can opt into 12/16.
    return Math.min(24, Math.max(1, Math.floor(configured)));
  }
  return fallback;
}
