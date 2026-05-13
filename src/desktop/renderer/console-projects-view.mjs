import {
  artifactExtension,
  artifactIconClass,
  artifactIconText,
  artifactStatusInfo,
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

export function formatProjectConversationPreview(conversation) {
  if (!conversation) return "Select a conversation.";
  const turns = Array.isArray(conversation.turns) ? conversation.turns : [];
  const updatedAt = conversation.updatedAt ?? conversation.updated_at ?? conversation.startedAt ?? conversation.created_at;
  const lines = [
    conversation.title || conversation.seedCommand || conversation.id || conversation.conversation_id,
    `Updated: ${formatDateTime(updatedAt)}`,
    ""
  ];
  for (const turn of turns.slice(-12)) {
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
  defaultColor = "#6366f1",
  workspaceByProjectId = {}
} = {}) {
  return (Array.isArray(projects) ? projects : []).map((project) => {
    const selected = project.id === selectedProjectId;
    const workspace = workspaceByProjectId?.[project.id] ?? null;
    const count = Number.isFinite(Number(workspace?.stats?.conversation_count))
      ? Number(workspace.stats.conversation_count)
      : (Array.isArray(conversations) ? conversations : [])
      .filter((conversation) => conversation.projectId === project.id).length;
    const fileCount = Number.isFinite(Number(workspace?.stats?.file_count))
      ? Number(workspace.stats.file_count)
      : (Array.isArray(project.attachedFilePaths) ? project.attachedFilePaths.length : 0);
    return `
      <button class="history-item project-workspace-item ${selected ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" style="text-align:left;--project-color:${escapeHtml(project.color ?? defaultColor)};">
        <span class="project-color-dot" aria-hidden="true"></span>
        <span class="project-list-copy">
          <strong>${escapeHtml(project.name ?? project.id)}</strong>
          <span>${escapeHtml(count)} chats · ${escapeHtml(fileCount)} files</span>
        </span>
      </button>
    `;
  }).join("");
}

export function renderProjectWorkspaceSummaryHtml({
  project = null,
  workspace = null,
  status = "idle"
} = {}) {
  if (!project) {
    return `<p class="muted" style="font-size:12px;">Create or select a project.</p>`;
  }
  const stats = workspace?.stats ?? {};
  const instructions = project?.metadata?.instructions ?? project?.metadata?.projectInstructions ?? "";
  const chatCount = Number(stats.conversation_count ?? 0);
  const fileCount = Number(stats.file_count ?? 0);
  const generatedCount = Number(stats.artifact_count ?? 0);
  const updated = stats.updated_at ? `Updated ${formatDateTime(stats.updated_at)}` : "Service workspace";
  return `
    <div class="project-workspace-hero" style="border-left-color:${escapeHtml(project.color ?? "#6366f1")}">
      <div class="project-workspace-title-row">
        <div>
          <h2>${escapeHtml(project.name ?? project.id)}</h2>
          <p>${escapeHtml(chatCount)} chats · ${escapeHtml(fileCount)} files · ${escapeHtml(generatedCount)} generated</p>
        </div>
        <span class="project-workspace-status">${escapeHtml(status === "loading" ? "Syncing" : updated)}</span>
      </div>
      ${instructions ? `<p class="project-workspace-instructions">${escapeHtml(instructions)}</p>` : ""}
    </div>
  `;
}

export function renderProjectConversationListHtml({
  conversations = [],
  selectedConversationId = null
} = {}) {
  const rows = Array.isArray(conversations) ? conversations : [];
  if (rows.length === 0) {
    return `<div class="project-empty-thread"><strong>No chats yet</strong><span>Start this project with the box below.</span></div>`;
  }
  return rows.map((conversation) => {
    const conversationId = conversation.id ?? conversation.conversation_id ?? "";
    const turnCount = conversation.messageCount ?? conversation.message_count ?? (conversation.turns ?? []).length;
    const updatedAt = conversation.updatedAt ?? conversation.updated_at ?? conversation.startedAt ?? conversation.created_at;
    return `
      <div class="history-item-row project-thread-row ${conversationId === selectedConversationId ? "active" : ""}">
        <button class="history-item history-item--main" data-project-conversation-id="${escapeHtml(conversationId)}" style="text-align:left;">
          <div class="row">
            <strong style="font-size:13px;">${escapeHtml(conversation.title || conversation.seedCommand || "新会话")}</strong>
            <span class="muted" style="font-size:11px;">${escapeHtml(turnCount)}</span>
          </div>
          <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(formatDateTime(updatedAt))}</p>
        </button>
        <button class="history-item-resume" type="button"
                data-resume-project-conversation-id="${escapeHtml(conversationId)}"
                title="在 Chat 标签继续此对话" aria-label="继续对话">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>
    `;
  }).join("");
}

export function renderProjectArtifactListHtml({
  artifacts = [],
  attachedFilePaths = [],
  projectId = null,
  labelForPath = (value) => value
} = {}) {
  const rows = Array.isArray(artifacts) ? artifacts.filter((artifact) => artifact?.path) : [];
  const attachedRows = Array.isArray(attachedFilePaths)
    ? attachedFilePaths
      .map((entry) => typeof entry === "string" ? { path: entry, legacyScopeLabel: true } : entry)
      .filter((entry) => typeof entry?.path === "string" && entry.path.trim())
      .map((entry) => ({ ...entry, path: entry.path.trim() }))
      .filter((entry, index, all) => all.findIndex((item) => item.path === entry.path) === index)
    : [];
  if (rows.length === 0 && attachedRows.length === 0) {
    return `<p class="muted" style="font-size:12px;">No files in this project.</p>`;
  }
  const attachedHtml = attachedRows.map((entry) => {
    const filePath = entry.path;
    const ext = artifactExtension(filePath);
    const label = labelForPath(filePath);
    const kind = entry.metadata?.kind === "folder" || entry.kind === "folder" ? "folder" : "file";
    const status = entry.legacyScopeLabel ? "Project scope" : entry.status || (entry.indexed_at ? "indexed" : "attached");
    const scopeLabel = kind === "folder" ? "Attached project folder" : "Attached project file";
    return `
      <div class="project-artifact-row project-artifact-row--attached">
        <span class="artifact-icon ${artifactIconClass(ext)}">${escapeHtml(artifactIconText(filePath))}</span>
        <button class="project-artifact-main" type="button" data-project-artifact-open="${escapeHtml(filePath)}" title="${escapeHtml(filePath)}">
          <span class="project-artifact-name">${escapeHtml(label)}</span>
          <span class="project-artifact-meta">
            <span>${escapeHtml(scopeLabel)}</span>
            <span class="artifact-status artifact-status--project">${escapeHtml(status)}</span>
          </span>
        </button>
        <div class="project-artifact-actions">
          ${projectId ? `<button class="project-artifact-action" type="button" data-project-file-reindex="${escapeHtml(filePath)}" data-project-file-reindex-project-id="${escapeHtml(projectId)}" title="Reindex for project search" aria-label="Reindex ${escapeHtml(label)} for project search">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>` : ""}
          ${projectId ? `<button class="project-artifact-action project-artifact-action--danger" type="button" data-project-file-clear-index="${escapeHtml(filePath)}" data-project-file-clear-index-project-id="${escapeHtml(projectId)}" title="Clear project search index only" aria-label="Clear project search index for ${escapeHtml(label)}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M4 7h16"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>
          </button>` : ""}
          <button class="project-artifact-action" type="button" data-project-artifact-reveal="${escapeHtml(filePath)}" title="Reveal in folder" aria-label="Reveal ${escapeHtml(label)}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
          </button>
          ${projectId ? `<button class="project-artifact-action project-artifact-action--danger" type="button" data-project-file-detach="${escapeHtml(filePath)}" data-project-file-detach-project-id="${escapeHtml(projectId)}" title="Remove from project" aria-label="Remove ${escapeHtml(label)} from project">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>` : ""}
        </div>
      </div>
    `;
  }).join("");
  const artifactHtml = rows.map((artifact) => {
    const filePath = `${artifact.path ?? ""}`;
    const ext = artifactExtension(filePath);
    const label = labelForPath(filePath);
    const conversationTitle = artifact.conversation_title || artifact.conversation_id || "";
    const status = artifactStatusInfo(artifact.status);
    return `
      <div class="project-artifact-row">
        <span class="artifact-icon ${artifactIconClass(ext)}">${escapeHtml(artifactIconText(filePath))}</span>
        <button class="project-artifact-main" type="button" data-project-artifact-open="${escapeHtml(filePath)}" title="${escapeHtml(filePath)}">
          <span class="project-artifact-name">${escapeHtml(label)}</span>
          <span class="project-artifact-meta">
            <span>${escapeHtml(conversationTitle)}${artifact.created_at ? ` · ${escapeHtml(formatDateTime(artifact.created_at))}` : ""}</span>
            ${status ? `<span class="artifact-status ${status.className}">${escapeHtml(status.label)}</span>` : ""}
          </span>
        </button>
        <div class="project-artifact-actions">
          <button class="project-artifact-action" type="button" data-project-artifact-reveal="${escapeHtml(filePath)}" title="Reveal in folder" aria-label="Reveal ${escapeHtml(label)}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");
  return [
    attachedHtml ? `<div class="project-file-section-label">Project files</div>${attachedHtml}` : "",
    artifactHtml ? `<div class="project-file-section-label">Generated files</div>${artifactHtml}` : ""
  ].join("");
}
