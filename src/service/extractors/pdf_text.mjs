import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);

function asLatin1(buffer) {
  return Buffer.from(buffer).toString("latin1");
}

function unescapePdfText(text) {
  return `${text ?? ""}`.replace(/\\(\r\n|\r|\n)/g, "").replace(/\\([0-7]{1,3}|.)/gs, (_, escaped) => {
    if (/^[0-7]/.test(escaped)) return String.fromCharCode(Number.parseInt(escaped, 8));
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    if (escaped === "b") return "\b";
    if (escaped === "f") return "\f";
    return escaped;
  });
}

function normalizeExtractedText(text) {
  return `${text ?? ""}`
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeUtf16BeHex(hex) {
  const clean = `${hex ?? ""}`.replace(/[^0-9a-f]/gi, "");
  if (clean.length < 2) return "";
  const bytes = Buffer.from(clean.length % 2 === 0 ? clean : `0${clean}`, "hex");
  const codeUnits = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes.readUInt16BE(index);
    if (code === 0xfeff) continue;
    codeUnits.push(code);
  }
  return String.fromCharCode(...codeUnits);
}

function incrementUtf16BeHex(hex, offset) {
  const clean = `${hex ?? ""}`.replace(/[^0-9a-f]/gi, "");
  if (clean.length < 4 || clean.length % 4 !== 0) return decodeUtf16BeHex(clean);
  const bytes = Buffer.from(clean, "hex");
  const lastOffset = bytes.length - 2;
  const next = Math.max(0, Math.min(0xffff, bytes.readUInt16BE(lastOffset) + offset));
  bytes.writeUInt16BE(next, lastOffset);
  return decodeUtf16BeHex(bytes.toString("hex"));
}

function toFixedWidthHex(value, width) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function parsePdfObjects(buffer) {
  const text = asLatin1(buffer);
  const objects = new Map();
  const objectRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = objectRe.exec(text))) {
    const id = Number(match[1]);
    const afterHeader = objectRe.lastIndex;
    const end = text.indexOf("endobj", afterHeader);
    if (end === -1) break;
    const objectText = text.slice(afterHeader, end);
    let stream = null;
    const streamKeyword = text.indexOf("stream", afterHeader);
    if (streamKeyword !== -1 && streamKeyword < end) {
      let streamStart = streamKeyword + "stream".length;
      if (text[streamStart] === "\r" && text[streamStart + 1] === "\n") {
        streamStart += 2;
      } else if (text[streamStart] === "\n" || text[streamStart] === "\r") {
        streamStart += 1;
      }
      const streamEndKeyword = text.indexOf("endstream", streamStart);
      if (streamEndKeyword !== -1 && streamEndKeyword <= end) {
        let streamEnd = streamEndKeyword;
        if (text[streamEnd - 1] === "\n") streamEnd -= 1;
        if (text[streamEnd - 1] === "\r") streamEnd -= 1;
        stream = Buffer.from(buffer).subarray(streamStart, streamEnd);
      }
    }
    objects.set(id, { id, text: objectText, stream });
    objectRe.lastIndex = end + "endobj".length;
  }
  return objects;
}

function decodePdfStream(object) {
  if (!object?.stream) return null;
  const dictionary = object.text.slice(0, Math.max(0, object.text.indexOf("stream")));
  try {
    if (/\/FlateDecode\b/.test(dictionary)) {
      return inflateSync(object.stream).toString("latin1");
    }
    return object.stream.toString("latin1");
  } catch {
    return null;
  }
}

