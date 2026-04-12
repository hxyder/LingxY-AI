import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitFileTask } from "../src/service/core/file-submission.mjs";
import { submitImageTask } from "../src/service/core/image-submission.mjs";
import { submitScreenshotTask } from "../src/service/core/screenshot-submission.mjs";
import { buildFileContextPacket, extractFileContent } from "../src/service/extractors/file-ingest.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { buildScreenshotCaptureRequest } from "../src/helper/Screenshot/capture-contract.mjs";
import { DEFAULT_OCR_ENGINE } from "../src/service/extractors/pdf_ocr.mjs";
import { DEFAULT_IMAGE_OCR_ENGINE } from "../src/service/extractors/image_ocr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-pdf-ocr");
process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1";
const textPdf = path.join(runtimeDir, "sample-text-layer.pdf");
const scannedPdf = path.join(runtimeDir, "sample-scanned.pdf");
const screenshotPath = path.join(runtimeDir, "capture.png");
const mockCli = path.join(repoRoot, "tests", "fixtures", "mock-kimi-cli.mjs");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });

await writeFile(textPdf, `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 67 >>
stream
BT
/F1 12 Tf
72 120 Td
(Quarterly Revenue  2026  1200) Tj
ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`, "utf8");

await writeFile(scannedPdf, `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`, "utf8");

await writeFile(screenshotPath, "fake png bytes", "utf8");

const textExtract = await extractFileContent(textPdf);
assert.equal(textExtract.extraction_mode, "text_pdf");
assert.equal(textExtract.page_count, 1);
assert.match(textExtract.text, /Quarterly Revenue/);

const scannedExtract = await extractFileContent(scannedPdf);
assert.equal(["pdf_ocr", "pdf_ocr_unavailable"].includes(scannedExtract.extraction_mode), true);
if (scannedExtract.extraction_mode === "pdf_ocr_unavailable") {
  assert.equal(scannedExtract.ocr_engine, DEFAULT_OCR_ENGINE);
  assert.equal(scannedExtract.ocr_applied, false);
  assert.equal(scannedExtract.needs_pdf_ocr_engine, true);
} else {
  assert.equal(scannedExtract.ocr_applied, true);
  assert.match(scannedExtract.ocr_engine, /^pdftoppm\+/);
}

const imageExtract = await extractFileContent(screenshotPath);
assert.equal(imageExtract.extraction_mode, "image_ocr");
assert.equal([DEFAULT_IMAGE_OCR_ENGINE, "tesseract", "none"].includes(imageExtract.ocr_engine), true);

const filePacket = await buildFileContextPacket({
  filePaths: [textPdf, scannedPdf],
  traceId: "trace_pdf",
  contextId: "ctx_pdf",
  capturedAt: "2026-04-08T00:00:00.000Z"
});
assert.equal(filePacket.source_type, "file_group");
assert.equal(filePacket.file_metadata.length, 2);
assert.equal(filePacket.file_metadata[0].extraction_mode, "text_pdf");
assert.equal(["pdf_ocr", "pdf_ocr_unavailable"].includes(filePacket.file_metadata[1].extraction_mode), true);

const service = createServiceBootstrap();
service.runtime.artifactStore = {
  ...service.runtime.artifactStore,
  rootDir: runtimeDir
};
service.runtime.kimiRuntime = {
  command: process.execPath,
  args: [mockCli],
  env: process.env,
  maxRuntimeSeconds: 30
};

const textTask = await submitFileTask({
  filePaths: [textPdf],
  userCommand: "分析这些文件并生成详细报告",
  runtime: service.runtime
});
assert.equal(textTask.task.status, "success");
assert.equal(textTask.task.context_packet.file_metadata[0].extraction_mode, "text_pdf");

const scannedTask = await submitFileTask({
  filePaths: [scannedPdf],
  userCommand: "分析这些文件并生成详细报告",
  runtime: service.runtime
});
assert.equal(scannedTask.task.status, "success");
assert.equal(["pdf_ocr", "pdf_ocr_unavailable"].includes(scannedTask.task.context_packet.file_metadata[0].extraction_mode), true);

const imageTask = await submitImageTask({
  imagePaths: [screenshotPath],
  userCommand: "请分析这张截图",
  source: "clipboard",
  runtime: service.runtime
});
assert.equal(imageTask.task.status, "success");
assert.equal(imageTask.task.executor, "multi_modal");
assert.equal(imageTask.task.context_packet.source_type, "image");

const screenshotTask = await submitScreenshotTask({
  screenshotPath,
  runtime: service.runtime
});
assert.equal(screenshotTask.task.status, "success");
assert.equal(screenshotTask.task.context_packet.selection_metadata.image_source, "screenshot");

const screenshotRequest = buildScreenshotCaptureRequest({
  screenshotPath,
  width: 1920,
  height: 1080
});
assert.equal(screenshotRequest.action, "submit_screenshot");

console.log("PDF parsing, OCR, and screenshot verification passed.");
