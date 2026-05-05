import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

export function isOneShotScheduleRow(schedule) {
  return schedule?.trigger_type === "at" || schedule?.metadata?.one_shot === true;
}

export function scheduleRunAtIsPast(schedule, now = Date.now()) {
  const ts = Date.parse(schedule?.trigger_config?.run_at ?? schedule?.trigger_config?.at ?? "");
  return Number.isFinite(ts) && ts <= now;
}

export function isTerminalOneShotScheduleRow(schedule, now = Date.now()) {
  return isOneShotScheduleRow(schedule)
    && !schedule.next_run_at
    && (
      Boolean(schedule.last_run_at)
      || Number(schedule.run_count ?? 0) > 0
      || !schedule.enabled
      || scheduleRunAtIsPast(schedule, now)
    );
}

export function terminalOneShotLabel(schedule, now = Date.now()) {
  if (!isTerminalOneShotScheduleRow(schedule, now)) return null;
  return schedule.last_run_at || Number(schedule.run_count ?? 0) > 0 ? "completed" : "expired";
}

export function scheduleBucket(schedule, now = Date.now()) {
  if (schedule.completed_at || isTerminalOneShotScheduleRow(schedule, now)) return "completed";
  if (!schedule.enabled) return "paused";
  return "active";
}

const SCHEDULE_EMAIL_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

export function uniqueScheduleEmails(values) {
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const matches = String(value ?? "").match(SCHEDULE_EMAIL_REGEX) ?? [];
    for (const email of matches) {
      const normalized = email.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        emails.push(email);
      }
    }
  }
  return emails;
}

export function recipientSegments(text = "") {
  const value = String(text ?? "");
  if (!value) return [];
  const segments = [];
  const markerPattern = /(?:收件人|发送到|发给|寄给|email\s+to|send\s+to|\bto\b)\s*[:：]?\s*/gi;
  for (const match of value.matchAll(markerPattern)) {
    const rest = value.slice(match.index + match[0].length);
    const stop = rest.search(/(?:主题|subject|正文|body|内容|，邮件|。|\n)/i);
    segments.push(stop >= 0 ? rest.slice(0, stop) : rest);
  }
  return segments;
}

export function scheduleRecipients(schedule = {}) {
  const params = schedule.action_params ?? {};
  const input = params.input ?? {};
  const explicit = [
    params.to,
    params.cc,
    params.bcc,
    params.recipient,
    params.recipients,
    input.to,
    input.cc,
    input.bcc,
    input.recipient,
    input.recipients
  ];
  const explicitEmails = uniqueScheduleEmails(explicit.flatMap((value) => Array.isArray(value) ? value : [value]));
  if (explicitEmails.length) return explicitEmails;

  const textSources = [
    schedule.description,
    params.userCommand,
    params.contextText,
    params.command,
    schedule.action_target
  ];
  const segmentEmails = uniqueScheduleEmails(textSources.flatMap(recipientSegments));
  if (segmentEmails.length) return segmentEmails;

  return uniqueScheduleEmails([schedule.description]);
}

