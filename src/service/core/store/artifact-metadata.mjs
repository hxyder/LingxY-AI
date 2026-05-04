import path from "node:path";

const KIND_BY_EXTENSION = new Map([
  [".pdf", "pdf"],
  [".doc", "document"],
  [".docx", "document"],
  [".odt", "document"],
  [".rtf", "document"],
  [".xls", "spreadsheet"],
  [".xlsx", "spreadsheet"],
  [".csv", "data"],
  [".ppt", "presentation"],
  [".pptx", "presentation"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".html", "html"],
  [".htm", "html"],
  [".svg", "svg"],
  [".json", "data"],
  [".jsonl", "data"],
  [".txt", "text"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".bmp", "image"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".mp4", "video"],
  [".mov", "video"],
  [".webm", "video"]
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php",
  ".sh", ".ps1", ".bat", ".sql", ".yaml", ".yml", ".toml", ".ini", ".xml"
]);

const KNOWN_SOURCES = new Set(["generated", "edited", "uploaded", "referenced", "imported", "external", "system", "unknown"]);
const KNOWN_STATUSES = new Set(["available", "missing", "pending", "failed", "deleted", "unknown"]);

function normalizedText(value, fallback) {
  const text = `${value ?? ""}`.trim().toLowerCase();
  return text || fallback;
}

function normalizeBytes(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : null;
}

function normalizeSha256(value) {
  const text = `${value ?? ""}`.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : null;
}

export function inferArtifactKind({ path: artifactPath = "", mime_type = "", mimeType = "" } = {}) {
  const mime = normalizedText(mime_type || mimeType, "");
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("word") || mime.includes("opendocument.text") || mime === "application/rtf") return "document";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("html")) return "html";
  if (mime.includes("svg")) return "svg";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("json")) return "data";
  if (mime.startsWith("text/")) return "text";

  const ext = path.extname(`${artifactPath ?? ""}`).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return KIND_BY_EXTENSION.get(ext) ?? "file";
}

export function normalizeArtifactMetadata(artifact = {}) {
  const inferredKind = inferArtifactKind(artifact);
  const kind = normalizedText(artifact.kind, inferredKind);
  const source = normalizedText(artifact.source, "generated");
  const status = normalizedText(artifact.status, "available");
  return {
    kind,
    source: KNOWN_SOURCES.has(source) ? source : "unknown",
    bytes: normalizeBytes(artifact.bytes),
    sha256: normalizeSha256(artifact.sha256),
    status: KNOWN_STATUSES.has(status) ? status : "unknown"
  };
}
