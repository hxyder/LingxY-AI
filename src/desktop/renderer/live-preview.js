// Live file generation preview panel — UCA-180.
//
// AionUI-style right-edge overlay that streams partial tool arguments
// while the agent is producing a file artifact, then hands over to the
// final artifact viewer once the tool completes. Three sizes (compact /
// medium / full) + pin + close. Self-contained — exposes a tiny global
// API that the main console wires into the existing task event stream.
//
// Why a separate file: the main console.js is already 7k+ lines; this
// module's surface is well-defined (open / append / commit / close) and
// has no dependency on the console's internal state beyond what's
// passed in via arguments. Easy to delete in isolation if we walk the
// feature back.

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
  // Wait for DOMContentLoaded so the body is ready when the module loads.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(root));
  } else {
    document.body.appendChild(root);
  }

  const $ = (sel) => root.querySelector(sel);

  // ── Header controls ──────────────────────────────────────────────────
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
    // Refresh path lazily — the model may stream `path` before `content`.
    if (!state.toolPath) {
      const pathFromStream = extractStringField(state.rawJson, "path") || extractStringField(state.rawJson, "filename");
      if (pathFromStream) {
        state.toolPath = pathFromStream;
        state.toolKind = inferKind(pathFromStream, toolName);
        $("[data-lp-title]").textContent = pathFromStream;
      }
    }
    if (toolName === "generate_document") {
      // generate_document streams a structured object — pull title /
      // sections / slides / rows out of the partial JSON and render a
      // styled preview that mirrors the final docx / pptx / xlsx
      // layout. Falls back to extractContentField for ad-hoc cases.
      renderStructuredDoc(state.rawJson);
    } else {
      const content = extractContentField(state.rawJson);
      renderStreamingContent(content);
    }
    $("[data-lp-meta]").textContent = `${formatBytes(state.rawJson.length)} · streaming`;
  }

  function commit({ toolName, success, artifactPath, mime, observation }) {
    if (!state.open || state.toolName !== toolName) return;
    root.dataset.state = success === false ? "err" : "ok";
    $("[data-lp-meta]").textContent = success === false
      ? (observation ? `失败 · ${String(observation).slice(0, 80)}` : "失败")
      : (artifactPath ? `已生成 · ${formatBytesLabel(artifactPath)}` : "已完成");
    if (artifactPath) state.toolPath = artifactPath;
    if (success !== false && artifactPath) {
      // Hand over to the final artifact viewer.
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

  // ── Renderers ────────────────────────────────────────────────────────
  function renderStreamingContent(content) {
    const body = $("[data-lp-body]");
    if (!content) {
      // Show the partial JSON as-is so the user has feedback even before
      // the `content` field arrives from the model.
      body.innerHTML = `<div class="lp-prejson"><pre></pre></div>`;
      body.querySelector("pre").textContent = state.rawJson.slice(-2000);
      return;
    }
    if (state.toolKind === "html") {
      let frame = body.querySelector("iframe.lp-iframe");
      if (!frame) {
        body.innerHTML = `<iframe class="lp-iframe" sandbox="allow-same-origin"></iframe>`;
        frame = body.querySelector("iframe");
      }
      frame.srcdoc = content;
      return;
    }
    if (state.toolKind === "markdown" || state.toolKind === "text" || state.toolKind === "code" || state.toolKind === "json") {
      let pre = body.querySelector("pre.lp-pre");
      if (!pre) {
        body.innerHTML = `<pre class="lp-pre"></pre>`;
        pre = body.querySelector("pre");
      }
      pre.textContent = content;
      pre.scrollTop = pre.scrollHeight;
      return;
    }
    // Binary / docx / pptx / image — placeholder until commit.
    body.innerHTML = `
      <div class="lp-placeholder">
        <div class="lp-placeholder-title">${escapeHtml(state.toolPath || state.toolName)}</div>
        <div class="lp-placeholder-sub">该格式无法实时预览，生成完成后会自动加载。</div>
        <div class="lp-placeholder-bytes">${formatBytes(state.rawJson.length)} · 已收到</div>
      </div>
    `;
  }

  async function renderFinalArtifact(artifactPath, mime) {
    const body = $("[data-lp-body]");
    const ext = (artifactPath.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
    const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
    if (isImage && window.ucaShell?.readFileAsDataUrl) {
      try {
        const dataUrl = await window.ucaShell.readFileAsDataUrl(artifactPath, mime || `image/${ext === "jpg" ? "jpeg" : ext}`);
        body.innerHTML = "";
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = artifactPath;
        img.className = "lp-image";
        body.appendChild(img);
        return;
      } catch {
        body.innerHTML = `<div class="lp-error">图片加载失败</div>`;
        return;
      }
    }
    if (isPreviewable(ext) && window.ucaShell?.readTextFile) {
      try {
        const raw = await window.ucaShell.readTextFile(artifactPath, 8000);
        body.innerHTML = `<pre class="lp-pre"></pre>`;
        body.querySelector("pre").textContent = raw;
        return;
      } catch {
        body.innerHTML = `<div class="lp-error">预览加载失败</div>`;
        return;
      }
    }
    // Office (docx / xlsx / pptx) and PDF route through the runtime's
    // /file/extract-text endpoint, which wraps the OOXML / pdftotext
    // extractor used everywhere else in the app.
    if (["docx", "xlsx", "pptx", "pdf"].includes(ext)) {
      try {
        const baseUrl = (typeof window !== "undefined" && window.__lingxyRuntimeBaseUrl)
          || "http://127.0.0.1:4310";
        const url = `${baseUrl}/file/extract-text?path=${encodeURIComponent(artifactPath)}&limit=10000`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
        body.innerHTML = `<div class="lp-doc-head"></div><pre class="lp-pre"></pre>`;
        body.querySelector(".lp-doc-head").textContent = `${basename(artifactPath)} · ${ext.toUpperCase()} 文本提取`;
        body.querySelector("pre").textContent = data.text || "(无可提取文本)";
        return;
      } catch (error) {
        body.innerHTML = `
          <div class="lp-placeholder">
            <div class="lp-placeholder-title">${escapeHtml(basename(artifactPath))}</div>
            <div class="lp-placeholder-sub">无法提取文本：${escapeHtml(error.message)}</div>
            <div class="lp-placeholder-bytes">点击右上角的 ↗ 用系统应用打开</div>
          </div>
        `;
        return;
      }
    }
    // Non-previewable binary → show "open externally" hint.
    body.innerHTML = `
      <div class="lp-placeholder">
        <div class="lp-placeholder-title">${escapeHtml(basename(artifactPath))}</div>
        <div class="lp-placeholder-sub">该文件类型无法在面板内预览。</div>
      </div>
    `;
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
  function isPreviewable(ext) {
    return ["txt","log","md","markdown","json","js","mjs","cjs","ts","tsx","py","go","rs","java","sh","ps1","sql","yaml","yml","toml","ini","xml","css","html","htm","csv","tsv"].includes(ext);
  }
  function basename(p) {
    return (p || "").split(/[\\/]/).pop() || p;
  }
  function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  }
  function formatBytesLabel(p) {
    return basename(p);
  }
  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  // Pull the value of the `content` field out of a partial JSON object
  // even when the JSON is truncated mid-string. Anthropic / OpenAI both
  // stream tool args as JSON, and `write_file` uses {"path":..., "content":...}.
  function extractContentField(partial) {
    return extractStringField(partial, "content");
  }

  // Render a partial-JSON `generate_document` argument bundle as styled
  // HTML. Tolerates truncation (mid-string, mid-array) by recovering
  // whatever is parseable from the head of the buffer.
  function renderStructuredDoc(rawJson) {
    const body = $("[data-lp-body]");
    const kind = (extractStringField(rawJson, "kind") || "").toLowerCase();
    const title = extractStringField(rawJson, "title");
    const subtitle = extractStringField(rawJson, "subtitle");
    let html = "";
    if (kind === "pptx" || extractField(rawJson, "slides") !== null) {
      const slides = parseObjectArray(rawJson, "slides", ["heading", "bullets"]);
      html = `
        <div class="lp-doc">
          ${title ? `<h1 class="lp-doc-title">${escapeHtml(title)}</h1>` : ""}
          ${subtitle ? `<div class="lp-doc-sub">${escapeHtml(subtitle)}</div>` : ""}
          ${slides.map((s, i) => `
            <div class="lp-slide">
              <div class="lp-slide-head">幻灯片 ${i + 1}${s.heading ? " · " + escapeHtml(s.heading) : ""}</div>
              ${Array.isArray(s.bullets) && s.bullets.length
                ? `<ul class="lp-slide-bullets">${s.bullets.filter(Boolean).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
                : ""}
            </div>
          `).join("")}
          ${slides.length === 0 ? `<div class="lp-doc-progress">正在生成第 1 张幻灯片…</div>` : ""}
        </div>
      `;
    } else if (kind === "xlsx" || extractField(rawJson, "rows") !== null) {
      const rows = parseStringMatrix(rawJson, "rows");
      html = `
        <div class="lp-doc">
          ${title ? `<h1 class="lp-doc-title">${escapeHtml(title)}</h1>` : ""}
          ${rows.length === 0 ? `<div class="lp-doc-progress">正在生成表格…</div>` : `
            <table class="lp-doc-table">
              <tbody>
                ${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}
              </tbody>
            </table>
          `}
        </div>
      `;
    } else {
      // docx / pdf — sections array of {heading, body}.
      const sections = parseObjectArray(rawJson, "sections", ["heading", "body"]);
      html = `
        <div class="lp-doc">
          ${title ? `<h1 class="lp-doc-title">${escapeHtml(title)}</h1>` : ""}
          ${sections.map((s) => `
            <section class="lp-doc-section">
              ${s.heading ? `<h2 class="lp-doc-h2">${escapeHtml(s.heading)}</h2>` : ""}
              ${s.body ? `<div class="lp-doc-body">${escapeHtml(s.body).replace(/\n/g, "<br>")}</div>` : ""}
            </section>
          `).join("")}
          ${sections.length === 0 ? `<div class="lp-doc-progress">正在生成…</div>` : ""}
        </div>
      `;
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  // Best-effort: locate a top-level JSON field (string OR object/array)
  // and return its raw text slice, or null when the field hasn't started
  // streaming yet. Used to detect "this partial json contains a slides
  // field" without needing the value to be complete.
  function extractField(partial, fieldName) {
    if (!partial) return null;
    const re = new RegExp(`"${fieldName}"\\s*:`);
    const m = re.exec(partial);
    return m ? partial.slice(m.index + m[0].length) : null;
  }

  // Parse a partial JSON array of objects with a known shape into an
  // array of {key1, key2} entries. Tolerates truncation by stopping at
  // the first incomplete object. Used for slides[] / sections[].
  function parseObjectArray(partial, fieldName, knownKeys) {
    const slice = extractField(partial, fieldName);
    if (!slice) return [];
    // Find array opener.
    const arrStart = slice.indexOf("[");
    if (arrStart === -1) return [];
    const after = slice.slice(arrStart + 1);
    const out = [];
    let i = 0;
    while (i < after.length) {
      // Skip whitespace + commas.
      while (i < after.length && /[\s,]/.test(after[i])) i += 1;
      if (i >= after.length || after[i] === "]") break;
      if (after[i] !== "{") break;
      // Collect a balanced {…} object, respecting strings + escapes.
      let depth = 0;
      let j = i;
      let inStr = false;
      let escape = false;
      let ended = false;
      for (; j < after.length; j += 1) {
        const ch = after[j];
        if (inStr) {
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === "\"") { inStr = false; }
          continue;
        }
        if (ch === "\"") { inStr = true; continue; }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) { ended = true; j += 1; break; }
        }
      }
      const objText = after.slice(i, ended ? j : j);
      const obj = {};
      for (const k of knownKeys) {
        if (k === "bullets") {
          obj[k] = parseStringArray(objText, "bullets");
        } else {
          obj[k] = extractStringField(objText, k);
        }
      }
      // Only push if at least one known key actually has content; this
      // suppresses noisy half-empty rows during stream startup.
      if (Object.values(obj).some((v) => (Array.isArray(v) ? v.length : v))) {
        out.push(obj);
      }
      if (!ended) break;
      i = j;
    }
    return out;
  }

  function parseStringArray(partial, fieldName) {
    const slice = extractField(partial, fieldName);
    if (!slice) return [];
    const arrStart = slice.indexOf("[");
    if (arrStart === -1) return [];
    const after = slice.slice(arrStart + 1);
    const out = [];
    let i = 0;
    while (i < after.length) {
      while (i < after.length && /[\s,]/.test(after[i])) i += 1;
      if (i >= after.length || after[i] === "]") break;
      if (after[i] !== "\"") break;
      i += 1;
      let str = "";
      let escape = false;
      let ended = false;
      while (i < after.length) {
        const ch = after[i];
        if (escape) {
          if (ch === "n") str += "\n";
          else if (ch === "t") str += "\t";
          else str += ch;
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === "\"") {
          ended = true;
          i += 1;
          break;
        } else {
          str += ch;
        }
        i += 1;
      }
      if (str) out.push(str);
      if (!ended) break;
    }
    return out;
  }

  function parseStringMatrix(partial, fieldName) {
    const slice = extractField(partial, fieldName);
    if (!slice) return [];
    const arrStart = slice.indexOf("[");
    if (arrStart === -1) return [];
    const after = slice.slice(arrStart + 1);
    const rows = [];
    let i = 0;
    while (i < after.length) {
      while (i < after.length && /[\s,]/.test(after[i])) i += 1;
      if (i >= after.length || after[i] === "]") break;
      if (after[i] !== "[") break;
      // Inner array of strings — reuse parseStringArray on the substring
      // starting at this inner [.
      let depth = 0;
      let j = i;
      let inStr = false;
      let escape = false;
      let ended = false;
      for (; j < after.length; j += 1) {
        const ch = after[j];
        if (inStr) {
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === "\"") { inStr = false; }
          continue;
        }
        if (ch === "\"") { inStr = true; continue; }
        if (ch === "[") depth += 1;
        else if (ch === "]") {
          depth -= 1;
          if (depth === 0) { ended = true; j += 1; break; }
        }
      }
      const innerText = `"row":${after.slice(i, ended ? j : j)}`;
      const cells = parseStringArray(innerText, "row");
      if (cells.length > 0) rows.push(cells);
      if (!ended) break;
      i = j;
    }
    return rows;
  }
  function extractStringField(partial, fieldName) {
    if (!partial) return "";
    // Find `"<fieldName>"` followed by `:` then the opening quote.
    const re = new RegExp(`"${fieldName}"\\s*:\\s*"`);
    const match = re.exec(partial);
    if (!match) return "";
    let i = match.index + match[0].length;
    let out = "";
    let escape = false;
    while (i < partial.length) {
      const ch = partial[i];
      if (escape) {
        // Handle the common JSON escapes; ignore \uXXXX subtleties — close
        // enough for live preview, the final value comes from the parsed
        // tool arguments.
        if (ch === "n") out += "\n";
        else if (ch === "t") out += "\t";
        else if (ch === "r") out += "\r";
        else out += ch;
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        return out;
      } else {
        out += ch;
      }
      i += 1;
    }
    // String didn't terminate — partial mid-stream.
    return out;
  }

  // ── Expose ───────────────────────────────────────────────────────────
  window.livePreview = {
    isFileGenTool: (toolName) => FILE_GEN_TOOLS.has(toolName),
    openForTool,
    appendDelta,
    commit,
    close
  };
})();
