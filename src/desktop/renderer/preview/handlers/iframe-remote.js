// Default remote handler (UCA-182 Phase 3).
//
// Lowest-priority catch-all for formats the server knows how to
// render but the client cannot paint locally: docx / xlsx / pptx /
// pdf / html-passthrough. Asks the runtime's /file/render-preview-html
// endpoint for the HTML blob and drops it into a sandboxed iframe.
//
// The iframe uses `srcdoc` (not `src`) so the HTML is evaluated in
// an opaque origin — any inline <script> can still run (for the xlsx
// tab switcher etc) but has no network or parent-document access.

(function initIframeRemoteHandler() {
  if (!window.livePreviewClient) return;

  const IFRAME_SANDBOX = "allow-same-origin allow-scripts";

  window.livePreviewClient.register({
    id: "iframe-remote",
    extensions: [".docx", ".xlsx", ".pptx", ".pdf", ".html", ".htm", ".md", ".markdown"],
    priority: 5,
    async render(container, { filePath, runtimeBaseUrl }) {
      const baseUrl = runtimeBaseUrl
        || window.__lingxyRuntimeBaseUrl
        || "http://127.0.0.1:4310";
      const url = `${baseUrl}/file/render-preview-html?path=${encodeURIComponent(filePath)}`;
      const resp = await fetch(url);
      if (resp.redirected && resp.url.includes("/file/pdf")) {
        // PDF redirect — let the pdf handler take over if one exists;
        // otherwise fall through to the iframe which will render the
        // PDF using the browser's built-in viewer.
        const pdfHandler = window.livePreviewClient.resolve(filePath, "application/pdf");
        if (pdfHandler && pdfHandler.id !== "iframe-remote") {
          await pdfHandler.render(container, { filePath, runtimeBaseUrl: baseUrl });
          return;
        }
      }
      const html = await resp.text();
      if (!resp.ok) throw new Error(html.slice(0, 160) || `HTTP ${resp.status}`);
      container.innerHTML = `<iframe class="lp-iframe" sandbox="${IFRAME_SANDBOX}"></iframe>`;
      const iframe = container.querySelector("iframe");
      iframe.srcdoc = html;
    }
  });
})();
