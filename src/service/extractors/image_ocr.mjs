import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OCR_SCRIPT = path.join(process.cwd(), "scripts", "ocr-image.ps1");

export const DEFAULT_IMAGE_OCR_ENGINE = "windows-media-ocr";

export async function runImageOcr(imagePath, { engine = DEFAULT_IMAGE_OCR_ENGINE } = {}) {
  // try Windows built-in OCR first
  if (engine === "windows-media-ocr" || engine === "auto") {
    try {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", OCR_SCRIPT,
        "-ImagePath", imagePath
      ], { encoding: "utf8", timeout: 10000 });

      const result = JSON.parse(stdout.trim());
      if (result.ok && result.text) {
        return {
          image_path: imagePath,
          ocr_text: result.text,
          ocr_confidence: 0.85,
          ocr_low_confidence_regions: [],
          ocr_engine: result.engine ?? "windows-media-ocr",
          ocr_line_count: result.lineCount ?? 0
        };
      }
    } catch {
      // Windows OCR failed — fall back to placeholder
    }
  }

  // fallback: return empty OCR result (image will still be sent to Vision API)
  return {
    image_path: imagePath,
    ocr_text: "",
    ocr_confidence: 0,
    ocr_low_confidence_regions: [],
    ocr_engine: "none"
  };
}
