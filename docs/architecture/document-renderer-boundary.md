# Document Renderer Boundary

CAP-1 high-risk family migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/document-renderer.mjs` after static and runtime
preflight verification.

## Current State

- File: `src/service/capabilities/tools/document-renderer.mjs`
- Public API: `renderDocumentPreviewHtml`, `renderDocument`
- Tool caller: `generate_document` in `src/service/action_tools/tools/index.mjs`
- Direct render kinds owned here: `pptx`, `docx`, `xlsx`
- Preview/HTML rendering here supports `pptx`, `docx`, `xlsx`, `pdf`, and HTML
  preview content.

## Current Verifier Coverage

- `scripts/verify-document-renderer-contract.mjs` locks the moved owner,
  old-path removal, public exports, lazy heavy dependencies, local Mermaid/SVG
  helpers, no renderer/Electron/provider imports, `generate_document` contract
  fields, preview sidecar metadata, reversibility wiring, and this boundary
  document.
- `scripts/verify-document-renderer-runtime.mjs` executes
  `renderDocumentPreviewHtml`, `renderDocument`, and `generate_document(html)`.
  It proves local Mermaid assets, SVG sanitization, text escaping, unsupported
  kind rejection, DOCX/XLSX/PPTX binary creation, HTML artifact creation,
  `preview_html_path`, and primary reversibility metadata.
- Existing broader gates still apply:
  `scripts/verify-doc-renderer-arg-length.mjs`,
  `scripts/verify-action-tools.mjs`,
  `scripts/verify-file-reversibility-checkpoint.mjs`,
  `tests/behavior/document-diagram-components.test.mjs`, and
  `tests/behavior/svg-artifact-components.test.mjs`.

## Dependencies

| Import | Current path | Notes |
|--------|--------------|-------|
| `writeFile`, `mkdir` | `node:fs/promises` | Service-side artifact file writes |
| `path` | `node:path` | Target and parent path handling |
| `renderMermaidScriptTag` | `./mermaid-assets.mjs` | Local Mermaid asset script, no CDN |
| `sanitizeSvgMarkup` | `./svg-sanitize.mjs` | Sanitizes embedded SVG components |
| `pptxgenjs` | dynamic import | PPTX rendering, lazy-loaded |
| `docx` | dynamic import | DOCX rendering, lazy-loaded |
| `exceljs` | dynamic import | XLSX rendering, lazy-loaded |

## Artifact Boundary

- `generate_document` owns action-result wrapping, output-path sandboxing,
  preview sidecar writes, PDF fallback handling, and reversibility checkpoints.
- `document-renderer.mjs` owns document preview HTML and direct DOCX/PPTX/XLSX
  binary rendering only.
- Artifact kinds and metadata must remain stable:
  - tool id: `generate_document`
  - supported user-facing artifact kinds: `pptx`, `docx`, `xlsx`, `pdf`, `html`
  - preview metadata: `preview_html_path`
  - reversibility metadata: `reversibility`, `reversibility_sidecars`
  - PDF fallback metadata: `needs_pdf_conversion`, `pdf_conversion_error`

## No-Touch Areas

- Do not change tool ids, artifact kinds, MIME mappings, preview metadata, or
  storage schema.
- Do not change IPC channels, HTTP routes, provider ids, approval behavior, or
  public action-tool registry ids.
- Do not move PDF/HTML fallback ownership out of `generate_document`.
- Do not add compatibility barrels or parallel old/new renderer
  implementations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Heavy package imports regress startup or tool-surface cost | High | Contract verifier locks lazy dynamic imports |
| Preview HTML loses local Mermaid or SVG sanitization | High | Runtime verifier checks local asset and sanitized SVG output |
| Artifact metadata changes break preview/recovery UI | High | Contract and runtime verifiers lock `preview_html_path` and reversibility |
| PDF/HTML fallback behavior gets folded into the helper | Medium | Contract doc keeps fallback ownership in `generate_document` |
| Physical move creates stale old-owner assertions | Medium | Contract, registry, roots, and stale-owner verifiers lock the moved owner |

## Decision

Moved from the old action-tools owner to
`src/service/capabilities/tools/document-renderer.mjs` in CAP-1 as a focused
artifact-renderer tool-family move. The old owner path must not return as a
compatibility barrel or parallel implementation.

Remaining follow-up:
- CAP-2 schemas/registry migration remains blocked until remaining high-risk
  tool families are classified and reviewed.
