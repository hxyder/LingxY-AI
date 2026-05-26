// Image preview provider (UCA-182 Phase 2).
//
// Reads the image and embeds it as a data URL inside the standard
// preview shell. Embedding keeps the HTML self-contained (cacheable,
// portable, easy to inspect) at the cost of a ~33% base64 overhead;
// acceptable for screenshots / icons that preview users open.
//
// For very large images (>8 MB) we fall back to a native-open hint
// rather than inlining — the user can still view them in an
// external viewer via the file chip.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";
import { sanitizeSvgMarkup } from "../../capabilities/tools/svg-sanitize.mjs";

const MAX_INLINE_BYTES = 8 * 1024 * 1024;
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml"
};

export const IMAGE_PROVIDER = {
  id: "image",
  extensions: Object.keys(MIME_BY_EXT),
  mimePrefixes: ["image/"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const info = await stat(ctx.filePath).catch(() => null);
    if (!info) {
      return { kind: "native-open", cacheable: false, meta: { reason: "stat_failed" } };
    }
    if (info.size > MAX_INLINE_BYTES) {
      return {
        kind: "native-open",
        cacheable: false,
        meta: { reason: "image_too_large", size: info.size }
      };
    }
    const mime = MIME_BY_EXT[ctx.ext] ?? "application/octet-stream";
    const parsed = path.parse(ctx.filePath);
    const bytes = await readFile(ctx.filePath);

    let body;
    if (ctx.ext === ".svg") {
      // SVG: keep safe markup only; the sanitizer removes active content.
      const svgText = sanitizeSvgMarkup(bytes.toString("utf8"));
      if (!svgText) {
        return { kind: "native-open", cacheable: false, meta: { reason: "unsafe_svg", size: info.size } };
      }
      body = `<div class="preview-surface preview-content" style="text-align:center;">${svgText}</div>`;
    } else {
      const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
      body = `<section class="preview-surface preview-content" style="text-align:center;">
  <img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(parsed.base)}" style="max-width:100%;height:auto;border-radius:6px;">
  <p class="preview-muted" style="color:var(--preview-muted);margin-top:12px;font-size:12px;">${escapeHtml(parsed.base)} · ${formatBytes(info.size)}</p>
</section>`;
    }

    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: ctx.ext.replace(/^\./, "") || "image",
        bodyHtml: body
      }),
      meta: { bytes: info.size, mime }
    };
  }
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
