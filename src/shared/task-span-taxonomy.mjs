export const TASK_SPAN_TAXONOMY_SCHEMA_VERSION = 1;

export const TASK_TRACE_PHASES = Object.freeze([
  "lifecycle",
  "planning",
  "model",
  "tool",
  "artifact",
  "approval",
  "recovery",
  "system"
]);

export const TASK_TRACE_PHASE_LABELS = Object.freeze({
  lifecycle: "Lifecycle",
  planning: "Planning",
  model: "Model",
  tool: "Tools",
  artifact: "Artifacts",
  approval: "Approval",
  recovery: "Recovery",
  system: "System"
});

const EVENT_RULES = [
  { phase: "approval", name: "approval.decision", re: /approval|human|consent/i },
  { phase: "artifact", name: "artifact.event", re: /artifact|document|checkpoint|reversib/i },
  { phase: "tool", name: "tool.call", re: /^tool_|tool_call|tool_input|mcp/i },
  { phase: "model", name: "model.call", re: /llm|model|provider|text_delta|token_delta|reasoning_delta|final_composer/i },
  { phase: "planning", name: "planning.decision", re: /router|route|planner|phase_gate|task_spec|context|skill_context|prefetch|semantic/i },
  { phase: "recovery", name: "recovery.event", re: /retry|recover|error|failure|failed|denied/i },
  { phase: "lifecycle", name: "runtime.lifecycle", re: /task_created|status_changed|success|partial_success|cancelled|completed/i }
];

export function classifyTaskTraceEvent(type = "", payload = {}) {
  const eventType = String(type || "");
  if (payload?.artifact_action || payload?.artifact_paths) {
    return { phase: "artifact", span_name: "artifact.event", span_kind: "internal" };
  }
  const match = EVENT_RULES.find((rule) => rule.re.test(eventType));
  if (match) return { phase: match.phase, span_name: match.name, span_kind: "internal" };
  if (payload?.success === false) {
    return { phase: "recovery", span_name: "recovery.event", span_kind: "internal" };
  }
  return { phase: "system", span_name: "runtime.event", span_kind: "internal" };
}

export function normalizeTaskTraceSpan(span = {}) {
  const kind = String(span.kind ?? "internal");
  const fallback = kind === "llm" ? "model.call" : kind === "tool" ? "tool.call" : "runtime.event";
  return {
    ...span,
    name: span.name ?? span.span_name ?? fallback,
    phase: span.phase ?? (kind === "llm" ? "model" : kind === "tool" ? "tool" : "system"),
    kind
  };
}

export function buildTaskSpanExport(trace = {}, { taskId = null } = {}) {
  const spans = Array.isArray(trace.spans) ? trace.spans : [];
  return {
    schema_version: TASK_SPAN_TAXONOMY_SCHEMA_VERSION,
    export_shape: "local_otel_span_v1",
    task_id: taskId,
    span_count: spans.length,
    spans: spans.map((span) => {
      const normalized = normalizeTaskTraceSpan(span);
      return {
        span_id: normalized.id ?? null,
        parent_span_id: normalized.parent_id ?? null,
        name: normalized.name,
        kind: normalized.kind,
        phase: normalized.phase,
        status: normalized.status ?? "completed",
        start_ms: normalized.start_ms ?? null,
        end_ms: normalized.end_ms ?? null,
        duration_ms: normalized.duration_ms ?? null,
        attributes: {
          label: normalized.label ?? null,
          detail: normalized.detail ?? null
        }
      };
    })
  };
}
