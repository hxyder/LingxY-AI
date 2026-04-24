// CSV / TSV preview provider (UCA-182 Phase 2).
//
// Parses the file server-side into a <table> instead of leaving it
// to the client. Doing it here means the cached HTML is ready to
// paint (faster repeat opens) and the same code path is used by
// both the console and overlay renderers.
//
// The parser is intentionally minimal — it handles quoted fields
// and escaped double quotes (the RFC 4180 essentials) but does not
// attempt to support multi-line quoted cells containing embedded
// newlines spanning many KB. For anything fancier, users should
// import into Excel / sheets.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

const MAX_ROWS = 2000;

export const CSV_PROVIDER = {
  id: "csv",
  extensions: [".csv", ".tsv"],
  mimePrefixes: ["text/csv", "text/tab-separated-values"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const text = await readFile(ctx.filePath, "utf8");
    const delimiter = ctx.ext === ".tsv" ? "\t" : ",";
    const allRows = parseCsv(text, delimiter);
    const truncated = allRows.length > MAX_ROWS;
    const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;
    const parsed = path.parse(ctx.filePath);

    const headCells = (rows[0] ?? []).map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const bodyRows = rows.slice(1).map((r) => {
      const cells = r.map((c) => {
        const isNum = c !== "" && !Number.isNaN(Number(c));
        return `<td${isNum ? ' class="num"' : ""}>${escapeHtml(c)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const banner = truncated ? `仅显示前 ${MAX_ROWS} 行（共 ${allRows.length} 行）。` : null;

    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: ctx.ext === ".tsv" ? "tsv" : "csv",
        banner,
        bodyHtml: `<section class="preview-surface preview-content">
<table class="preview-table">
  <thead><tr>${headCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</section>`
      }),
      meta: { rowCount: allRows.length, columnCount: rows[0]?.length ?? 0, truncated }
    };
  }
};

/**
 * RFC 4180-ish CSV parser. Handles quoted fields and "" escapes;
 * ignores quoted newlines (rare; not worth the complexity here).
 */
export function parseCsv(input, delimiter = ",") {
  const text = String(input ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const rows = [];
  for (const line of lines) {
    const cells = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let end = i + 1;
        let buf = "";
        while (end < line.length) {
          if (line[end] === '"' && line[end + 1] === '"') { buf += '"'; end += 2; continue; }
          if (line[end] === '"') break;
          buf += line[end];
          end += 1;
        }
        cells.push(buf);
        i = end + 1;
        if (line[i] === delimiter) i += 1;
      } else {
        const next = line.indexOf(delimiter, i);
        if (next === -1) {
          cells.push(line.slice(i));
          break;
        }
        cells.push(line.slice(i, next));
        i = next + 1;
      }
    }
    rows.push(cells);
  }
  return rows;
}
