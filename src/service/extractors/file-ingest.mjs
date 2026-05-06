import { open, readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runImageOcr } from "./image_ocr.mjs";
import { extractScannedPdfWithOcr } from "./pdf_ocr.mjs";
import { extractPdfTablePreview } from "./pdf_table.mjs";
import {
  extractTextPdf,
  hasUsablePdfTextLayer,
  countPdfPagesFromBuffer,
  extractPdfTextViaPdftotext
} from "./pdf_text.mjs";

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

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "dist",
  "build",
  ".tmp"
]);
const MAX_EXPANDED_DIRECTORY_FILES = 200;
const DEFAULT_EXTRACTION_CONCURRENCY = 3;

function asLatin1(buffer) {
  return Buffer.from(buffer).toString("latin1");
}

function countPdfPages(buffer) {
  return countPdfPagesFromBuffer(buffer);
}

export async function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const handle = await open(filePath, "r");
  let bytes;
  try {
    bytes = Buffer.alloc(4);
    await handle.read(bytes, 0, bytes.length, 0);
  } finally {
    await handle.close();
  }

  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return "application/pdf";
  }

  if (bytes.subarray(0, 2).toString("latin1") === "PK" && [".docx", ".xlsx", ".pptx"].includes(extension)) {
    return MIME_BY_EXTENSION[extension];
  }

  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

async function expandInputPath(filePath, output, { maxFiles = MAX_EXPANDED_DIRECTORY_FILES } = {}) {
  if (output.length >= maxFiles) return;
  const info = await stat(filePath);
  if (!info.isDirectory()) {
    output.push(filePath);
    return;
  }

  const entries = await readdir(filePath, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= maxFiles) break;
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
    const childPath = path.join(filePath, entry.name);
    if (entry.isDirectory()) {
      await expandInputPath(childPath, output, { maxFiles });
    } else if (entry.isFile()) {
      output.push(childPath);
    }
  }
}

async function expandInputFilePaths(filePaths = []) {
  const output = [];
  for (const filePath of filePaths) {
    await expandInputPath(filePath, output);
    if (output.length >= MAX_EXPANDED_DIRECTORY_FILES) break;
  }
  return [...new Set(output)];
}

async function mapWithConcurrency(items = [], concurrency = DEFAULT_EXTRACTION_CONCURRENCY, worker) {
  const limit = Math.max(1, Math.min(Number(concurrency) || DEFAULT_EXTRACTION_CONCURRENCY, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
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
  if (fileStat.isDirectory()) {
    const entries = await readdir(filePath, { withFileTypes: true });
    const names = entries.slice(0, 80).map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
    return {
      path: filePath,
      size: 0,
      mime: "inode/directory",
      extraction_mode: "directory_listing",
      text: [`[Directory] ${filePath}`, ...names].join("\n")
    };
  }
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

    // Probe poppler's pdftotext FIRST — it handles FlateDecode-compressed
    // streams, font subsets, and ToUnicode CMaps that the naive Tj-regex
    // can't. Only fall through to the regex / OCR path when poppler isn't
    // installed or returns no meaningful content. This fixes the common
    // "PDF 内部正文是压缩/二进制流，无法可靠还原正文" case for modern
    // Word / Acrobat / Quartz PDF exports.
    const popplerText = await extractPdfTextViaPdftotext(filePath);
    const trimmedPoppler = popplerText?.replace(/\s+/g, " ").trim() ?? "";
    if (trimmedPoppler.length >= 60) {
      return {
        path: filePath,
        size: fileStat.size,
        mime,
        extraction_mode: "text_pdf_poppler",
        text: popplerText,
        page_count: countPdfPages(bytes),
        table_preview: extractPdfTablePreview(popplerText)
      };
    }

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
  capturedAt = new Date().toISOString(),
  extractFileContentImpl = extractFileContent,
  extractionConcurrency = DEFAULT_EXTRACTION_CONCURRENCY,
  onProgress = null
}) {
  onProgress?.({
    phase: "file_expand_started",
    input_count: Array.isArray(filePaths) ? filePaths.length : 0
  });
  const expandedFilePaths = await expandInputFilePaths(filePaths);
  onProgress?.({
    phase: "file_expand_finished",
    expanded_count: expandedFilePaths.length,
    input_count: Array.isArray(filePaths) ? filePaths.length : 0
  });

  // When the inputs are folders and expansion found real files, use those.
  // When expansion is empty (empty folder, or only ignored subdirs), fall
  // through to extracting a directory listing — BUT don't hand the folder
  // paths to downstream CLIs as file_paths, or they'll EISDIR trying to read
  // them as files.
  const expansionFoundFiles = expandedFilePaths.length > 0;
  const effectiveFilePaths = expansionFoundFiles ? expandedFilePaths : filePaths;
  const fileMetadata = [];
  const extractedTexts = [];

  const total = effectiveFilePaths.length;
  onProgress?.({
    phase: "file_ingest_started",
    total,
    expanded_count: expandedFilePaths.length,
    input_count: Array.isArray(filePaths) ? filePaths.length : 0
  });

  let completedCount = 0;
  const extractedFiles = await mapWithConcurrency(
    effectiveFilePaths,
    extractionConcurrency,
    async (filePath, index) => {
      const extracted = await extractFileContentImpl(filePath);
      completedCount += 1;
      onProgress?.({
        phase: "file_ingest_progress",
        path: extracted.path ?? filePath,
        index,
        completed: completedCount,
        total
      });
      return extracted;
    }
  );

  for (let index = 0; index < extractedFiles.length; index += 1) {
    const filePath = effectiveFilePaths[index];
    const extracted = extractedFiles[index];
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

  onProgress?.({
    phase: "file_ingest_finished",
    completed: total,
    total
  });

  // Paths CLIs should try to read as files (NOT directories). If expansion
  // yielded no files, pass an empty list — the directory listing lives in
  // the text field and downstream tools can work off that.
  const cliFilePaths = expansionFoundFiles ? expandedFilePaths : [];

  // Surface image files via image_paths so executor-resolver picks
  // multi_modal and provider-resolver picks the vision-routed provider.
  // Without this, an image dropped through file-submission (shell menu /
  // file picker) gets file_paths only, executor-resolver sees no image,
  // and the task ends up on the chat provider — bypassing the user's
  // configured Vision/Image model entirely.
  const imagePaths = cliFilePaths.filter((filePath, idx) => {
    const mime = fileMetadata[idx]?.mime ?? "";
    return typeof mime === "string" && mime.startsWith("image/");
  });

  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: effectiveFilePaths.length > 1 ? "file_group" : "file",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "user",
    redaction_applied: false,
    file_paths: cliFilePaths,
    original_file_paths: filePaths,
    file_metadata: fileMetadata,
    image_paths: imagePaths,
    text: extractedTexts.join("\n\n"),
    captured_at: capturedAt
  };
}