function parseToUnicodeCMap(cmapText) {
  const map = new Map();
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let section;
  while ((section = bfcharRe.exec(cmapText))) {
    const pairRe = /<([0-9a-f\s]+)>\s+<([0-9a-f\s]+)>/gi;
    let pair;
    while ((pair = pairRe.exec(section[1]))) {
      const source = pair[1].replace(/\s+/g, "").toUpperCase();
      const target = decodeUtf16BeHex(pair[2]);
      if (source && target) map.set(source, target);
    }
  }

  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((section = bfrangeRe.exec(cmapText))) {
    const arrayRangeRe = /<([0-9a-f\s]+)>\s+<([0-9a-f\s]+)>\s+\[([\s\S]*?)\]/gi;
    let arrayRange;
    while ((arrayRange = arrayRangeRe.exec(section[1]))) {
      const startHex = arrayRange[1].replace(/\s+/g, "").toUpperCase();
      const endHex = arrayRange[2].replace(/\s+/g, "").toUpperCase();
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 4096) continue;
      const values = [...arrayRange[3].matchAll(/<([0-9a-f\s]+)>/gi)].map((item) => decodeUtf16BeHex(item[1]));
      for (let code = start; code <= end && code - start < values.length; code += 1) {
        const target = values[code - start];
        if (target) map.set(toFixedWidthHex(code, startHex.length), target);
      }
    }

    const baseRangeRe = /<([0-9a-f\s]+)>\s+<([0-9a-f\s]+)>\s+<([0-9a-f\s]+)>/gi;
    let baseRange;
    while ((baseRange = baseRangeRe.exec(section[1]))) {
      const startHex = baseRange[1].replace(/\s+/g, "").toUpperCase();
      const endHex = baseRange[2].replace(/\s+/g, "").toUpperCase();
      const targetHex = baseRange[3].replace(/\s+/g, "");
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 4096) continue;
      for (let code = start; code <= end; code += 1) {
        const target = incrementUtf16BeHex(targetHex, code - start);
        if (target) map.set(toFixedWidthHex(code, startHex.length), target);
      }
    }
  }
  return map;
}

