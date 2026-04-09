import path from "node:path";

export const DEFAULT_IMAGE_OCR_ENGINE = "paddle-3.0-placeholder";

export async function runImageOcr(imagePath, { engine = DEFAULT_IMAGE_OCR_ENGINE } = {}) {
  return {
    image_path: imagePath,
    ocr_text: `[Image OCR placeholder] ${path.basename(imagePath)}`,
    ocr_confidence: 0.9,
    ocr_low_confidence_regions: [
      {
        bbox: [24, 28, 200, 66],
        confidence: 0.58
      }
    ],
    ocr_engine: engine
  };
}