export function scheduleMatchesSearch(schedule, query) {
  if (!query) return true;
  const hay = [
    schedule.name,
    schedule.description,
    schedule.schedule_id,
    schedule.trigger_type,
    schedule.category,
    schedule.metadata?.category,
    schedule.last_run_status,
    schedule.action_target,
    schedule.action_params?.userCommand,
    schedule.action_params?.contextText,
    scheduleRecipients(schedule).join(" ")
  ]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

export function scheduleActionPreview(schedule = {}) {
  const params = schedule.action_params ?? {};
  const text = params.userCommand
    ?? params.command
    ?? params.contextText
    ?? schedule.description
    ?? schedule.action_target
    ?? "";
  return String(text).replace(/\s+/g, " ").trim();
}

export function clipSchedulePreview(text, max = 170) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function renderScheduleActionSummary(schedule) {
  const recipients = scheduleRecipients(schedule);
  const preview = scheduleActionPreview(schedule);
  const hasSummary = recipients.length || preview;
  if (!hasSummary) return "";
  const recipientHtml = recipients.length
    ? `<div class="sched-action-summary"><span class="sched-action-label">收件人</span>${recipients.map((email) => `<span class="tag">${escapeHtml(email)}</span>`).join("")}</div>`
    : "";
  const previewHtml = preview
    ? `<div class="sched-action-summary"><span class="sched-action-label">执行</span><span class="sched-action-text" title="${escapeHtml(preview)}">${escapeHtml(clipSchedulePreview(preview))}</span></div>`
    : "";
  return `${recipientHtml}${previewHtml}`;
}

export function formatScheduleLastRun(schedule) {
  if (!schedule.last_run_at) return "<span class=\"muted\">Last: never</span>";
  const timeText = escapeHtml(formatDateTime(schedule.last_run_at));
  const status = schedule.last_run_status;
  if (!status) return `<span>Last: ${timeText}</span>`;
  const cls = status === "success" ? "ok" : (status === "failed" ? "err" : "muted");
  const statusLabel = escapeHtml(status);
  if (status === "failed" && schedule.last_run_task_id) {
    return `<span>Last: ${timeText} · <button type="button" class="sched-last-link sched-last-${cls}" data-sched-task-jump="${escapeHtml(schedule.last_run_task_id)}">${statusLabel}</button></span>`;
  }
  return `<span>Last: ${timeText} · <span class="sched-last-${cls}">${statusLabel}</span></span>`;
}

export function renderScheduleRow(schedule) {
  const color = schedule.color || schedule.metadata?.color || "";
  const categoryLabel = schedule.category || schedule.metadata?.category || "";
  const enabledChecked = schedule.enabled ? " checked" : "";
  const bucket = scheduleBucket(schedule);
  const stateClass = bucket === "completed" ? " is-completed" : (bucket === "paused" ? " is-paused" : "");
  const runLabel = bucket === "completed" ? "Re-run" : "Run now";
  const terminalLabel = terminalOneShotLabel(schedule);
  const statePill = bucket === "completed"
    ? `<span class="pill pill-neutral">${escapeHtml(terminalLabel ?? "completed")}</span>`
    : (bucket === "paused" ? `<span class="pill pill-neutral">paused</span>` : "");
  return `
    <div class="sched-row${stateClass}" data-schedule-row="${escapeHtml(schedule.schedule_id)}" style="${color ? `border-left:3px solid ${escapeHtml(color)};` : ""}">
      <label class="toggle" title="${schedule.enabled ? "Disable" : "Enable"}">
        <input type="checkbox"${enabledChecked} data-toggle-schedule-id="${escapeHtml(schedule.schedule_id)}" data-enabled="${schedule.enabled ? "false" : "true"}"/>
        <span class="toggle-track"></span>
      </label>
      <div style="flex:1;min-width:0;">
        <div class="sched-title">${escapeHtml(schedule.name ?? schedule.schedule_id)}</div>
        <div class="sched-meta">
          ${categoryLabel ? `<span class="tag">${escapeHtml(categoryLabel)}</span>` : ""}
          <span class="tag">${escapeHtml(schedule.trigger_type ?? "manual")}</span>
          <span>Next: ${escapeHtml(formatDateTime(schedule.next_run_at))}</span>
          ${formatScheduleLastRun(schedule)}
          ${statePill}
        </div>
        ${renderScheduleActionSummary(schedule)}
      </div>
      <div class="sched-actions btn-group">
        <button class="btn btn-sm btn-ghost" data-edit-schedule-id="${escapeHtml(schedule.schedule_id)}" title="重命名">编辑</button>
        <button class="btn btn-sm" data-run-schedule-id="${escapeHtml(schedule.schedule_id)}">${runLabel}</button>
        <button class="btn btn-sm btn-danger" data-delete-schedule-id="${escapeHtml(schedule.schedule_id)}">Delete</button>
      </div>
    </div>
  `;
}

export function groupSchedules(schedules = [], query = "") {
  const filtered = schedules.filter((schedule) => scheduleMatchesSearch(schedule, query));
  const groups = { active: [], paused: [], completed: [] };
  for (const schedule of filtered) groups[scheduleBucket(schedule)].push(schedule);
  return { filtered, groups };
}
