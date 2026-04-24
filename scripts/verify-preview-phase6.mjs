import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { readdir, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createPreviewRegistry } from "../src/service/preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../src/service/preview/providers/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-preview-p6-"));
const cacheDir = path.join(tmpRoot, "cache");
mkdirSync(cacheDir, { recursive: true });

const registry = createPreviewRegistry({
  providers: BUILTIN_PREVIEW_PROVIDERS,
  cacheDir
});
const snapshot = registry.metricsSnapshot();
assert.equal(typeof snapshot.renders, "number");
assert.equal(typeof snapshot.cacheHits, "number");
assert.ok(snapshot.byProvider && typeof snapshot.byProvider === "object");

writeFileSync(path.join(cacheDir, "a.html"), "<p>a</p>");
writeFileSync(path.join(cacheDir, "b.html"), "<p>b</p>");

const fakeRuntime = {
  previewRegistry: registry,
  paths: { previewCacheDir: cacheDir }
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/preview/status") {
    const list = fakeRuntime.previewRegistry.list();
    const metrics = fakeRuntime.previewRegistry.metricsSnapshot();
    const files = await readdir(cacheDir).catch(() => []);
    let bytes = 0;
    for (const n of files) try { bytes += (await stat(path.join(cacheDir, n))).size; } catch {}
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      providers: list,
      metrics,
      cache: { dir: cacheDir, files: files.length, bytes }
    }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/preview/cache/clear") {
    const files = await readdir(cacheDir).catch(() => []);
    let removed = 0;
    for (const n of files) try { await unlink(path.join(cacheDir, n)); removed += 1; } catch {}
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, removed }));
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

try {
  const statusResp = await fetch(`http://127.0.0.1:${port}/preview/status`);
  assert.equal(statusResp.status, 200);
  const status = await statusResp.json();
  assert.ok(Array.isArray(status.providers), "status.providers is an array");
  assert.ok(status.providers.some((p) => p.id === "pdf"), "pdf provider listed");
  assert.ok(status.providers.some((p) => p.id === "pptx"), "pptx provider listed");
  assert.equal(typeof status.metrics.renders, "number");
  assert.equal(status.cache.files, 2, "cache.files should count the two seeded entries");
  assert.ok(status.cache.bytes > 0, "cache.bytes non-zero");

  const clearResp = await fetch(`http://127.0.0.1:${port}/preview/cache/clear`, { method: "POST" });
  assert.equal(clearResp.status, 200);
  const clearBody = await clearResp.json();
  assert.equal(clearBody.ok, true);
  assert.equal(clearBody.removed, 2);

  const status2 = await (await fetch(`http://127.0.0.1:${port}/preview/status`)).json();
  assert.equal(status2.cache.files, 0, "cache cleared");
  assert.equal(status2.cache.bytes, 0);
} finally {
  await new Promise((r) => server.close(r));
}

{
  const text = readFileSync(path.join(ROOT, "src/service/core/service-bootstrap.mjs"), "utf8");
  assert.ok(text.includes('import("marked")') || text.includes("import(\"marked\")"));
  assert.ok(text.includes('import("mammoth")') || text.includes("import(\"mammoth\")"));
}

{
  const html = readFileSync(path.join(ROOT, "src/desktop/renderer/console.html"), "utf8");
  assert.ok(html.includes('id="previewSettingsPanel"'));
  assert.ok(html.includes('id="previewCacheClearBtn"'));
  assert.ok(html.includes('id="previewStrategyInfo"'));
  const js = readFileSync(path.join(ROOT, "src/desktop/renderer/console.js"), "utf8");
  assert.ok(js.includes("renderPreviewSettings"));
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-phase6");
