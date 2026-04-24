// DOCX preview provider (UCA-182 Phase 2).
//
// Uses mammoth to convert the Word document into semantic HTML.
// mammoth preserves paragraph structure, headings, lists, tables
// and basic inline formatting; it intentionally ignores page-level
// concerns (page breaks, headers/footers, columns) — which matches
// what a web-based preview pane should show anyway.
//
// Images embedded in the docx are inlined as data URLs (mammoth's
// default handler) so the HTML is self-contained and cacheable.
//
// Any mammoth warning (e.g. unmapped style) is preserved in the
// provider's meta output for diagnostics but never surfaced as a
// user-visible error — mammoth is tolerant and always produces some
// HTML, even for malformed docx.

import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

export const DOCX_PROVIDER = {
  id: "docx",
  extensions: [".docx"],
  mimePrefixes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  priority: 10,
  version: "2",
  async render(ctx) {
    const mammothMod = await import("mammoth");
    const mammoth = mammothMod.default ?? mammothMod;
    const { value: bodyHtml, messages } = await mammoth.convertToHtml(
      { path: ctx.filePath },
      { styleMap: defaultStyleMap() }
    );
    const parsed = path.parse(ctx.filePath);
    const warnings = (messages ?? []).filter((m) => m.type === "warning").slice(0, 10);
    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: "docx",
        extraHead: WORD_PAPER_CSS,
        bodyHtml: `<div class="preview-word-page"><div class="preview-word-body">${bodyHtml}</div></div>`
      }),
      meta: {
        warnings: warnings.map((w) => w.message),
        messageCount: messages?.length ?? 0
      }
    };
  }
};

/**
 * Extended style map so mammoth maps common Word / `generate_document`
 * styles onto semantic HTML we can then shape with the Word-like CSS
 * below. Bumped version to "2" invalidates any cache from Phase 2.
 */
function defaultStyleMap() {
  return [
    "p[style-name='Title'] => h1.preview-title-block:fresh",
    "p[style-name='Subtitle'] => h2.preview-subtitle:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Heading 5'] => h5:fresh",
    "p[style-name='Heading 6'] => h6:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote.preview-intense:fresh",
    "p[style-name='Normal'] => p:fresh",
    "p[style-name='List Paragraph'] => p.preview-list-para:fresh",
    "p[style-name='Caption'] => p.preview-caption:fresh",
    "r[style-name='Emphasis'] => em",
    "r[style-name='Strong'] => strong",
    "r[style-name='Intense Emphasis'] => em.preview-intense",
    "r[style-name='Book Title'] => strong.preview-book-title"
  ];
}

// UCA-182 Phase 10a: make the preview look like a Word page. A4
// portrait at 96dpi is 816 × 1123 px; we render on a centred "paper"
// with a light shadow so headings, lists and tables look like their
// Word counterparts rather than generic HTML.
const WORD_PAPER_CSS = `<style>
.preview-word-page {
  max-width: 816px;
  margin: 20px auto 40px;
  background: #ffffff;
  color: #2c2c2c;
  padding: 56px 72px;
  border-radius: 2px;
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.12);
  border: 1px solid #e5e5e5;
  font-family: "Calibri", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif;
  font-size: 11pt;
  line-height: 1.45;
}
@media (prefers-color-scheme: dark) {
  .preview-word-page {
    background: #f7f5ef;  /* keep light "paper" look even in dark shell */
    color: #2c2c2c;
  }
}
.preview-word-body { position: relative; }
.preview-word-body > *:first-child { margin-top: 0; }
.preview-word-body > *:last-child  { margin-bottom: 0; }
.preview-word-body p { margin: 0 0 8pt; text-align: justify; }
.preview-word-body h1,
.preview-word-body h2,
.preview-word-body h3,
.preview-word-body h4,
.preview-word-body h5,
.preview-word-body h6 {
  font-family: "Calibri Light", "Calibri", "PingFang SC", sans-serif;
  color: #2e74b5;
  font-weight: 400;
  line-height: 1.2;
  margin: 20pt 0 6pt;
  page-break-after: avoid;
}
.preview-word-body h1 { font-size: 22pt; margin-top: 0; color: #1f3864; }
.preview-word-body h1.preview-title-block { font-size: 28pt; color: #1f3864; font-weight: 300; border-bottom: 1px solid #2e74b5; padding-bottom: 4pt; }
.preview-word-body h2 { font-size: 16pt; }
.preview-word-body h3 { font-size: 13pt; color: #1f4e79; }
.preview-word-body h4 { font-size: 12pt; color: #2e74b5; font-weight: 600; }
.preview-word-body h5 { font-size: 11pt; color: #2e74b5; font-weight: 600; }
.preview-word-body h6 { font-size: 11pt; color: #2e74b5; font-style: italic; }
.preview-word-body h2.preview-subtitle { color: #595959; font-size: 14pt; font-weight: 300; letter-spacing: 0.02em; margin-top: 0; }
.preview-word-body blockquote {
  margin: 10pt 20pt;
  padding: 4pt 14pt;
  border-left: 3px solid #2e74b5;
  color: #404040;
  font-style: italic;
}
.preview-word-body blockquote.preview-intense {
  background: #deeaf6;
  color: #1f3864;
  font-weight: 500;
  border-left-color: #1f4e79;
}
.preview-word-body p.preview-caption {
  font-size: 10pt;
  color: #595959;
  font-style: italic;
  text-align: center;
  margin: 4pt 0 10pt;
}
.preview-word-body ul, .preview-word-body ol { margin: 0 0 8pt 20pt; padding-left: 8pt; }
.preview-word-body li { margin-bottom: 2pt; }
.preview-word-body strong { font-weight: 700; color: inherit; }
.preview-word-body em { font-style: italic; }
.preview-word-body em.preview-intense { color: #2e74b5; font-weight: 600; font-style: normal; }
.preview-word-body strong.preview-book-title { color: #1f3864; }
.preview-word-body a { color: #0563c1; text-decoration: underline; }
.preview-word-body table {
  border-collapse: collapse;
  margin: 10pt 0;
  width: 100%;
  font-size: 10.5pt;
}
.preview-word-body table th,
.preview-word-body table td {
  border: 1px solid #bfbfbf;
  padding: 4pt 8pt;
  text-align: left;
  vertical-align: top;
}
.preview-word-body table th {
  background: #2e74b5;
  color: #ffffff;
  font-weight: 600;
}
.preview-word-body table tr:nth-child(even) td { background: #f2f2f2; }
.preview-word-body img { max-width: 100%; height: auto; margin: 6pt 0; }
.preview-word-body hr { border: none; border-top: 1px solid #d0d0d0; margin: 14pt 0; }
@media print {
  .preview-word-page { box-shadow: none; border: none; margin: 0; }
}
</style>`;
