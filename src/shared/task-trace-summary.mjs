import {
  TASK_TRACE_PHASE_LABELS,
  TASK_TRACE_PHASES,
  classifyTaskTraceEvent,
  normalizeTaskTraceSpan
} from "./task-span-taxonomy.mjs";

function normalizeEventType(event = {}) {
  return `${event.event_type ?? event.event ?? event.type ?? ""}`.trim();
}

function eventPayload(event = {}) {
  return event.payload ?? event.data ?? {};
}

function eventTimestampMs(event = {}) {
  const raw = event.ts ?? event.at ?? event.created_at ?? event.timestamp ?? null;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function durationMs(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

function formatToolLabel(payload = {}) {
  return payload.tool_id ?? payload.tool ?? payload.name ?? "tool";
}

function spanStatusFromToolPayload(payload = {}) {
  if (payload.success === false) return "failed";
  if (payload.success === true) return "success";
  return "completed";
}

function tracePhaseForEvent(type = "", payload = {}) {
  return classifyTaskTraceEvent(type, payload).phase;
}

function eventLabel(type = "", payload = {}) {
  const tool = payload.tool_id ?? payload.tool ?? payload.name ?? null;
  if (tool) return `${type}:${tool}`;
  const phase = payload.phase ?? payload.call_site ?? payload.executor ?? null;
  if (phase) return `${type}:${phase}`;
  return String(type || "event");
}

function updateTimelinePhase(phases, entry) {
  const phaseId = tracePhaseForEvent(entry.type, entry.payload);
  const existing = phases.get(phaseId) ?? {
    id: phaseId,
    label: TASK_TRACE_PHASE_LABELS[phaseId] ?? phaseId,
    count: 0,
    started_at_ms: null,
    ended_at_ms: null,
    duration_ms: null,
    failures: 0,
    event_types: {},
    labels: []
  };
  existing.count += 1;
  existing.event_types[entry.type] = (existing.event_types[entry.type] ?? 0) + 1;
  if (entry.payload?.success === false || /failed|cancelled|denied|error/i.test(entry.type)) {
    existing.failures += 1;
  }
  if (entry.tsMs != null) {
    existing.started_at_ms = existing.started_at_ms == null ? entry.tsMs : Math.min(existing.started_at_ms, entry.tsMs);
    existing.ended_at_ms = existing.ended_at_ms == null ? entry.tsMs : Math.max(existing.ended_at_ms, entry.tsMs);
  }
  const label = eventLabel(entry.type, entry.payload);
  if (label && !existing.labels.includes(label) && existing.labels.length < 8) existing.labels.push(label);
  phases.set(phaseId, existing);
}

function pushSpan(spans, span) {
  if (!span?.id) return;
  spans.push(normalizeTaskTraceSpan({
    status: "completed",
    duration_ms: durationMs(span.start_ms, span.end_ms),
    ...span
  }));
}

export function buildTaskTraceSummary(events = []) {
  const ordered = Array.isArray(events)
    ? events
        .map((event, index) => ({
          event,
          index,
          type: normalizeEventType(event),
          payload: eventPayload(event),
          tsMs: eventTimestampMs(event)
        }))
        .sort((a, b) => (a.tsMs ?? Number.MAX_SAFE_INTEGER) - (b.tsMs ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    : [];

  const counts = {};
  const spans = [];
  const openTools = new Map();
  let firstMs = null;
  let lastMs = null;
  let firstTokenMs = null;
  let firstVisibleMs = null;
  let terminalStatus = null;
  let skillContext = null;
  const phases = new Map();

  for (const entry of ordered) {
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    updateTimelinePhase(phases, entry);
    if (entry.tsMs != null) {
      firstMs = firstMs == null ? entry.tsMs : Math.min(firstMs, entry.tsMs);
      lastMs = lastMs == null ? entry.tsMs : Math.max(lastMs, entry.tsMs);
    }

    if ((entry.type === "text_delta" || entry.type === "token_delta") && firstTokenMs == null && entry.tsMs != null) {
      firstTokenMs = entry.tsMs;
    }
    if ((entry.type === "inline_result" || entry.type === "success" || entry.type === "partial_success") && firstVisibleMs == null && entry.tsMs != null) {
      firstVisibleMs = entry.tsMs;
    }
    if (["success", "partial_success", "failed", "cancelled"].includes(entry.type)) {
      terminalStatus = entry.type;
    }
    if (entry.type === "skill_context_loaded") {
      skillContext = {
        executor: entry.payload.executor ?? null,
        active_count: Number(entry.payload.active_count ?? entry.payload.count ?? 0),
        skills: Array.isArray(entry.payload.skills) ? entry.payload.skills.slice(0, 12) : [],
        workflow_hints: Array.isArray(entry.payload.workflow_hints) ? entry.payload.workflow_hints.slice(0, 8) : []
      };
    }

    if (entry.type === "tool_call_started" || entry.type === "tool_call_proposed") {
      const key = `${entry.payload.tool_call_id ?? entry.payload.call_id ?? entry.payload.id ?? formatToolLabel(entry.payload)}:${openTools.size}`;
      openTools.set(key, {
        id: key,
        kind: "tool",
        name: "tool.call",
        phase: "tool",
        label: formatToolLabel(entry.payload),
        start_ms: entry.tsMs,
        end_ms: null,
        status: "running",
        detail: entry.type
      });
      continue;
    }

    if (entry.type === "tool_call_completed") {
      const toolLabel = formatToolLabel(entry.payload);
      const explicitKey = entry.payload.tool_call_id ?? entry.payload.call_id ?? entry.payload.id ?? null;
      const matchKey = explicitKey
        ? [...openTools.keys()].find((key) => key.startsWith(`${explicitKey}:`))
        : [...openTools.entries()].find(([, span]) => span.label === toolLabel)?.[0];
      const open = matchKey ? openTools.get(matchKey) : null;
      if (matchKey) openTools.delete(matchKey);
      pushSpan(spans, {
        ...(open ?? {
          id: `tool:${toolLabel}:${entry.index}`,
          kind: "tool",
          label: toolLabel,
          start_ms: entry.tsMs
        }),
        end_ms: entry.tsMs,
        status: spanStatusFromToolPayload(entry.payload),
        detail: entry.payload.error ?? entry.payload.message ?? ""
      });
      continue;
    }

    if (entry.type === "llm_usage") {
      const callSite = entry.payload.call_site ?? entry.payload.site ?? "provider call";
      pushSpan(spans, {
        id: `llm:${callSite}:${entry.index}`,
        kind: "llm",
        name: "model.call",
        phase: "model",
        label: callSite,
        start_ms: Number.isFinite(Number(entry.payload.started_at_ms)) ? Number(entry.payload.started_at_ms) : entry.tsMs,
        end_ms: entry.tsMs,
        status: entry.payload.aborted ? "aborted" : "completed",
        detail: [entry.payload.provider_id, entry.payload.model].filter(Boolean).join(" · ")
      });
    }
  }

  for (const span of openTools.values()) {
    pushSpan(spans, {
      ...span,
      end_ms: lastMs,
      status: "running"
    });
  }

  const toolSpans = spans.filter((span) => span.kind === "tool");
  const llmSpans = spans.filter((span) => span.kind === "llm");
  const failedToolSpans = toolSpans.filter((span) => span.status === "failed");
  const slowestSpans = [...spans]
    .filter((span) => Number.isFinite(Number(span.duration_ms)))
    .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
    .slice(0, 6);
  const timeline = TASK_TRACE_PHASES
    .map((id) => phases.get(id))
    .filter(Boolean)
    .map((phase) => ({
      ...phase,
      duration_ms: durationMs(phase.started_at_ms, phase.ended_at_ms),
      offset_ms: durationMs(firstMs, phase.started_at_ms),
      status: phase.failures > 0 ? "attention" : "ok"
    }));
  const abortedProviderCalls = llmSpans.filter((span) => span.status === "aborted").length;
  const attentionFlags = [];
  if (failedToolSpans.length > 0) attentionFlags.push({ id: "tool_failures", label: `${failedToolSpans.length} failed tool call${failedToolSpans.length === 1 ? "" : "s"}` });
  if (abortedProviderCalls > 0) attentionFlags.push({ id: "provider_aborted", label: `${abortedProviderCalls} aborted provider call${abortedProviderCalls === 1 ? "" : "s"}` });
  if (durationMs(firstMs, firstTokenMs) > 5000) attentionFlags.push({ id: "slow_first_token", label: "first token over 5s" });
  if (durationMs(firstMs, firstVisibleMs) > 10000) attentionFlags.push({ id: "slow_first_visible", label: "first visible result over 10s" });
  if ((counts.artifact_created ?? 0) > 0 && (counts.tool_call_completed ?? 0) === 0) {
    attentionFlags.push({ id: "artifact_without_tool_completion", label: "artifact event without matching tool completion" });
  }

  return {
    event_count: ordered.length,
    started_at_ms: firstMs,
    ended_at_ms: lastMs,
    duration_ms: durationMs(firstMs, lastMs),
    first_token_ms: durationMs(firstMs, firstTokenMs),
    first_visible_ms: durationMs(firstMs, firstVisibleMs),
    terminal_status: terminalStatus,
    counts,
    spans,
    timeline,
    attention_flags: attentionFlags,
    slowest_spans: slowestSpans,
    tool_calls: {
      total: toolSpans.length,
      failed: failedToolSpans.length,
      running: toolSpans.filter((span) => span.status === "running").length
    },
    provider_calls: {
      total: llmSpans.length,
      aborted: llmSpans.filter((span) => span.status === "aborted").length
    },
    skill_context: skillContext
  };
}
