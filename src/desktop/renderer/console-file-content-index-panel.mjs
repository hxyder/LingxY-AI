import { escapeHtml, formatDateTime } from "./shared-ui.mjs";
import { createRuntimeHttpClient } from "./shared/runtime-http-client.mjs";
import {
  DEFAULT_PROJECT_ID,
  setProjectAttachedFilePath
} from "../../shared/project-store.mjs";

const ACTOR_HEADER = "X-Lingxy-Desktop-Actor";

function recordPath(record = {}) {
  return record.metadata?.path ?? record.id ?? "";
}

function recordMetaLine(record = {}) {
  const bits = [];
  if (record.metadata?.project_id) bits.push(`project ${record.metadata.project_id}`);
  if (record.metadata && record.metadata.project_id === null) bits.push("global");
  if (Number.isFinite(Number(record.metadata?.chunk_index)) && Number.isFinite(Number(record.metadata?.chunk_count))) {
    bits.push(`chunk ${Number(record.metadata.chunk_index) + 1}/${Number(record.metadata.chunk_count)}`);
  }
  if (record.metadata?.coverage_scope) bits.push(record.metadata.coverage_scope);
  if (record.metadata?.artifact_id) bits.push(`artifact ${record.metadata.artifact_id}`);
  if (record.metadata?.task_id) bits.push(`task ${record.metadata.task_id}`);
  if (record.metadata?.created_at) bits.push(formatDateTime(record.metadata.created_at));
  return bits.join(" · ");
}

