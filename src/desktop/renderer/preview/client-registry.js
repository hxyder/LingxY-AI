// Renderer-side preview client registry (UCA-182 Phase 3).
//
// Mirrors the server-side src/service/preview/registry.mjs in shape,
// but the registered handlers paint DOM instead of returning HTML
// strings. Each format's handler file (handlers/*.js) registers
// itself into this table at load time; live-preview.js then calls
// `window.livePreviewClient.render(container, { filePath, mime })`
// with zero knowledge of specific formats.
//
// Handlers receive:
//   container — the <div> that should contain the preview
//   opts.filePath  — absolute path (server or local)
//   opts.mime      — best-effort mime type (may be null)
//   opts.runtimeBaseUrl — where /file/* endpoints live
//
// Handlers are async and return a Promise. On failure they should
// render a placeholder inside container and resolve normally — the
// caller does not introspect errors.
//
// Priority: same convention as the server registry. Higher wins.

(function initPreviewClientRegistry() {
  const handlers = [];

  function register(handler) {
    if (!handler || typeof handler.render !== "function") return;
    handlers.push(handler);
    handlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  function extOf(filePath) {
    const match = /\.([a-z0-9]{1,8})$/i.exec(filePath || "");
    return match ? ("." + match[1].toLowerCase()) : "";
  }

  function resolve(filePath, mime) {
    const ext = extOf(filePath);
    const ctx = { ext, mime: mime || null, filePath };
    for (const h of handlers) {
      const match = typeof h.canHandle === "function"
        ? h.canHandle(ctx)
        : (h.extensions?.includes(ext) || h.mimePrefixes?.some((p) => (mime || "").startsWith(p)));
      if (match) return h;
    }
    return null;
  }

  async function render(container, opts = {}) {
    if (!container) return;
    const handler = resolve(opts.filePath, opts.mime);
    if (!handler) {
      renderNativeOpenFallback(container, opts.filePath);
      return;
    }
    try {
      await handler.render(container, opts);
    } catch (error) {
      renderErrorFallback(container, opts.filePath, error);
    }
  }

  function list() {
    return handlers.map((h) => ({
      id: h.id,
      extensions: h.extensions ?? [],
      priority: h.priority ?? 0
    }));
  }

  function renderNativeOpenFallback(container, filePath) {
    const name = (filePath || "").split(/[\\/]/).pop() || "文件";
    container.innerHTML = `
      <div class="lp-placeholder">
        <div class="lp-placeholder-title">${escapeHtml(name)}</div>
        <div class="lp-placeholder-sub">该文件类型暂无内置预览。使用外部应用打开。</div>
      </div>`;
  }

  function renderErrorFallback(container, filePath, error) {
    const name = (filePath || "").split(/[\\/]/).pop() || "文件";
    container.innerHTML = `
      <div class="lp-placeholder">
        <div class="lp-placeholder-title">${escapeHtml(name)}</div>
        <div class="lp-placeholder-sub">预览失败：${escapeHtml(error?.message || "未知错误")}</div>
        <div class="lp-placeholder-bytes">点击右上角的 ↗ 用系统应用打开</div>
      </div>`;
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  window.livePreviewClient = {
    register,
    resolve,
    render,
    list,
    extOf,
    _helpers: { escapeHtml }
  };
})();
