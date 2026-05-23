// Preview provider contract (UCA-182).
//
// Every file-type preview strategy (docx/xlsx/pdf/md/…) is a module that
// exports a provider matching this shape. The registry dispatches by
// extension / MIME and never has to know about specific formats —
// adding epub/rtf/odt later means writing one more provider file,
// not touching core routing.
//
//   ┌────────────────┐   resolve(ext|mime)   ┌──────────────────┐
//   │  http-server   │ ────────────────────▶ │ PreviewRegistry   │
//   │  /file/render- │                       │                   │
//   │  preview-html  │ ◀──── { kind, html }  │  provider.render  │
//   └────────────────┘                       └──────────────────┘
//
// Contract:
//
//   id:            string   — unique stable id; used in cache key + metrics.
//   extensions:    string[] — lowercase with leading dot, e.g. [".docx"].
//   mimePrefixes?: string[] — optional secondary match (used when ext is absent).
//   priority:      number   — highest wins when multiple match. sidecar=100,
//                              format-specific providers default 10, generic
//                              fallbacks 1.
//   version:       string   — bumped when the provider's output format changes;
//                              participates in the cache key so old cached
//                              HTML is invalidated automatically.
//
//   canHandle?(ctx) → boolean
//     Optional override; default walks `extensions` then `mimePrefixes`.
//
//   async render(ctx) → {
//     kind: "html" | "pdf-redirect" | "native-open",
//     html?:    string,    // required when kind === "html"
//     pdfPath?: string,    // required when kind === "pdf-redirect"
//     cacheable: boolean,  // false for one-shot error/placeholder output
//     etag?:    string,    // optional; auto-derived from cache key otherwise
//     meta?:    object     // for metrics / debugging
//   }
//
//   ctx shape:
//     { filePath: string, ext: string, mime: string|null,
//       cacheDir: string, runtime: object }
//
// The registry is responsible for: extension dispatch, content-addressed
// caching, concurrency limiting, error isolation. Providers should be
// small, pure-ish functions that only know how to render one format.

/**
 * @typedef {Object} PreviewRenderContext
 * @property {string} filePath   absolute path to the file on disk
 * @property {string} ext        lowercase extension including dot, "" if none
 * @property {string|null} mime  best-effort mime type, may be null
 * @property {string} cacheDir   base dir where providers may drop sidecar artefacts
 * @property {object} runtime    reference to the full runtime (for logging etc.)
 */

/**
 * @typedef {Object} PreviewRenderResult
 * @property {"html"|"pdf-redirect"|"native-open"} kind
 * @property {string} [html]
 * @property {string} [pdfPath]
 * @property {boolean} cacheable
 * @property {string} [etag]
 * @property {object} [meta]
 */

/**
 * @typedef {Object} PreviewProvider
 * @property {string} id
 * @property {string[]} extensions
 * @property {string[]} [mimePrefixes]
 * @property {number} priority
 * @property {string} version
 * @property {(ctx: PreviewRenderContext) => boolean} [canHandle]
 * @property {(ctx: PreviewRenderContext) => Promise<PreviewRenderResult>} render
 */

export const PROVIDER_CONTRACT_VERSION = 1;

export function defaultCanHandle(provider, ctx) {
  const ext = (ctx.ext || "").toLowerCase();
  if (ext && provider.extensions?.includes(ext)) return true;
  if (ctx.mime && Array.isArray(provider.mimePrefixes)) {
    return provider.mimePrefixes.some((prefix) => ctx.mime.startsWith(prefix));
  }
  return false;
}
