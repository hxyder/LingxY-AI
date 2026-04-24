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
  version: "1",
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
        bodyHtml: `<section class="preview-surface preview-content">${bodyHtml}</section>`
      }),
      meta: {
        warnings: warnings.map((w) => w.message),
        messageCount: messages?.length ?? 0
      }
    };
  }
};

/**
 * Minimal style map so mammoth maps common LingxY-generated docx
 * styles onto sane semantic HTML tags. mammoth already has decent
 * defaults; we only lock in a few that our own `generate_document`
 * emits.
 */
function defaultStyleMap() {
  return [
    "p[style-name='Title'] => h1.preview-title-block:fresh",
    "p[style-name='Subtitle'] => h2.preview-subtitle:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote.preview-intense:fresh"
  ];
}
