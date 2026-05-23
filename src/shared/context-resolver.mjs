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

function buildFileSelectionDecision(selection = null, {
  imageReason,
  fileReason
} = {}) {
  const paths = normalizePaths(selection?.filePaths);
  if (paths.length === 0) return null;
  const allImages = paths.every(isImageFilePath);
  return {
    kind: allImages ? "image_paths" : "file_paths",
    reason: allImages ? imageReason : fileReason,
    sourceApp: selection?.sourceApp,
    captureMode: selection?.captureMode,
    selectionMetadata: selection?.selectionMetadata,
    filePaths: paths
  };
}

export function resolveOverlayContextSubmission({
  explicitBrowserContextRequest = false,
  activeBrowserCapture = null,
  explicitWindowContextRequest = false,
  explicitFileContextRequest = false,
  activeFileSelection = null,
  activeWindowBrowserCapture = null,
  activeWindowFileSelection = null,
  activeWindowCapture = null,
  pendingFileSelection = null,
  pendingCapture = null,
  seedCapture = null
} = {}) {
  const pendingFileDecision = buildFileSelectionDecision(pendingFileSelection, {
    imageReason: "pending_image_files",
    fileReason: "pending_files"
  });

  if (explicitBrowserContextRequest) {
    if (activeBrowserCapture) {
      return {
        kind: "capture",
        reason: "explicit_browser_context",
        capture: activeBrowserCapture
      };
    }
    const activeFilePaths = normalizePaths(activeFileSelection?.filePaths);
    if (activeFilePaths.length > 0) {
      const allImages = activeFilePaths.every(isImageFilePath);
      return {
        kind: allImages ? "image_paths" : "file_paths",
        reason: activeFileSelection?.sourceKind === "browser_file_url"
          ? "explicit_browser_file_url_context"
          : (activeFileSelection?.sourceKind === "active_window_screenshot"
              ? "explicit_browser_window_screenshot_context"
              : "explicit_browser_file_context"),
        sourceApp: activeFileSelection?.sourceApp,
        captureMode: activeFileSelection?.captureMode,
        selectionMetadata: activeFileSelection?.selectionMetadata,
        filePaths: activeFilePaths
      };
    }
    return {
      kind: "missing_explicit_browser_context",
      reason: "explicit_browser_context_unavailable",
      fallbackAllowed: false
    };
  }

  if (explicitWindowContextRequest) {
    if (pendingFileDecision) {
      return {
        ...pendingFileDecision,
        reason: pendingFileDecision.kind === "image_paths"
          ? "explicit_window_selected_image_context"
          : "explicit_window_selected_file_context"
      };
    }
    if (activeBrowserCapture) {
      return {
        kind: "capture",
        reason: "explicit_window_browser_context",
        capture: activeBrowserCapture
      };
    }
    const activeFilePaths = normalizePaths(activeFileSelection?.filePaths);
    if (activeFilePaths.length > 0) {
      const allImages = activeFilePaths.every(isImageFilePath);
      return {
        kind: allImages ? "image_paths" : "file_paths",
        reason: allImages ? "explicit_window_image_context" : "explicit_window_file_context",
        sourceApp: activeFileSelection?.sourceApp,
        captureMode: activeFileSelection?.captureMode,
        selectionMetadata: activeFileSelection?.selectionMetadata,
        filePaths: activeFilePaths
      };
    }
    if (activeWindowCapture) {
      return {
        kind: "capture",
        reason: "explicit_window_text_context",
        capture: activeWindowCapture
      };
    }
    return {
      kind: "missing_explicit_window_context",
      reason: "explicit_window_context_unavailable",
      fallbackAllowed: false
    };
  }

  if (explicitFileContextRequest && pendingFileDecision) {
    return {
      ...pendingFileDecision,
      reason: pendingFileDecision.kind === "image_paths"
        ? "explicit_selected_image_context"
        : "explicit_selected_file_context"
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
      selectionMetadata: activeFileSelection?.selectionMetadata,
      filePaths: activeFilePaths
    };
  }

  if (pendingFileDecision) {
    return pendingFileDecision;
  }

  if (explicitFileContextRequest && activeWindowCapture) {
    return {
      kind: "capture",
      reason: "explicit_file_text_context",
      capture: activeWindowCapture
    };
  }

  if (explicitFileContextRequest) {
    return {
      kind: "missing_explicit_file_context",
      reason: "explicit_file_context_unavailable",
      fallbackAllowed: false
    };
  }

  if (pendingCapture?.capture) {
    return {
      kind: "capture",
      reason: "pending_capture",
      capture: pendingCapture.capture
    };
  }

  if (activeWindowBrowserCapture) {
    return {
      kind: "capture",
      reason: "pending_active_browser_window",
      capture: activeWindowBrowserCapture
    };
  }

  const activeWindowFilePaths = normalizePaths(activeWindowFileSelection?.filePaths);
  if (activeWindowFilePaths.length > 0) {
    const allImages = activeWindowFilePaths.every(isImageFilePath);
    return {
      kind: allImages ? "image_paths" : "file_paths",
      reason: allImages ? "pending_active_window_image" : "pending_active_window_file",
      sourceApp: activeWindowFileSelection?.sourceApp,
      captureMode: activeWindowFileSelection?.captureMode,
      selectionMetadata: activeWindowFileSelection?.selectionMetadata,
      filePaths: activeWindowFilePaths
    };
  }

  if (activeWindowCapture) {
    return {
      kind: "capture",
      reason: "pending_active_window_text",
      capture: activeWindowCapture
    };
  }

  if (seedCapture) {
    return {
      kind: "capture",
      reason: "seed_capture",
      capture: seedCapture
    };
  }

  return {
    kind: "empty",
    reason: "no_context"
  };
}
