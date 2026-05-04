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

export function extractEvidenceSummaryFromMessage(message) {
  const metadata = message?.metadata && typeof message.metadata === "object"
    ? message.metadata
    : (message?.metadata_json && typeof message.metadata_json === "object" ? message.metadata_json : null);
  if (metadata?.evidence_summary && typeof metadata.evidence_summary === "object") {
    return metadata.evidence_summary;
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

const COVERAGE_SCOPE_LABELS = Object.freeze({
  single_file_text: "fresh file text",
  folder_recursive_text: "deep folder text",
  directory_listing_shallow: "listed only",
  file_enumeration_recursive: "recursive listing",
  file_metadata: "metadata only"
});

const SHALLOW_SOURCE_SCOPES = new Set([
  "directory_listing_shallow",
  "file_enumeration_recursive",
  "file_metadata"
]);

function renderCoverageScopeChips(counts = {}, { className = "chip muted", prefix = "" } = {}) {
  if (!counts || typeof counts !== "object") return "";
  return Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .map(([scope, count]) => {
      const label = COVERAGE_SCOPE_LABELS[scope] ?? scope.replace(/_/g, " ");
      return `<span class="${escapeHtml(className)}">${escapeHtml(count)} ${escapeHtml(prefix ? `${prefix} ${label}` : label)}</span>`;
    })
    .join("");
}

export function renderEvidenceSourcesHtml(evidence, {
  className = "task-answer task-evidence",
  title = "Evidence",
  zh = "来源",
  citations = evidence?.citations
} = {}) {
  const webCount = Number(evidence?.source_count ?? 0);
  const domainCount = Number(evidence?.distinct_domain_count ?? 0);
  const localCount = Number(evidence?.local_source_count ?? 0);
  const indexedCount = Number(evidence?.indexed_file_source_count ?? 0);
  const shallowCount = Number(evidence?.local_shallow_source_count ?? 0);
  const truncatedCount = Number(evidence?.local_truncated_source_count ?? 0);
  const indexedTruncatedCount = Number(evidence?.indexed_file_truncated_source_count ?? 0);
  const localDeepCount = Number(evidence?.local_deep_text_source_count ?? 0);
  const localScopeChips = renderCoverageScopeChips(evidence?.local_coverage_scope_counts, { className: "chip ready" });
  const indexedScopeChips = renderCoverageScopeChips(evidence?.indexed_file_coverage_scope_counts, { className: "chip muted", prefix: "indexed" });
  const sources = normalizeEvidenceSourcesForView(evidence);
  const ledgerCount = sources.length;
  const blendedCount = Number(evidence?.blended_source_count ?? (ledgerCount || (webCount + localCount + indexedCount)));
  if (!evidence || (blendedCount <= 0 && shallowCount <= 0 && ledgerCount <= 0)) return "";
  const hasSourceLedger = sources.length > 0;
  const webSources = hasSourceLedger
    ? sources.filter((source) => source.kind === "web")
    : legacySources(evidence?.urls, "web");
  const localSourcesForRows = hasSourceLedger
    ? sources.filter((source) => (source.kind === "file" || source.kind === "image") && !SHALLOW_SOURCE_SCOPES.has(source.scope))
    : legacySources(evidence?.local_sources, "file");
  const indexedSourcesForRows = hasSourceLedger
    ? sources.filter((source) => source.kind === "chunk")
    : legacySources(evidence?.indexed_file_sources, "chunk");
  const shallowSourcesForRows = hasSourceLedger
    ? sources.filter((source) => source.kind === "file" && SHALLOW_SOURCE_SCOPES.has(source.scope))
    : legacySources(evidence?.local_shallow_sources, "listed");
  const domains = Array.isArray(evidence.domains) ? evidence.domains.slice(0, 6) : [];
  const missingCitations = Array.isArray(citations?.missing) ? citations.missing.filter(Boolean) : [];
  const shownWebSources = webSources.slice(0, 6);
  const shownLocalSources = localSourcesForRows.slice(0, 6);
  const shownIndexedSources = indexedSourcesForRows.slice(0, 6);
  const shownShallowSources = shallowSourcesForRows.slice(0, 6);
  const moreWeb = Math.max(0, (hasSourceLedger ? webSources.length : webCount) - shownWebSources.length);
  const moreLocal = Math.max(0, (hasSourceLedger ? localSourcesForRows.length : localCount) - shownLocalSources.length);
  const moreIndexed = Math.max(0, (hasSourceLedger ? indexedSourcesForRows.length : indexedCount) - shownIndexedSources.length);
  const moreShallow = Math.max(0, (hasSourceLedger ? shallowSourcesForRows.length : shallowCount) - shownShallowSources.length);
  return `
    <div class="${escapeHtml(className)}" data-evidence-sources>
      <div class="task-answer-label">${escapeHtml(title)}<span class="zh">${escapeHtml(zh)}</span></div>
      <div class="btn-group" style="margin-bottom:8px;">
        <span class="chip ready">${escapeHtml(blendedCount)} content source${blendedCount === 1 ? "" : "s"}</span>
        ${webCount ? `<span class="chip muted">${escapeHtml(webCount)} web · ${escapeHtml(domainCount)} domains</span>` : ""}
        ${localCount ? `<span class="chip muted">${escapeHtml(localCount)} local text</span>` : ""}
        ${localDeepCount ? `<span class="chip ready">${escapeHtml(localDeepCount)} deep local read</span>` : ""}
        ${indexedCount ? `<span class="chip muted">${escapeHtml(indexedCount)} indexed file</span>` : ""}
        ${shallowCount ? `<span class="chip warning">${escapeHtml(shallowCount)} listed only</span>` : ""}
        ${truncatedCount + indexedTruncatedCount ? `<span class="chip warning">${escapeHtml(truncatedCount + indexedTruncatedCount)} truncated</span>` : ""}
        ${missingCitations.length ? `<span class="chip warning" data-citation-diagnostic="unresolved" title="${escapeHtml(missingCitations.join(", "))}">${escapeHtml(missingCitations.length)} unresolved citation${missingCitations.length === 1 ? "" : "s"}</span>` : ""}
        ${localScopeChips}
        ${indexedScopeChips}
      </div>
      ${domains.length ? `<div class="muted" style="font-size:11px;margin-bottom:6px;">Domains: ${domains.map(escapeHtml).join(", ")}</div>` : ""}
      ${shownWebSources.length ? `
        <div class="stack" style="gap:4px;margin-top:6px;">
          ${shownWebSources.map((source) => renderEvidenceSourceRow(source, { tag: "web", action: "Open", actionAttr: "data-evidence-url" })).join("")}
          ${moreWeb ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreWeb)} more web source${moreWeb === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
      ${shownLocalSources.length ? `
        <div class="stack" style="gap:4px;margin-top:8px;">
          ${shownLocalSources.map((source) => renderEvidenceSourceRow(source, { tag: source.kind === "image" ? "image" : "local", action: "Reveal", actionAttr: "data-evidence-path" })).join("")}
          ${moreLocal ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreLocal)} more local source${moreLocal === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
      ${shownIndexedSources.length ? `
        <div class="stack" style="gap:4px;margin-top:8px;">
          ${shownIndexedSources.map((source) => renderEvidenceSourceRow(source, { tag: "indexed", action: "Reveal", actionAttr: "data-evidence-path" })).join("")}
          ${moreIndexed ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreIndexed)} more indexed file source${moreIndexed === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
      ${shownShallowSources.length ? `
        <div class="stack" style="gap:4px;margin-top:8px;">
          ${shownShallowSources.map((source) => renderEvidenceSourceRow(source, { tag: "listed", action: "Reveal", actionAttr: "data-evidence-path" })).join("")}
          ${moreShallow ? `<div class="muted" style="font-size:11px;">+${escapeHtml(moreShallow)} more listed-only local path${moreShallow === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
    </div>
  `;
}

function normalizeEvidenceSourcesForView(evidence) {
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  return sources
    .map((source) => ({
      id: typeof source?.id === "string" ? source.id.trim() : "",
      kind: typeof source?.kind === "string" ? source.kind.trim() : "",
      locator: typeof source?.locator === "string" ? source.locator.trim() : "",
      title: typeof source?.title === "string" ? source.title.trim() : "",
      scope: typeof source?.scope === "string" ? source.scope.trim() : ""
    }))
    .filter((source) => source.locator);
}

function legacySources(values, kind) {
  return Array.isArray(values)
    ? values.filter(Boolean).map((locator) => ({ kind, locator: String(locator), title: "", id: "", scope: "" }))
    : [];
}

function renderEvidenceSourceRow(source, { tag, action, actionAttr }) {
  const locator = source.locator ?? "";
  const idAttr = source.id ? ` data-source-id="${escapeHtml(source.id)}"` : "";
  const label = source.title || shortEvidenceLabel(locator);
  return `
    <div class="row evidence-source-row" data-evidence-source-row${idAttr} style="gap:6px;align-items:center;font-size:11.5px;">
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="muted" style="overflow-wrap:anywhere;min-width:0;flex:1;" title="${escapeHtml(locator)}">${escapeHtml(label)}</span>
      <button class="btn btn-sm btn-ghost" type="button" ${actionAttr}="${escapeHtml(locator)}">${escapeHtml(action)}</button>
    </div>
  `;
}

export function revealEvidenceSource(container, sourceId, { flashMs = 1500 } = {}) {
  const cleanId = typeof sourceId === "string" ? sourceId.trim() : "";
  if (!container || !cleanId) return false;
  const rows = container.querySelectorAll?.("[data-evidence-source-row][data-source-id]") ?? [];
  const target = Array.from(rows).find((row) => row.getAttribute("data-source-id") === cleanId);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: "smooth", block: "center" });
  target.classList.remove("cite-source-row--flash");
  void target.offsetWidth;
  target.classList.add("cite-source-row--flash");
  setTimeout(() => target.classList.remove("cite-source-row--flash"), flashMs);
  return true;
}

export function renderToolCallSourcesHtml(sources = []) {
  const items = Array.isArray(sources) ? sources.filter((source) => source?.id && source?.locator).slice(0, 4) : [];
  if (items.length === 0) return "";
  return `
    <div class="ttc-sources" data-tool-call-sources>
      ${items.map((source) => {
        const kind = source.kind === "chunk" ? "indexed" : source.kind;
        const label = source.title || shortEvidenceLabel(source.locator);
        return `<span class="tag" data-source-id="${escapeHtml(source.id)}" title="${escapeHtml(source.locator)}">${escapeHtml(kind)} · ${escapeHtml(label)}</span>`;
      }).join("")}
      ${Array.isArray(sources) && sources.length > items.length
        ? `<span class="tag">+${escapeHtml(sources.length - items.length)} more</span>`
        : ""}
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
