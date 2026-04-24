// HTML passthrough provider (UCA-182 Phase 2).
//
// `.html` / `.htm` files are already HTML; the provider's only job
// is to wrap whatever the user has on disk in the preview shell so
// it renders in the same theme as the other previews. When the
// file already looks like a complete HTML document (has <html> or
// <!doctype>), we serve it verbatim and let the renderer-side
// iframe sandbox contain any embedded scripts. Partial fragments
// are wrapped in our shell.
//
// Note: the sidecar provider (priority 100) still wins for
// `<name>-preview.html`, which is what `generate_document` produces
// for its own artefacts. This passthrough is the fallback for
// arbitrary HTML files the user opens directly.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell } from "../preview-shell.mjs";

export const HTML_PASSTHROUGH_PROVIDER = {
  id: "html-passthrough",
  extensions: [".html", ".htm"],
  mimePrefixes: ["text/html"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const raw = await readFile(ctx.filePath, "utf8");
    const parsed = path.parse(ctx.filePath);

    if (looksLikeCompleteDocument(raw)) {
      return {
        kind: "html",
        cacheable: true,
        html: raw,
        meta: { mode: "verbatim" }
      };
    }

    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: "html",
        bodyHtml: `<section class="preview-surface preview-content">${raw}</section>`
      }),
      meta: { mode: "wrapped" }
    };
  }
};

function looksLikeCompleteDocument(source) {
  const head = source.slice(0, 2048).toLowerCase();
  return head.includes("<!doctype") || head.includes("<html");
}
