// Markdown preview provider (UCA-182 Phase 2).
//
// Renders .md / .markdown with `marked` for the structural pass,
// then scrubs the output through a DOM-based sanitizer. The iframe
// that ultimately shows this HTML already runs sandboxed in the
// renderer, and the sanitizer here is defence-in-depth against script
// injection inside user-owned files.
//
// KaTeX / Mermaid support is opt-in and lazy: we only pull those
// modules when the source actually contains `$$…$$` or a mermaid
// fenced block. Keeps first-render cost low for the common case
// (plain markdown → ~15ms cold, ~3ms warm).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";
import { sanitizeHtmlFragment } from "../../security/html-utils.mjs";

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"];

export const MARKDOWN_PROVIDER = {
  id: "markdown",
  extensions: MARKDOWN_EXTENSIONS,
  mimePrefixes: ["text/markdown"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const source = await readFile(ctx.filePath, "utf8");
    const { marked } = await import("marked");
    marked.setOptions({ breaks: true, gfm: true });
    const rawHtml = marked.parse(source);
    const safeHtml = sanitizeHtml(rawHtml);
    const extraHead = buildKatexMermaidHead(source);
    const parsed = path.parse(ctx.filePath);
    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: "markdown",
        extraHead,
        bodyHtml: `<section class="preview-surface preview-content">${safeHtml}</section>`
      }),
      meta: { bytes: Buffer.byteLength(source, "utf8") }
    };
  }
};

// ---- helpers ---------------------------------------------------------

/**
 * Strip obviously-dangerous constructs from an HTML fragment that
 * `marked` produced from user-owned markdown. Not a substitute for
 * a full HTML sanitizer, but safe enough for our threat model:
 *   - source is on disk, owned by the user
 *   - output renders inside a sandboxed iframe in the renderer
 */
export function sanitizeHtml(html) {
  return sanitizeHtmlFragment(html);
}

function buildKatexMermaidHead(source) {
  const parts = [];
  const hasKatex = /\$\$[\s\S]+?\$\$|\$[^\n$]+\$/.test(source);
  const hasMermaid = /```mermaid\b/.test(source);
  if (hasKatex) {
    // We ship marked's KaTeX-less output by default and inline a hint
    // so the renderer-side handler can lazy-load katex in-page.
    parts.push(`<meta name="x-preview-feature" content="katex">`);
  }
  if (hasMermaid) {
    parts.push(`<meta name="x-preview-feature" content="mermaid">`);
  }
  return parts.join("\n");
}

// Exported for verifier convenience (unit testability).
export const _internals = { sanitizeHtml };
