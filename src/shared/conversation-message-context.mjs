const MAX_TEXT_PREVIEW = 1200;
const MAX_PATHS = 12;

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function basenameOf(filePath = "") {
  return String(filePath ?? "").split(/[\\/]/).pop() || String(filePath ?? "");
}

function uniqStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

export function buildConversationMessageContextSummary(contextPacket = {}) {
  if (!contextPacket || typeof contextPacket !== "object") return null;
  const filePaths = uniqStrings(contextPacket.file_paths ?? contextPacket.filePaths ?? []).slice(0, MAX_PATHS);
  const imagePaths = uniqStrings(contextPacket.image_paths ?? contextPacket.imagePaths ?? []).slice(0, MAX_PATHS);
  const metadata = contextPacket.selection_metadata && typeof contextPacket.selection_metadata === "object"
    ? contextPacket.selection_metadata
    : {};
  const text = cleanText(contextPacket.text ?? metadata.selected_text ?? metadata.selection_text ?? "");
  const title = cleanText(contextPacket.title ?? metadata.page_title ?? metadata.title ?? "");
  const url = cleanText(contextPacket.url ?? metadata.url ?? "");
  const sourceType = cleanText(contextPacket.source_type ?? "");
  const sourceApp = cleanText(contextPacket.source_app ?? "");
  const captureMode = cleanText(contextPacket.capture_mode ?? "");

  const summary = {
    source_type: sourceType || null,
    source_app: sourceApp || null,
    capture_mode: captureMode || null,
    title: title || null,
    url: url || null,
    text_preview: text ? text.slice(0, MAX_TEXT_PREVIEW) : null,
    text_truncated: text.length > MAX_TEXT_PREVIEW,
    file_paths: filePaths,
    image_paths: imagePaths,
    file_count: Array.isArray(contextPacket.file_paths) ? contextPacket.file_paths.length : filePaths.length,
    image_count: Array.isArray(contextPacket.image_paths) ? contextPacket.image_paths.length : imagePaths.length
  };

  return hasConversationContextSummary(summary) ? summary : null;
}

export function getConversationContextSummary(message = {}) {
  const summary = message?.metadata?.context_summary;
  return summary && typeof summary === "object" && hasConversationContextSummary(summary) ? summary : null;
}

export function hasConversationContextSummary(summary = {}) {
  return Boolean(
    summary?.title
    || summary?.url
    || summary?.text_preview
    || (Array.isArray(summary?.file_paths) && summary.file_paths.length > 0)
    || (Array.isArray(summary?.image_paths) && summary.image_paths.length > 0)
  );
}

export function conversationContextChips(summary = {}) {
  if (!hasConversationContextSummary(summary)) return [];
  const chips = [];
  if (summary.source_type) chips.push({ label: summary.source_type });
  if (summary.title) chips.push({ label: summary.title });
  if (summary.url) {
    try {
      const hostname = new URL(summary.url).hostname.replace(/^www\./i, "");
      chips.push({ label: hostname || summary.url, title: summary.url, url: summary.url, kind: "url" });
    } catch {
      chips.push({ label: summary.url, title: summary.url, url: summary.url, kind: "url" });
    }
  }
  for (const filePath of summary.file_paths ?? []) {
    chips.push({ label: basenameOf(filePath), title: filePath, path: filePath, kind: "file" });
  }
  for (const imagePath of summary.image_paths ?? []) {
    chips.push({ label: basenameOf(imagePath), title: imagePath, path: imagePath, kind: "image" });
  }
  const fileExtra = Number(summary.file_count ?? 0) - Number(summary.file_paths?.length ?? 0);
  const imageExtra = Number(summary.image_count ?? 0) - Number(summary.image_paths?.length ?? 0);
  if (fileExtra > 0) chips.push({ label: `+${fileExtra} files` });
  if (imageExtra > 0) chips.push({ label: `+${imageExtra} images` });
  return chips.slice(0, 18);
}

export function conversationContextPreviewText(summary = {}) {
  if (!summary?.text_preview) return "";
  return `${summary.text_preview}${summary.text_truncated ? " ..." : ""}`;
}
