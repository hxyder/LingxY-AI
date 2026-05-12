# SVG Sanitize Boundary

CAP-1 high-risk security-family migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/svg-sanitize.mjs` after static and runtime
preflight verification.

## Current State

- File: `src/service/capabilities/tools/svg-sanitize.mjs`
- Public API: `sanitizeSvgMarkup`, `isSafeSvgMarkup`
- Callers:
  - `src/service/capabilities/tools/document-render-tools.mjs` for
    `render_svg`.
  - `src/service/capabilities/tools/document-artifact-helpers.mjs` for PDF/HTML
    document outline SVG components.
  - `src/service/capabilities/tools/document-renderer.mjs` for document preview
    embedded SVG components.
  - `src/service/executors/tool_using/tool-call-validator.mjs` for
    `render_svg` validation.

## Current Verifier Coverage

- `scripts/verify-svg-sanitize-contract.mjs` locks the moved owner, old-path
  removal, public exports, import-free pure helper shape, known callers, and
  this boundary document.
- `scripts/verify-svg-sanitize-runtime.mjs` executes the sanitizer, `render_svg`,
  and document preview SVG paths. It proves forbidden element removal,
  self-closing forbidden element removal, event handler removal, javascript URL
  removal, xlink namespace removal, XML/doctype preamble removal, invalid input
  rejection, render tool rejection, standalone SVG artifact sanitization, and
  document preview sanitization.
- Existing broader gates still apply:
  `tests/behavior/svg-artifact-components.test.mjs`,
  `tests/behavior/tool-call-validator-document.test.mjs`,
  `scripts/verify-action-tools.mjs`, and
  `scripts/verify-artifact-generation-invariant.mjs`.

## Security Boundary

The sanitizer is a small pure helper. It must not import runtime, renderer,
Electron, provider, filesystem, or network code. It only transforms SVG markup
strings and returns an empty string for invalid or unsafe non-SVG inputs.

It currently removes:
- `script`, `foreignObject`, `iframe`, `object`, and `embed` elements.
- inline `on*=` event handlers.
- `href` and `xlink:href` javascript URLs.
- XML declarations and doctype preambles.
- `xmlns:xlink` declarations after xlink URL removal.

## No-Touch Areas

- Do not change tool ids, artifact kinds, MIME mappings, preview metadata, or
  storage schema.
- Do not change IPC channels, HTTP routes, provider ids, approval behavior, or
  public action-tool registry ids.
- Do not change `render_svg` output path, `artifactPaths`, or
  `image/svg+xml` metadata.
- Do not add compatibility barrels or parallel old/new sanitizer
  implementations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Sanitizer accepts active content | High | Runtime verifier covers scripts, event handlers, javascript URLs, and xlink |
| Document preview embeds unsafe SVG | High | Runtime verifier checks document preview SVG figure output |
| render_svg writes unsafe standalone SVG | High | Runtime verifier executes `RENDER_SVG_TOOL` and inspects output |
| Validator diverges from renderer | Medium | Contract verifier locks validator import and runtime verifier covers invalid rejection |
| Physical move creates stale old-owner assertions | Medium | Contract, registry, roots, and stale-owner verifiers lock the moved owner |

## Decision

Moved from the old action-tools owner to
`src/service/capabilities/tools/svg-sanitize.mjs` in CAP-1 as a focused
security helper move. The old owner path must not return as a compatibility
barrel or parallel implementation.

Remaining follow-up:
- CAP-2 schemas/registry migration remains blocked until remaining high-risk
  tool families are classified and reviewed.
