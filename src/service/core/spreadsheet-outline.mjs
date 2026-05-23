const GENERIC_DUMP_HEADERS = new Set(["content", "section", "summary", "正文", "内容", "文本"]);
const GENERIC_DUMP_MIN_CELL_CHARS = 120;

function cleanCell(value = "") {
  return String(value ?? "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function isMarkdownSeparatorCell(value = "") {
  return /^:?-{3,}:?$/.test(cleanCell(value));
}

function splitPipeRow(line = "") {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.includes("|")) return [];
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").map(cleanCell);
}

function normalizeRows(rows = []) {
  return rows
    .map((row) => Array.isArray(row) ? row.map(cleanCell) : [cleanCell(row)])
    .filter((row) => row.some((cell) => cell.length > 0));
}

function extractMarkdownTable(text = "") {
  const lines = String(text ?? "").split(/\r?\n/);
  let block = [];
  const flush = () => {
    if (block.length < 2) {
      block = [];
      return null;
    }
    const rows = block.map(splitPipeRow).filter((row) => row.length > 0);
    block = [];
    if (rows.length < 2) return null;
    const sepIndex = rows.findIndex((row) => row.length > 0 && row.every(isMarkdownSeparatorCell));
    if (sepIndex <= 0) return null;
    const headers = rows[sepIndex - 1].filter((cell) => !isMarkdownSeparatorCell(cell));
    const dataRows = normalizeRows(rows.slice(sepIndex + 1));
    if (headers.length === 0 || dataRows.length === 0) return null;
    return { headers, rows: dataRows };
  };

  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (line.includes("|") && splitPipeRow(line).length >= 2) {
      block.push(line);
      continue;
    }
    const table = flush();
    if (table) return table;
  }
  return flush();
}

function extractDelimitedTable(text = "") {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  if (!lines.every((line) => line.includes(delimiter))) return null;
  const rows = normalizeRows(lines.map((line) => line.split(delimiter).map(cleanCell)));
  if (rows.length < 2) return null;
  const width = rows[0].length;
  if (width < 2 || rows.some((row) => Math.abs(row.length - width) > 1)) return null;
  return { headers: rows[0], rows: rows.slice(1) };
}

export function spreadsheetOutlineFromText(text = "", { title = "", sheetName = "" } = {}) {
  const table = extractMarkdownTable(text) ?? extractDelimitedTable(text);
  if (!table) return null;
  return {
    ...(title ? { title } : {}),
    ...(sheetName ? { sheetName } : {}),
    headers: table.headers,
    rows: table.rows
  };
}

function sheetsFromOutline(outline = {}) {
  if (typeof outline === "string") {
    const parsed = spreadsheetOutlineFromText(outline);
    return parsed ? sheetsFromOutline(parsed) : [];
  }
  if (Array.isArray(outline?.sheets)) {
    return outline.sheets.map((sheet) => ({
      name: sheet?.name ?? sheet?.sheetName ?? "",
      headers: normalizeRows([sheet?.headers ?? []])[0] ?? [],
      rows: normalizeRows(sheet?.rows ?? [])
    }));
  }
  if (outline && typeof outline === "object" && !Array.isArray(outline)) {
    return [{
      name: outline.sheetName ?? outline.name ?? "",
      headers: normalizeRows([outline.headers ?? []])[0] ?? [],
      rows: normalizeRows(outline.rows ?? [])
    }];
  }
  if (Array.isArray(outline)) {
    const rows = normalizeRows(outline);
    return [{ name: "", headers: rows[0] ?? [], rows: rows.slice(1) }];
  }
  return [];
}

export function inspectSpreadsheetOutline(outline = {}) {
  const sheets = sheetsFromOutline(outline);
  let maxColumns = 0;
  let dataRowCount = 0;
  let nonEmptyCellCount = 0;
  let longestCellChars = 0;
  let genericSingleColumnDump = false;
  let markdownOrSandboxDump = false;

  for (const sheet of sheets) {
    const width = Math.max(sheet.headers.length, ...sheet.rows.map((row) => row.length), 0);
    maxColumns = Math.max(maxColumns, width);
    dataRowCount += sheet.rows.length;
    const headerKey = String(sheet.headers[0] ?? "").trim().toLowerCase();
    const singleColumn = width <= 1;
    let sheetLongestCellChars = 0;
    for (const row of sheet.rows) {
      for (const cell of row) {
        const text = cleanCell(cell);
        if (!text) continue;
        nonEmptyCellCount += 1;
        longestCellChars = Math.max(longestCellChars, text.length);
        sheetLongestCellChars = Math.max(sheetLongestCellChars, text.length);
        if (/sandbox:\/|下载\s*Excel|```|^\s*#|^\s*\|/i.test(text)) {
          markdownOrSandboxDump = true;
        }
      }
    }
    if (singleColumn && GENERIC_DUMP_HEADERS.has(headerKey) && sheetLongestCellChars > GENERIC_DUMP_MIN_CELL_CHARS) {
      genericSingleColumnDump = true;
    }
  }

  return {
    sheetCount: sheets.length,
    maxColumns,
    dataRowCount,
    nonEmptyCellCount,
    longestCellChars,
    genericSingleColumnDump,
    markdownOrSandboxDump
  };
}

export function evaluateSpreadsheetOutlineQuality({ outline = {}, requireTabular = false } = {}) {
  const metrics = inspectSpreadsheetOutline(outline);
  const issues = [];
  if (metrics.sheetCount === 0 || metrics.nonEmptyCellCount === 0) {
    issues.push("empty_spreadsheet");
  }
  if (metrics.genericSingleColumnDump) {
    issues.push("generic_content_dump");
  }
  if (metrics.markdownOrSandboxDump) {
    issues.push("markdown_or_sandbox_dump");
  }
  if (requireTabular && metrics.maxColumns < 2) {
    issues.push("too_few_columns");
  }
  if (requireTabular && metrics.dataRowCount < 1) {
    issues.push("too_few_rows");
  }
  return {
    ok: issues.length === 0,
    metrics,
    issues
  };
}
