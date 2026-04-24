// Content-addressed cache for preview HTML (UCA-182).
//
// Providers return HTML strings; the registry caches them by
//   sha256(filePath + mtimeMs + providerId + providerVersion)
//
// so that
//   (a) reopening the same file → instant (disk read)
//   (b) editing the file on disk → auto-invalidated (mtime changed)
//   (c) bumping a provider's version field → auto-invalidated
//
// An in-process LRU sits on top to avoid even the disk read when the
// user toggles between two or three files rapidly.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LRU_MAX = 32;

export function createPreviewCache({ cacheDir, lruMax = DEFAULT_LRU_MAX } = {}) {
  if (!cacheDir) throw new Error("createPreviewCache: cacheDir required");
  const lru = new Map(); // preserves insertion order for LRU eviction

  function lruGet(key) {
    if (!lru.has(key)) return null;
    const value = lru.get(key);
    lru.delete(key);
    lru.set(key, value);
    return value;
  }
  function lruSet(key, value) {
    if (lru.has(key)) lru.delete(key);
    lru.set(key, value);
    while (lru.size > lruMax) {
      const oldest = lru.keys().next().value;
      lru.delete(oldest);
    }
  }

  async function computeKey(filePath, providerId, providerVersion) {
    let mtimeMs = 0;
    try { mtimeMs = (await stat(filePath)).mtimeMs | 0; } catch { /* file gone — still hashable */ }
    const h = createHash("sha256");
    h.update(filePath);
    h.update("|");
    h.update(String(mtimeMs));
    h.update("|");
    h.update(providerId);
    h.update("|");
    h.update(providerVersion);
    return h.digest("hex");
  }

  async function get(filePath, providerId, providerVersion) {
    const key = await computeKey(filePath, providerId, providerVersion);
    const hot = lruGet(key);
    if (hot) return { html: hot, source: "lru", key };
    try {
      const diskPath = path.join(cacheDir, `${key}.html`);
      const html = await readFile(diskPath, "utf8");
      lruSet(key, html);
      return { html, source: "disk", key };
    } catch {
      return { html: null, source: null, key };
    }
  }

  async function set(key, html) {
    lruSet(key, html);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, `${key}.html`), html, "utf8");
  }

  return { get, set, computeKey };
}
