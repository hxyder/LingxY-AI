import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

export function formatProjectConversationPreview(conversation) {
  if (!conversation) return "Select a conversation.";
  const lines = [
    conversation.title || conversation.seedCommand || conversation.id,
    `Updated: ${formatDateTime(conversation.updatedAt)}`,
    ""
  ];
  for (const turn of (conversation.turns ?? []).slice(-12)) {
    const label = turn.role === "user" ? "User" : turn.role === "assistant" ? "Assistant" : "System";
    lines.push(`${label}: ${turn.content ?? ""}`);
    lines.push("");
  }
  return lines.join("\n").trim() || "No turns yet.";
}

export function renderProjectListHtml({
  projects = [],
  conversations = [],
  selectedProjectId = null,
  defaultColor = "#6366f1"
} = {}) {
  return (Array.isArray(projects) ? projects : []).map((project) => {
    const selected = project.id === selectedProjectId;
    const count = (Array.isArray(conversations) ? conversations : [])
      .filter((conversation) => conversation.projectId === project.id).length;
    return `
      <button class="history-item ${selected ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" style="text-align:left;border-left:4px solid ${escapeHtml(project.color ?? defaultColor)};">
        <div class="row">
          <strong style="font-size:13px;">${escapeHtml(project.name ?? project.id)}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml(count)}</span>
        </div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(project.id)}</p>
      </button>
    `;
  }).join("");
}

export function renderProjectConversationListHtml({
  conversations = [],
  selectedConversationId = null
} = {}) {
  const rows = Array.isArray(conversations) ? conversations : [];
  if (rows.length === 0) {
    return `<p class="muted" style="font-size:12px;">No conversations in this project.</p>`;
  }
  return rows.map((conversation) => `
      <div class="history-item-row ${conversation.id === selectedConversationId ? "active" : ""}">
        <button class="history-item history-item--main" data-project-conversation-id="${escapeHtml(conversation.id)}" style="text-align:left;">
          <div class="row">
            <strong style="font-size:13px;">${escapeHtml(conversation.title || conversation.seedCommand || "新会话")}</strong>
            <span class="muted" style="font-size:11px;">${escapeHtml((conversation.turns ?? []).length)}</span>
          </div>
          <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(formatDateTime(conversation.updatedAt ?? conversation.startedAt))}</p>
        </button>
        <button class="history-item-resume" type="button"
                data-resume-project-conversation-id="${escapeHtml(conversation.id)}"
                title="在 Chat 标签继续此对话" aria-label="继续对话">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>
    `).join("");
}
