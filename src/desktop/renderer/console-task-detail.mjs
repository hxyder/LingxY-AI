import {
  escapeHtml
} from "./shared-ui.mjs";
import { collectLlmUsageSummary } from "../../shared/llm-usage-summary.mjs";
import { buildTaskTraceSummary } from "../../shared/task-trace-summary.mjs";

// C17 (lingxy_codex_ready_agent_runtime_upgrade_plan.md §C17, R rule "cost 不准 → 改 token"):
// Task detail KV grid displays Tokens (in/out/total) as the primary
// usage signal, replacing the prior `Cost` cell. Object destructuring
// silently ignores any extra keys, so legacy callers passing `cost`
// still work without an explicit binding.
export function renderTaskKvGrid({
  provider,
  model,
  executor,
  source,
  retry,
  tokens,
  duration,
  transport
} = {}) {
  const hasText = (value) => value != null && value !== "" && value !== "—";
  const cells = [];
  if (hasText(provider)) cells.push(["Provider", provider]);
  if (hasText(model)) cells.push(["Model", model]);
  if (hasText(executor)) cells.push(["Executor", executor]);
  if (hasText(source)) cells.push(["Source", source]);
  if (retry && Number(retry) > 0) cells.push(["Retry", String(retry)]);
  if (hasText(tokens)) cells.push(["Tokens", String(tokens)]);
  if (hasText(duration)) cells.push(["Duration", duration]);
  if (hasText(transport)) cells.push(["Transport", transport]);
  if (cells.length === 0) return "";
  return `
    <div class="kv-grid kv-grid--auto">
      ${cells.map(([key, value]) => `<div class="kv-cell"><div class="kv-k">${escapeHtml(key)}</div><div class="kv-v">${escapeHtml(String(value))}</div></div>`).join("")}
    </div>
  `;
}

// C17: derive a human-readable token-usage string from a task record.
// Returns null when no MEANINGFUL token data is available so the KV
// grid omits the cell instead of rendering a misleading "0 tokens" /
// "-1 tokens" line.
//
// Codex round-1: tightened guards to require non-negative values
// AND a positive total. The previous Number.isFinite-only guard
// rendered "0 (0 in / 0 out)" for the legitimate "no usage yet"
// case and would render negative numbers from corrupted data.
export function describeTaskTokens(task = {}) {
  const isNonNegFinite = (v) => Number.isFinite(v) && Number(v) >= 0;
  const tokensIn = task?.usage_summary?.tokens_in ?? task?.usage?.input_tokens ?? null;
  const tokensOut = task?.usage_summary?.tokens_out ?? task?.usage?.output_tokens ?? null;
  const fallbackTotal = task?.tokens_used ?? task?.usage?.total_tokens ?? null;
  if (isNonNegFinite(tokensIn) && isNonNegFinite(tokensOut)) {
    const inN = Number(tokensIn);
    const outN = Number(tokensOut);
    const total = inN + outN;
    if (total > 0) {
      return `${total.toLocaleString("en-US")} (${inN.toLocaleString("en-US")} in / ${outN.toLocaleString("en-US")} out)`;
    }
  }
  if (isNonNegFinite(fallbackTotal) && Number(fallbackTotal) > 0) {
    return `${Number(fallbackTotal).toLocaleString("en-US")}`;
  }
  return null;
}

function fmtNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

function usageDisplay(usage = {}) {
  const total = Number(usage.total_tokens ?? 0);
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  if (total > 0 && (input > 0 || output > 0)) {
    return `${fmtNumber(total)} (${fmtNumber(input)} in / ${fmtNumber(output)} out)`;
  }
  if (total > 0) return fmtNumber(total);
  return "n/a";
}

function cacheDisplay(cache = {}) {
  const bits = [
    ["hit", cache.hit_tokens],
    ["miss", cache.miss_tokens],
    ["create", cache.creation_input_tokens],
    ["read", cache.read_input_tokens]
  ]
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => `${label} ${fmtNumber(value)}`);
  return bits.length > 0 ? bits.join(" · ") : "no cache tokens reported";
}

