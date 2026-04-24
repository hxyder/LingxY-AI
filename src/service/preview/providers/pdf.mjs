// PDF preview provider (UCA-182 Phase 4).
//
// The provider itself is deliberately tiny: it returns a
// "pdf-redirect" envelope so the http-server forwards the request
// to /file/pdf (which streams the raw bytes with proper PDF mime).
// The actual rendering happens in the renderer process via
// pdfjs-dist — we keep binary rendering out of the preview cache
// because pdfjs consumes the original bytes at display time.
//
// Why the redirect dance instead of returning HTML?
//   1. pdfjs needs a fetchable URL (it streams pages in chunks); a
//      data: URL would force all bytes into memory up front.
//   2. /file/pdf applies our path-safety rules the same way the
//      rest of /file/* does, without duplicating logic here.
//   3. Keeps the provider stateless and trivially cacheable if we
//      later cache page thumbnails (not Phase 4 scope).

import { stat } from "node:fs/promises";

export const PDF_PROVIDER = {
  id: "pdf",
  extensions: [".pdf"],
  mimePrefixes: ["application/pdf"],
  priority: 10,
  version: "1",
  async render(ctx) {
    // Verify the file is present and readable — failing fast here
    // beats sending a redirect that 404s at /file/pdf.
    try { await stat(ctx.filePath); } catch {
      return { kind: "native-open", cacheable: false, meta: { reason: "not_found" } };
    }
    return {
      kind: "pdf-redirect",
      pdfPath: ctx.filePath,
      cacheable: false,
      meta: { provider: "pdf" }
    };
  }
};
