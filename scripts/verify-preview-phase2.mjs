// Phase 2 verifier (UCA-182) — real renderers for docx / xlsx / md /
// text / image / csv / html-passthrough.
//
// Each section generates a temporary fixture via the libraries we
// ship with (docx, exceljs, raw bytes for PNG / CSV / MD) and then
// asks the preview registry to render it. Assertions focus on
// structural features the provider must produce, without coupling
// to exact whitespace.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPreviewRegistry } from "../src/service/preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../src/service/preview/providers/index.mjs";
import { parseCsv } from "../src/service/preview/providers/csv.mjs";
import { sanitizeHtml } from "../src/service/preview/providers/markdown.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-preview-phase2-"));
const cacheDir = path.join(tmpRoot, "cache");
const registry = createPreviewRegistry({
  providers: BUILTIN_PREVIEW_PROVIDERS,
  cacheDir
});

// ---------------------------------------------------------------- markdown
{
  const md = path.join(tmpRoot, "sample.md");
  writeFileSync(md, "# Hello\n\n**bold** and a list:\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n");
  const result = await registry.render(md);
  assert.equal(result.kind, "html", "markdown → html");
  assert.ok(/<h1[^>]*>Hello<\/h1>/i.test(result.html), "markdown rendered h1");
  assert.ok(/<strong>bold<\/strong>/i.test(result.html), "bold rendered");
  assert.ok(/<li>one<\/li>/i.test(result.html), "list item rendered");
  assert.ok(/<code[\s\S]*const x/i.test(result.html), "code block rendered");
  assert.equal(result.meta?.provider, "markdown");

  // sanitizer: scripts stripped.
  assert.ok(!/<script/i.test(sanitizeHtml("<p>hi</p><script>alert(1)</script>")));
  assert.ok(!/onerror=/i.test(sanitizeHtml('<img src=x onerror=alert(1)>')));
}

// -------------------------------------------------------------------- docx
{
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Big Title", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("A quick brown fox jumps over the lazy dog.")
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  const out = path.join(tmpRoot, "sample.docx");
  writeFileSync(out, buffer);

  const result = await registry.render(out);
  assert.equal(result.kind, "html", "docx → html");
  assert.ok(/<h1>Big Title<\/h1>/i.test(result.html), "mammoth emitted h1");
  assert.ok(/quick brown fox/i.test(result.html), "body text present");
  assert.equal(result.meta?.provider, "docx");
}

// -------------------------------------------------------------------- xlsx
{
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet1 = workbook.addWorksheet("Q1");
  sheet1.addRow(["Name", "Revenue", "Growth"]);
  sheet1.addRow(["Alpha", 12345, 0.12]);
  sheet1.addRow(["Beta", 678, 0.02]);
  const sheet2 = workbook.addWorksheet("Notes");
  sheet2.addRow(["Remark"]);
  sheet2.addRow(["Placeholder"]);
  const out = path.join(tmpRoot, "book.xlsx");
  await workbook.xlsx.writeFile(out);

  const result = await registry.render(out);
  assert.equal(result.kind, "html", "xlsx → html");
  assert.ok(/<table class="preview-xlsx">/.test(result.html), "table rendered");
  assert.ok(/Alpha/.test(result.html), "sheet data present");
  assert.ok(/nav class="preview-tabs"/.test(result.html), "multi-sheet tabs rendered");
  assert.ok(/<colgroup>/.test(result.html), "colgroup must carry column widths");
  assert.deepEqual(result.meta?.sheets, ["Q1", "Notes"]);
}

// -------------------------------------------------------------------- csv
{
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv('a,"b,c",d'), [["a", "b,c", "d"]]);
  assert.deepEqual(parseCsv('"""quoted"""'), [['"quoted"']]);

  const csv = path.join(tmpRoot, "list.csv");
  writeFileSync(csv, "name,score\nalpha,42\nbeta,73\n");
  const result = await registry.render(csv);
  assert.equal(result.kind, "html");
  assert.ok(/<table class="preview-table">/.test(result.html));
  assert.ok(/<th>name<\/th>/.test(result.html));
  assert.ok(/<td class="num">42<\/td>/.test(result.html), "numeric detection");
  assert.equal(result.meta?.rowCount, 3);
  assert.equal(result.meta?.columnCount, 2);
}

// -------------------------------------------------------------------- text
{
  const txt = path.join(tmpRoot, "notes.txt");
  writeFileSync(txt, "line 1\nline 2\n<script>should be escaped</script>\n");
  const result = await registry.render(txt);
  assert.equal(result.kind, "html");
  assert.ok(/<pre class="preview-pre">/.test(result.html));
  assert.ok(/&lt;script&gt;/.test(result.html), "text must be HTML-escaped");
  assert.equal(result.meta?.provider, "text");
}

// -------------------------------------------------------------------- image (PNG)
{
  // Minimal 1x1 red PNG.
  const png = Buffer.from(
    "89504E470D0A1A0A0000000D49484452000000010000000108020000009077538D000000" +
    "0C4944415408D76368D8CFC00F0000010100016040A0630000000049454E44AE426082",
    "hex"
  );
  const out = path.join(tmpRoot, "pixel.png");
  writeFileSync(out, png);
  const result = await registry.render(out);
  assert.equal(result.kind, "html");
  assert.ok(/<img src="data:image\/png;base64,/.test(result.html));
  assert.equal(result.meta?.provider, "image");
}

// -------------------------------------------------------------------- html passthrough
{
  // Fragment → should be wrapped.
  const frag = path.join(tmpRoot, "fragment.html");
  writeFileSync(frag, "<p>fragment</p>");
  const r1 = await registry.render(frag);
  assert.equal(r1.kind, "html");
  assert.ok(/<article class="preview-root">/.test(r1.html), "fragment wrapped in shell");
  assert.equal(r1.meta?.mode, "wrapped");

  // Complete doc → verbatim.
  const doc = path.join(tmpRoot, "doc.html");
  writeFileSync(doc, "<!doctype html><html><body><p>real doc</p></body></html>");
  const r2 = await registry.render(doc);
  assert.equal(r2.kind, "html");
  assert.ok(/<!doctype/i.test(r2.html), "complete document served verbatim");
  assert.equal(r2.meta?.mode, "verbatim");
}

// -------------------------------------------------------------------- cache roundtrip (second render should be cached)
{
  const md = path.join(tmpRoot, "cacheme.md");
  writeFileSync(md, "# cache test\n");
  const first = await registry.render(md);
  assert.equal(first.meta?.cached, false, "first render writes cache");
  const second = await registry.render(md);
  assert.ok(second.meta?.cached || second.meta?.source === "lru" || second.meta?.source === "disk",
    "second render hits cache");
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-phase2");
