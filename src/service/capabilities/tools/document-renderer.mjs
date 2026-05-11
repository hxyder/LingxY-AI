/**
 * document-renderer.mjs
 *
 * Professional-quality document generation using:
 *   pptxgenjs  — PPTX presentations
 *   docx       — Word documents
 *   exceljs    — Excel spreadsheets
 *
 * Replaces the bare-XML PowerShell renderer with styled, production-ready output.
 * Called in-process from tools/index.mjs (no subprocess overhead).
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { renderMermaidScriptTag } from "../../action_tools/tools/mermaid-assets.mjs";
import { sanitizeSvgMarkup } from "../../action_tools/tools/svg-sanitize.mjs";

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  dark:    "1E293B",   // slate-800  — headings, dark bg
  ink:     "374151",   // gray-700   — body text
  muted:   "64748B",   // slate-500  — secondary text
  light:   "F8FAFC",   // slate-50   — alternate row bg
  white:   "FFFFFF",
  primary: "2563EB",   // blue-600   — accent / buttons
  border:  "E2E8F0",   // slate-200  — dividers, table borders
};

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────

async function renderPptx(targetPath, outline) {
  const { default: pptxgen } = await import("pptxgenjs");
  await ensureParentDir(targetPath);

  const prs = new pptxgen();
  prs.layout  = "LAYOUT_WIDE";   // 10 × 5.63 in
  prs.subject = outline.title  ?? "Presentation";
  prs.author  = outline.author ?? "UCA";
  prs.company = outline.company ?? "";

  const W = 10, H = 5.63;

  // ── Title slide ─────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { fill: C.dark };

    // Left accent pillar
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 0.32, h: H,
      fill: { color: C.primary }, line: { type: "none" },
    });

    s.addText(outline.title ?? "Untitled", {
      x: 0.6, y: 1.5, w: W - 1.0, h: 1.4,
      fontSize: 38, bold: true, color: C.white,
      align: "left", fontFace: "Calibri", charSpacing: -0.3,
    });

    if (outline.subtitle) {
      s.addText(outline.subtitle, {
        x: 0.6, y: 3.1, w: W - 1.0, h: 0.75,
        fontSize: 20, color: "94A3B8", align: "left", fontFace: "Calibri",
      });
    }

    // Thin rule between title and subtitle
    s.addShape(prs.ShapeType.rect, {
      x: 0.6, y: 3.0, w: 2.8, h: 0.04,
      fill: { color: C.primary }, line: { type: "none" },
    });

    const meta = [outline.author, outline.date].filter(Boolean).join("  ·  ");
    if (meta) {
      s.addText(meta, {
        x: 0.6, y: H - 0.55, w: W - 1.2, h: 0.38,
        fontSize: 10, color: C.muted, align: "left", fontFace: "Calibri",
      });
    }
  }

  // ── Content slides ──────────────────────────────────────────────────────────
  const slides = Array.isArray(outline.slides) ? outline.slides : [];
  for (let idx = 0; idx < slides.length; idx++) {
    const sl = slides[idx];

    // Section-divider layout
    if (sl.layout === "section") {
      const s = prs.addSlide();
      s.background = { fill: C.primary };
      s.addText(sl.heading ?? sl.title ?? "", {
        x: 1, y: 1.8, w: W - 2, h: 2,
        fontSize: 34, bold: true, color: C.white,
        align: "center", fontFace: "Calibri",
      });
      continue;
    }

    const s = prs.addSlide();
    s.background = { fill: C.white };

    // Left accent stripe
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 0.08, h: H,
      fill: { color: C.primary }, line: { type: "none" },
    });

    // Slide heading
    const heading = sl.heading ?? sl.title ?? `Slide ${idx + 2}`;
    s.addText(heading, {
      x: 0.28, y: 0.22, w: W - 0.56, h: 0.78,
      fontSize: 26, bold: true, color: C.dark,
      align: "left", fontFace: "Calibri",
    });

    // Hairline rule
    s.addShape(prs.ShapeType.rect, {
      x: 0.28, y: 1.05, w: W - 0.56, h: 0.03,
      fill: { color: C.border }, line: { type: "none" },
    });

    const bullets = Array.isArray(sl.bullets) ? sl.bullets : [];
    const body    = sl.body   ?? null;
    const table   = sl.table  ?? null;

    if (table && Array.isArray(table.rows)) {
      // Table layout
      const headers  = Array.isArray(table.headers) ? table.headers : [];
      const hRow = headers.map(h => ({
        text: String(h ?? ""),
        options: { bold: true, color: C.white, fill: C.dark, fontFace: "Calibri", fontSize: 13 },
      }));
      const dRows = table.rows.map((row, ri) =>
        (Array.isArray(row) ? row : [row]).map(cell => ({
          text: String(cell ?? ""),
          options: {
            color: C.ink, fontFace: "Calibri", fontSize: 12,
            fill: ri % 2 === 0 ? C.white : C.light,
          },
        }))
      );
      const allRows = hRow.length ? [hRow, ...dRows] : dRows;
      if (allRows.length) {
        s.addTable(allRows, {
          x: 0.28, y: 1.15, w: W - 0.56,
          border: { type: "solid", pt: 0.4, color: C.border },
          autoPage: true,
        });
      }
    } else if (bullets.length > 0) {
      const items = bullets.map(b => ({
        text: String(b),
        options: {
          bullet: { type: "bullet", code: "2022", indent: 20 },
          fontSize: 18, color: C.ink, breakLine: true,
          paraSpaceBefore: 6, fontFace: "Calibri",
        },
      }));
      s.addText(items, {
        x: 0.35, y: 1.18, w: W - 0.7, h: H - 1.55, valign: "top",
      });
    } else if (body) {
      s.addText(String(body), {
        x: 0.35, y: 1.18, w: W - 0.7, h: H - 1.55,
        fontSize: 16, color: C.ink, align: "left",
        fontFace: "Calibri", valign: "top", wrap: true,
      });
    }

    // Slide number
    s.addText(`${idx + 2}`, {
      x: W - 0.45, y: H - 0.38, w: 0.32, h: 0.25,
      fontSize: 9, color: C.muted, align: "right", fontFace: "Calibri",
    });
  }

  await prs.writeFile({ fileName: targetPath });
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

async function renderDocx(targetPath, outline) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle, TableCell, TableRow, Table,
    WidthType, ShadingType, convertInchesToTwip, UnderlineType,
  } = await import("docx");
  await ensureParentDir(targetPath);

  const children = [];

  // Title block
  if (outline.title) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: outline.title, bold: true, size: 52, color: C.dark, font: "Calibri" }),
        ],
        heading: HeadingLevel.TITLE,
        spacing: { after: 80 },
      })
    );
  }
  if (outline.subtitle) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: outline.subtitle, size: 28, color: C.muted, font: "Calibri" }),
        ],
        spacing: { after: 80 },
      })
    );
  }
  if (outline.author || outline.date) {
    const meta = [outline.author, outline.date].filter(Boolean).join("   ·   ");
    children.push(
      new Paragraph({
        children: [new TextRun({ text: meta, size: 18, color: C.muted, font: "Calibri" })],
        spacing: { after: 320 },
      })
    );
  }

  // Horizontal rule after title block
  if (outline.title) {
    children.push(
      new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.border } },
        spacing: { after: 240 },
      })
    );
  }

  // Sections
  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides)                ? outline.slides
    : [];

  for (const sec of sections) {
    const heading = sec.heading ?? sec.title;
    if (heading) {
      const isH2 = sec.level === 2;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: heading, bold: true, font: "Calibri",
              size:  isH2 ? 28 : 36,
              color: isH2 ? C.ink : C.dark,
            }),
          ],
          heading: isH2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
          spacing: { before: isH2 ? 280 : 400, after: 100 },
          border: isH2 ? {} : {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: C.border },
          },
        })
      );
    }

    // Body text (multi-paragraph)
    if (sec.body) {
      for (const para of String(sec.body).split(/\n\n+/)) {
        const text = para.replace(/\n/g, " ").trim();
        if (text) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text, size: 22, color: C.ink, font: "Calibri" })],
              spacing: { after: 140 },
            })
          );
        }
      }
    }

    // Bullet list
    if (Array.isArray(sec.bullets)) {
      for (const b of sec.bullets) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: String(b), size: 22, color: C.ink, font: "Calibri" })],
            bullet: { level: 0 },
            spacing: { after: 70 },
          })
        );
      }
      children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
    }

    // Table
    if (sec.table && Array.isArray(sec.table.rows)) {
      const headers = Array.isArray(sec.table.headers) ? sec.table.headers : [];
      const rows    = sec.table.rows;

      const makeCell = (text, isHeader) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(text ?? ""), bold: isHeader,
                  size: 20, color: isHeader ? C.white : C.ink, font: "Calibri",
                }),
              ],
            }),
          ],
          shading: isHeader ? { fill: C.dark, type: ShadingType.SOLID } : undefined,
          margins: {
            top:    convertInchesToTwip(0.05), bottom: convertInchesToTwip(0.05),
            left:   convertInchesToTwip(0.1),  right:  convertInchesToTwip(0.1),
          },
        });

      const tableRows = [];
      if (headers.length) {
        tableRows.push(new TableRow({ children: headers.map(h => makeCell(h, true)) }));
      }
      for (let ri = 0; ri < rows.length; ri++) {
        const cells = Array.isArray(rows[ri]) ? rows[ri] : [rows[ri]];
        const tr = new TableRow({
          children: cells.map(c => makeCell(c, false)),
        });
        // Shade alternate rows
        if (ri % 2 === 1) {
          tr.children.forEach(cell => {
            if (!cell.options?.shading) {
              cell.options = cell.options ?? {};
              cell.options.shading = { fill: "F8FAFC", type: ShadingType.SOLID };
            }
          });
        }
        tableRows.push(tr);
      }

      if (tableRows.length) {
        children.push(
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );
        children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
      }
    }
  }

  // Plain body fallback (no sections)
  if (outline.body && sections.length === 0) {
    for (const para of String(outline.body).split(/\n\n+/)) {
      const text = para.replace(/\n/g, " ").trim();
      if (text) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text, size: 22, color: C.ink, font: "Calibri" })],
            spacing: { after: 140 },
          })
        );
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22, color: C.ink } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1.0),
            right:  convertInchesToTwip(1.0),
            bottom: convertInchesToTwip(1.0),
            left:   convertInchesToTwip(1.2),
          },
        },
      },
      children: children.length ? children : [new Paragraph({ text: "" })],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(targetPath, buffer);
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

async function renderXlsx(targetPath, outline) {
  const { default: ExcelJS } = await import("exceljs");
  await ensureParentDir(targetPath);

  const wb = new ExcelJS.Workbook();
  wb.creator  = outline.author ?? "UCA";
  wb.modified = new Date();

  // Support `sheets` array or single-sheet outline
  const sheetsSpec = Array.isArray(outline.sheets)
    ? outline.sheets
    : [{ name: outline.sheetName ?? "Sheet1", headers: outline.headers, rows: outline.rows }];

  for (const spec of sheetsSpec) {
    const ws = wb.addWorksheet(String(spec.name ?? "Sheet1"));

    const rawHeaders = Array.isArray(spec.headers) ? spec.headers : [];
    const rawRows    = Array.isArray(spec.rows)    ? spec.rows    : [];

    // If no explicit headers, treat first data row as headers
    const headers  = rawHeaders.length > 0 ? rawHeaders
      : (rawRows.length > 0 && Array.isArray(rawRows[0]) ? rawRows[0] : []);
    const dataRows = rawHeaders.length > 0 ? rawRows
      : rawRows.slice(headers === rawRows[0] ? 1 : 0);

    if (headers.length > 0) {
      ws.columns = headers.map((h, i) => ({
        header: String(h ?? `Col ${i + 1}`),
        key:    `c${i}`,
        width:  Math.max(12, String(h ?? "").length + 4),
      }));

      // Style header row
      const hRow = ws.getRow(1);
      hRow.height = 22;
      hRow.eachCell(cell => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${C.dark}` } };
        cell.font      = { bold: true, color: { argb: `FF${C.white}` }, name: "Calibri", size: 11 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
        cell.border    = borderStyle(C.border);
      });

      // Auto-filter
      const lastCol = colLetter(headers.length);
      ws.autoFilter = `A1:${lastCol}1`;
    }

    // Data rows
    for (let ri = 0; ri < dataRows.length; ri++) {
      const rowArr = Array.isArray(dataRows[ri]) ? dataRows[ri] : [dataRows[ri]];
      const rowObj = {};
      rowArr.forEach((v, j) => { rowObj[`c${j}`] = v ?? ""; });
      const row = ws.addRow(rowObj);
      row.height = 18;

      const fillArgb = ri % 2 === 0 ? `FF${C.white}` : `FF${C.light}`;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        cell.font      = { name: "Calibri", size: 11, color: { argb: `FF${C.ink}` } };
        cell.alignment = { vertical: "middle" };
        cell.border    = borderStyle(C.border);
        // Number / date detection
        const val = cell.value;
        if (typeof val === "number") {
          cell.numFmt = Number.isInteger(val) ? "0" : "0.00";
          cell.alignment.horizontal = "right";
        }
      });
    }

    // Auto-size columns based on content
    ws.columns.forEach(col => {
      let max = col.header ? String(col.header).length : 0;
      col.eachCell({ includeEmpty: false }, c => {
        const len = c.value != null ? String(c.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(Math.max(max + 4, 10), 60);
    });

    // Freeze header row
    ws.views = [{ state: "frozen", ySplit: headers.length > 0 ? 1 : 0, showGridLines: true }];
  }

  await wb.xlsx.writeFile(targetPath);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function borderStyle(color) {
  const s = { style: "thin", color: { argb: `FF${color}` } };
  return { top: s, bottom: s, left: s, right: s };
}

function colLetter(n) {
  let result = "";
  while (n > 0) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || "A";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function diagramCodeOf(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.code ?? value.mermaid ?? value.source ?? "").trim();
}

function diagramCaptionOf(value) {
  if (!value || typeof value !== "object") return "";
  return String(value.caption ?? value.title ?? "").trim();
}

function sectionDiagrams(section = {}) {
  const diagrams = [];
  if (section.diagram) diagrams.push(section.diagram);
  if (Array.isArray(section.diagrams)) diagrams.push(...section.diagrams);
  return diagrams
    .map((entry) => ({
      code: diagramCodeOf(entry),
      caption: diagramCaptionOf(entry)
    }))
    .filter((entry) => entry.code);
}

function svgMarkupOf(value) {
  if (typeof value === "string") return sanitizeSvgMarkup(value);
  if (!value || typeof value !== "object") return "";
  return sanitizeSvgMarkup(value.svg ?? value.markup ?? value.source ?? "");
}

function svgCaptionOf(value) {
  if (!value || typeof value !== "object") return "";
  return String(value.caption ?? value.title ?? "").trim();
}

function sectionSvgs(section = {}) {
  const svgs = [];
  if (section.svg) svgs.push(section.svg);
  if (Array.isArray(section.svgs)) svgs.push(...section.svgs);
  return svgs
    .map((entry) => ({
      svg: svgMarkupOf(entry),
      caption: svgCaptionOf(entry)
    }))
    .filter((entry) => entry.svg);
}

function renderPreviewStyles() {
  return `
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --ink: #1e293b;
      --muted: #64748b;
      --line: #e2e8f0;
      --accent: #2563eb;
      --soft: #eff6ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.6 "Segoe UI", Calibri, Arial, sans-serif;
    }
    .doc {
      max-width: 1080px;
      margin: 0 auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 28px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    .doc-head { margin-bottom: 20px; }
    .doc-kicker { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .doc-title { margin: 8px 0 4px; font-size: 30px; line-height: 1.2; }
    .doc-sub { color: var(--muted); margin: 0 0 8px; }
    .slide { border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin-top: 14px; background: linear-gradient(180deg, #fff 0%, #fbfdff 100%); }
    .slide-head { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .slide-body, .section-body { white-space: pre-wrap; }
    .doc-diagram { margin: 16px 0; }
    .doc-diagram .mermaid { max-width: 100%; }
    .doc-diagram figcaption { margin-top: 6px; color: var(--muted); text-align: center; font-size: 12px; }
    .doc-svg { margin: 16px 0; text-align: center; }
    .doc-svg svg { max-width: 100%; height: auto; }
    .doc-svg figcaption { margin-top: 6px; color: var(--muted); text-align: center; font-size: 12px; }
    pre.mermaid-fallback { background: #f1f5f9; border: 1px solid var(--line); border-radius: 6px; padding: 12px; white-space: pre-wrap; }
    .slide ul, .section ul { margin: 10px 0 0 18px; padding: 0; }
    .section { padding: 18px 0; border-top: 1px solid var(--line); }
    .section:first-of-type { border-top: 0; padding-top: 4px; }
    .section h2 { margin: 0 0 8px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #1e293b; color: #fff; }
    tr:nth-child(even) td { background: #f8fafc; }
    .sheet { margin-top: 18px; }
    .sheet-name { font-weight: 700; margin-bottom: 8px; }
  `;
}

function wrapPreviewHtml(title, body, kindLabel = "") {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title || "Preview")}</title>
    ${renderMermaidScriptTag()}
    <style>${renderPreviewStyles()}</style>
  </head>
  <body>
    <article class="doc">
      <header class="doc-head">
        ${kindLabel ? `<div class="doc-kicker">${escapeHtml(kindLabel)}</div>` : ""}
        ${title ? `<h1 class="doc-title">${escapeHtml(title)}</h1>` : ""}
      </header>
      ${body}
    </article>
    <script>
      if (typeof mermaid !== "undefined") {
        mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
      } else {
        document.querySelectorAll(".mermaid").forEach(el => {
          const pre = document.createElement("pre");
          pre.className = "mermaid-fallback";
          pre.textContent = el.textContent;
          el.replaceWith(pre);
        });
      }
    </script>
  </body>
</html>`;
}

function renderBullets(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<ul>${items.filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPreviewTable(table = null) {
  if (!table || typeof table !== "object") return "";
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (headers.length === 0 && rows.length === 0) return "";
  return `
    <table>
      ${headers.length > 0 ? `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>` : ""}
      <tbody>
        ${rows.map((row) => `<tr>${(Array.isArray(row) ? row : [row]).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderPreviewDiagrams(section = {}) {
  const diagrams = sectionDiagrams(section);
  if (diagrams.length === 0) return "";
  return diagrams.map((diagram) => `
    <figure class="doc-diagram">
      <div class="mermaid">${escapeHtml(diagram.code)}</div>
      ${diagram.caption ? `<figcaption>${escapeHtml(diagram.caption)}</figcaption>` : ""}
    </figure>
  `).join("");
}

function renderPreviewSvgs(section = {}) {
  const svgs = sectionSvgs(section);
  if (svgs.length === 0) return "";
  return svgs.map((svg) => `
    <figure class="doc-svg">
      ${svg.svg}
      ${svg.caption ? `<figcaption>${escapeHtml(svg.caption)}</figcaption>` : ""}
    </figure>
  `).join("");
}

export function renderDocumentPreviewHtml({ kind, outline = {}, title = "" } = {}) {
  const resolvedTitle = title || outline.title || "Preview";
  if (kind === "pptx") {
    const slides = Array.isArray(outline.slides) ? outline.slides : [];
    const body = `
      ${outline.subtitle ? `<p class="doc-sub">${escapeHtml(outline.subtitle)}</p>` : ""}
      ${slides.map((slide, index) => `
        <section class="slide">
          <div class="slide-head">幻灯片 ${index + 1}${slide?.heading ? ` · ${escapeHtml(slide.heading)}` : ""}</div>
          ${slide?.body ? `<div class="slide-body">${escapeHtml(slide.body)}</div>` : ""}
          ${renderPreviewDiagrams(slide)}
          ${renderPreviewSvgs(slide)}
          ${renderBullets(slide?.bullets)}
          ${renderPreviewTable(slide?.table)}
        </section>
      `).join("")}
    `;
    return wrapPreviewHtml(resolvedTitle, body, "PowerPoint Preview");
  }

  if (kind === "xlsx") {
    const sheets = Array.isArray(outline.sheets)
      ? outline.sheets
      : [{ name: outline.sheetName ?? "Sheet1", headers: outline.headers ?? [], rows: outline.rows ?? [] }];
    const body = sheets.map((sheet) => {
      const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      return `
        <section class="sheet">
          <div class="sheet-name">${escapeHtml(sheet.name ?? "Sheet")}</div>
          ${renderPreviewTable({ headers, rows })}
        </section>
      `;
    }).join("");
    return wrapPreviewHtml(resolvedTitle, body, "Excel Preview");
  }

  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides) ? outline.slides
      : [];
  const body = `
    ${outline.subtitle ? `<p class="doc-sub">${escapeHtml(outline.subtitle)}</p>` : ""}
    ${sections.map((section) => `
      <section class="section">
        ${section?.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""}
        ${section?.body ? `<div class="section-body">${escapeHtml(section.body)}</div>` : ""}
        ${renderPreviewDiagrams(section)}
        ${renderPreviewSvgs(section)}
        ${renderBullets(section?.bullets)}
        ${renderPreviewTable(section?.table)}
      </section>
    `).join("")}
  `;
  return wrapPreviewHtml(resolvedTitle, body, kind === "pdf" ? "PDF Preview" : "Word Preview");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a document artifact.
 * @param {{ kind: "pptx"|"docx"|"xlsx", targetPath: string, outline: object }} opts
 */
export async function renderDocument({ kind, targetPath, outline }) {
  const o = outline ?? {};
  switch (kind) {
    case "pptx": return renderPptx(targetPath, o);
    case "docx": return renderDocx(targetPath, o);
    case "xlsx": return renderXlsx(targetPath, o);
    default:     throw new Error(`renderDocument: unsupported kind "${kind}"`);
  }
}
