import path from "node:path";

function cleanString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function charLength(value) {
  const text = typeof value === "string" ? value : "";
  return text.trim() ? text.length : null;
}

function basename(value) {
  const text = cleanString(value);
  if (!text) return null;
  try {
    return path.basename(text);
  } catch {
    return text;
  }
}

function mimeModality(mime = "") {
  const normalized = String(mime ?? "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  return "text";
}

function hasMeaningfulText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasBrowserPageContent(capture = {}) {
  if (capture.sourceType !== "webpage" && capture.sourceType !== "page_explanation") return false;
  return capture.metadata?.hasPageContent === true
    || hasMeaningfulText(capture.text)
    || hasMeaningfulText(capture.html);
}

function fileTextExtracted(metadata = {}) {
  const mode = cleanString(metadata.extraction_mode);
  if (!mode) return false;
  return !new Set([
    "directory_listing",
    "pdf_ocr_unavailable",
    "unsupported_binary"
  ]).has(mode);
}

export function makeContentEvidence({
  source_kind,
  coverage_scope,
  locator = null,
  title = null,
  modality = "text",
  content_extracted = false,
  extraction_mode = null,
  char_length = null,
  byte_length = null,
  item_count = null,
  status = "available",
  error = null,
  pixels_available = false
} = {}) {
  const cleanKind = cleanString(source_kind);
  const cleanScope = cleanString(coverage_scope);
  if (!cleanKind || !cleanScope) return null;
  return {
    schema_version: "1.0",
    source_kind: cleanKind,
    coverage_scope: cleanScope,
    content_extracted: content_extracted === true,
    status: cleanString(status) ?? "available",
    modality: cleanString(modality) ?? "text",
    ...(cleanString(locator) ? { locator: cleanString(locator) } : {}),
    ...(cleanString(title) ? { title: cleanString(title) } : {}),
    ...(cleanString(extraction_mode) ? { extraction_mode: cleanString(extraction_mode) } : {}),
    ...(cleanNumber(char_length) !== null ? { char_length: cleanNumber(char_length) } : {}),
    ...(cleanNumber(byte_length) !== null ? { byte_length: cleanNumber(byte_length) } : {}),
    ...(cleanNumber(item_count) !== null ? { item_count: cleanNumber(item_count) } : {}),
    ...(pixels_available === true ? { pixels_available: true } : {}),
    ...(cleanString(error) ? { error: cleanString(error) } : {})
  };
}

function evidenceRank(entry) {
  if (!entry || typeof entry !== "object") return 0;
  let rank = entry.status === "failed" ? 1 : 2;
  if (entry.content_extracted === true) rank += 2;
  return rank;
}

export function mergeContentEvidence(existing = [], additions = []) {
  const merged = new Map();
  for (const entry of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = makeContentEvidence(entry);
    if (!normalized) continue;
    const key = [
      normalized.source_kind,
      normalized.coverage_scope,
      normalized.locator ?? "",
      normalized.extraction_mode ?? ""
    ].join("|");
    const previous = merged.get(key);
    if (!previous || evidenceRank(normalized) >= evidenceRank(previous)) {
      merged.set(key, normalized);
    }
  }
  return [...merged.values()];
}

export function withContentEvidence(selectionMetadata = {}, additions = []) {
  const metadata = selectionMetadata && typeof selectionMetadata === "object" ? selectionMetadata : {};
  return {
    ...metadata,
    content_evidence: mergeContentEvidence(metadata.content_evidence, additions)
  };
}

export function browserContentEvidenceFromCapture(capture = {}) {
  const textLength = charLength(capture.text) ?? charLength(capture.html);
  if (capture.sourceType === "text_selection") {
    return [
      makeContentEvidence({
        source_kind: "browser_text_selection",
        coverage_scope: "selected_text",
        locator: capture.url,
        title: capture.pageTitle,
        content_extracted: hasMeaningfulText(capture.selectionText ?? capture.text),
        extraction_mode: "browser_selection",
        char_length: charLength(capture.selectionText ?? capture.text)
      })
    ].filter(Boolean);
  }

  if (capture.sourceType === "page_explanation") {
    return [
      makeContentEvidence({
        source_kind: "browser_page_text",
        coverage_scope: "captured_page_text",
        locator: capture.url,
        title: capture.pageTitle,
        content_extracted: hasMeaningfulText(capture.text) || hasMeaningfulText(capture.html),
        extraction_mode: "extension_page_explanation",
        char_length: textLength
      })
    ].filter(Boolean);
  }

  if (capture.sourceType === "webpage") {
    const hasContent = hasBrowserPageContent(capture);
    return [
      makeContentEvidence({
        source_kind: hasContent ? "browser_page_text" : "browser_page_metadata",
        coverage_scope: hasContent ? "captured_page_text" : "url_title_only",
        locator: capture.url,
        title: capture.pageTitle,
        content_extracted: hasContent,
        extraction_mode: hasContent ? "extension_capture" : "browser_metadata",
        char_length: hasContent ? textLength : null
      })
    ].filter(Boolean);
  }

  if (capture.sourceType === "link") {
    return [
      makeContentEvidence({
        source_kind: "browser_link_metadata",
        coverage_scope: "link_reference_only",
        locator: capture.url,
        title: capture.anchorText ?? capture.pageTitle,
        content_extracted: false,
        extraction_mode: "browser_metadata"
      })
    ].filter(Boolean);
  }

  if (capture.sourceType === "image") {
    return [
      makeContentEvidence({
        source_kind: "browser_image_reference",
        coverage_scope: "image_url_reference",
        locator: capture.imageUrl ?? capture.url,
        title: capture.pageTitle,
        modality: "image",
        content_extracted: false,
        extraction_mode: "browser_metadata"
      })
    ].filter(Boolean);
  }

  return [];
}

export function browserPrefetchContentEvidence({ capture = {}, contextPacket = {}, ok = false, error = null } = {}) {
  return [
    makeContentEvidence({
      source_kind: ok ? "browser_prefetch_text" : "browser_prefetch_failed",
      coverage_scope: ok ? "fetched_page_text" : "url_title_only",
      locator: capture.url ?? contextPacket.url,
      title: capture.pageTitle ?? contextPacket.selection_metadata?.page_title,
      content_extracted: ok,
      extraction_mode: "service_fetch",
      char_length: ok ? charLength(contextPacket.text) : null,
      status: ok ? "available" : "failed",
      error: error?.message ?? error
    })
  ].filter(Boolean);
}

export function fileContentEvidenceFromContextPacket(contextPacket = {}) {
  const metadata = Array.isArray(contextPacket.file_metadata) ? contextPacket.file_metadata : [];
  return metadata.map((entry) => {
    const contentExtracted = fileTextExtracted(entry);
    const mode = cleanString(entry.extraction_mode);
    const mime = cleanString(entry.mime);
    const isDirectoryListing = mode === "directory_listing";
    const isImage = mime?.startsWith("image/") === true;
    return makeContentEvidence({
      source_kind: isDirectoryListing
        ? "local_directory_listing"
        : isImage
          ? "local_image_text"
          : contentExtracted
            ? "local_file_text"
            : "local_file_metadata",
      coverage_scope: isDirectoryListing
        ? "directory_listing_shallow"
        : contentExtracted
          ? "single_file_text"
          : "file_metadata",
      locator: entry.path,
      title: basename(entry.path),
      modality: isImage ? "image" : mimeModality(mime),
      content_extracted: contentExtracted,
      extraction_mode: mode,
      byte_length: entry.size,
      item_count: entry.page_count
    });
  }).filter(Boolean);
}

export function imageContentEvidenceFromContextPacket(contextPacket = {}) {
  const imagePaths = Array.isArray(contextPacket.image_paths) ? contextPacket.image_paths : [];
  const imageMetadata = contextPacket.image_metadata && typeof contextPacket.image_metadata === "object"
    ? contextPacket.image_metadata
    : {};
  const source = cleanString(imageMetadata.source ?? contextPacket.selection_metadata?.image_source);
  const pixelEntries = imagePaths.map((imagePath) => makeContentEvidence({
    source_kind: source === "screenshot" ? "screenshot_image" : "attached_image",
    coverage_scope: "image_pixels_available",
    locator: imagePath,
    title: basename(imagePath),
    modality: "image",
    content_extracted: false,
    extraction_mode: source === "screenshot" ? "screenshot_capture" : "image_attachment",
    pixels_available: true
  })).filter(Boolean);
  const ocrText = cleanString(imageMetadata.ocr_text ?? contextPacket.text);
  const ocrEntry = ocrText ? makeContentEvidence({
    source_kind: source === "screenshot" ? "screenshot_ocr_text" : "image_ocr_text",
    coverage_scope: "ocr_text",
    locator: imagePaths[0],
    title: basename(imagePaths[0]),
    modality: "text",
    content_extracted: true,
    extraction_mode: imageMetadata.ocr_engine ?? "image_ocr",
    char_length: ocrText.length
  }) : null;
  return [...pixelEntries, ocrEntry].filter(Boolean);
}

export function officeContentEvidenceFromCapture(capture = {}) {
  const text = capture.selectionText ?? capture.selectionMetadata?.selected_text ?? "";
  return [
    makeContentEvidence({
      source_kind: "office_selection_text",
      coverage_scope: "selected_text",
      locator: capture.documentPath,
      title: capture.documentName,
      content_extracted: hasMeaningfulText(text),
      extraction_mode: "office_selection",
      char_length: charLength(text)
    })
  ].filter(Boolean);
}
