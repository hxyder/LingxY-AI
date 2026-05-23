import {
  formatTaskEventSummary
} from "./task-event-stream.js";
import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";
import {
  formatToolArgsPreview
} from "./tool-display.mjs";
import {
  buildCapabilityToolView,
  renderCapabilityToolViewHtml
} from "./capability-tool-view.mjs";

// Pull provider visibility info out of the task event stream so the
// task detail panel can show the resolved provider and downgrade warning
// without the backend denormalising them into the task record itself.
export function extractTaskProviderInfo(detail) {
  if (!detail?.events?.length) return { descriptor: null, downgraded: false };
  let descriptor = null;
  let downgraded = false;
  for (const event of detail.events) {
    const payload = event?.payload ?? {};
    if (payload.provider_id || payload.provider_kind) {
      descriptor = {
        provider_id: payload.provider_id ?? null,
        provider_kind: payload.provider_kind ?? null,
        provider_name: payload.provider_name ?? null,
        model: payload.model ?? null,
        transport: payload.transport ?? null
      };
    }
    if (payload.downgraded === true) {
      downgraded = true;
    }
  }
  return { descriptor, downgraded };
}

export function renderProviderLine(descriptor) {
  if (!descriptor) return "";
  const name = descriptor.provider_name || descriptor.provider_id || descriptor.provider_kind || "unknown provider";
  const model = descriptor.model || "default";
  const transport = (descriptor.transport || "").toUpperCase() || "—";
  return `
    <div class="row" style="font-size:11px;color:var(--muted);gap:6px;align-items:center;">
      <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--status-info-bg);border:1px solid var(--status-info-border);color:var(--status-info-text);">
        <span style="font-weight:500;">Provider</span>
        <span>${escapeHtml(name)}</span>
        <span class="muted">·</span>
        <span>${escapeHtml(model)}</span>
        <span class="muted">·</span>
        <span>${escapeHtml(transport)}</span>
      </span>
    </div>
  `;
}

export function renderDowngradedWarning(downgraded) {
  if (!downgraded) return "";
  return `
    <div data-uca-downgraded="1" style="padding:8px 10px;border-radius:8px;background:var(--warn-soft);border:1px solid var(--warn);margin-top:8px;">
      <strong style="font-size:12px;color:var(--warn);">AI claim downgraded</strong>
      <p class="muted" style="margin:4px 0 0;font-size:12px;">The model claimed completion, but no tool in this run returned success:true. The task has been downgraded to partial — see the timeline below for what actually executed.</p>
    </div>
  `;
}

// Events carrying extra payload detail use a <details> element so the
// user can expand only what they want to see. Failures and pending steps
// default to open; routine success steps stay collapsed.
export function renderTimelineEntry(event, context = {}) {
  const summary = formatTaskEventSummary(event, context);
  const payload = event?.data ?? event?.payload ?? {};
  const eventType = event?.event ?? event?.event_type ?? "";
  const ts = escapeHtml(formatDateTime(event.ts ?? event.at));
  const title = escapeHtml(summary.title);
  const body = escapeHtml(summary.body);

  const hasToolArgs = (eventType === "tool_call_started" || eventType === "tool_call_proposed" || eventType === "tool_call_completed")
    && payload.args && typeof payload.args === "object" && Object.keys(payload.args).length > 0;
  const hasObservation = eventType === "tool_call_completed"
    && (typeof payload.observation === "string" || typeof payload.text === "string" || typeof payload.error === "string");
  const hasError = eventType === "failed" && typeof payload.message === "string" && payload.message.length > 0;
  const capabilityView = eventType === "tool_call_completed"
    ? buildCapabilityToolView(payload.tool_id ?? payload.tool ?? "", payload.metadata ?? {})
    : null;
  const hasRichDetail = hasToolArgs || hasObservation || hasError || Boolean(capabilityView);

  if (!hasRichDetail) {
    return `
      <div class="timeline-item">
        <div class="row"><strong style="font-size:12px;">${title}</strong><span class="muted" style="font-size:11px;">${ts}</span></div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${body}</p>
      </div>
    `;
  }

  const failed = eventType === "tool_call_completed" && payload.success === false;
  const pending = eventType === "tool_call_started" || eventType === "tool_call_proposed";
  const openAttr = failed || pending || hasError ? " open" : "";

  const detailLines = [];
  if (hasToolArgs) {
    const toolId = payload.tool_id ?? payload.tool ?? "";
    const preview = formatToolArgsPreview(toolId, payload.args) || "参数已折叠";
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">参数摘要</div><div class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:var(--surface-soft);border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview)}</div>`);
  }
  if (hasObservation) {
    const raw = typeof payload.observation === "string" ? payload.observation
      : typeof payload.text === "string" ? payload.text
        : payload.error ?? "";
    const label = payload.success === false ? "error" : "observation";
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">${label}</div><pre class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:var(--surface-soft);border-radius:6px;overflow:auto;white-space:pre-wrap;">${escapeHtml(raw)}</pre>`);
  }
  if (capabilityView) {
    detailLines.push(renderCapabilityToolViewHtml(capabilityView));
  }
  if (hasError) {
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">failure</div><pre class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:rgba(239,68,68,0.08);border-radius:6px;overflow:auto;white-space:pre-wrap;">${escapeHtml(payload.message)}</pre>`);
  }

  return `
    <details class="timeline-item"${openAttr}>
      <summary style="cursor:pointer;list-style:none;">
        <div class="row"><strong style="font-size:12px;">${title}</strong><span class="muted" style="font-size:11px;">${ts}</span></div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${body}</p>
      </summary>
      ${detailLines.join("")}
    </details>
  `;
}
