(function initPreviewRuntimeClient() {
  if (window.previewRuntimeClient) return;

  function createPreviewRuntimeClient({
    fetchFn = globalThis.fetch?.bind(globalThis)
  } = {}) {
    if (typeof fetchFn !== "function") {
      throw new TypeError("createPreviewRuntimeClient requires fetchFn.");
    }

    async function renderPreviewHtml({ filePath, runtimeBaseUrl } = {}) {
      const baseUrl = runtimeBaseUrl
        || window.__lingxyRuntimeBaseUrl
        || "http://127.0.0.1:4310";
      const url = `${baseUrl}/file/render-preview-html?path=${encodeURIComponent(filePath)}`;
      const response = await fetchFn(url);
      return { baseUrl, response };
    }

    return { renderPreviewHtml };
  }

  window.createPreviewRuntimeClient = createPreviewRuntimeClient;
  window.previewRuntimeClient = createPreviewRuntimeClient();
})();
