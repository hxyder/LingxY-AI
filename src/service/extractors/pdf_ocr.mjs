import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { runImageOcr } from "./image_ocr.mjs";

export const DEFAULT_OCR_ENGINE = "none";
const execFileAsync = promisify(execFile);

function unavailableResult(filePath, engine, reason) {
  return {
    path: filePath,
    mime: "application/pdf",
    extraction_mode: "pdf_ocr_unavailable",
    text: "",
    page_count: undefined,
    ocr_applied: false,
    ocr_engine: engine,
    ocr_confidence: 0,
    ocr_low_confidence_regions: [],
    ocr_error: reason,
    needs_pdf_ocr_engine: true
  };
}

export async function extractScannedPdfWithOcr(filePath, { engine = DEFAULT_OCR_ENGINE } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-pdf-ocr-"));
  try {
    const prefix = path.join(tempDir, "page");
    await execFileAsync("pdftoppm", [
      "-png",
      "-r",
      "200",
      filePath,
      prefix
    ], {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024
    });

    const pageImages = (await readdir(tempDir))
      .filter((entry) => /^page-\d+\.png$/i.test(entry))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .map((entry) => path.join(tempDir, entry));

    if (pageImages.length === 0) {
      return unavailableResult(filePath, engine, "pdftoppm did not produce page images for OCR.");
    }

    const pageResults = [];
    for (const imagePath of pageImages) {
      pageResults.push(await runImageOcr(imagePath, { engine: "auto" }));
    }
    const text = pageResults
      .map((result) => result.ocr_text)
      .filter((value) => value && value.trim())
      .join("\n\n");
    const engines = [...new Set(pageResults.map((result) => result.ocr_engine).filter(Boolean))];
    const confidenceValues = pageResults
      .map((result) => Number(result.ocr_confidence))
      .filter((value) => Number.isFinite(value));
    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;

    return {
      path: filePath,
      mime: "application/pdf",
      extraction_mode: "pdf_ocr",
      text,
      page_count: pageImages.length,
      ocr_applied: true,
      ocr_engine: `pdftoppm+${engines.length > 0 ? engines.join("+") : "none"}`,
      ocr_confidence: averageConfidence,
      ocr_low_confidence_regions: []
    };
  } catch (error) {
    return unavailableResult(
      filePath,
      engine,
      `No text layer was found in ${path.basename(filePath)} and PDF raster OCR is unavailable: ${error.message}`
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
