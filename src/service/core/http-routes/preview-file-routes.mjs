import { createReadStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { extractFileContent } from "../../extractors/file-ingest.mjs";
import { sendJson } from "../http-helpers.mjs";

export async function tryHandlePreviewFileRoute({ request, response, method, url, runtime }) {
  if (method === "GET" && url.pathname === "/file/render-preview-html") {
    const target = url.searchParams.get("path");
    if (!target) {
      sendJson(response, 400, { error: "missing path" });
      return true;
    }
    try {
      const result = await runtime.previewRegistry?.render(target);
      if (result?.kind === "html" && result.html) {
        const headers = { "Content-Type": "text/html; charset=utf-8" };
        if (result.etag) headers.ETag = `"${result.etag}"`;
        response.writeHead(200, headers);
        response.end(result.html);
        return true;
      }
      if (result?.kind === "pdf-redirect" && result.pdfPath) {
        response.writeHead(302, { Location: `/file/pdf?path=${encodeURIComponent(result.pdfPath)}` });
        response.end();
        return true;
      }
      sendJson(response, 404, {
        error: "no preview provider",
        reason: result?.meta?.reason ?? "unknown",
        ext: path.extname(target).toLowerCase()
      });
      return true;
    } catch (error) {
      sendJson(response, 500, { error: error.message });
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/file/pdf") {
    const target = url.searchParams.get("path");
    if (!target) {
      sendJson(response, 400, { error: "missing path" });
      return true;
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        sendJson(response, 404, { error: "not a file" });
        return true;
      }
      const range = request.headers["range"];
      if (range && range.startsWith("bytes=")) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Number(match[2]) : info.size - 1;
        if (start >= info.size || end >= info.size || start > end) {
          response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
          response.end();
          return true;
        }
        response.writeHead(206, {
          "Content-Type": "application/pdf",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=0"
        });
        createReadStream(target, { start, end }).pipe(response);
        return true;
      }
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": String(info.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0"
      });
      createReadStream(target).pipe(response);
      return true;
    } catch (error) {
      sendJson(response, 500, { error: error.message });
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/preview/status") {
    const list = runtime.previewRegistry?.list?.() ?? [];
    const metrics = runtime.previewRegistry?.metricsSnapshot?.() ?? {};
    const cacheDir = runtime.paths?.previewCacheDir ?? null;
    let cache = { dir: cacheDir, files: 0, bytes: 0 };
    if (cacheDir) {
      try {
        const files = await readdir(cacheDir).catch(() => []);
        let bytes = 0;
        for (const name of files) {
          try { bytes += (await stat(path.join(cacheDir, name))).size; } catch { /* ignore */ }
        }
        cache = { dir: cacheDir, files: files.length, bytes };
      } catch { /* cache dir missing */ }
    }
    sendJson(response, 200, {
      providers: list,
      metrics,
      cache
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/preview/cache/clear") {
    const cacheDir = runtime.paths?.previewCacheDir;
    if (!cacheDir) {
      sendJson(response, 400, { error: "previewCacheDir not configured" });
      return true;
    }
    try {
      const files = await readdir(cacheDir).catch(() => []);
      let removed = 0;
      for (const name of files) {
        try {
          await unlink(path.join(cacheDir, name));
          removed += 1;
        } catch { /* skip */ }
      }
      sendJson(response, 200, { ok: true, removed });
      return true;
    } catch (error) {
      sendJson(response, 500, { error: error.message });
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/file/extract-text") {
    const target = url.searchParams.get("path");
    const limitParam = Number(url.searchParams.get("limit") ?? 8000);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50000) : 8000;
    if (!target) {
      sendJson(response, 400, { error: "missing path" });
      return true;
    }
    try {
      const extracted = await extractFileContent(target);
      const text = String(extracted?.text ?? "").slice(0, limit);
      sendJson(response, 200, { text, mime: extracted?.mime ?? null, mode: extracted?.extraction_mode ?? null });
      return true;
    } catch (error) {
      sendJson(response, 500, { error: error.message });
      return true;
    }
  }

  return false;
}
