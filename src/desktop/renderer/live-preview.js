// Live file-generation preview panel — UCA-180 (Phase-3 rewrite, UCA-182).
//
// AionUI-style right-edge overlay. The panel's only job now is UI:
//   - three size presets (compact / medium / full) + pin + close + chip
//   - stream events from the agent loop into a body <div>
//   - hand rendering off to `window.livePreviewClient` (final artefact)
//     or `window.livePreviewStreaming` (partial JSON during a tool call)
//
// All format-specific painting lives in ./preview/handlers/*.js.
// Adding a new preview format: drop a handler, no changes here.

(function initLivePreview() {
  const SIZE_KEY = "lingxy.livePreview.size";
  const PIN_KEY = "lingxy.livePreview.pinned";
  const SIZES = ["compact", "medium", "full"];
  const FILE_GEN_TOOLS = new Set(["write_file", "generate_document", "edit_file"]);
  const AUTO_COLLAPSE_MS = 5000;

  const state = {
    size: loadSize(),
    pinned: loadPinned(),
    open: false,
    toolName: "",
    toolPath: "",
    toolKind: "text",
    rawJson: "",
    autoCollapseTimer: null,
    minimized: false
  };

  function loadSize() {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return SIZES.includes(v) ? v : "medium";
    } catch { return "medium"; }
  }
  function saveSize() {
    try { localStorage.setItem(SIZE_KEY, state.size); } catch { /* ignore */ }
  }
  function loadPinned() {
    try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
  }
  function savePinned() {
    try { localStorage.setItem(PIN_KEY, state.pinned ? "1" : "0"); } catch { /* ignore */ }
  }

  // ── DOM ──────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "livePreview";
  root.className = "live-preview";
  root.dataset.size = state.size;
  root.hidden = true;
  root.innerHTML = `
    <div class="lp-backdrop" data-lp-backdrop hidden></div>
    <aside class="lp-panel" role="complementary" aria-label="实时文件预览">
      <header class="lp-head">
        <div class="lp-head-main">
          <span class="lp-status-dot" data-lp-status></span>
          <span class="lp-title" data-lp-title>正在生成…</span>
          <span class="lp-sub" data-lp-sub></span>
        </div>
        <div class="lp-head-actions">
          <button type="button" class="lp-icon-btn" data-lp-size="compact" title="紧凑">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="4" width="6" height="16" rx="1"/></svg>
          </button>
          <button type="button" class="lp-icon-btn" data-lp-size="medium" title="中等">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="4" width="11" height="16" rx="1"/></svg>
          </button>
          <button type="button" class="lp-icon-btn" data-lp-size="full" title="全屏">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="17" height="16" rx="1"/></svg>
          </button>
          <span class="lp-sep"></span>
          <button type="button" class="lp-icon-btn" data-lp-pin title="置顶">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1V4H8v2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
          </button>
          <button type="button" class="lp-icon-btn" data-lp-close title="关闭">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>
      <div class="lp-body" data-lp-body></div>
      <footer class="lp-foot">
        <span class="lp-foot-meta" data-lp-meta></span>
      </footer>
    </aside>
    <button type="button" class="lp-chip" data-lp-chip hidden>
      <span data-lp-chip-name>预览</span>
    </button>
  `;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(root));
  } else {
    document.body.appendChild(root);
  }

  const $ = (sel) => root.querySelector(sel);

  root.addEventListener("click", (ev) => {
    const sizeBtn = ev.target.closest("[data-lp-size]");
    if (sizeBtn) { setSize(sizeBtn.dataset.lpSize); return; }
    if (ev.target.closest("[data-lp-pin]")) { togglePin(); return; }
    if (ev.target.closest("[data-lp-close]")) { close(); return; }
    if (ev.target.closest("[data-lp-chip]")) { restore(); return; }
    if (ev.target.matches("[data-lp-backdrop]")) { setSize("medium"); return; }
  });

  function setSize(size) {
    if (!SIZES.includes(size)) return;
    state.size = size;
    root.dataset.size = size;
    saveSize();
    syncActiveSizeBtn();
  }
  function togglePin() {
    state.pinned = !state.pinned;
    savePinned();
    root.dataset.pinned = state.pinned ? "1" : "0";
    if (state.pinned && state.autoCollapseTimer) {
      clearTimeout(state.autoCollapseTimer);
      state.autoCollapseTimer = null;
    }
  }
  function syncActiveSizeBtn() {
    root.querySelectorAll("[data-lp-size]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.lpSize === state.size);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────
  function openForTool({ toolName, args }) {
    if (!FILE_GEN_TOOLS.has(toolName)) return false;
    state.open = true;
    state.minimized = false;
    state.toolName = toolName;
    state.toolPath = (args && (args.path || args.filename)) || "";
    state.toolKind = inferKind(state.toolPath, toolName);
    state.rawJson = "";
    if (state.autoCollapseTimer) { clearTimeout(state.autoCollapseTimer); state.autoCollapseTimer = null; }
    root.hidden = false;
    root.dataset.pinned = state.pinned ? "1" : "0";
    root.dataset.state = "running";
    root.querySelector("[data-lp-chip]").hidden = true;
    root.querySelector(".lp-panel").hidden = false;
    syncActiveSizeBtn();
    $("[data-lp-title]").textContent = state.toolPath || `${toolName} 生成中…`;
    $("[data-lp-sub]").textContent = toolName;
    $("[data-lp-meta]").textContent = "0B";
    $("[data-lp-body]").innerHTML = `<div class="lp-loading">正在生成…</div>`;
    return true;
  }

  function appendDelta({ toolName, partialJson }) {
    if (!state.open || state.toolName !== toolName) return;
    state.rawJson = partialJson || "";
    if (!state.toolPath && window.livePreviewStreaming?.extractStringField) {
      const extract = window.livePreviewStreaming.extractStringField;
      const pathFromStream = extract(state.rawJson, "path") || extract(state.rawJson, "filename");
      if (pathFromStream) {
        state.toolPath = pathFromStream;
        state.toolKind = inferKind(pathFromStream, toolName);
        $("[data-lp-title]").textContent = pathFromStream;
      }
    }
    const body = $("[data-lp-body]");
    window.livePreviewStreaming?.renderDelta(body, {
      toolName,
      rawJson: state.rawJson,
      toolKind: state.toolKind,
      toolPath: state.toolPath
    });
    $("[data-lp-meta]").textContent = `${formatBytes(state.rawJson.length)} · streaming`;
  }

  function commit({ toolName, success, artifactPath, mime, observation }) {
    if (!state.open || state.toolName !== toolName) return;
    root.dataset.state = success === false ? "err" : "ok";
    $("[data-lp-meta]").textContent = success === false
      ? (observation ? `失败 · ${String(observation).slice(0, 80)}` : "失败")
      : (artifactPath ? `已生成 · ${basename(artifactPath)}` : "已完成");
    if (artifactPath) state.toolPath = artifactPath;
    if (success !== false && artifactPath) {
      void renderFinalArtifact(artifactPath, mime);
    } else if (success === false) {
      const body = $("[data-lp-body]");
      const errEl = document.createElement("div");
      errEl.className = "lp-error";
      errEl.textContent = observation || "工具失败";
      body.innerHTML = "";
      body.appendChild(errEl);
    }
    if (!state.pinned) {
      if (state.autoCollapseTimer) clearTimeout(state.autoCollapseTimer);
      state.autoCollapseTimer = setTimeout(() => minimize(), AUTO_COLLAPSE_MS);
    }
  }

  function close() {
    state.open = false;
    state.minimized = false;
    state.rawJson = "";
    if (state.autoCollapseTimer) { clearTimeout(state.autoCollapseTimer); state.autoCollapseTimer = null; }
    root.hidden = true;
    root.querySelector("[data-lp-chip]").hidden = true;
  }

  function minimize() {
    state.minimized = true;
    root.querySelector(".lp-panel").hidden = true;
    const chip = root.querySelector("[data-lp-chip]");
    chip.hidden = false;
    chip.querySelector("[data-lp-chip-name]").textContent = state.toolPath
      ? basename(state.toolPath)
      : "预览";
  }

  function restore() {
    state.minimized = false;
    root.querySelector(".lp-panel").hidden = false;
    root.querySelector("[data-lp-chip]").hidden = true;
    if (!state.pinned && state.autoCollapseTimer) {
      clearTimeout(state.autoCollapseTimer);
      state.autoCollapseTimer = null;
    }
  }

  // ── Final artefact rendering ─────────────────────────────────────────
  async function renderFinalArtifact(artifactPath, mime) {
    const body = $("[data-lp-body]");
    if (window.livePreviewClient?.render) {
      await window.livePreviewClient.render(body, {
        filePath: artifactPath,
        mime,
        runtimeBaseUrl: window.__lingxyRuntimeBaseUrl || undefined
      });
      return;
    }
    // Extremely unlikely: handler scripts never loaded. Fallback to
    // a plain "open externally" placeholder rather than any kind of
    // fake preview.
    body.innerHTML = `
      <div class="lp-placeholder">
        <div class="lp-placeholder-title">${escapeHtml(basename(artifactPath))}</div>
        <div class="lp-placeholder-sub">预览模块未加载。请刷新或使用外部应用打开。</div>
      </div>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function inferKind(filePath, toolName) {
    const ext = (filePath.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
    if (ext === "html" || ext === "htm") return "html";
    if (ext === "md" || ext === "markdown") return "markdown";
    if (ext === "json") return "json";
    if (["js","mjs","cjs","ts","tsx","py","go","rs","java","sh","ps1","sql","yaml","yml","toml","ini","xml","css"].includes(ext)) return "code";
    if (["txt","log"].includes(ext)) return "text";
    if (["png","jpg","jpeg","gif","webp"].includes(ext)) return "image";
    if (toolName === "generate_document") return "binary";
    return "text";
  }
  function basename(p) {
    return (p || "").split(/[\\/]/).pop() || p;
  }
  function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  }
  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  window.livePreview = {
    isFileGenTool: (toolName) => FILE_GEN_TOOLS.has(toolName),
    openForTool,
    appendDelta,
    commit,
    close
  };
})();
