// XLSX preview provider (UCA-182 Phase 2).
//
// Uses exceljs to walk every worksheet and renders each one as a
// `<table>`. The first sheet is shown by default; other sheets are
// reachable via a tab bar at the top. A tiny inline script handles
// the tab switching so the preview stays a single self-contained
// HTML document (no renderer-side JS required).
//
// Layout choices:
//   - rows come out of exceljs one-indexed; header row is the first
//     row with at least one value and is styled via <thead>
//   - merged cells honour the workbook's merge ranges (rowspan /
//     colspan are emitted for the top-left cell, other cells in the
//     range are skipped)
//   - numeric cells get the `num` class so they right-align and use
//     tabular numerals
//   - empty trailing rows are trimmed to keep the rendered DOM small

import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

const MAX_ROWS_PER_SHEET = 5000;
const MAX_COLS_PER_SHEET = 200;

export const XLSX_PROVIDER = {
  id: "xlsx",
  extensions: [".xlsx"],
  mimePrefixes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(ctx.filePath);

    const sheetsHtml = [];
    const sheetNames = [];
    for (const sheet of workbook.worksheets) {
      sheetNames.push(sheet.name);
      sheetsHtml.push(renderSheet(sheet));
    }

    const tabs = sheetNames.length > 1
      ? `<nav class="preview-tabs" role="tablist">${sheetNames
          .map((n, i) => `<button type="button" data-target="sheet-${i}"${i === 0 ? ' class="active"' : ""}>${escapeHtml(n)}</button>`)
          .join("")}</nav>`
      : "";
    const switcher = sheetNames.length > 1 ? TAB_SWITCH_SCRIPT : "";
    const parsed = path.parse(ctx.filePath);

    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: "xlsx",
        subtitle: `${sheetNames.length} 个工作表`,
        bodyHtml: `<section class="preview-surface preview-content">
${tabs}
${sheetsHtml.map((h, i) => `<div id="sheet-${i}" class="preview-sheet"${i === 0 ? "" : ' hidden'}>${h}</div>`).join("\n")}
${switcher}
</section>`
      }),
      meta: { sheets: sheetNames }
    };
  }
};

/** Render a single sheet as a table. */
function renderSheet(sheet) {
  const { rowCount, columnCount } = sheetDimensions(sheet);
  if (rowCount === 0) return '<p class="preview-muted">（空白工作表）</p>';
  const rowLimit = Math.min(rowCount, MAX_ROWS_PER_SHEET);
  const colLimit = Math.min(columnCount, MAX_COLS_PER_SHEET);

  // Build a skip-set for merged cells — exceljs reports the merges,
  // and for each merged block only the top-left cell should render.
  const skip = new Set();
  const merges = (sheet.model?.merges ?? []).map(decodeMerge).filter(Boolean);
  for (const m of merges) {
    for (let r = m.top; r <= m.bottom; r++) {
      for (let c = m.left; c <= m.right; c++) {
        if (r === m.top && c === m.left) continue;
        skip.add(`${r},${c}`);
      }
    }
  }
  const mergeLookup = new Map(merges.map((m) => [`${m.top},${m.left}`, m]));

  const rowsHtml = [];
  for (let r = 1; r <= rowLimit; r++) {
    const row = sheet.getRow(r);
    const cellsHtml = [];
    for (let c = 1; c <= colLimit; c++) {
      if (skip.has(`${r},${c}`)) continue;
      const cell = row.getCell(c);
      const merge = mergeLookup.get(`${r},${c}`);
      const attrs = [];
      if (merge) {
        const rs = merge.bottom - merge.top + 1;
        const cs = merge.right - merge.left + 1;
        if (rs > 1) attrs.push(`rowspan="${rs}"`);
        if (cs > 1) attrs.push(`colspan="${cs}"`);
      }
      const { text, isNumber } = cellText(cell);
      if (isNumber) attrs.push('class="num"');
      const tag = r === 1 ? "th" : "td";
      cellsHtml.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${escapeHtml(text)}</${tag}>`);
    }
    if (cellsHtml.length === 0) continue;
    rowsHtml.push(`<tr>${cellsHtml.join("")}</tr>`);
  }
  const head = rowsHtml.length ? `<thead>${rowsHtml.shift()}</thead>` : "";
  const body = rowsHtml.length ? `<tbody>${rowsHtml.join("")}</tbody>` : "";
  return `<table class="preview-table">${head}${body}</table>`;
}

function sheetDimensions(sheet) {
  let rowCount = 0;
  let columnCount = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    rowCount = Math.max(rowCount, rowNumber);
    columnCount = Math.max(columnCount, row.cellCount ?? 0, row.actualCellCount ?? 0);
  });
  return { rowCount, columnCount };
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return { text: "", isNumber: false };
  if (typeof v === "number") return { text: String(v), isNumber: true };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 19).replace("T", " "), isNumber: false };
  if (typeof v === "object") {
    if (v.richText) return { text: v.richText.map((rt) => rt.text).join(""), isNumber: false };
    if (v.text != null) return { text: String(v.text), isNumber: false };
    if (v.formula) return { text: String(v.result ?? ""), isNumber: typeof v.result === "number" };
    if (v.hyperlink && v.text) return { text: String(v.text), isNumber: false };
  }
  return { text: String(v), isNumber: false };
}

function decodeMerge(merge) {
  // exceljs stores merges as "A1:C3" style strings.
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(merge ?? ""));
  if (!match) return null;
  const [, lc, lr, rc, rr] = match;
  return {
    top: Number(lr),
    left: colToNumber(lc),
    bottom: Number(rr),
    right: colToNumber(rc)
  };
}

function colToNumber(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const TAB_SWITCH_SCRIPT = `
<script>
(() => {
  const tabs = document.querySelectorAll("nav.preview-tabs button[data-target]");
  tabs.forEach((btn) => btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    document.querySelectorAll(".preview-sheet").forEach((el) => { el.hidden = el.id !== target; });
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
  }));
})();
</script>`;
