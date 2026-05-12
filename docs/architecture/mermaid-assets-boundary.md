# Mermaid Assets Boundary

CAP-1 high-risk render-asset migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/mermaid-assets.mjs` after static and runtime
preflight verification.

## Current State

- File: `src/service/capabilities/tools/mermaid-assets.mjs`
- Public API: `resolveMermaidScriptSrc`, `MERMAID_SCRIPT_SRC`,
  `renderMermaidScriptTag`
- Callers:
  - `src/service/capabilities/tools/document-render-tools.mjs` for
    `render_diagram` HTML templates.
  - `src/service/capabilities/tools/document-artifact-helpers.mjs` for
    PDF/HTML templates.
  - `src/service/capabilities/tools/document-renderer.mjs` for document preview
    HTML.
  - `src/service/executors/kimi/output-format.mjs` for Kimi HTML previews.

## Current Verifier Coverage

- `scripts/verify-mermaid-assets-contract.mjs` locks the moved owner, old-path
  removal, public exports, local dependency specifier, known callers, no CDN
  strings, and this boundary document.
- `scripts/verify-mermaid-assets-runtime.mjs` executes the resolver and script
  tag helper, proves attribute escaping, checks the local Mermaid bundle exists,
  and exercises `render_diagram` plus document preview HTML output.
- Existing broader gates still apply:
  `tests/behavior/mermaid-local-assets.test.mjs`,
  `tests/behavior/document-diagram-components.test.mjs`,
  `scripts/verify-action-tools.mjs`, and
  `scripts/verify-preview-window.mjs`.

## Render Asset Boundary

This helper is only allowed to resolve and render a script tag for the local
`mermaid/dist/mermaid.min.js` dependency. It must not import runtime, renderer,
Electron, provider, filesystem write, or network code. It must never point
generated artifacts to a CDN.

## No-Touch Areas

- Do not change tool ids, artifact kinds, MIME mappings, preview metadata, or
  storage schema.
- Do not change IPC channels, HTTP routes, provider ids, approval behavior, or
  public action-tool registry ids.
- Do not change `render_diagram` output path, `artifactPaths`, or generated HTML
  fallback behavior.
- Do not add compatibility barrels or parallel old/new Mermaid helper
  implementations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Generated artifacts load Mermaid from CDN | High | Runtime verifier checks resolver, render_diagram, and document preview output |
| Script tag injection through custom src | Medium | Runtime verifier checks HTML attribute escaping |
| Kimi/document/render_diagram callers diverge | Medium | Contract verifier locks all known imports |
| Physical move creates stale old-owner assertions | Medium | Contract, registry, roots, and stale-owner verifiers lock the moved owner |

## Decision

moved from `src/service/action_tools/tools/mermaid-assets.mjs` to
`src/service/capabilities/tools/mermaid-assets.mjs` in CAP-1 as a focused
render-asset helper move. The old owner path must not return as a compatibility
barrel or parallel implementation.

Remaining follow-up:
- CAP-2 schemas/registry migration remains blocked until remaining high-risk
  tool families are classified and reviewed.
