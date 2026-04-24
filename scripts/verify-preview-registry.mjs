// Phase 1 verifier (UCA-182) — preview registry scaffold.
//
// Asserts:
//   1. createPreviewRegistry dispatches by priority.
//   2. Sidecar provider wins when <name>-preview.html exists.
//   3. Unknown extensions return native-open (not a crash).
//   4. Cache LRU + disk roundtrip.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPreviewRegistry } from "../src/service/preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../src/service/preview/providers/index.mjs";
import { createPreviewCache } from "../src/service/preview/cache.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-preview-"));
const cacheDir = path.join(tmpRoot, "cache");

// --- 1. Sidecar win ---------------------------------------------------
{
  const artifact = path.join(tmpRoot, "report.docx");
  const sidecar = path.join(tmpRoot, "report-preview.html");
  writeFileSync(artifact, "fake docx bytes");
  writeFileSync(sidecar, "<p>hello sidecar</p>");
  const registry = createPreviewRegistry({
    providers: BUILTIN_PREVIEW_PROVIDERS,
    cacheDir
  });
  const result = await registry.render(artifact);
  assert.equal(result.kind, "html", "sidecar provider should return html");
  assert.ok(result.html.includes("hello sidecar"), "sidecar html should be forwarded verbatim");
  assert.equal(result.meta?.provider, "sidecar");
}

// --- 2. Unknown extension → native-open -------------------------------
{
  const registry = createPreviewRegistry({
    providers: BUILTIN_PREVIEW_PROVIDERS,
    cacheDir
  });
  const result = await registry.render(path.join(tmpRoot, "unknown.xyz"));
  assert.equal(result.kind, "native-open", "unknown file types should fall through to native-open");
}

// --- 3. Priority sort: custom high-priority provider wins -------------
{
  const customProvider = {
    id: "custom-test",
    extensions: [".docx"],
    priority: 999,
    version: "1",
    async render() {
      return { kind: "html", html: "<p>custom wins</p>", cacheable: false };
    }
  };
  const artifact = path.join(tmpRoot, "winner.docx");
  writeFileSync(artifact, "fake");
  const registry = createPreviewRegistry({
    providers: [...BUILTIN_PREVIEW_PROVIDERS, customProvider],
    cacheDir
  });
  const result = await registry.render(artifact);
  assert.equal(result.kind, "html");
  assert.ok(result.html.includes("custom wins"), "priority=999 provider must beat sidecar (priority=100)");
}

// --- 4. Cache roundtrip ----------------------------------------------
{
  const cache = createPreviewCache({ cacheDir });
  const artifact = path.join(tmpRoot, "cacheme.txt");
  writeFileSync(artifact, "hello");
  const { html: miss, source: missSource } = await cache.get(artifact, "test-provider", "1");
  assert.equal(miss, null, "fresh cache should miss");
  assert.equal(missSource, null);
  const { key } = await cache.get(artifact, "test-provider", "1");
  await cache.set(key, "<p>cached</p>");
  const { html: hit, source: hitSource } = await cache.get(artifact, "test-provider", "1");
  assert.equal(hit, "<p>cached</p>");
  assert.ok(["lru", "disk"].includes(hitSource));

  // Bump version → invalidation.
  const { html: bumpedMiss } = await cache.get(artifact, "test-provider", "2");
  assert.equal(bumpedMiss, null, "version bump must invalidate cache");
}

// --- 5. Registry.list + metrics snapshot ------------------------------
{
  const registry = createPreviewRegistry({
    providers: BUILTIN_PREVIEW_PROVIDERS,
    cacheDir
  });
  const list = registry.list();
  assert.ok(list.some((p) => p.id === "sidecar"), "built-in providers must include sidecar");
  const metrics = registry.metricsSnapshot();
  assert.equal(typeof metrics.renders, "number");
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-registry");
