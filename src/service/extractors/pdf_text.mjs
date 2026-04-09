import { readFile } from "node:fs/promises";
import path from "node:path";

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

export function extractPdfTextLayerFromBuffer(buffer) {
  const text = asLatin1(buffer);
  const matches = [...text.matchAll(/\(([^()]*)\)\s*Tj/g)];
  const extracted = matches.map((match) => unescapePdfText(match[1]).trim()).filter(Boolean);
  return extracted.join("\n");
}

export function hasUsablePdfTextLayer(buffer, minCharacters = 24) {
  const extracted = extractPdfTextLayerFromBuffer(buffer);
  return extracted.replace(/\s+/g, "").length >= minCharacters;
}

export async function extractTextPdf(filePath) {
  const bytes = await readFile(filePath);
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