function scoreDecodedText(text) {
  let score = 0;
  for (const char of `${text ?? ""}`) {
    if (char === "\ufffd" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(char)) {
      score -= 8;
    } else if (/\s/u.test(char)) {
      score += 1;
    } else if (/[\p{L}\p{N}@._:/+#&%(),;'"\-[\]]/u.test(char)) {
      score += 3;
    } else {
      score += 1;
    }
  }
  return score;
}

function decodeHexWithCMap(hex, cmap) {
  const clean = `${hex ?? ""}`.replace(/\s+/g, "").toUpperCase();
  if (!clean || !cmap?.size) return "";
  const widths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((a, b) => b - a);
  let output = "";
  let index = 0;
  while (index < clean.length) {
    let consumed = 0;
    for (const width of widths) {
      const key = clean.slice(index, index + width);
      if (key.length === width && cmap.has(key)) {
        output += cmap.get(key);
        consumed = width;
        break;
      }
    }
    if (consumed === 0) {
      index += widths.at(-1) ?? 2;
    } else {
      index += consumed;
    }
  }
  return output;
}

function decodeHexFallback(hex) {
  const clean = `${hex ?? ""}`.replace(/\s+/g, "");
  if (!clean) return "";
  const utf16 = decodeUtf16BeHex(clean);
  const latin1 = Buffer.from(clean.length % 2 === 0 ? clean : `0${clean}`, "hex").toString("latin1");
  return scoreDecodedText(utf16) >= scoreDecodedText(latin1) ? utf16 : latin1;
}

function decodePdfHexText(hex, activeCMap, cmaps) {
  const candidates = [];
  if (activeCMap?.size) candidates.push(decodeHexWithCMap(hex, activeCMap));
  for (const cmap of cmaps) {
    if (cmap !== activeCMap) candidates.push(decodeHexWithCMap(hex, cmap));
  }
  candidates.push(decodeHexFallback(hex));
  return candidates
    .filter(Boolean)
    .sort((a, b) => scoreDecodedText(b) - scoreDecodedText(a))[0] ?? "";
}

function extractPdfStringTokens(source) {
  const tokens = [];
  const tokenRe = /<([0-9a-f\s]+)>|\(((?:\\.|[^\\()])*)\)/gis;
  let token;
  while ((token = tokenRe.exec(source))) {
    if (token[1] != null) {
      tokens.push({ type: "hex", value: token[1] });
    } else {
      tokens.push({ type: "literal", value: token[2] });
    }
  }
  return tokens;
}

function decodePdfStringToken(token, activeCMap, cmaps) {
  if (token.type === "hex") return decodePdfHexText(token.value, activeCMap, cmaps);
  return unescapePdfText(token.value);
}

function buildFontCMapLookup(objects, decodedStreams) {
  const cmapsByObjectId = new Map();
  for (const [id, streamText] of decodedStreams) {
    if (!/beginbf(?:char|range)/.test(streamText)) continue;
    const cmap = parseToUnicodeCMap(streamText);
    if (cmap.size > 0) cmapsByObjectId.set(id, cmap);
  }

  const fontObjectToCMap = new Map();
  for (const [id, object] of objects) {
    const toUnicode = object.text.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (toUnicode) {
      const cmap = cmapsByObjectId.get(Number(toUnicode[1]));
      if (cmap) fontObjectToCMap.set(id, cmap);
    }
  }

  const fontNameToCMap = new Map();
  for (const object of objects.values()) {
    const fontResourceRe = /\/Font\s*<<([\s\S]*?)>>/g;
    let resource;
    while ((resource = fontResourceRe.exec(object.text))) {
      const fontEntryRe = /\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g;
      let entry;
      while ((entry = fontEntryRe.exec(resource[1]))) {
        const cmap = fontObjectToCMap.get(Number(entry[2]));
        if (cmap && !fontNameToCMap.has(entry[1])) fontNameToCMap.set(entry[1], cmap);
      }
    }
  }

  return {
    all: [...cmapsByObjectId.values()],
    byFontName: fontNameToCMap
  };
}

function extractTextFromContentStream(streamText, cmapLookup) {
  const chunks = [];
  const string = "(?:<[^>]+>|\\((?:\\\\.|[^\\\\()])*\\))";
  const opRe = new RegExp(
    `/([A-Za-z0-9_.-]+)\\s+[-+]?\\d*\\.?\\d+\\s+Tf|(${string})\\s*Tj|(\\[(?:${string}|[^\\]])*\\])\\s*TJ|(${string})\\s*'|(?:[-+]?\\d*\\.?\\d+\\s+){2}(${string})\\s*"`,
    "gs"
  );
  const blocks = [...streamText.matchAll(/BT([\s\S]*?)ET/g)].map((match) => match[1]);
  for (const block of blocks) {
    let activeCMap = null;
    let operation;
    while ((operation = opRe.exec(block))) {
      if (operation[1]) {
        activeCMap = cmapLookup.byFontName.get(operation[1]) ?? activeCMap;
        continue;
      }
      const operand = operation[2] ?? operation[3] ?? operation[4] ?? operation[5] ?? "";
      const decoded = extractPdfStringTokens(operand)
        .map((token) => decodePdfStringToken(token, activeCMap, cmapLookup.all))
        .join("");
      if (decoded.trim()) chunks.push(decoded);
    }
  }
  return normalizeExtractedText(chunks.join("\n"));
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
  const rawText = matches.map((match) => unescapePdfText(match[1]).trim()).filter(Boolean).join("\n");
  const streamText = extractPdfTextFromCompressedStreams(buffer);
  return normalizeExtractedText([rawText, streamText].filter(Boolean).join("\n"));
}

export function extractPdfTextFromCompressedStreams(buffer) {
  const objects = parsePdfObjects(buffer);
  const decodedStreams = new Map();
  for (const [id, object] of objects) {
    const decoded = decodePdfStream(object);
    if (decoded) decodedStreams.set(id, decoded);
  }
  if (decodedStreams.size === 0) return "";

  const cmapLookup = buildFontCMapLookup(objects, decodedStreams);
  const extracted = [];
  for (const streamText of decodedStreams.values()) {
    if (!/\bBT\b/.test(streamText) || !/\bET\b/.test(streamText)) continue;
    const text = extractTextFromContentStream(streamText, cmapLookup);
    if (text) extracted.push(text);
  }
  return normalizeExtractedText(extracted.join("\n"));
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
