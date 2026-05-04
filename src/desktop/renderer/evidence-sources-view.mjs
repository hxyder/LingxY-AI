import { escapeHtml } from "./shared-ui.mjs";

export function extractEvidenceSummaryFromTaskDetail(detail) {
  const task = detail?.task ?? {};
  if (task.evidence_summary && typeof task.evidence_summary === "object") return task.evidence_summary;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const payload = events[i]?.payload;
    if (!payload || typeof payload !== "object") continue;
    if (payload.evidence_summary && typeof payload.evidence_summary === "object") return payload.evidence_summary;
    if (events[i]?.event_type === "evidence_summary") return payload;
  }
  return null;
}

export function shortEvidenceLabel(value = "") {
  const text = String(value ?? "");
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.hostname.replace(/^www\./i, "") || text;
  } catch {
    const parts = text.split(/[\\/]+/).filter(Boolean);
    return parts.at(-1) || text;
  }
}

export function renderEvidenceSourcesHtml(evidence, {
  className = "task-answer task-evidence",
  title = "Evidence",
  zh = "来源"
} = {}) {
  const webCount = Number(evidence?.source_count ?? 0);
  const domainCount = Number(evidence?.distinct_domain_count ?? 0);
  const localCount = Number(evidence?.local_source_count ?? 0);
  const blendedCount = Number(evidence?.blended_source_count ?? (webCount + localCount));
  if (!evidence || blendedCount <= 0) return "";
  const urls = Array.isArray(evidence.urls) ? evidence.urls.slice(0, 6) : [];
  const domains = Array.isArray(evidence.domains) ? evidence.domains.slice(0, 6) : [];
  const localSources = Array.isArray(evidence.local_sources) ? evidence.local_sources.slice(0, 6) : [];
  const moreWeb = Math.max(0, webCount - urls.length);
  const moreLocal = Math.max(0, localCount - localSources.length);
  return `
    <div class="${escapeHtml(className)}" data-evidence-sources>
      <div class="task-answer-label">${escapeHtml(title)}<span class="zh">${escapeHtml(zh)}</span></div>
      <div class="btn-group" style="margin-bottom:8px;">
        <span class="chip ready">${escapeHtml(blendedCount)} sources</span>
        ${webCount ? `<span class="chip muted">${escapeHtml(webCount)} web · ${escapeHtml(domainCount)} domains</span>` : ""}
        ${localCount ? `<span class="chip muted">${escapeHtml(localCount)} local</span>` : ""}
      </div>
      ${domains.length ? `<div class="muted" style="font-size:11px;margin-bottom:6px;">Domains: ${domains.map(escapeHtml).join(", ")}</div>` : ""}
      ${urls.length ? `
        <div class="stack" style="gap:4px;margin-top:6px;">
          ${urls.map((url) => `
            <div class="row" style="gap:6px;align-items:center;font-size:11.5px;">
              <span class="tag">web</span>
              <span class="muted" style="overflow-wrap:anywhere;min-width:0;flex:1;" title="${escapeHtml(url)}">${escapeHtml(shortEvidenceLabel(url))}</span>
              <button class="btn btn-sm btn-ghost" type="button" data-evidence-url="${escapeHtml(url)}">Open</button>
            </div>
          `).join("")}
          ${moreWeb ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreWeb)} more web source${moreWeb === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
      ${localSources.length ? `
        <div class="stack" style="gap:4px;margin-top:8px;">
          ${localSources.map((filePath) => `
            <div class="row" style="gap:6px;align-items:center;font-size:11.5px;">
              <span class="tag">local</span>
              <span class="muted" style="overflow-wrap:anywhere;min-width:0;flex:1;" title="${escapeHtml(filePath)}">${escapeHtml(shortEvidenceLabel(filePath))}</span>
              <button class="btn btn-sm btn-ghost" type="button" data-evidence-path="${escapeHtml(filePath)}">Reveal</button>
            </div>
          `).join("")}
          ${moreLocal ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreLocal)} more local source${moreLocal === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
    </div>
  `;
}

export function wireEvidenceSourceActions(container, shell) {
  if (!container || !shell) return;
  for (const btn of container.querySelectorAll("[data-evidence-url]")) {
    btn.addEventListener("click", () => {
      const url = btn.dataset.evidenceUrl;
      if (url) void shell.openExternal?.(url);
    });
  }
  for (const btn of container.querySelectorAll("[data-evidence-path]")) {
    btn.addEventListener("click", async () => {
      const filePath = btn.dataset.evidencePath;
      if (!filePath) return;
      try {
        if (typeof shell.showItemInFolder === "function") {
          await shell.showItemInFolder(filePath);
          return;
        }
      } catch { /* fallback */ }
      void shell.openPath?.(filePath);
    });
  }
}