function renderAttachControl(record = {}, project = null) {
  if (!project?.id || project.id === DEFAULT_PROJECT_ID) return "";
  const path = recordPath(record);
  if (!path) return "";
  const attachedPaths = Array.isArray(project.attachedFilePaths) ? project.attachedFilePaths : [];
  const checked = attachedPaths.includes(path);
  const label = `Attach to ${project.name || project.id}`;
  return `
    <label class="file-content-attach-control" title="${escapeHtml(label)}">
      <input type="checkbox"
             data-attach-file-content-path="${escapeHtml(path)}"
             data-attach-file-content-project-id="${escapeHtml(project.id)}"
             ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderRecord(record = {}, { attachProject = null } = {}) {
  const path = recordPath(record);
  const meta = recordMetaLine(record);
  return `
    <div class="surface" style="padding:10px 12px;">
      <div class="row" style="align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <strong style="font-size:12px;word-break:break-all;">${escapeHtml(path || record.id || "Indexed file")}</strong>
          ${meta ? `<div class="muted" style="font-size:11px;margin-top:4px;">${escapeHtml(meta)}</div>` : ""}
          ${record.text_preview ? `<p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.45;">${escapeHtml(record.text_preview)}</p>` : ""}
        </div>
        <div class="stack" style="align-items:flex-end;gap:6px;">
          ${renderAttachControl(record, attachProject)}
          <button type="button" class="btn btn-sm btn-danger" data-delete-file-content-index="${escapeHtml(record.id)}">Delete index</button>
        </div>
      </div>
    </div>
  `;
}

export function createFileContentIndexPanel({
  root = document,
  getServiceBaseUrl,
  getProjects = () => [],
  getSelectedProjectId = () => null,
  onProjectStoreUpdate = null,
  toast = () => {}
} = {}) {
  const refreshBtn = root.querySelector("#fileContentIndexRefreshBtn");
  const scopeSelect = root.querySelector("#fileContentIndexScopeSelect");
  const stateEl = root.querySelector("#fileContentIndexState");
  const countEl = root.querySelector("#fileContentIndexCount");
  const listEl = root.querySelector("#fileContentIndexList");
  let records = [];
  let loaded = false;
  let loading = false;
  const httpClient = createRuntimeHttpClient({
    getBaseUrl: () => {
      const baseUrl = getServiceBaseUrl?.();
      if (!baseUrl) throw new Error("Runtime service is not ready.");
      return baseUrl;
    }
  });

  function setState(message = "") {
    if (stateEl) stateEl.textContent = message;
  }

  async function request(pathname, options = {}) {
    const headers = {
      ...(options.headers ?? {}),
      [ACTOR_HEADER]: "desktop_console"
    };
    return httpClient.fetchJson(pathname, { ...options, headers });
  }

  function selectedScopeValue() {
    return String(scopeSelect?.value ?? "all").trim() || "all";
  }

  function selectedProjectQueryValue() {
    const value = selectedScopeValue();
    if (value === "all") return null;
    if (value === "global") return "global";
    if (value.startsWith("project:")) return value.slice("project:".length);
    return null;
  }

  function selectedAttachProject() {
    const projectId = String(selectedProjectQueryValue() ?? "").trim();
    if (!projectId || projectId === DEFAULT_PROJECT_ID) return null;
    const projects = Array.isArray(getProjects?.()) ? getProjects() : [];
    return projects.find((project) => project?.id === projectId) ?? null;
  }

  function listPath() {
    const params = new URLSearchParams({ limit: "200" });
    const projectId = selectedProjectQueryValue();
    if (projectId != null) params.set("project_id", projectId);
    return `/history/file-content?${params.toString()}`;
  }

  function refreshScopeOptions() {
    if (!scopeSelect) return;
    const previous = selectedScopeValue();
    const selectedProjectId = String(getSelectedProjectId?.() ?? "").trim();
    const projectOptions = (Array.isArray(getProjects?.()) ? getProjects() : [])
      .filter((project) => project?.id)
      .map((project) => {
        const id = String(project.id);
        const label = project.name || id;
        return `<option value="project:${escapeHtml(id)}">${escapeHtml(label)}</option>`;
      })
      .join("");
    scopeSelect.innerHTML = [
      `<option value="all">All scopes</option>`,
      `<option value="global">Personal / global</option>`,
      selectedProjectId ? `<option value="project:${escapeHtml(selectedProjectId)}">Current project</option>` : "",
      projectOptions
    ].join("");
    const values = new Set(Array.from(scopeSelect.options).map((option) => option.value));
    scopeSelect.value = values.has(previous)
      ? previous
      : (selectedProjectId && values.has(`project:${selectedProjectId}`) ? `project:${selectedProjectId}` : "all");
  }

  function render() {
    if (!listEl) return;
    refreshScopeOptions();
    if (countEl) countEl.textContent = `${records.length}`;
    if (!loaded && records.length === 0) {
      listEl.innerHTML = `<p class="muted" style="font-size:12px;">Click Load indexed files to view searchable file-content records.</p>`;
      return;
    }
    if (records.length === 0) {
      listEl.innerHTML = `<p class="muted" style="font-size:12px;">No indexed file content records.</p>`;
      return;
    }
    const attachProject = selectedAttachProject();
    listEl.innerHTML = records.map((record) => renderRecord(record, { attachProject })).join("");
    for (const button of listEl.querySelectorAll("[data-delete-file-content-index]")) {
      button.addEventListener("click", () => {
        void deleteRecord(button.dataset.deleteFileContentIndex);
      });
    }
    for (const input of listEl.querySelectorAll("[data-attach-file-content-path]")) {
      input.addEventListener("change", () => {
        updateProjectAttachment({
          projectId: input.dataset.attachFileContentProjectId,
          path: input.dataset.attachFileContentPath,
          attached: input.checked
        });
      });
    }
  }

  async function load({ force = false } = {}) {
    if (loading) return;
    if (loaded && !force) return;
    loading = true;
    refreshBtn?.setAttribute("disabled", "true");
    setState("Loading indexed files...");
    try {
      const payload = await request(listPath());
      records = Array.isArray(payload.records) ? payload.records : [];
      loaded = true;
      setState(records.length ? "Loaded." : "No indexed file content.");
      render();
    } catch (error) {
      setState(`Failed: ${error.message}`);
      toast(`加载文件索引失败：${error.message}`, { kind: "err" });
    } finally {
      loading = false;
      refreshBtn?.removeAttribute("disabled");
    }
  }

  async function deleteRecord(recordId) {
    const id = String(recordId ?? "").trim();
    if (!id) return;
    const record = records.find((item) => item.id === id);
    const path = recordPath(record);
    const ok = window.confirm(`Delete this indexed file-content record?\n\n${path || id}\n\nThis only removes the searchable index entry. It does not delete the source file.`);
    if (!ok) return;
    setState("Deleting index record...");
    try {
      await request(`/history/file-content/${encodeURIComponent(id)}`, { method: "DELETE" });
      records = records.filter((item) => item.id !== id);
      setState("Deleted index record.");
      render();
      toast("已删除文件内容索引记录", { kind: "ok" });
    } catch (error) {
      setState(`Failed: ${error.message}`);
      toast(`删除索引失败：${error.message}`, { kind: "err" });
    }
  }

  function updateProjectAttachment({ projectId, path, attached }) {
    const id = String(projectId ?? "").trim();
    const filePath = String(path ?? "").trim();
    if (!id || !filePath || typeof onProjectStoreUpdate !== "function") return;
    try {
      onProjectStoreUpdate((store) => setProjectAttachedFilePath(store, id, filePath, attached));
      render();
      toast(attached ? "已加入项目文件范围" : "已移出项目文件范围", { kind: "ok" });
    } catch (error) {
      toast(`更新项目文件范围失败：${error.message}`, { kind: "err" });
      render();
    }
  }

  refreshBtn?.addEventListener("click", () => {
    void load({ force: true });
  });
  scopeSelect?.addEventListener("change", () => {
    loaded = false;
    records = [];
    render();
    void load({ force: true });
  });

  render();

  return {
    load,
    render,
    isLoaded: () => loaded
  };
}
