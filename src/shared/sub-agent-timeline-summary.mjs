export const SUB_AGENT_TIMELINE_SCHEMA_VERSION = "1.0";

export const SUB_AGENT_TIMELINE_EVENT_TYPES = Object.freeze([
  "sub_agent_run_started",
  "sub_agent_run_completed",
  "sub_agent_report"
]);

function safeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item != null) : [];
}

function cleanString(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function statusRank(status) {
  switch (status) {
    case "failed":
    case "cancelled":
      return 3;
    case "running":
    case "queued":
    case "cancelling":
      return 2;
    case "partial_success":
      return 1;
    case "success":
      return 0;
    default:
      return 1;
  }
}

function reportFromEvent(event = {}) {
  if (!SUB_AGENT_TIMELINE_EVENT_TYPES.includes(event.event_type)) return null;
  const payload = event.payload ?? {};
  const report = payload.report ?? payload;
  const childTaskId = report.child_task_id ?? payload.child_task_id ?? null;
  if (!childTaskId) return null;
  return {
    child_task_id: childTaskId,
    parent_task_id: report.parent_task_id ?? payload.parent_task_id ?? null,
    assigned_scope_id: report.assigned_scope_id ?? payload.assigned_scope_id ?? null,
    status: report.status ?? payload.status ?? "unknown",
    summary: cleanString(report.summary ?? payload.summary ?? ""),
    tool_calls: safeArray(report.tool_calls ?? payload.tool_calls),
    violations: safeArray(report.violations ?? payload.violations),
    budget: report.budget ?? payload.budget ?? null,
    event_type: event.event_type,
    ts: event.ts ?? event.at ?? null
  };
}

function childSummary(child = {}, report = null, index = 0) {
  const budgetObserved = report?.budget?.observed ?? {};
  const usage = child.usage_summary ?? child.usage ?? {};
  const tokensIn = Number(usage.tokens_in ?? usage.input_tokens ?? 0);
  const tokensOut = Number(usage.tokens_out ?? usage.output_tokens ?? 0);
  const reportPromptTokens = Number(budgetObserved.prompt_tokens ?? 0);
  return {
    child_task_id: child.task_id ?? report?.child_task_id ?? null,
    parent_task_id: child.parent_task_id ?? report?.parent_task_id ?? null,
    child_index: Number.isInteger(child.child_index) ? child.child_index : index,
    status: report?.status ?? child.status ?? "unknown",
    label: cleanString(child.user_command ?? child.intent ?? report?.summary ?? child.task_id ?? "Sub-agent run", 180),
    summary: cleanString(report?.summary ?? child.result_summary ?? child.failure_user_message ?? "", 500),
    assigned_scope_id: report?.assigned_scope_id ?? null,
    tool_call_count: report?.tool_calls?.length ?? 0,
    violation_count: report?.violations?.length ?? 0,
    violations: report?.violations ?? [],
    token_total: tokensIn + tokensOut + reportPromptTokens,
    duration_ms: Number(child.elapsed_ms ?? 0) || null,
    event_type: report?.event_type ?? null,
    updated_at: child.updated_at ?? report?.ts ?? null
  };
}

export function buildSubAgentTimelineSummary({
  parentTask = {},
  childTasks = [],
  events = []
} = {}) {
  const reports = safeArray(events)
    .map(reportFromEvent)
    .filter(Boolean);
  const reportByChild = new Map(reports.map((report) => [report.child_task_id, report]));
  const children = safeArray(childTasks);
  const childIds = new Set([
    ...safeArray(parentTask.child_task_ids),
    ...children.map((child) => child.task_id).filter(Boolean),
    ...reports.map((report) => report.child_task_id).filter(Boolean)
  ]);
  const childById = new Map(children.map((child) => [child.task_id, child]));
  const items = [...childIds].map((childId, index) =>
    childSummary(childById.get(childId) ?? { task_id: childId, parent_task_id: parentTask.task_id }, reportByChild.get(childId), index)
  ).sort((left, right) => {
    const rankDelta = statusRank(right.status) - statusRank(left.status);
    if (rankDelta !== 0) return rankDelta;
    return (left.child_index ?? 0) - (right.child_index ?? 0);
  });
  const totals = {
    total: items.length,
    success: items.filter((item) => item.status === "success" || item.status === "partial_success").length,
    failed: items.filter((item) => item.status === "failed").length,
    cancelled: items.filter((item) => item.status === "cancelled").length,
    running: items.filter((item) => ["queued", "running", "cancelling"].includes(item.status)).length,
    violations: items.reduce((sum, item) => sum + item.violation_count, 0),
    token_total: items.reduce((sum, item) => sum + Number(item.token_total ?? 0), 0)
  };
  return {
    schema_version: SUB_AGENT_TIMELINE_SCHEMA_VERSION,
    parent_task_id: parentTask.task_id ?? null,
    has_sub_agents: items.length > 0,
    totals,
    items
  };
}
