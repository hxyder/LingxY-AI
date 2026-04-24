// Image handler (UCA-182 Phase 3).
//
// Reads the file as a data URL via the preload bridge and drops it
// into an <img>. Saves a server roundtrip and lets the renderer's
// caching layer keep the blob around once the user switches away.

(function initImageHandler() {
  if (!window.livePreviewClient) return;

  const MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml"
  };

  window.livePreviewClient.register({
    id: "client-image",
    extensions: Object.keys(MIME_BY_EXT),
    priority: 20,
    async render(container, { filePath }) {
      if (!window.ucaShell?.readFileAsDataUrl) {
        throw new Error("ucaShell.readFileAsDataUrl 未挂载");
      }
      const ext = "." + (filePath.split(".").pop() || "").toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
      const dataUrl = await window.ucaShell.readFileAsDataUrl(filePath, mime);
      container.innerHTML = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = filePath;
      img.className = "lp-image";
      container.appendChild(img);
    }
  });
})();
