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
  version: "2",
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
        extraHead: XLSX_GRID_CSS,
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

  // UCA-182 Phase 10b: preserve Excel column widths via a <colgroup>
  // so columns match what the user drew in the spreadsheet. exceljs
  // column.width is in "characters"; empirically ~7.5px per char at
  // Calibri 11pt matches Excel's rendering.
  const colWidths = [];
  for (let c = 1; c <= colLimit; c++) {
    const col = sheet.getColumn(c);
    const charWidth = Number(col?.width) || 10;
    colWidths.push(Math.round(charWidth * 7.5));
  }
  const colgroupHtml = `<colgroup>${colWidths.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;

  // Freeze-pane detection: sheet.views[0].state === "frozen" and
  // ySplit is the number of rows locked at the top. We flag <thead>
  // as sticky whenever a freeze exists; covers the common "freeze
  // header row" use case without per-row complexity.
  const view = sheet.views?.[0] ?? {};
  const hasFrozen = view.state === "frozen" && (view.ySplit ?? 0) >= 1;

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
      const style = cellInlineStyle(cell);
      const classes = [];
      if (isNumber) classes.push("num");
      if (classes.length) attrs.push(`class="${classes.join(" ")}"`);
      if (style) attrs.push(`style="${style}"`);
      const tag = r === 1 ? "th" : "td";
      cellsHtml.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${escapeHtml(text)}</${tag}>`);
    }
    if (cellsHtml.length === 0) continue;
    rowsHtml.push(`<tr>${cellsHtml.join("")}</tr>`);
  }
  const head = rowsHtml.length ? `<thead${hasFrozen ? ' class="sticky"' : ""}>${rowsHtml.shift()}</thead>` : "";
  const body = rowsHtml.length ? `<tbody>${rowsHtml.join("")}</tbody>` : "";
  return `<table class="preview-xlsx">${colgroupHtml}${head}${body}</table>`;
}

/** Translate an exceljs cell's fill / font / alignment into inline CSS. */
function cellInlineStyle(cell) {
  const parts = [];
  // Fill (background)
  const argb = cell?.fill?.fgColor?.argb || cell?.fill?.fgColor?.rgb;
  if (typeof argb === "string" && /^[0-9A-Fa-f]{6,8}$/.test(argb)) {
    const hex = argb.length === 8 ? argb.slice(2) : argb;
    parts.push(`background-color:#${hex}`);
  }
  // Font color
  const fontArgb = cell?.font?.color?.argb;
  if (typeof fontArgb === "string" && /^[0-9A-Fa-f]{6,8}$/.test(fontArgb)) {
    const hex = fontArgb.length === 8 ? fontArgb.slice(2) : fontArgb;
    parts.push(`color:#${hex}`);
  }
  if (cell?.font?.bold) parts.push("font-weight:700");
  if (cell?.font?.italic) parts.push("font-style:italic");
  if (cell?.font?.underline) parts.push("text-decoration:underline");
  const h = cell?.alignment?.horizontal;
  if (h === "left" || h === "center" || h === "right" || h === "justify") {
    parts.push(`text-align:${h}`);
  }
  const v = cell?.alignment?.vertical;
  if (v === "top" || v === "middle" || v === "bottom") {
    parts.push(`vertical-align:${v === "middle" ? "middle" : v}`);
  }
  return parts.join(";");
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

// UCA-182 Phase 10b: Excel-like grid styling. Sticky thead honours
// the workbook's freeze pane; alternating row tint mirrors default
// Excel table style; col widths come from the <colgroup> emitted by
// renderSheet so the columns actually match what the user drew.
const XLSX_GRID_CSS = `<style>
.preview-xlsx {
  border-collapse: separate;
  border-spacing: 0;
  font-family: "Calibri", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 11pt;
  color: #2c2c2c;
  background: #ffffff;
  width: auto;
}
.preview-xlsx th,
.preview-xlsx td {
  border: 1px solid #d4d4d4;
  padding: 2px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.preview-xlsx thead th {
  background: #4472c4;
  color: #ffffff;
  font-weight: 600;
  text-align: center;
  padding: 4px 8px;
}
.preview-xlsx thead.sticky th {
  position: sticky;
  top: 0;
  z-index: 2;
  box-shadow: 0 2px 0 rgba(0,0,0,0.05);
}
.preview-xlsx tbody tr:nth-child(even) td { background: #f7f9fc; }
.preview-xlsx td.num { text-align: right; font-variant-numeric: tabular-nums; }
.preview-xlsx tbody tr:hover td { background: #d9e1f2 !important; }
.preview-sheet { overflow: auto; max-height: 80vh; }
@media (prefers-color-scheme: dark) {
  .preview-xlsx { background: #ffffff; color: #2c2c2c; }
}
</style>`;

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
