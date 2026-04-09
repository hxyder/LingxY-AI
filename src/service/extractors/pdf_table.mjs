export function extractPdfTablePreview(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => /\s{2,}|\t/.test(line));
  return candidates.slice(0, 5).map((line) =>
    line.split(/\s{2,}|\t/).map((cell) => cell.trim()).filter(Boolean)
  );
}
