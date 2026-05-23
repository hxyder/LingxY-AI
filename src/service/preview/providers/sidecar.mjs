// Sidecar provider (UCA-182) — highest priority.
//
// `generate_document` writes a `<artifact>-preview.html` file next to
// every produced docx/xlsx/pptx/pdf. The HTML is full-fidelity, was
// built from the same outline that produced the binary, and lives on
// disk — so we always prefer it over a fresh render.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const SIDECAR_PROVIDER = {
  id: "sidecar",
  extensions: [".docx", ".xlsx", ".pptx", ".pdf", ".html", ".htm"],
  priority: 100,
  version: "1",
  async canHandle(ctx) {
    const sidecar = sidecarPathFor(ctx.filePath);
    try {
      await stat(sidecar);
      return true;
    } catch { return false; }
  },
  async render(ctx) {
    const sidecar = sidecarPathFor(ctx.filePath);
    const html = await readFile(sidecar, "utf8");
    return {
      kind: "html",
      html,
      cacheable: false, // already on disk, cache would duplicate
      meta: { sidecarPath: sidecar }
    };
  }
};

function sidecarPathFor(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-preview.html`);
}
