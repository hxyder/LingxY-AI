const READABLE_TEXT_SCOPES = new Set([
  "captured_page_text",
  "fetched_page_text",
  "selected_text",
  "single_file_text",
  "ocr_text"
]);

const READABLE_TEXT_KINDS = new Set([
  "browser_page_text",
  "browser_prefetch_text",
  "browser_text_selection",
  "local_file_text",
  "local_image_text",
  "image_ocr_text",
  "screenshot_ocr_text",
  "office_selection_text"
]);

const BROWSER_PAGE_SOURCE_TYPES = new Set(["webpage", "page_explanation"]);
const LOCAL_SOURCE_SCOPES = new Set(["browser_page", "current_context", "selection", "uploaded_files"]);

function contentEvidenceEntries(contextPacket = {}) {
  const metadata = contextPacket?.selection_metadata;
  return Array.isArray(metadata?.content_evidence) ? metadata.content_evidence : [];
}

export function hasReadableTextEvidence(entries = []) {
  return (Array.isArray(entries) ? entries : []).some((entry) =>
    entry?.content_extracted === true
    && entry?.status !== "failed"
    && (
      READABLE_TEXT_SCOPES.has(String(entry.coverage_scope ?? ""))
      || READABLE_TEXT_KINDS.has(String(entry.source_kind ?? ""))
    )
  );
}

export function hasImagePixelEvidence(entries = []) {
  return (Array.isArray(entries) ? entries : []).some((entry) =>
    entry?.pixels_available === true
    && entry?.status !== "failed"
    && String(entry.coverage_scope ?? "") === "image_pixels_available"
  );
}

function taskTargetsLocalSource(taskSpec = {}) {
  const sourceScope = String(taskSpec?.contract?.source_scope ?? "").trim();
  if (LOCAL_SOURCE_SCOPES.has(sourceScope)) return true;
  const groups = Array.isArray(taskSpec?.success_contract?.required_policy_groups)
    ? taskSpec.success_contract.required_policy_groups
    : [];
  return groups.includes("local_file_text_read");
}

function browserPageViolation(contextPacket = {}) {
  return {
    kind: "browser_page_content_required",
    message: "I could not read the current page content. I only have page metadata, so please retry page capture, use the browser page action, paste the page text, or explicitly allow screenshot/vision fallback.",
    source_type: contextPacket.source_type ?? null
  };
}

function officeSelectionViolation(contextPacket = {}) {
  return {
    kind: "office_selection_content_required",
    message: "I could not read any Office document text from the current selection. Please select text, use the document/file entry, or retry the Office capture.",
    source_type: contextPacket.source_type ?? null
  };
}

function fileContextViolation(contextPacket = {}) {
  return {
    kind: "file_content_required",
    message: "The attached file context does not contain readable text. A directory listing, metadata, or unavailable OCR result is not enough for document analysis.",
    source_type: contextPacket.source_type ?? null
  };
}

export function validateContentEvidenceGate({
  taskSpec = null,
  contextPacket = null,
  mode = "pre_execution",
  allowImagePixels = false,
  requireReadableText = false
} = {}) {
  const entries = contentEvidenceEntries(contextPacket);
  if (entries.length === 0) return { ok: true, violations: [] };
  const hasText = hasReadableTextEvidence(entries);
  const hasPixels = hasImagePixelEvidence(entries);
  if (hasText || (allowImagePixels && hasPixels)) return { ok: true, violations: [] };

  const violations = [];
  const sourceType = String(contextPacket?.source_type ?? "");
  if (BROWSER_PAGE_SOURCE_TYPES.has(sourceType) && (requireReadableText || taskTargetsLocalSource(taskSpec))) {
    violations.push(browserPageViolation(contextPacket));
  }
  if (sourceType === "office_selection" && (requireReadableText || taskTargetsLocalSource(taskSpec))) {
    violations.push(officeSelectionViolation(contextPacket));
  }
  if (mode === "inline_context_only"
      && ["file", "file_group"].includes(sourceType)
      && taskTargetsLocalSource(taskSpec)) {
    violations.push(fileContextViolation(contextPacket));
  }

  return { ok: violations.length === 0, violations };
}

export function firstContentEvidenceViolationMessage(result) {
  const first = Array.isArray(result?.violations) ? result.violations[0] : null;
  return first?.message ?? "The input evidence does not contain enough readable content for this task.";
}
