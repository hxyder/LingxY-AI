// Phase 10 verifier (UCA-182) — docx Word-like CSS / xlsx cell styles
// / pptx coordinate layout.
//
// Goal: each of the three binary office providers produces output
// that is visually "Office-like" rather than generic HTML. We don't
// screenshot-diff in CI; we assert on structural markers that prove
// the upgrade landed.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DOCX_PROVIDER } from "../src/service/preview/providers/docx.mjs";
import { XLSX_PROVIDER } from "../src/service/preview/providers/xlsx.mjs";
import { PPTX_PROVIDER } from "../src/service/preview/providers/pptx.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-preview-p10-"));

// --- 10a docx: Word-like paper + extended style map ------------------
{
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "My Title", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("Body copy.")
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  const file = path.join(tmpRoot, "w.docx");
  writeFileSync(file, buffer);

  const result = await DOCX_PROVIDER.render({ filePath: file, ext: ".docx", mime: null });
  assert.equal(result.kind, "html");
  assert.ok(/class="preview-word-page"/.test(result.html), "docx must render inside .preview-word-page");
  assert.ok(/class="preview-word-body"/.test(result.html), "docx must render inside .preview-word-body");
  assert.ok(/max-width:\s*816px/.test(result.html), "docx paper must be A4-width (816px)");
  assert.ok(/color:\s*#2e74b5/i.test(result.html) || /color:\s*#1f3864/i.test(result.html),
    "docx must use Word heading blue");
  assert.equal(DOCX_PROVIDER.version, "2", "docx version bump invalidates old cache");
}

// --- 10b xlsx: cell inline styles + colgroup + sticky thead ---------
{
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Styled", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "Name", key: "name", width: 20 },
    { header: "Score", key: "score", width: 12 }
  ];
  const row = sheet.addRow({ name: "Alpha", score: 42 });
  const scoreCell = row.getCell(2);
  scoreCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB3B" } };
  scoreCell.font = { bold: true, color: { argb: "FFB71C1C" } };
  const out = path.join(tmpRoot, "styled.xlsx");
  await wb.xlsx.writeFile(out);

  const result = await XLSX_PROVIDER.render({ filePath: out, ext: ".xlsx", mime: null });
  assert.equal(result.kind, "html");
  assert.ok(/<colgroup>\s*(<col[^>]*>){2}/.test(result.html),
    "xlsx must emit a <colgroup> matching column count");
  assert.ok(/style="width:150px"/.test(result.html),
    "width=20 chars → 150px via the 7.5px/char heuristic");
  assert.ok(/background-color:#FFEB3B/i.test(result.html),
    "xlsx must inline cell fill color");
  assert.ok(/color:#B71C1C/i.test(result.html),
    "xlsx must inline cell font color");
  assert.ok(/font-weight:700/i.test(result.html),
    "xlsx must inline bold font");
  assert.ok(/<thead class="sticky">/.test(result.html),
    "xlsx must mark thead sticky when workbook has a freeze pane");
  assert.equal(XLSX_PROVIDER.version, "2", "xlsx version bump invalidates old cache");
}

// --- 10c pptx: coordinate layout ------------------------------------
{
  const pptxgenMod = await import("pptxgenjs");
  const PptxGen = pptxgenMod.default ?? pptxgenMod;
  const pres = new PptxGen();
  const s1 = pres.addSlide();
  s1.addText("Coordinate Title", { x: 1, y: 0.5, w: 7, h: 1, fontSize: 36, bold: true });
  s1.addText("Positioned bullet", { x: 1, y: 2, w: 7, h: 0.8, fontSize: 18 });
  const s2 = pres.addSlide();
  s2.addText("Second slide", { x: 1, y: 0.5, w: 7, h: 1, fontSize: 32 });
  const out = path.join(tmpRoot, "coords.pptx");
  await pres.writeFile({ fileName: out });

  const runtime = {};
  const result = await PPTX_PROVIDER.render({ filePath: out, ext: ".pptx", mime: null, runtime });
  assert.equal(result.kind, "html");
  const slideMatches = result.html.match(/class="pptx-slide"/g) ?? [];
  assert.ok(slideMatches.length >= 2, `expected ≥2 slides, got ${slideMatches.length}`);
  // Each slide needs a fixed pixel-size frame so absolute positioning works.
  assert.ok(/width:\d+px;height:\d+px/.test(result.html),
    "pptx slide must carry fixed pixel dimensions");
  // Shapes must be absolutely positioned.
  const absCount = (result.html.match(/position:absolute/g) ?? []).length;
  assert.ok(absCount >= 2, `expected multiple position:absolute shapes, got ${absCount}`);
  // Text content came through.
  assert.ok(/Coordinate Title/.test(result.html), "title text must be extracted");
  assert.ok(/Second slide/.test(result.html), "second slide text must be extracted");
  // Font size preserved (pptxgenjs writes sz in 1/100pt; renderer /100).
  assert.ok(/font-size:36pt/.test(result.html) || /font-size:32pt/.test(result.html),
    "run font sizes must survive the coordinate pipeline");
  assert.equal(result.meta?.via, "jszip-coords");
  assert.equal(PPTX_PROVIDER.version, "3");
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-phase10");
