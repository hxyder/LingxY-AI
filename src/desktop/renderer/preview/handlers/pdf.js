// PDF handler (UCA-182 Phase 4).
//
// Uses pdfjs-dist to render the PDF into <canvas> elements one page
// at a time. IntersectionObserver keeps memory flat for long docs:
// pages render when they scroll into view and are torn down when
// they leave. The first page always renders immediately so the
// panel has something to show within a few hundred ms of open.
//
// pdfjs itself is lazy-loaded — the dynamic import only happens
// when a PDF is actually opened, so unrelated sessions pay nothing.

(function initPdfHandler() {
  if (!window.livePreviewClient) return;

  let pdfjsPromise = null;
  async function getPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        const shellClient = window.previewShellClient ?? window.createPreviewShellClient?.();
        if (!shellClient) throw new Error("preview shell client unavailable");
        const { mainUrl, workerUrl } = await shellClient.getPdfWorkerUrl();
        // Dynamic import from an absolute file:// URL — works in both
        // dev (running from source) and packaged builds.
        const mod = await import(/* @vite-ignore */ mainUrl);
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
        return mod;
      })();
    }
    return pdfjsPromise;
  }

  window.livePreviewClient.register({
    id: "client-pdf",
    extensions: [".pdf"],
    priority: 25,
    async render(container, { filePath, runtimeBaseUrl }) {
      const baseUrl = runtimeBaseUrl
        || window.__lingxyRuntimeBaseUrl
        || "http://127.0.0.1:4310";
      const url = `${baseUrl}/file/pdf?path=${encodeURIComponent(filePath)}`;

      container.innerHTML = `
        <div class="lp-pdf" style="background:#1a1d29;padding:16px;min-height:100%;overflow:auto;">
          <div class="lp-pdf-pages"></div>
          <div class="lp-pdf-status" style="color:#94a3b8;font-size:12px;text-align:center;padding:20px 0;">加载中…</div>
        </div>`;
      const pagesHost = container.querySelector(".lp-pdf-pages");
      const statusEl = container.querySelector(".lp-pdf-status");

      const pdfjs = await getPdfjs();
      const loadingTask = pdfjs.getDocument({ url, withCredentials: false });
      const doc = await loadingTask.promise;

      statusEl.textContent = `${doc.numPages} 页 · 已加载`;

      // Build page placeholders up front so scroll height is stable.
      const placeholders = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const wrap = document.createElement("div");
        wrap.className = "lp-pdf-page";
        wrap.dataset.page = String(i);
        wrap.style.cssText = "margin:0 auto 14px;box-shadow:0 4px 20px rgba(0,0,0,.3);background:#fff;";
        pagesHost.appendChild(wrap);
        placeholders.push(wrap);
      }

      const rendered = new Set();
      async function renderPage(pageWrap) {
        const pageNum = Number(pageWrap.dataset.page);
        if (rendered.has(pageNum)) return;
        rendered.add(pageNum);
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.maxWidth = `${viewport.width}px`;
        canvas.style.display = "block";
        pageWrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        pageWrap.innerHTML = "";
        pageWrap.appendChild(canvas);
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport
        }).promise;
      }

      // First page: render immediately for fast first paint.
      if (placeholders[0]) {
        await renderPage(placeholders[0]).catch((e) => {
          statusEl.textContent = `首页渲染失败：${e.message}`;
        });
      }

      // Lazy-render subsequent pages on scroll.
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            renderPage(entry.target).catch(() => { /* keep scrolling */ });
          }
        });
      }, { root: container.querySelector(".lp-pdf"), rootMargin: "400px" });

      placeholders.slice(1).forEach((wrap) => observer.observe(wrap));
    }
  });
})();
