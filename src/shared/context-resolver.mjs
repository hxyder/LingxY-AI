const IMAGE_FILE_EXTENSIONS = Object.freeze([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp"
]);

export function isImageFilePath(filePath = "") {
  const value = String(filePath ?? "").toLowerCase();
  return IMAGE_FILE_EXTENSIONS.some((ext) => value.endsWith(ext));
}

function normalizePaths(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

export function normalizeAttachmentSubmission({ filePaths = [], imagePaths = [] } = {}) {
  const files = normalizePaths(filePaths);
  const images = normalizePaths(imagePaths);
  if (files.length === 0 && images.length === 0) return {};
  if (files.length === 0) return { imagePaths: images, source: "file" };
  if (images.length === 0 && files.every(isImageFilePath)) {
    return { imagePaths: files, source: "file" };
  }
  return images.length > 0
    ? { filePaths: files, imagePaths: images, source: "file" }
    : { filePaths: files };
}

export function resolveOverlayContextSubmission({
  explicitBrowserContextRequest = false,
  activeBrowserCapture = null,
  explicitFileContextRequest = false,
  activeFileSelection = null,
  pendingFileSelection = null,
  pendingCapture = null,
  seedCapture = null
} = {}) {
  if (explicitBrowserContextRequest) {
    if (activeBrowserCapture) {
      return {
        kind: "capture",
        reason: "explicit_browser_context",
        capture: activeBrowserCapture
      };
    }
    return {
      kind: "missing_explicit_browser_context",
      reason: "explicit_browser_context_unavailable",
      fallbackAllowed: false
    };
  }

  const activeFilePaths = normalizePaths(activeFileSelection?.filePaths);
  if (activeFilePaths.length > 0) {
    const allImages = activeFilePaths.every(isImageFilePath);
    return {
      kind: allImages ? "image_paths" : "file_paths",
      reason: allImages ? "explicit_image_context" : "explicit_file_context",
      sourceApp: activeFileSelection?.sourceApp,
      captureMode: activeFileSelection?.captureMode,
      filePaths: activeFilePaths
    };
  }

  const pendingFilePaths = normalizePaths(pendingFileSelection?.filePaths);
  if (pendingFilePaths.length > 0) {
    const allImages = pendingFilePaths.every(isImageFilePath);
    return {
      kind: allImages ? "image_paths" : "file_paths",
      reason: allImages ? "pending_image_files" : "pending_files",
      sourceApp: pendingFileSelection?.sourceApp,
      captureMode: pendingFileSelection?.captureMode,
      filePaths: pendingFilePaths
    };
  }

  if (explicitFileContextRequest) {
    return {
      kind: "missing_explicit_file_context",
      reason: "explicit_file_context_unavailable",
      fallbackAllowed: false
    };
  }

  const capture = pendingCapture?.capture ?? seedCapture ?? null;
  if (capture) {
    return {
      kind: "capture",
      reason: pendingCapture?.capture ? "pending_capture" : "seed_capture",
      capture
    };
  }

  return {
    kind: "empty",
    reason: "no_context"
  };
}