function renderSegmentRows(estimate = null, limit = 8) {
  const segments = Array.isArray(estimate?.segments) ? estimate.segments.slice(0, limit) : [];
  if (segments.length === 0) return "";
  const max = Math.max(...segments.map((segment) => Number(segment.estimated_tokens ?? 0)), 1);
  return `
    <div class="llm-segment-list">
      ${segments.map((segment) => {
        const tokens = Number(segment.estimated_tokens ?? 0);
        const width = Math.max(4, Math.min(100, Math.round((tokens / max) * 100)));
        return `
          <div class="llm-segment-row">
            <span class="llm-segment-name">${escapeHtml(segment.name)}</span>
            <span class="llm-segment-bar" aria-hidden="true"><span style="width:${width}%"></span></span>
            <span class="llm-segment-value">${fmtNumber(tokens)} est</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function renderLlmUsagePanel(events = []) {
  const summary = collectLlmUsageSummary(events);
  if (!summary) return "";
  const calls = summary.calls.slice(0, 8);
  return `
    <section class="llm-usage-panel" aria-label="LLM usage">
      <div class="llm-usage-head">
        <div>
          <div class="llm-usage-title">LLM usage<span class="zh">模型用量</span></div>
          <div class="muted">${summary.call_count} provider call${summary.call_count === 1 ? "" : "s"} · ${cacheDisplay(summary.cache)}</div>
        </div>
        <div class="llm-usage-total">${escapeHtml(usageDisplay(summary.totals))}</div>
      </div>
      ${renderSegmentRows(summary.prompt_segments_estimate)}
      <div class="llm-call-list">
        ${calls.map((call) => {
          const label = [call.call_site, call.iteration != null ? `#${call.iteration}` : ""].filter(Boolean).join(" ");
          const model = [call.provider_name ?? call.provider_id, call.model].filter(Boolean).join(" · ");
          return `
            <details class="llm-call-item">
              <summary>
                <span>${escapeHtml(label || "unknown")}</span>
                <span>${escapeHtml(usageDisplay(call.usage))}</span>
              </summary>
              <div class="llm-call-meta">${escapeHtml(model || "provider unknown")}${call.stream ? " · stream" : ""}${call.aborted ? " · aborted" : ""}</div>
              ${renderSegmentRows(call.prompt_segments_estimate, 6)}
            </details>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function fmtMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(n)}ms`;
}

function renderTraceMetric(label, value) {
  return `
    <div class="trace-metric">
      <div class="trace-metric-k">${escapeHtml(label)}</div>
      <div class="trace-metric-v">${escapeHtml(value)}</div>
    </div>
  `;
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

function compactDebugText(value, max = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function firstSelectedValue(selected, key) {
  for (const item of selected) {
    if (item?.value?.[key] != null && item.value[key] !== "") return item.value[key];
  }
  return null;
}

function countByKind(items) {
  const counts = new Map();
  for (const item of items) {
    const kind = item?.kind ?? "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function selectedItemSummary(item = {}) {
  const value = item.value ?? {};
  const anchors = [
    value.task_id ? `task ${value.task_id}` : "",
    value.artifact_id ? `artifact ${value.artifact_id}` : "",
    value.tool_id ? `tool ${value.tool_id}` : "",
    value.compaction_id ? `compaction ${value.compaction_id}` : "",
    item.path ? `path ${item.path}` : ""
  ].filter(Boolean);
  const text = compactDebugText(item.content ?? anchors.join(" · ") ?? item.reason ?? "", 160);
  return {
    kind: item.kind ?? "unknown",
    source: item.source ?? "runtime",
    reason: compactDebugText(item.reason ?? item.inclusion_reason ?? "", 180),
    text
  };
}

function omittedItemSummary(item = {}) {
  return {
    kind: item.kind ?? "unknown",
    source: item.source ?? "runtime",
    reason: compactDebugText(item.reason ?? "omitted", 180)
  };
}

export function buildContextDebugPanelView(task = {}) {
  const ctx = task?.context_packet ?? {};
  const compiled = ctx.compiled_context ?? null;
  if (!compiled || typeof compiled !== "object") {
    return null;
  }
  const selected = safeArray(compiled.selected);
  const omissions = safeArray(compiled.omissions);
  const resolver = ctx.selection_metadata?.follow_up_resolution ?? {};
  const sourceArtifactIds = selected
    .map((item) => item?.value?.artifact_id)
    .filter(Boolean);
  const targetKinds = selected
    .map((item) => item?.value?.kind ?? item?.value?.target_kind ?? null)
    .filter(Boolean);
  return {
    compiled,
    session: {
      session_id: firstSelectedValue(selected, "session_id") ?? null,
      conversation_id: compiled.conversation_id ?? task.conversation_id ?? ctx.selection_metadata?.conversation_id ?? null,
      project_id: task.project_id ?? ctx.selection_metadata?.project_id ?? null,
      parent_task_id: compiled.parent_task_id ?? task.parent_task_id ?? resolver.parent_task_id ?? null,
      is_continuation: Boolean(task.is_continuation ?? resolver.should_continue),
      resolver_mode: resolver.mode ?? null,
      resolver_confidence: resolver.confidence ?? null
    },
    stats: {
      selected_count: selected.length,
      omitted_count: Number(compiled.omitted_count ?? omissions.length),
      candidate_count: compiled.stats?.candidate_count ?? null,
      text_chars: compiled.stats?.text_chars ?? null
    },
    selected_counts: countByKind(selected),
    omitted_counts: countByKind(omissions),
    selected: selected.map(selectedItemSummary),
    omissions: omissions.map(omittedItemSummary),
    action_target: {
      source_artifact_ids: [...new Set(sourceArtifactIds)],
      target_kinds: [...new Set(targetKinds)]
    }
  };
}

function renderContextDebugMetric(label, value) {
  const display = value == null || value === "" ? "n/a" : String(value);
  return renderTraceMetric(label, display);
}

function renderKindCounts(counts) {
  if (!counts.length) return "";
  return `
    <div class="context-debug-kind-list">
      ${counts.slice(0, 12).map(([kind, count]) => `
        <span class="context-debug-kind">${escapeHtml(kind)} <strong>${escapeHtml(String(count))}</strong></span>
      `).join("")}
    </div>
  `;
}

function renderContextRows(items, limit, emptyText) {
  const rows = safeArray(items).slice(0, Math.max(1, limit));
  if (rows.length === 0) {
    return `<div class="muted context-debug-empty">${escapeHtml(emptyText)}</div>`;
  }
  return `
    <div class="context-debug-row-list">
      ${rows.map((item) => `
        <div class="context-debug-row">
          <span class="context-debug-row-kind">${escapeHtml(item.kind)}</span>
          <span class="context-debug-row-main">
            <span class="context-debug-row-source">${escapeHtml(item.source)}</span>
            ${item.text ? `<span class="context-debug-row-text">${escapeHtml(item.text)}</span>` : ""}
            <span class="context-debug-row-reason">${escapeHtml(item.reason)}</span>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderContextDebugPanel(task = {}, {
  selectedLimit = 12,
  omittedLimit = 8
} = {}) {
  const view = buildContextDebugPanelView(task);
  if (!view) return "";
  const session = view.session;
  const action = view.action_target;
  return `
    <div class="context-debug-panel" data-context-debug-panel="compact">
      <div class="task-trace-head">
        <div>
          <div class="task-trace-title">Context<span class="zh">上下文</span></div>
          <div class="muted">${view.stats.selected_count} selected · ${view.stats.omitted_count} omitted</div>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-context-debug-copy="1">Copy JSON</button>
      </div>
      <div class="trace-metric-grid">
        ${renderContextDebugMetric("Session", session.session_id)}
        ${renderContextDebugMetric("Conversation", session.conversation_id)}
        ${renderContextDebugMetric("Parent", session.parent_task_id)}
        ${renderContextDebugMetric("Resolver", session.resolver_mode)}
        ${renderContextDebugMetric("Confidence", session.resolver_confidence)}
        ${renderContextDebugMetric("Candidates", view.stats.candidate_count)}
      </div>
      ${renderKindCounts(view.selected_counts)}
      <div class="context-debug-section">
        <div class="context-debug-section-head">
          <span>Selected</span>
          ${view.selected.length > selectedLimit ? `<button type="button" class="btn btn-sm btn-ghost" data-context-debug-more="selected">More</button>` : ""}
        </div>
        ${renderContextRows(view.selected, selectedLimit, "No selected context.")}
      </div>
      <div class="context-debug-section">
        <div class="context-debug-section-head">
          <span>Omitted</span>
          ${view.omissions.length > omittedLimit ? `<button type="button" class="btn btn-sm btn-ghost" data-context-debug-more="omitted">More</button>` : ""}
        </div>
        ${renderKindCounts(view.omitted_counts)}
        ${renderContextRows(view.omissions, omittedLimit, "No omitted context.")}
      </div>
      ${action.source_artifact_ids.length || action.target_kinds.length ? `
        <div class="context-debug-section">
          <div class="context-debug-section-head"><span>Action target</span></div>
          <div class="context-debug-kind-list">
            ${action.source_artifact_ids.slice(0, 8).map((id) => `<span class="context-debug-kind">source ${escapeHtml(id)}</span>`).join("")}
            ${action.target_kinds.slice(0, 6).map((kind) => `<span class="context-debug-kind">kind ${escapeHtml(kind)}</span>`).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderTraceTimeline(trace = {}) {
  const timeline = Array.isArray(trace.timeline) ? trace.timeline.slice(0, 8) : [];
  if (timeline.length === 0) return "";
  const total = Math.max(1, Number(trace.duration_ms ?? 0));
  return `
    <div class="trace-phase-list" aria-label="Trace phase timeline">
      ${timeline.map((phase) => {
        const offset = Math.max(0, Math.min(100, Math.round((Number(phase.offset_ms ?? 0) / total) * 100)));
        const width = Math.max(6, Math.min(100 - offset, Math.round((Number(phase.duration_ms ?? 0) / total) * 100) || 6));
        const label = `${phase.label} · ${phase.count} event${phase.count === 1 ? "" : "s"}`;
        const detail = Array.isArray(phase.labels) ? phase.labels.slice(0, 3).join(" · ") : "";
        return `
          <div class="trace-phase-row" data-phase-status="${escapeHtml(phase.status || "ok")}">
            <div class="trace-phase-head">
              <span class="trace-phase-name">${escapeHtml(label)}</span>
              <span class="trace-phase-time">${escapeHtml(fmtMs(phase.duration_ms))}</span>
            </div>
            <div class="trace-phase-track" aria-hidden="true">
              <span style="left:${offset}%;width:${width}%"></span>
            </div>
            ${detail ? `<div class="trace-phase-detail">${escapeHtml(detail)}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderTraceAttention(trace = {}) {
  const flags = Array.isArray(trace.attention_flags) ? trace.attention_flags.slice(0, 5) : [];
  if (flags.length === 0) return "";
  return `
    <div class="trace-attention-list" aria-label="Trace attention flags">
      ${flags.map((flag) => `<span class="trace-attention-pill">${escapeHtml(flag.label || flag.id)}</span>`).join("")}
    </div>
  `;
}

export function renderTaskTracePanel(events = []) {
  const trace = buildTaskTraceSummary(events);
  if (!trace.event_count) return "";
  const slowest = trace.slowest_spans.slice(0, 4);
  const skillContext = trace.skill_context;
  const skillNames = Array.isArray(skillContext?.skills)
    ? skillContext.skills.map((skill) => skill.name || skill.id).filter(Boolean).slice(0, 4)
    : [];
  const workflowHints = Array.isArray(skillContext?.workflow_hints)
    ? skillContext.workflow_hints.slice(0, 3)
    : [];
  const traceExportJson = JSON.stringify(trace);
  return `
    <section class="task-trace-panel" aria-label="Task trace">
      <div class="task-trace-head">
        <div>
          <div class="task-trace-title">Trace<span class="zh">诊断</span></div>
          <div class="muted">${trace.event_count} events${trace.terminal_status ? ` · ${escapeHtml(trace.terminal_status)}` : ""}</div>
        </div>
        <button type="button" class="btn btn-sm btn-ghost trace-export-btn" data-task-trace-copy="1" data-trace-json="${escapeHtml(traceExportJson)}">Copy JSON</button>
      </div>
      <div class="trace-metric-grid">
        ${renderTraceMetric("Duration", fmtMs(trace.duration_ms))}
        ${renderTraceMetric("First token", fmtMs(trace.first_token_ms))}
        ${renderTraceMetric("First visible", fmtMs(trace.first_visible_ms))}
        ${renderTraceMetric("Tools", `${trace.tool_calls.total}${trace.tool_calls.failed ? ` / ${trace.tool_calls.failed} failed` : ""}`)}
        ${renderTraceMetric("LLM calls", `${trace.provider_calls.total}${trace.provider_calls.aborted ? ` / ${trace.provider_calls.aborted} aborted` : ""}`)}
      </div>
      ${renderTraceAttention(trace)}
      ${renderTraceTimeline(trace)}
      ${skillContext ? `
        <div class="trace-skill-context" aria-label="Skill context">
          <div class="trace-slowest-row">
            <span class="trace-slowest-kind">skills</span>
            <span class="trace-slowest-label">${escapeHtml(skillNames.length ? skillNames.join(", ") : `${skillContext.active_count || 0} active`)}</span>
            <span class="trace-slowest-duration">${escapeHtml(skillContext.executor || "")}</span>
          </div>
          ${workflowHints.map((hint) => `
            <div class="trace-slowest-row">
              <span class="trace-slowest-kind">workflow</span>
              <span class="trace-slowest-label">${escapeHtml(hint)}</span>
              <span class="trace-slowest-duration"></span>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${slowest.length ? `
        <div class="trace-slowest-list" aria-label="Slowest spans">
          ${slowest.map((span) => `
            <div class="trace-slowest-row">
              <span class="trace-slowest-kind">${escapeHtml(span.kind)}</span>
              <span class="trace-slowest-label">${escapeHtml(span.label)}</span>
              <span class="trace-slowest-duration">${escapeHtml(fmtMs(span.duration_ms))}</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function eventPayload(event = {}) {
  return event.payload ?? event.data ?? {};
}

function reversibilityFromEvent(event = {}) {
  const payload = eventPayload(event);
  return payload.metadata?.reversibility
    ?? payload.result?.metadata?.reversibility
    ?? payload.reversibility
    ?? null;
}

function reversibilitySidecarsFromEvent(event = {}) {
  const payload = eventPayload(event);
  return payload.metadata?.reversibility_sidecars
    ?? payload.result?.metadata?.reversibility_sidecars
    ?? payload.reversibility_sidecars
    ?? [];
}

function shortPath(value = "") {
  const text = String(value ?? "");
  if (text.length <= 76) return text;
  return `...${text.slice(-73)}`;
}

export function collectFileReversibilityEntries(events = []) {
  return (Array.isArray(events) ? events : [])
    .flatMap((event) => {
      const payload = eventPayload(event);
      const sidecars = reversibilitySidecarsFromEvent(event);
      return [
        reversibilityFromEvent(event),
        ...(Array.isArray(sidecars) ? sidecars : [])
      ].map((checkpoint) => {
        if (!checkpoint?.reversible || !checkpoint.reverse_operation || !checkpoint.target_path) {
          return null;
        }
        return {
          checkpoint_id: checkpoint.checkpoint_id ?? null,
          tool_id: checkpoint.tool_id ?? payload.tool_id ?? payload.tool ?? null,
          operation: checkpoint.operation ?? "file_mutation",
          reverse_operation: checkpoint.reverse_operation,
          target_path: checkpoint.target_path,
          backup_path: checkpoint.backup_path ?? null,
          existed_before: checkpoint.existed_before === true,
          created_at: checkpoint.created_at ?? event.ts ?? event.created_at ?? null
        };
      });
    })
    .filter(Boolean);
}

function reverseOperationLabel(operation) {
  if (operation === "restore_file") return "Restore previous bytes";
  if (operation === "delete_created_file") return "Delete created file";
  return operation || "Reverse";
}

export function renderFileReversibilityPanel(events = []) {
  const entries = collectFileReversibilityEntries(events);
  if (entries.length === 0) return "";
  const exportJson = JSON.stringify({ entries });
  return `
    <section class="file-reversibility-panel" aria-label="File recovery checkpoints">
      <div class="task-trace-head">
        <div>
          <div class="task-trace-title">Recovery<span class="zh">可逆性</span></div>
          <div class="muted">${entries.length} file checkpoint${entries.length === 1 ? "" : "s"}</div>
        </div>
        <button type="button" class="btn btn-sm btn-ghost file-reversibility-export-btn" data-file-reversibility-copy="1" data-reversibility-json="${escapeHtml(exportJson)}">Copy JSON</button>
      </div>
      <div class="trace-slowest-list" aria-label="File recovery entries">
        ${entries.slice(0, 6).map((entry) => `
          <div class="trace-slowest-row">
            <span class="trace-slowest-kind">${escapeHtml(reverseOperationLabel(entry.reverse_operation))}</span>
            <span class="trace-slowest-label" title="${escapeHtml(entry.target_path)}">${escapeHtml(shortPath(entry.target_path))}</span>
            <span class="trace-slowest-duration">${escapeHtml(entry.backup_path ? "backup ready" : "new file")}</span>
            ${entry.checkpoint_id ? `<button type="button" class="btn btn-sm btn-ghost" data-file-reversibility-restore="${escapeHtml(entry.checkpoint_id)}">Restore</button>` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}
