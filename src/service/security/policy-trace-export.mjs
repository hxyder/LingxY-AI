export const POLICY_TRACE_EXPORT_SCHEMA_VERSION = 1;

const SECRET_KEY_RE = /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|credential|authorization|cookie)/i;

const POLICY_EVENT_TYPES = new Set([
  "tool.blocked_by_policy",
  "tool.rate_limited",
  "llm.call",
  "redaction.applied",
  "kill_switch.toggle",
  "presenter_mode.toggle",
  "redaction.state_lost"
]);

const TASK_POLICY_EVENT_RE = /approval|blocked|policy|privacy|redaction|kill_switch|presenter/i;

function safeList(call, fallback = []) {
  try {
    const value = call?.();
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function limitArray(items = [], limit = 100) {
  return Array.isArray(items) ? items.slice(0, Math.max(0, limit)) : [];
}

function sortByTimeDesc(items = [], field = "ts") {
  return [...items].sort((a, b) => `${b?.[field] ?? ""}`.localeCompare(`${a?.[field] ?? ""}`));
}

function redactForPolicyTrace(value, key = "") {
  if (value == null) return value;
  if (SECRET_KEY_RE.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => redactForPolicyTrace(entry));
  if (typeof value === "object") {
    const next = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      next[childKey] = redactForPolicyTrace(childValue, childKey);
    }
    return next;
  }
  return value;
}

function summarizeAuditDecision(entry = {}) {
  const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : {};
  const subtype = `${entry.event_subtype ?? ""}`;
  return redactForPolicyTrace({
    ts: entry.ts ?? null,
    task_id: entry.task_id ?? payload.task_id ?? null,
    decision_type: subtype,
    blocked: payload.blocked === true || subtype.includes("blocked") || subtype.includes("rate_limited"),
    reason: payload.reason ?? payload.error ?? payload.code ?? null,
    tool_id: payload.tool_id ?? payload.tool ?? null,
    source_type: payload.source_type ?? null,
    risk_level: payload.risk_level ?? payload.risk?.risk_level ?? null
  });
}

function summarizeApproval(approval = {}) {
  return redactForPolicyTrace({
    approval_id: approval.approval_id ?? approval.id ?? null,
    task_id: approval.task_id ?? approval.taskId ?? null,
    status: approval.status ?? "pending",
    tool_id: approval.tool_id ?? approval.toolId ?? approval.tool?.id ?? null,
    risk_level: approval.risk_level ?? approval.risk?.risk_level ?? null,
    created_at: approval.created_at ?? approval.createdAt ?? null,
    reason: approval.reason ?? null
  });
}

function summarizeTaskPolicyEvent(event = {}) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  return redactForPolicyTrace({
    task_id: event.task_id ?? payload.task_id ?? null,
    event_type: event.event_type ?? event.type ?? null,
    ts: event.ts ?? event.created_at ?? null,
    approval_id: payload.approval_id ?? payload.approvalId ?? null,
    tool_id: payload.tool_id ?? payload.tool ?? null,
    reason: payload.reason ?? payload.error ?? payload.code ?? null,
    status: payload.status ?? null
  });
}

function collectTaskPolicyEvents(store, limit) {
  const tasks = safeList(() => store?.listTasks?.({ deleted: "any" }));
  const events = [];
  for (const task of tasks) {
    const taskId = task?.task_id;
    if (!taskId || typeof store?.getTaskEvents !== "function") continue;
    for (const event of safeList(() => store.getTaskEvents(taskId))) {
      const eventType = `${event?.event_type ?? event?.type ?? ""}`;
      if (TASK_POLICY_EVENT_RE.test(eventType)) {
        events.push(summarizeTaskPolicyEvent({ ...event, task_id: event.task_id ?? taskId }));
      }
    }
  }
  return limitArray(sortByTimeDesc(events, "ts"), limit);
}

export function buildPolicyTraceExport(runtime, {
  auditLimit = 200,
  approvalLimit = 100,
  taskEventLimit = 200
} = {}) {
  const store = runtime?.store ?? runtime?.storeAdapter ?? null;
  const auditLogs = sortByTimeDesc(safeList(() => store?.listAuditLogs?.()));
  const policyAuditLogs = auditLogs.filter((entry) => POLICY_EVENT_TYPES.has(entry?.event_subtype));
  const approvals = safeList(() => store?.listPendingApprovals?.());
  const taskPolicyEvents = collectTaskPolicyEvents(store, taskEventLimit);
  const decisions = limitArray(policyAuditLogs, auditLimit).map(summarizeAuditDecision);
  const blockedCount = decisions.filter((entry) => entry.blocked === true).length;

  return {
    schema_version: POLICY_TRACE_EXPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    summary: {
      decisions: decisions.length,
      blocked: blockedCount,
      approvals: approvals.length,
      task_policy_events: taskPolicyEvents.length
    },
    decisions,
    approvals: limitArray(approvals, approvalLimit).map(summarizeApproval),
    taskPolicyEvents,
    manifest: {
      includes: [
        "policy_audit_decisions_redacted",
        "pending_approvals_redacted",
        "task_policy_events_redacted"
      ],
      excludes: [
        "provider_api_keys",
        "oauth_tokens",
        "secret_store",
        "raw_tool_arguments",
        "raw_context_text"
      ]
    }
  };
}
