const ATTACH_THUMB_PLACEHOLDER = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="9" r="1.5"/>
    <path d="m21 15-5-5L5 21"/>
  </svg>
`;

export function createConsoleChatAttachmentsController({
  attachButton,
  attachInput,
  attachmentsEl,
  dropShell,
  dropZone,
  shell = null,
  documentRef = document,
  escapeHtml,
  isImagePath,
  imageMimeFor
} = {}) {
  const attachments = [];
  const thumbnailCache = new Map();

  async function loadAttachmentThumbnail(filePath) {
    if (!filePath || thumbnailCache.has(filePath)) {
      return thumbnailCache.get(filePath) ?? null;
    }
    if (!isImagePath(filePath) || !shell?.readFileAsDataUrl) return null;
    thumbnailCache.set(filePath, null);
    try {
      const dataUrl = await shell.readFileAsDataUrl(filePath, imageMimeFor(filePath));
      thumbnailCache.set(filePath, dataUrl);
      return dataUrl;
    } catch (error) {
      console.warn("[attach-thumb] readFileAsDataUrl failed", filePath, error?.message ?? error);
      return null;
    }
  }

  function addFiles(files = [], resolvedPaths = []) {
    for (const [index, file] of Array.from(files).entries()) {
      attachments.push({
        name: file.name,
        path: resolvedPaths[index] || file.path || ""
      });
    }
    render();
  }

  function render() {
    if (!attachmentsEl) return;
    if (attachments.length === 0) {
      attachmentsEl.hidden = true;
      attachmentsEl.innerHTML = "";
      return;
    }
    attachmentsEl.hidden = false;
    attachmentsEl.innerHTML = attachments.map((entry, idx) => {
      const filePath = entry?.path ?? "";
      const isImage = isImagePath(filePath);
      const cached = isImage ? thumbnailCache.get(filePath) : null;
      if (isImage) {
        const thumbInner = cached
          ? `<img src="${escapeHtml(cached)}" alt="">`
          : ATTACH_THUMB_PLACEHOLDER;
        return `
          <span class="chip-attach chip-attach--image" data-path="${escapeHtml(filePath)}">
            <span class="chip-attach-thumb">${thumbInner}</span>
            <span class="chip-attach-name">${escapeHtml(entry?.name ?? "")}</span>
            <button type="button" data-remove-attach="${idx}" aria-label="Remove">&times;</button>
          </span>
        `;
      }
      return `
        <span class="chip-attach">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span>${escapeHtml(entry?.name ?? "")}</span>
          <button type="button" data-remove-attach="${idx}" aria-label="Remove">&times;</button>
        </span>
      `;
    }).join("");
    for (const btn of attachmentsEl.querySelectorAll("[data-remove-attach]")) {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.removeAttach);
        if (Number.isInteger(idx)) {
          attachments.splice(idx, 1);
          render();
        }
      });
    }
    for (const chip of attachmentsEl.querySelectorAll(".chip-attach--image")) {
      const filePath = chip.dataset.path;
      if (!filePath || chip.querySelector("img")) continue;
      void loadAttachmentThumbnail(filePath).then((dataUrl) => {
        if (!dataUrl) return;
        const thumb = chip.querySelector(".chip-attach-thumb");
        if (!thumb || thumb.querySelector("img")) return;
        thumb.innerHTML = "";
        const img = documentRef.createElement("img");
        img.src = dataUrl;
        img.alt = "";
        thumb.appendChild(img);
      });
    }
  }

  function clear() {
    attachments.length = 0;
    render();
  }

  function getFilePaths() {
    return attachments.map((entry) => `${entry?.path ?? ""}`.trim()).filter(Boolean);
  }

  attachButton?.addEventListener("click", () => {
    attachInput?.click();
  });
  attachInput?.addEventListener("change", () => {
    const files = Array.from(attachInput.files ?? []);
    const resolvedPaths = shell?.resolveDroppedFilePaths?.(files) ?? [];
    addFiles(files, resolvedPaths);
    attachInput.value = "";
  });

  if (dropShell && dropZone) {
    const hasFilePayload = (event) => {
      const types = event.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i += 1) if (types[i] === "Files") return true;
      return false;
    };
    let counter = 0;
    dropShell.addEventListener("dragenter", (event) => {
      if (!hasFilePayload(event)) return;
      counter += 1;
      dropZone.hidden = false;
    });
    dropShell.addEventListener("dragleave", (event) => {
      if (!hasFilePayload(event)) return;
      counter -= 1;
      if (counter <= 0) { counter = 0; dropZone.hidden = true; }
    });
    dropShell.addEventListener("dragover", (event) => {
      if (hasFilePayload(event)) event.preventDefault();
    });
    dropShell.addEventListener("drop", (event) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      event.stopPropagation();
      counter = 0;
      dropZone.hidden = true;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      const paths = shell?.resolveDroppedFilePaths?.(files) ?? [];
      addFiles(files, paths);
    });
  }

  return {
    addFiles,
    clear,
    getFilePaths,
    render
  };
}
