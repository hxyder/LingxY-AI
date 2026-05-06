// Preview window renderer (UCA-182 Phase 14).
//
// This script owns the dedicated preview BrowserWindow anchored to
// the right edge of the primary display. It listens for three IPC
// events:
//
//   uca:preview-window-init      { toolName, args }
//     — a previewable artifact tool has started and the window should
//       open in "streaming" mode.
//
//   uca:preview-window-delta     { toolName, partialJson }
//     — partial tool-args JSON; we pass it straight into the
//       renderer-side streaming helper (outline-only for binary
//       formats, content stream for text / markdown).
//
//   uca:preview-window-committed { toolName, success, artifactPath,
//                                  mime, observation }
//     — tool finished; render the final artefact via the
//       livePreviewClient registry.
//
// An "openForFile" shortcut (kind = "open-file") is accepted on
// preview-window-init so artifact buttons in overlay / console can
// open this window directly without going through a fake "tool" run.
//
// The window never paints its own top-level chrome via the OS — the
// title bar and close/pin buttons live inside the HTML. That keeps
// the window compact and consistent with the popup-card aesthetic.

(function initPreviewWindow() {
  const head = document.getElementById("pvHead");
  const title = document.getElementById("pvTitle");
  const sub = document.getElementById("pvSub");
  const status = document.getElementById("pvStatus");
  const body = document.getElementById("pvBody");
  const meta = document.getElementById("pvMeta");
  const closeBtn = document.getElementById("pvCloseBtn");
  const pinBtn = document.getElementById("pvPinBtn");

  const state = {
    toolName: "",
    toolPath: "",
    toolKind: "text",
    rawJson: "",
    pinned: false
  };

  const root = document.getElementById("pvRoot");
  function setStatus(s) {
    status.dataset.state = s;
    // Phase 17: top-of-body progress bar tracks the running state.
    if (root) root.dataset.streaming = (s === "running") ? "1" : "0";
  }
  function setTitle(t) { title.textContent = t || "预览"; }
  function setSub(s) { sub.textContent = s || ""; }
  function setMeta(m) { meta.textContent = m || ""; }

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
  function basename(p) { return (p || "").split(/[\\/]/).pop() || p; }
  function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  }

  // --- Init (tool start OR open-file shortcut) -----------------------
  function applyInit(payload = {}) {
    const { kind = "tool", toolName, args, filePath, mime } = payload;
    if (kind === "open-file") {
      state.toolName = "__open__";
      state.toolPath = filePath || "";
      state.toolKind = inferKind(filePath || "", "__open__");
      state.rawJson = "";
      setStatus("ok");
      setTitle(basename(filePath || "预览"));
      setSub("打开预览");
      setMeta("");
      body.innerHTML = `<div class="pv-loading">加载中…</div>`;
      renderFinal(filePath, mime);
      return;
    }
    // Tool start
    state.toolName = toolName || "";
    state.toolPath = (args && (args.path || args.filename)) || "";
    state.toolKind = inferKind(state.toolPath, state.toolName);
    state.rawJson = "";
    setStatus("running");
    setTitle(state.toolPath || `${toolName} 生成中…`);
    setSub(toolName || "");
    setMeta("0B · streaming");
    body.innerHTML = `<div class="pv-loading">正在生成…</div>`;
  }

  function applyDelta(payload = {}) {
    const { toolName, partialJson } = payload;
    if (!toolName || state.toolName !== toolName) return;
    state.rawJson = partialJson || "";

    if (!state.toolPath && window.livePreviewStreaming?.extractStringField) {
      const extract = window.livePreviewStreaming.extractStringField;
      const inferred = extract(state.rawJson, "path") || extract(state.rawJson, "filename");
      if (inferred) {
        state.toolPath = inferred;
        state.toolKind = inferKind(inferred, toolName);
        setTitle(inferred);
      }
    }
    setMeta(`${formatBytes(state.rawJson.length)} · streaming`);
    window.livePreviewStreaming?.renderDelta(body, {
      toolName,
      rawJson: state.rawJson,
      toolKind: state.toolKind,
      toolPath: state.toolPath
    });
  }

  function applyCommit(payload = {}) {
    const { toolName, success, artifactPath, mime, observation } = payload;
    if (!toolName || state.toolName !== toolName) return;
    setStatus(success === false ? "err" : "ok");
    if (success === false) {
      setMeta(observation ? `失败 · ${String(observation).slice(0, 80)}` : "失败");
      body.innerHTML = `<div class="lp-error">${escapeHtml(observation || "工具失败")}</div>`;
      return;
    }
    setMeta(artifactPath ? `已生成 · ${basename(artifactPath)}` : "已完成");
    if (artifactPath) {
      state.toolPath = artifactPath;
      setTitle(basename(artifactPath));
      renderFinal(artifactPath, mime);
    }
  }

  async function renderFinal(filePath, mime) {
    if (!filePath || !window.livePreviewClient?.render) {
      body.innerHTML = `<div class="pv-empty">预览模块未加载。</div>`;
      return;
    }
    try {
      await window.livePreviewClient.render(body, {
        filePath,
        mime: mime ?? null,
        runtimeBaseUrl: window.__lingxyRuntimeBaseUrl
      });
    } catch (error) {
      body.innerHTML = `<div class="lp-error">预览失败：${escapeHtml(error?.message ?? error)}</div>`;
    }
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // --- Button wiring --------------------------------------------------
  closeBtn.addEventListener("click", () => {
    window.ucaShell?.closePreviewWindow?.();
  });
  pinBtn.addEventListener("click", () => {
    state.pinned = !state.pinned;
    pinBtn.style.background = state.pinned ? "var(--accent-soft, rgba(37,99,235,.14))" : "transparent";
    pinBtn.style.color = state.pinned ? "var(--accent-strong, #1d4ed8)" : "var(--muted)";
    window.ucaShell?.setPreviewWindowAlwaysOnTop?.(state.pinned);
  });

  // --- IPC wiring -----------------------------------------------------
  window.ucaShell?.onPreviewWindowInit?.(applyInit);
  window.ucaShell?.onPreviewWindowDelta?.(applyDelta);
  window.ucaShell?.onPreviewWindowCommitted?.(applyCommit);

  // Resolve the runtime base url for handlers that fetch /file/pdf etc.
  // The URL query string carries ?serviceBaseUrl=... when the window
  // is created; fall back to the default.
  try {
    const q = new URLSearchParams(window.location.search);
    const base = q.get("serviceBaseUrl");
    if (base) window.__lingxyRuntimeBaseUrl = base;
  } catch { /* ignore */ }
})();
