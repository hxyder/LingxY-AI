// Preview provider registry (UCA-182).
//
// Central dispatcher that:
//   1. Picks the highest-priority provider whose canHandle() matches.
//   2. Wraps each render() in a content-addressed cache.
//   3. Limits concurrency so parallel renders don't starve the runtime.
//   4. Reports metrics (cache hit rate, per-provider latency).
//   5. Isolates errors — a broken provider returns a placeholder, not a 500.
//
// The registry is intentionally thin: all format-specific logic lives in
// provider modules. The runtime owns exactly one instance per process.

import path from "node:path";
import { defaultCanHandle } from "./provider.mjs";
import { createPreviewCache } from "./cache.mjs";

const DEFAULT_CONCURRENCY = 4;

function createLimit(max) {
  let active = 0;
  const queue = [];
  const run = () => {
    while (active < max && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(fn)
        .then((value) => { active -= 1; resolve(value); run(); })
        .catch((err) => { active -= 1; reject(err); run(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    run();
  });
}

function extOf(filePath) {
  const m = path.extname(filePath || "");
  return m ? m.toLowerCase() : "";
}

export function createPreviewRegistry({
  providers = [],
  cacheDir,
  concurrency = DEFAULT_CONCURRENCY,
  runtime = null
} = {}) {
  const sorted = [...providers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const cache = cacheDir ? createPreviewCache({ cacheDir }) : null;
  const limit = createLimit(concurrency);
  const metrics = {
    renders: 0,
    cacheHits: 0,
    byProvider: new Map() // id → { hits, renderMs, errors }
  };

  function recordMetric(providerId, { hit = false, ms = 0, error = false } = {}) {
    metrics.renders += 1;
    if (hit) metrics.cacheHits += 1;
    if (!metrics.byProvider.has(providerId)) {
      metrics.byProvider.set(providerId, { hits: 0, renderMs: 0, errors: 0, cacheHits: 0 });
    }
    const bucket = metrics.byProvider.get(providerId);
    bucket.hits += 1;
    if (hit) bucket.cacheHits += 1;
    else bucket.renderMs += ms;
    if (error) bucket.errors += 1;
  }

  async function resolve(filePath, mime = null) {
    const ext = extOf(filePath);
    const ctx = { filePath, ext, mime, cacheDir, runtime };
    for (const provider of sorted) {
      const hit = typeof provider.canHandle === "function"
        ? await provider.canHandle(ctx)
        : defaultCanHandle(provider, ctx);
      if (hit) return provider;
    }
    return null;
  }

  async function render(filePath, { mime = null } = {}) {
    const provider = await resolve(filePath, mime);
    if (!provider) {
      return {
        kind: "native-open",
        cacheable: false,
        meta: { reason: "no_provider_matched", ext: extOf(filePath) }
      };
    }
    const ext = extOf(filePath);
    const ctx = { filePath, ext, mime, cacheDir, runtime };

    // Cache lookup.
    if (cache && provider.version) {
      const { html, source, key } = await cache.get(filePath, provider.id, provider.version);
      if (html) {
        recordMetric(provider.id, { hit: true });
        return { kind: "html", html, cacheable: true, etag: key, meta: { source, cached: true, provider: provider.id } };
      }
      return limit(() => runAndCache(provider, ctx, key));
    }
    return limit(() => runAndCache(provider, ctx, null));
  }

  async function runAndCache(provider, ctx, cacheKey) {
    const started = Date.now();
    try {
      const result = await provider.render(ctx);
      const ms = Date.now() - started;
      recordMetric(provider.id, { hit: false, ms });
      if (result.kind === "html" && result.cacheable && cache && cacheKey) {
        try { await cache.set(cacheKey, result.html); } catch { /* cache write is best-effort */ }
        return { ...result, etag: result.etag ?? cacheKey, meta: { ...(result.meta ?? {}), provider: provider.id, cached: false, renderMs: ms } };
      }
      return { ...result, meta: { ...(result.meta ?? {}), provider: provider.id, cached: false, renderMs: ms } };
    } catch (error) {
      recordMetric(provider.id, { hit: false, ms: Date.now() - started, error: true });
      return {
        kind: "native-open",
        cacheable: false,
        meta: { provider: provider.id, error: error.message }
      };
    }
  }

  return {
    resolve,
    render,
    list() {
      return sorted.map((p) => ({
        id: p.id,
        extensions: p.extensions,
        priority: p.priority,
        version: p.version
      }));
    },
    metricsSnapshot() {
      return {
        renders: metrics.renders,
        cacheHits: metrics.cacheHits,
        byProvider: Object.fromEntries(metrics.byProvider)
      };
    }
  };
}
