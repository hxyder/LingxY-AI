import path from "node:path";

export const DEFAULT_OCR_ENGINE = "paddle-3.0-placeholder";

export async function extractScannedPdfWithOcr(filePath, { engine = DEFAULT_OCR_ENGINE } = {}) {
  return {
    path: filePath,
    mime: "application/pdf",
    extraction_mode: "pdf_ocr",
    text: `[OCR placeholder extraction] ${path.basename(filePath)}`,
    page_count: 1,
    ocr_applied: true,
    ocr_engine: engine,
    ocr_confidence: 0.92,
    ocr_low_confidence_regions: [
      {
        page: 1,
        bbox: [16, 24, 180, 52],
        confidence: 0.61
      }
    ]
  };
}
