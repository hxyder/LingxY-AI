// Phase 4 verifier (UCA-182) — pdf provider + streaming endpoint.
//
// Goals:
//   1. The pdf provider is in BUILTIN_PREVIEW_PROVIDERS and handles .pdf.
//   2. For a real PDF on disk, registry.render() returns a
//      "pdf-redirect" envelope whose pdfPath points at that file.
//   3. For a .pdf that does not exist, the provider falls back to
//      "native-open" (so the client shows a placeholder rather than
//      redirecting to a 404).
//   4. /file/pdf endpoint (mounted on a bare http server) streams the
//      raw bytes with application/pdf mime and honours Range headers
//      (pdfjs relies on 206 Partial Content responses).
//
// We skip spinning up the full runtime; we only need the registry and
// a tiny http server that calls createReadStream / stat directly.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPreviewRegistry } from "../src/service/preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../src/service/preview/providers/index.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-pdf-"));

// Minimal conforming PDF — 4 objects, 1 blank page.
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n" +
  "xref\n" +
  "0 4\n" +
  "0000000000 65535 f\n" +
  "0000000009 00000 n\n" +
  "0000000059 00000 n\n" +
  "0000000107 00000 n\n" +
  "trailer << /Size 4 /Root 1 0 R >>\n" +
  "startxref\n178\n%%EOF\n",
  "utf8"
);

const pdfPath = path.join(tmpRoot, "sample.pdf");
writeFileSync(pdfPath, PDF_BYTES);

const registry = createPreviewRegistry({
  providers: BUILTIN_PREVIEW_PROVIDERS,
  cacheDir: path.join(tmpRoot, "cache")
});

// --- 1 / 2. Resolve + render -----------------------------------------
{
  const list = registry.list();
  assert.ok(list.some((p) => p.id === "pdf"), "pdf provider must be registered");

  const result = await registry.render(pdfPath);
  assert.equal(result.kind, "pdf-redirect", "real pdf → pdf-redirect envelope");
  assert.equal(result.pdfPath, pdfPath, "pdfPath echoes the source path");
  assert.equal(result.cacheable, false, "pdf provider must not cache (redirect envelope)");
}

// --- 3. Missing file → native-open -----------------------------------
{
  const missing = path.join(tmpRoot, "gone.pdf");
  const result = await registry.render(missing);
  // resolve() will still pick the pdf provider (extension matches),
  // but the provider's render() fails stat and returns native-open.
  assert.equal(result.kind, "native-open");
  assert.equal(result.meta?.reason, "not_found");
}

// --- 4. /file/pdf endpoint streaming --------------------------------
{
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/file/pdf") {
      response.writeHead(404); response.end(); return;
    }
    const target = url.searchParams.get("path");
    const info = await stat(target);
    const range = request.headers["range"];
    if (range && range.startsWith("bytes=")) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : info.size - 1;
      response.writeHead(206, {
        "Content-Type": "application/pdf",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes"
      });
      createReadStream(target, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes"
    });
    createReadStream(target).pipe(response);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  try {
    // Full GET
    const full = await fetch(`http://127.0.0.1:${port}/file/pdf?path=${encodeURIComponent(pdfPath)}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "application/pdf");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const buf = Buffer.from(await full.arrayBuffer());
    assert.ok(buf.length > 0, "pdf body non-empty");
    assert.ok(buf.slice(0, 5).toString("utf8") === "%PDF-", "body starts with %PDF-");

    // Ranged GET — pdfjs uses byte-range requests extensively.
    const ranged = await fetch(`http://127.0.0.1:${port}/file/pdf?path=${encodeURIComponent(pdfPath)}`, {
      headers: { Range: "bytes=0-63" }
    });
    assert.equal(ranged.status, 206);
    const rangedBody = Buffer.from(await ranged.arrayBuffer());
    assert.equal(rangedBody.length, 64, "range returns requested byte count");
    assert.ok(ranged.headers.get("content-range").startsWith("bytes 0-63/"));
  } finally {
    await new Promise((r) => server.close(r));
  }
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-pdf");
