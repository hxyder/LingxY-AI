import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runImageOcr } from "./image_ocr.mjs";
import { extractScannedPdfWithOcr } from "./pdf_ocr.mjs";
import { extractPdfTablePreview } from "./pdf_table.mjs";
import { extractTextPdf, hasUsablePdfTextLayer, countPdfPagesFromBuffer } from "./pdf_text.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OOXML_EXTRACTOR_SCRIPT = path.join(__dirname, "extract-office-openxml.ps1");

const MIME_BY_EXTENSION = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/plain",
  ".mjs": "text/plain",
  ".cjs": "text/plain",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".jsx": "text/plain",
  ".py": "text/plain",
  ".java": "text/plain",
  ".cs": "text/plain",
  ".css": "text/plain",
  ".sql": "text/plain",
  ".ini": "text/plain",
  ".toml": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif"
};

const TEXT_BASED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/yaml",
  "application/xml",
  "text/html"
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "image/gif"
]);

const OFFICE_OPEN_XML_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

function asLatin1(buffer) {
  return Buffer.from(buffer).toString("latin1");
}

function countPdfPages(buffer) {
  return countPdfPagesFromBuffer(buffer);
}

export async function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const bytes = await readFile(filePath);

  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return "application/pdf";
  }

  if (bytes.subarray(0, 2).toString("latin1") === "PK" && [".docx", ".xlsx", ".pptx"].includes(extension)) {
    return MIME_BY_EXTENSION[extension];
  }

  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

async function readTextFile(filePath) {
  return readFile(filePath, "utf8");
}

function getOfficeExtractionFallback(filePath, mime) {
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return `[No extractable XLSX text found] ${path.basename(filePath)}`;
  }
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return `[No extractable PPTX text found] ${path.basename(filePath)}`;
  }
  return `[No extractable DOCX text found] ${path.basename(filePath)}`;
}

async function extractOfficeOpenXmlText(filePath, mime) {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        OOXML_EXTRACTOR_SCRIPT,
        "-TargetPath",
        filePath,
        "-Mime",
        mime
      ],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    );
    const extracted = stdout.trim();
    return extracted || getOfficeExtractionFallback(filePath, mime);
  } catch {
    return getOfficeExtractionFallback(filePath, mime);
  }
}

export async function extractFileContent(filePath) {
  const fileStat = await stat(filePath);
  const mime = await detectMimeType(filePath);

  if (TEXT_BASED_MIME_TYPES.has(mime)) {
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
    if (hasUsablePdfTextLayer(bytes)) {
      const extracted = await extractTextPdf(filePath);
      return {
        ...extracted,
        size: fileStat.size,
        table_preview: extractPdfTablePreview(extracted.text)
      };
    }

    return {
      ...(await extractScannedPdfWithOcr(filePath)),
      size: fileStat.size,
      page_count: countPdfPages(bytes)
    };
  }

  if (IMAGE_MIME_TYPES.has(mime)) {
    const ocrResult = await runImageOcr(filePath);
    return {
      path: filePath,
      size: fileStat.size,
      mime,
      extraction_mode: "image_ocr",
      text: ocrResult.ocr_text,
      ocr_engine: ocrResult.ocr_engine,
      ocr_confidence: ocrResult.ocr_confidence,
      ocr_low_confidence_regions: ocrResult.ocr_low_confidence_regions
    };
  }

  if (OFFICE_OPEN_XML_MIME_TYPES.has(mime)) {
    return {
      path: filePath,
      size: fileStat.size,
      mime,
      extraction_mode: "office_open_xml_text",
      text: await extractOfficeOpenXmlText(filePath, mime)
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
      extraction_mode: extracted.extraction_mode,
      ocr_engine: extracted.ocr_engine,
      ocr_confidence: extracted.ocr_confidence
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
