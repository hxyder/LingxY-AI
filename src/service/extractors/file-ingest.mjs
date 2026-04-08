import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXTENSION = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

function asLatin1(buffer) {
  return Buffer.from(buffer).toString("latin1");
}

function countPdfPages(buffer) {
  const text = asLatin1(buffer);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? undefined;
}

export async function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const bytes = await readFile(filePath);

  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return "application/pdf";
  }

  if (bytes.subarray(0, 2).toString("latin1") === "PK" && extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

async function readTextFile(filePath) {
  return readFile(filePath, "utf8");
}

export async function extractFileContent(filePath) {
  const fileStat = await stat(filePath);
  const mime = await detectMimeType(filePath);

  if (mime === "text/plain" || mime === "text/markdown") {
    const text = await readTextFile(filePath);
    return {
      path: filePath,
      size: fileStat.size,
      mime,
      extraction_mode: "native_text",
      text
    };
  }

  if (mime === "application/pdf") {
    const bytes = await readFile(filePath);
    return {
      path: filePath,
      size: fileStat.size,
      mime,
      extraction_mode: "binary_placeholder",
      text: `[PDF placeholder extraction] ${path.basename(filePath)}`,
      page_count: countPdfPages(bytes)
    };
  }

  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return {
      path: filePath,
      size: fileStat.size,
      mime,
      extraction_mode: "binary_placeholder",
      text: `[DOCX placeholder extraction] ${path.basename(filePath)}`
    };
  }

  return {
    path: filePath,
    size: fileStat.size,
    mime,
    extraction_mode: "unsupported_binary",
    text: `[Unsupported binary file] ${path.basename(filePath)}`
  };
}

export async function buildFileContextPacket({
  filePaths,
  captureMode = "shell_menu",
  sourceApp = "explorer.exe",
  traceId,
  contextId,
  capturedAt = new Date().toISOString()
}) {
  const fileMetadata = [];
  const extractedTexts = [];

  for (const filePath of filePaths) {
    const extracted = await extractFileContent(filePath);
    fileMetadata.push({
      path: extracted.path,
      size: extracted.size,
      mime: extracted.mime,
      page_count: extracted.page_count,
      extraction_mode: extracted.extraction_mode
    });
    extractedTexts.push(`## ${path.basename(filePath)}\n${extracted.text}`);
  }

  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: filePaths.length > 1 ? "file_group" : "file",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "user",
    redaction_applied: false,
    file_paths: filePaths,
    file_metadata: fileMetadata,
    text: extractedTexts.join("\n\n"),
    captured_at: capturedAt
  };
}
