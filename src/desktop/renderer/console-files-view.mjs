import {
  artifactExtension,
  artifactIconClass,
  artifactIconText,
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

export function filterFileArtifacts(artifacts = [], filterText = "") {
  const source = Array.isArray(artifacts) ? artifacts : [];
  const filter = String(filterText ?? "").trim().toLowerCase();
  if (!filter) return source;
  return source.filter((artifact) =>
    String(artifact.name ?? "").toLowerCase().includes(filter) ||
    String(artifact.path ?? "").toLowerCase().includes(filter) ||
    String(artifact.taskCommand ?? "").toLowerCase().includes(filter) ||
    String(artifact.label ?? "").toLowerCase().includes(filter)
  );
}

export function renderFilesListHtml({ visibleArtifacts = [], allArtifacts = [], selectedPath = null } = {}) {
  const visible = Array.isArray(visibleArtifacts) ? visibleArtifacts : [];
  const all = Array.isArray(allArtifacts) ? allArtifacts : [];
  if (visible.length === 0) {
    return `<p class="muted" style="font-size:12px;">${all.length === 0 ? "No files yet. Generated artifacts will appear here." : "No matches."}</p>`;
  }
  return visible.map((artifact) => {
    const ext = artifactExtension(artifact.path);
    const iconClass = artifactIconClass(ext);
    const iconText = artifactIconText(artifact.path);
    const active = artifact.path === selectedPath ? " active" : "";
    return `
    <div class="file-row${active}" data-file-path="${escapeHtml(artifact.path)}" role="button" tabindex="0">
      <span class="artifact-icon ${iconClass}">${escapeHtml(iconText)}</span>
      <div class="file-main">
        <div class="file-name">${escapeHtml(artifact.name)}</div>
        <div class="file-sub">${escapeHtml(formatDateTime(artifact.createdAt))}${artifact.taskCommand ? " · " + escapeHtml(String(artifact.taskCommand).slice(0, 40)) : ""}</div>
      </div>
    </div>
  `;
  }).join("");
}

export function renderTaskArtifactRowsHtml(artifacts = [], {
  selectedPath = null,
  labelForPath = (path) => path
} = {}) {
  const rows = Array.isArray(artifacts) ? artifacts : [];
  return rows.map((artifact, index) => {
    const path = artifact.path ?? "";
    const label = labelForPath(path);
    const ext = artifactExtension(path);
    const iconClass = artifactIconClass(ext);
    const iconText = artifactIconText(path);
    const isActive = path === selectedPath;
    return `
    <div class="artifact-row ${isActive ? "active" : ""}" data-artifact-container>
      <button type="button" class="artifact-row-main" data-artifact-select data-artifact-path="${escapeHtml(path)}">
        <span class="artifact-icon ${iconClass}">${escapeHtml(iconText)}</span>
        <div class="artifact-main">
          <div class="artifact-name">
            ${escapeHtml(label)}
            ${index === 0 ? `<span class="pill pill-ok" style="margin-left:6px;">Primary</span>` : ""}
          </div>
          <div class="artifact-path">${escapeHtml(path)}</div>
        </div>
      </button>
      <div class="artifact-actions btn-group">
        <button type="button" class="btn btn-sm" data-artifact-open data-artifact-path="${escapeHtml(path)}">Open</button>
        <button type="button" class="btn btn-sm btn-ghost" data-artifact-reveal data-artifact-path="${escapeHtml(path)}">Reveal</button>
        <button type="button" class="btn btn-sm btn-ghost" data-artifact-copy data-artifact-path="${escapeHtml(path)}">Copy path</button>
      </div>
    </div>
  `;
  }).join("");
}
