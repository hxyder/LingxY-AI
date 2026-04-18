import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function asLatin1(buffer) {
  return Buffer.from(buffer).toString("latin1");
}

function unescapePdfText(text) {
  return text
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

export function countPdfPagesFromBuffer(buffer) {
  const text = asLatin1(buffer);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? undefined;
}

// Legacy naive extractor — only catches `(text) Tj` operators from the raw
// PDF bytes. Works on trivial PDFs but misses CMapped/compressed/multi-op
// content. Kept as a fallback; prefer `extractPdfTextViaPdftotext` when the
// poppler binary is on the user's PATH.
export function extractPdfTextLayerFromBuffer(buffer) {
  const text = asLatin1(buffer);
  const matches = [...text.matchAll(/\(([^()]*)\)\s*Tj/g)];
  const extracted = matches.map((match) => unescapePdfText(match[1]).trim()).filter(Boolean);
  return extracted.join("\n");
}

// Poppler's `pdftotext -layout` handles CMaps, font subsets, compressed
// streams, and Unicode — the kinds of PDFs (Word exports, LaTeX, Canva
// résumés, etc.) where our naive regex gets only links and metadata.
// Returns null if the binary isn't installed or fails for any reason.
export async function extractPdfTextViaPdftotext(filePath) {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", filePath, "-"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true }
    );
    const trimmed = `${stdout ?? ""}`.replace(/\f/g, "\n").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function hasUsablePdfTextLayer(buffer, minCharacters = 24) {
  const extracted = extractPdfTextLayerFromBuffer(buffer);
  return extracted.replace(/\s+/g, "").length >= minCharacters;
}

export async function extractTextPdf(filePath) {
  const bytes = await readFile(filePath);

  // Prefer poppler's pdftotext when available — it recovers far more body
  // content than the Tj-regex fallback. We check it for every PDF that
  // survived hasUsablePdfTextLayer() so résumés / Word exports get their
  // actual prose rather than just URIs + metadata.
  const popplerText = await extractPdfTextViaPdftotext(filePath);
  const trimmedPoppler = popplerText?.replace(/\s+/g, " ").trim() ?? "";
  if (trimmedPoppler.length >= 60) {
    return {
      path: filePath,
      mime: "application/pdf",
      extraction_mode: "text_pdf_poppler",
      text: popplerText,
      page_count: countPdfPagesFromBuffer(bytes),
      table_preview: []
    };
  }

  const extractedText = extractPdfTextLayerFromBuffer(bytes);
  return {
    path: filePath,
    mime: "application/pdf",
    extraction_mode: "text_pdf",
    text: extractedText || `[PDF text extraction fallback] ${path.basename(filePath)}`,
    page_count: countPdfPagesFromBuffer(bytes),
    table_preview: []
  };
}
